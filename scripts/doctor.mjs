#!/usr/bin/env node
/**
 * 只读自检：确认 Cloudflare 凭证是否有效、Zero Trust 各端点权限是否齐备。
 * 不会创建或修改任何云端资源。
 *
 *   npm run doctor
 */
import {
  loadEnv, normalizeTeamDomain, fingerprint, authMode,
  request, ApiError, REQUIRED_PERMISSIONS, TOKEN_CONSOLE,
} from './lib/cf.mjs';

const env = loadEnv();
const ACCOUNT_ID = env.CF_ACCOUNT_ID || '9c2b9da6ca5beb3887a5f6152e3bac7d';
const globalKey = authMode(env) === 'global-key';
const base = `/accounts/${ACCOUNT_ID}/access`;
const teamDomain = normalizeTeamDomain(env.CF_TEAM_NAME);

console.log('\nCloudflare Access 配置自检（只读探测 + 一次非破坏性写权限测试）');
console.log('='.repeat(72));

console.log('\n凭证（仅显示形态，不输出值）');
console.log(`  认证方式        : ${globalKey ? 'Global API Key' : 'API Token (Bearer)'}`);
const tokenLabel = globalKey ? 'CF_GLOBAL_API_KEY' : 'CF_API_TOKEN';
console.log(`  ${tokenLabel.padEnd(16)}: ${fingerprint(globalKey ? env.CF_GLOBAL_API_KEY : env.CF_API_TOKEN)}`);
console.log(`  CF_ACCOUNT_ID   : ${ACCOUNT_ID ? '已设置 (' + ACCOUNT_ID.length + ' 字符)' : '【未设置】'}`);
console.log(`  CF_TEAM_NAME    : ${env.CF_TEAM_NAME || '【未设置】'} ${teamDomain ? '→ ' + teamDomain : ''}`);
console.log(`  APP_DOMAIN      : ${env.APP_DOMAIN || '【未设置】'}`);
const gh = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
const gg = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
console.log(`  OAuth 凭证      : GitHub ${gh ? '✓' : '✗'} / Google ${gg ? '✓' : '✗'}  (✗ = 该 IdP 会被 setup 跳过)`);
const allow = [env.ALLOWED_EMAILS, env.ALLOWED_EMAIL_DOMAIN].filter(Boolean).join(', ');
console.log(`  登录白名单      : ${allow || '【空】将使用 everyone（PIN + 任意邮箱可登录，仅适合 MVP）'}`);

if (!globalKey && !env.CF_API_TOKEN) {
  console.error('\n[阻塞] CF_API_TOKEN 未设置。请在 .dev.vars 填入后重跑。\n');
  process.exit(1);
}

console.log('\n端点权限矩阵');
async function probe(label, path) {
  try {
    const payload = await request(env, 'GET', path);
    const extra = Array.isArray(payload.result)
      ? `${payload.result.length} 条记录`
      : payload.result?.name || payload.result?.auth_domain || '';
    console.log(`  [OK]   ${label.padEnd(32)} 200  ${extra}`);
    return { ok: true };
  } catch (error) {
    const codes = error instanceof ApiError ? error.codes : [];
    const detail = error.message.includes('→ ') ? error.message.split('→ ')[1] : error.message;
    console.log(`  [FAIL] ${label.padEnd(32)} ${String(error.status || 'ERR').padEnd(4)} ${detail.slice(0, 62)}`);
    return { ok: false, status: error.status, codes, error };
  }
}

const account = await probe('账号信息 /accounts/:id', `/accounts/${ACCOUNT_ID}`);
const orgs = await probe('组织 /access/organizations', `${base}/organizations`);
const idps = await probe('IdP /access/identity_providers', `${base}/identity_providers`);
const apps = await probe('应用 /access/apps', `${base}/apps`);

/**
 * 写权限探测：故意 POST 一个必定被参数校验拒绝的空 body。
 * 权限检查在参数校验之前 —— 无写权限恒返回 403/1010，有写权限则会进入参数校验返回其他 4xx。
 * 不会创建任何资源。
 */
async function probeWrite() {
  const label = '写权限 POST /identity_providers';
  try {
    await request(env, 'POST', `${base}/identity_providers`, {});
    console.log(`  [WARN] ${label.padEnd(32)} 200  意外接受了空请求体，请到控制台人工核查`);
    return { ok: true, unexpected: true };
  } catch (error) {
    const codes = error instanceof ApiError ? error.codes : [];
    const noWrite = codes.includes(1010) || codes.includes(10000);
    const detail = error.message.includes('→ ') ? error.message.split('→ ')[1] : error.message;
    console.log(`  [${noWrite ? 'FAIL' : 'OK'}]  ${label.padEnd(31)} ${String(error.status || 'ERR').padEnd(4)} ${detail.slice(0, 56)}`);
    console.log(`         ${noWrite ? '↑ 空 body 在参数校验前被权限层拦下 = 缺少写权限' : '↑ 已进入参数校验而非权限拒绝 = 具备写权限'}`);
    return { ok: !noWrite, codes };
  }
}
const write = await probeWrite();

console.log('\n所需权限（Token 需在 Account Resources 中包含本账号）');
for (const p of REQUIRED_PERMISSIONS) console.log(`  - ${p}`);
console.log(`  管理入口：${TOKEN_CONSOLE}`);

console.log('\n结论');
let blocked = false;
if (!account.ok) {
  console.log('  ✗ 凭证未通过认证：Token 无效、已过期、复制不完整，或 IP/TTL 限制未覆盖当前环境。');
  console.log(`    到 ${TOKEN_CONSOLE} 重建 Token；或改用 CF_API_EMAIL + CF_GLOBAL_API_KEY。`);
  blocked = true;
} else {
  console.log('  ✓ 凭证有效，账号可达。');
}
if (!orgs.ok) {
  if (teamDomain) {
    console.log('  ! /access/organizations 权限不足（403/10000），但 CF_TEAM_NAME 已配置。');
    console.log('    setup 脚本会自动降级并继续，不影响创建 IdP 与应用 —— 这不是阻塞项。');
  } else {
    console.log('  ✗ /access/organizations 不可用且 CF_TEAM_NAME 未填：无法取得团队域名。');
    blocked = true;
  }
}
if (!idps.ok || !apps.ok) {
  console.log('  ✗ IdP / 应用端点不可读：setup 无法安全复用已有资源，需补齐 Access 权限后重跑。');
  blocked = true;
} else {
  console.log('  ✓ IdP 与应用端点可读（只代表有读权限，不代表能写）。');
}
if (!write.ok) {
  console.log('  ✗ 缺少写权限：setup 会在创建 IdP 时被 1010 auth.forbidden 拒绝。');
  console.log(`    到 ${TOKEN_CONSOLE} 把两项 Access 权限设为 Edit（不是 Read）；`);
  console.log('    或填 CF_API_EMAIL + CF_GLOBAL_API_KEY 改用全局密钥。');
  blocked = true;
} else {
  console.log('  ✓ 写权限探测通过，setup 可以执行。');
}
if (!gh || !gg) {
  console.log(`  ! ${[!gh && 'GitHub', !gg && 'Google'].filter(Boolean).join(' / ')} 凭证缺失，setup 会跳过对应 IdP。`);
}

console.log('\n下一步');
if (blocked) {
  console.log('  修复上述问题后重跑 npm run doctor。');
} else {
  console.log('  npm run setup:dry                # 空跑确认请求体');
  console.log('  npm run setup -- --write-config  # 创建资源并回填 AUD');
  console.log('  npm run deploy');
}
console.log('');
process.exit(blocked ? 1 : 0);
