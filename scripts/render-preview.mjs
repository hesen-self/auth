#!/usr/bin/env node
/**
 * 端到端渲染一份可离线查看的 UI 预览（public/preview.html）。
 *
 * 直接调用 Worker 的 fetch()，注入与 wrangler.jsonc 的 access.dev 一致的模拟身份，
 * 并用本地 mock 顶替 /cdn-cgi/access/get-identity 的网络请求。
 * 不需要安装依赖、不需要起服务、不联网 —— 同时也是 Worker 渲染逻辑的一次冒烟测试。
 *
 *   npm run preview
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';
import { renderLogoutPage } from '../src/render.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// wrangler.jsonc 含整行注释，剥掉后按 JSON 解析，保证 dev 身份只有一处定义。
const configText = readFileSync(resolve(ROOT, 'wrangler.jsonc'), 'utf8')
  .split(/\r?\n/)
  .filter((line) => !/^\s*\/\//.test(line))
  .join('\n');
const config = JSON.parse(configText);
const devIdentity = config.access.dev.identity;

const env = {
  TEAM_DOMAIN: 'https://demo-team.cloudflareaccess.com',
  POLICY_AUD: '', // 预览里没有真实 JWT，验签通道按预期显示「跳过」
  APP_NAME: config.vars.APP_NAME || 'Identity Console',
};

// 扩展身份端点的本地替身：字段结构与官方文档一致。
const fullIdentityDemo = {
  ...devIdentity,
  device_sessions: {
    '11111111-2222-3333-4444-555555555555': {
      last_authenticated: devIdentity.iat,
      warp_as_idp: { iat: devIdentity.iat, expires: devIdentity.iat + 28800 },
    },
  },
  custom: {
    groups: ['dev-team', 'identity-console-admin'],
    email_verified: true,
    preferred_username: devIdentity.email.split('@')[0],
  },
  gateway_account_id: 'demo-gateway-account',
  device_id: '11111111-2222-3333-4444-555555555555',
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input?.url ?? '');
  if (url.includes('/cdn-cgi/access/get-identity')) {
    return new Response(JSON.stringify(fullIdentityDemo), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return originalFetch(input, init);
};

const headers = new Headers({
  'accept': 'text/html,application/xhtml+xml',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
  'host': 'auth.hesen.dpdns.org',
  'cf-connecting-ip': '203.0.113.10',
  'cf-ipcountry': 'CN',
  'cf-ray': '8d1f2b3c4e5f6a7b-HKG',
  'x-forwarded-proto': 'https',
  // 故意放一个会话 Cookie，用来验证页面确实做了脱敏。
  'cookie': 'CF_Authorization=dev-session-token-must-never-appear-in-html; theme=dark',
});

const request = new Request('https://auth.hesen.dpdns.org/', { method: 'GET', headers });
Object.defineProperty(request, 'cf', {
  value: {
    colo: 'HKG',
    country: 'CN',
    city: 'Shenzhen',
    continent: 'AS',
    latitude: '22.5431',
    longitude: '114.0579',
    timezone: 'Asia/Shanghai',
    region: 'Guangdong',
    regionCode: 'GD',
    postalCode: '518000',
    asn: 4134,
    asOrganization: 'CHINANET-BACKBONE',
    httpProtocol: 'HTTP/3',
    tlsVersion: 'TLSv1.3',
    tlsCipher: 'AEAD-AES128-GCM-SHA256',
    clientAcceptEncoding: 'gzip, br',
    clientTcpRtt: 24,
  },
});

const ctx = {
  access: {
    aud: config.access.dev.aud,
    getIdentity: async () => structuredClone(devIdentity),
  },
};

const response = await worker.fetch(request, env, ctx);
const html = await response.text();
globalThis.fetch = originalFetch;

if (response.status !== 200) {
  console.error(`渲染失败：HTTP ${response.status}`);
  console.error(html.slice(0, 800));
  process.exit(1);
}

mkdirSync(resolve(ROOT, 'public'), { recursive: true });
writeFileSync(resolve(ROOT, 'public/preview.html'), html, 'utf8');

// 同时导出一份快照 JSON，方便核对字段与做回归对比。
const snapshotResponse = await worker.fetch(
  new Request('https://auth.hesen.dpdns.org/api/snapshot', { method: 'GET', headers }),
  env,
  ctx,
);
const snapshotText = await snapshotResponse.text();
writeFileSync(resolve(ROOT, 'public/snapshot.example.json'), snapshotText, 'utf8');

// 登录记录列表页：先验证无绑定时优雅降级，再用内存 mock 生成带示例数据的预览。
const logsUrl = 'https://auth.hesen.dpdns.org/logs';
const degraded = await worker.fetch(new Request(logsUrl, { method: 'GET', headers }), env, ctx);
const degradedHtml = await degraded.text();

const sampleRows = [0, 1, 2].map((index) => ({
  id: `sample-log-${index + 1}`,
  user_uuid: devIdentity.user_uuid,
  email: devIdentity.email,
  name: devIdentity.name,
  login_method: ['GitHub', 'Google', '邮箱验证码'][index],
  login_method_key: ['github', 'google', 'pin'][index],
  idp_type: ['github', 'google', 'onetimepin'][index],
  country: 'CN',
  city: ['Shenzhen', 'Shanghai', 'Beijing'][index],
  ip: `203.0.113.${10 + index}`,
  colo: 'HKG',
  asn: '4134',
  as_org: 'CHINANET-BACKBONE',
  user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0',
  auth_at: devIdentity.iat - index * 3600,
  session_exp: devIdentity.iat + 28800,
  aud: config.access.dev.aud,
  groups_json: JSON.stringify(['dev-team', 'identity-console-admin']),
  identity_json: JSON.stringify(devIdentity),
  dev_mode: 1,
  created_at: new Date(Date.now() - index * 3600000).toISOString(),
}));

// 只实现 storage.js 用到的 D1 / R2 方法，纯内存、不联网。
function createMockDb(rows) {
  return {
    prepare(sql) {
      let args = [];
      const statement = {
        bind(...values) { args = values; return statement; },
        async all() { return { results: rows }; },
        async first() {
          if (sql.includes('COUNT(*)')) return { total: rows.length };
          if (sql.includes('WHERE id = ?')) return rows.find((row) => row.id === args[0]) || null;
          return rows[0] || null;
        },
        async run() { return { changes: 0 }; },
      };
      return statement;
    },
  };
}

const createMockR2 = () => ({ async get() { return null; }, async put() { return {}; } });
const previewEnv = { ...env, DB: createMockDb(sampleRows), AVATARS: createMockR2() };

const logsResponse = await worker.fetch(new Request(logsUrl, { method: 'GET', headers }), previewEnv, ctx);
const logsHtml = await logsResponse.text();
writeFileSync(resolve(ROOT, 'public/logs-preview.html'), logsHtml, 'utf8');

const detailResponse = await worker.fetch(
  new Request(`${logsUrl}/sample-log-1`, { method: 'GET', headers }), previewEnv, ctx,
);
const detailHtml = await detailResponse.text();
writeFileSync(resolve(ROOT, 'public/log-detail-preview.html'), detailHtml, 'utf8');

// 退出中间页：先验证 Worker 路由（dev 态），再生成一份「生产态」预览便于查看真实效果。
const logoutResponse = await worker.fetch(
  new Request('https://auth.hesen.dpdns.org/logout', { method: 'GET', headers }), env, ctx,
);
const logoutHtml = await logoutResponse.text();
const prodLogoutSnapshot = structuredClone(JSON.parse(snapshotText));
prodLogoutSnapshot.meta.devMode = false;
prodLogoutSnapshot.meta.teamDomain = 'https://seazen.cloudflareaccess.com';
prodLogoutSnapshot.jwt.claims = { ...(prodLogoutSnapshot.jwt.claims || {}), aud: config.vars.POLICY_AUD };
const prodLogoutHtml = renderLogoutPage(prodLogoutSnapshot);
writeFileSync(resolve(ROOT, 'public/logout-preview.html'), prodLogoutHtml, 'utf8');

// 未认证访问（403）也应提供「前往登录页」入口，形成登录 / 退出的状态切换。
const forbiddenResponse = await worker.fetch(
  new Request('https://auth.hesen.dpdns.org/', { method: 'GET', headers: new Headers({ host: 'auth.hesen.dpdns.org' }) }),
  env,
  {},
);
const forbiddenHtml = await forbiddenResponse.text();

// 冒烟断言
const checks = [
  ['页面包含身份邮箱', html.includes(devIdentity.email)],
  ['页面包含三种登录方式', html.includes('GitHub') && html.includes('Google') && html.includes('邮箱验证码')],
  ['页面包含四个数据面板', (html.match(/class="panel /g) || []).length === 4],
  ['会话令牌已脱敏', !html.includes('dev-session-token-must-never-appear-in-html')],
  ['敏感头标记为脱敏', html.includes('[已脱敏')],
  ['页面包含 R2 头像与上传入口', html.includes('avatar-img') && html.includes('avatar-upload')],
  ['页面包含登录记录导航', html.includes('href="/logs"')],
  ['日志列表页可渲染', logsResponse.status === 200 && logsHtml.includes('登录记录')],
  ['无 D1 绑定时列表页给出降级提示', degraded.status === 200 && degradedHtml.includes('存储尚未配置')],
  ['列表页含示例记录表格', logsHtml.includes('<tbody>') && logsHtml.includes('sample-log-1')],
  ['详情页含脱敏身份对象', detailResponse.status === 200 && detailHtml.includes('落库的身份对象')],
  ['顶栏包含退出登录按钮', html.includes('href="/logout"') && html.includes('退出登录')],
  ['列表页 / 详情页也包含退出按钮', logsHtml.includes('href="/logout"') && detailHtml.includes('href="/logout"')],
  ['退出页可渲染', logoutResponse.status === 200 && logoutHtml.includes('正在退出登录')],
  ['本地 dev 退出页给出降级说明', logoutHtml.includes('本地 dev 模式') && logoutHtml.includes('返回首页（重新登录）')],
  ['生产态退出页触发官方登出端点', prodLogoutHtml.includes('/cdn-cgi/access/logout') && prodLogoutHtml.includes('立即重新登录')],
  ['生产态退出页同时触发 team 域名全局登出', prodLogoutHtml.includes('seazen.cloudflareaccess.com/cdn-cgi/access/logout')],
  ['生产态退出页跳回应用首页由 Access 302 到登录页', prodLogoutHtml.includes("location.replace('/')")],
  ['未登录 403 页提供前往登录页入口', forbiddenResponse.status === 403 && forbiddenHtml.includes('前往 Access 登录页')],
];
console.log('\n预览生成：public/preview.html');
console.log(`页面大小：${(Buffer.byteLength(html) / 1024).toFixed(1)} KB\n`);
for (const [name, ok] of checks) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
console.log('\n全部冒烟检查通过。\n');
