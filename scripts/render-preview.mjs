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
writeFileSync(resolve(ROOT, 'public/snapshot.example.json'), await snapshotResponse.text(), 'utf8');

// 冒烟断言
const checks = [
  ['页面包含身份邮箱', html.includes(devIdentity.email)],
  ['页面包含三种登录方式', html.includes('GitHub') && html.includes('Google') && html.includes('邮箱验证码')],
  ['页面包含四个数据面板', (html.match(/class="panel /g) || []).length === 4],
  ['会话令牌已脱敏', !html.includes('dev-session-token-must-never-appear-in-html')],
  ['敏感头标记为脱敏', html.includes('[已脱敏')],
];
console.log('\n预览生成：public/preview.html');
console.log(`页面大小：${(Buffer.byteLength(html) / 1024).toFixed(1)} KB\n`);
for (const [name, ok] of checks) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
console.log('\n全部冒烟检查通过。\n');
