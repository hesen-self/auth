#!/usr/bin/env node
/**
 * 打印 GitHub OAuth App / Google OAuth Client 需要填写的两个精确 URL。
 *
 *   npm run urls                       # 自动从 Cloudflare API 读取 team domain
 *   npm run urls -- --team my-team     # 已知 team name，直接生成
 *
 * 只需在 .dev.vars 填好 CF_API_TOKEN 即可自动查询；没有 Token 时会打印模板和获取方法。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const merged = { ...process.env };
  for (const filename of ['.dev.vars', '.env']) {
    const path = resolve(ROOT, filename);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in merged) || merged[key] === '') merged[key] = value;
    }
  }
  return merged;
}

const env = loadEnv();
const argTeam = process.argv.includes('--team')
  ? process.argv[process.argv.indexOf('--team') + 1]
  : '';
const ACCOUNT_ID = env.CF_ACCOUNT_ID || '9c2b9da6ca5beb3887a5f6152e3bac7d';

let teamDomain = '';
let source = '';

function normalize(input) {
  const raw = String(input || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!raw) return '';
  // 允许直接传完整 auth_domain，也允许只传 team name。
  return raw.includes('.') ? `https://${raw}` : `https://${raw}.cloudflareaccess.com`;
}

if (argTeam) {
  teamDomain = normalize(argTeam);
  source = '命令行 --team 参数';
} else if (env.CF_TEAM_NAME) {
  teamDomain = normalize(env.CF_TEAM_NAME);
  source = '.dev.vars 的 CF_TEAM_NAME';
} else if (env.CF_API_TOKEN) {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/access/organizations`,
      { headers: { authorization: `Bearer ${env.CF_API_TOKEN}` } },
    );
    const payload = await response.json();
    const authDomain = payload.result?.auth_domain || payload.result?.name;
    if (authDomain) {
      teamDomain = normalize(authDomain);
      source = `Cloudflare API /access/organizations (账号 ${ACCOUNT_ID})`;
    } else {
      console.warn(`  ! API 未返回 auth_domain：${payload.errors?.map((e) => e.message).join('; ') || `HTTP ${response.status}`}`);
    }
  } catch (error) {
    console.warn(`  ! 查询团队域名失败：${error.message}`);
  }
}

const placeholder = 'https://<team-name>.cloudflareaccess.com';
const base = teamDomain || placeholder;
const callback = `${base}/cdn-cgi/access/callback`;

console.log('\nOAuth 应用回调地址（回调发给 Cloudflare Access，不是发给应用域名）');
console.log('='.repeat(78));
if (teamDomain) {
  console.log(`团队域名来源：${source}\n`);
} else {
  console.log('尚未确定 team domain，下面是模板。把 <team-name> 换成你的实际值即可。');
  console.log('查到 team name 的三种方式：');
  console.log('  1. Zero Trust → Settings → Team name and domain → Team name');
  console.log('  2. 在 .dev.vars 填入 CF_API_TOKEN 后重跑本命令，自动调 API 查询');
  console.log('  3. 已知 team name 时：npm run urls -- --team <team-name>\n');
}
console.log('GitHub  · https://github.com/settings/developers  → OAuth Apps → New OAuth App');
console.log(`  Application name            : Identity Console（任意，会显示在登录页）`);
console.log(`  Homepage URL                : ${base}`);
console.log(`  Authorization callback URL  : ${callback}`);
console.log('');
console.log('Google  · https://console.cloud.google.com/apis/credentials  (APIs & Services → Credentials)');
console.log('          新版界面：菜单 → Google Auth Platform → Clients，或 https://console.cloud.google.com/auth/clients');
console.log(`  Authorized JavaScript origins : ${base}`);
console.log(`  Authorized redirect URIs      : ${callback}`);
console.log('');
console.log('Cloudflare 侧（创建 IdP 时粘贴 Client ID / Secret）');
console.log('  Zero Trust → Integrations → Identity providers → Add new → GitHub / Google');
console.log('');
console.log('='.repeat(78));
console.log(`注意：不要填 ${env.APP_DOMAIN || 'auth.hesen.dpdns.org'}。那是应用域名，由 Access 保护，不处理 OAuth 回调。`);
console.log('协议必须 https，Host 必须与 team domain 完全一致，callback 路径结尾不要再加斜杠。\n');
