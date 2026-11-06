#!/usr/bin/env node
/**
 * 通过 Cloudflare API 一键完成：
 *   1. 读取 Zero Trust 团队域名
 *   2. 创建/复用三个 Identity Provider：onetimepin / github / google
 *   3. 创建 self-hosted Access Application + Allow 策略，并绑定三个 IdP
 *   4. 输出 TEAM_DOMAIN / POLICY_AUD，可选写回 wrangler.jsonc
 *
 * 用法：
 *   cp .dev.vars.example .dev.vars   # 填入凭证
 *   npm run doctor                   # 只读诊断凭证与 Zero Trust 权限矩阵
 *   npm run setup:dry                # 只打印将要发送的请求，不联网
 *   npm run setup                    # 真正执行
 *   npm run setup -- --write-config  # 执行并把 TEAM_DOMAIN / POLICY_AUD 写回 wrangler.jsonc
 *   npm run setup -- --skip-org      # 组织端点 403 时，直接用 CF_TEAM_NAME 跳过它
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ROOT, loadEnv, normalizeTeamDomain, fingerprint, authMode,
  ApiError, request, reportFailure, TOKEN_CONSOLE,
} from './lib/cf.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const WRITE_CONFIG = process.argv.includes('--write-config');
const SKIP_ORG = process.argv.includes('--skip-org'); // 已知 team name 时跳过无权限的组织端点

const env = loadEnv();
const ACCOUNT_ID = env.CF_ACCOUNT_ID;
const API_TOKEN = env.CF_API_TOKEN;
const APP_DOMAIN = env.APP_DOMAIN || 'auth.hesen.dpdns.org';
const APP_NAME = env.APP_NAME || 'Identity Console';

function required(name, value) {
  if (!value) {
    console.error(`\n[缺少配置] ${name} 未设置。请先复制 .dev.vars.example 为 .dev.vars 并填写。\n`);
    process.exit(1);
  }
  return value;
}

async function call(method, path, body) {
  if (DRY_RUN) {
    console.log(`\n  → ${method} ${path}`);
    if (body) console.log(`    ${JSON.stringify(body, null, 2).split('\n').join('\n    ')}`);
    // 空跑也要返回结构正确的假数据，才能把后续分支完整走一遍。
    let result;
    if (path.includes('/organizations')) {
      result = { auth_domain: normalizeTeamDomain(env.CF_TEAM_NAME || 'your-team').replace(/^https?:\/\//, '') };
    } else if (method === 'GET' && path.endsWith('/identity_providers')) {
      result = [];
    } else if (method === 'GET' && path.endsWith('/access/apps')) {
      result = [];
    } else if (/^\/accounts\/[^/]+$/.test(path)) {
      result = { id: ACCOUNT_ID, name: '(DRY-RUN 账号)' };
    } else {
      result = { id: `dry-${path.split('/').pop()}-${Math.random().toString(36).slice(2, 8)}`, aud: 'dry-run-aud-tag' };
    }
    return { success: true, result };
  }
  return request(env, method, path, body);
}

function buildIncludeRules() {
  const rules = [];
  for (const email of (env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    rules.push({ email: { email } });
  }
  for (const domain of (env.ALLOWED_EMAIL_DOMAIN || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    rules.push({ email_domain: { domain } });
  }
  if (rules.length === 0) {
    console.warn('  ! 未配置 ALLOWED_EMAILS / ALLOWED_EMAIL_DOMAIN，将使用 everyone 规则。');
    console.warn('    与 One-time PIN 组合时 = 任意邮箱收验证码即可登录，正式使用前务必收紧策略。');
    rules.push({ everyone: {} });
  }
  return rules;
}

async function main() {
  console.log(`\nCloudflare Access 一键配置${DRY_RUN ? ' [DRY-RUN：不会发起任何网络请求]' : ''}`);
  console.log('='.repeat(64));

  required('CF_ACCOUNT_ID', ACCOUNT_ID);
  if (!DRY_RUN && authMode(env) === 'token') required('CF_API_TOKEN', API_TOKEN);
  required('APP_DOMAIN', APP_DOMAIN);

  const base = `/accounts/${ACCOUNT_ID}/access`;

  // 0. 凭证自检。刻意不用 /user/tokens/verify：它对非用户级 Token 会误报 Invalid API Token。
  console.log('\n[0/4] 校验凭证…');
  const globalKey = authMode(env) === 'global-key';
  console.log(`  认证方式: ${globalKey ? 'Global API Key (X-Auth-Email / X-Auth-Key)' : 'API Token (Bearer)'}`);
  if (!globalKey) console.log(`  Token 形态: ${fingerprint(API_TOKEN)}`);
  const account = await call('GET', `/accounts/${ACCOUNT_ID}`);
  console.log(`  账号可达: ${account.result?.name || '(未返回名称)'}`);

  // 1. 团队域名。组织端点仅为「锦上添花」：部分 Token 缺权限会返回 403/10000，
  //    而已填 CF_TEAM_NAME 时完全不需要它，失败就降级继续。
  console.log('\n[1/4] 确定 Zero Trust 团队域名…');
  let teamDomain = normalizeTeamDomain(env.CF_TEAM_NAME);
  if (SKIP_ORG) {
    console.log('  --skip-org：按 CF_TEAM_NAME 直接使用，跳过组织端点');
  } else {
    try {
      const org = await call('GET', `${base}/organizations`);
      const fromApi = normalizeTeamDomain(org.result?.auth_domain || org.result?.name || '');
      if (!teamDomain) teamDomain = fromApi;
      else if (fromApi && fromApi !== teamDomain) {
        console.warn(`  ! API 返回 ${fromApi}，与 CF_TEAM_NAME 推出的 ${teamDomain} 不一致，以后者为准`);
      }
      if (fromApi) console.log(`  API 返回: ${fromApi}`);
    } catch (error) {
      if (!(error instanceof ApiError) || !teamDomain) throw error;
      console.warn(`  ! 组织端点不可用（${error.message}）`);
      console.warn('    → 已按 CF_TEAM_NAME 降级继续：创建 IdP / 应用不依赖此端点。');
    }
  }
  if (!teamDomain) {
    throw new Error(`无法取得团队域名：请在 .dev.vars 设置 CF_TEAM_NAME=seazen，或到 ${TOKEN_CONSOLE} 给 Token 补齐权限后重跑`);
  }
  console.log(`  团队域名: ${teamDomain}`);
  console.log(`  IdP 回调地址（GitHub / Google 都填这个）: ${teamDomain}/cdn-cgi/access/callback`);

  // 2. 已存在的 IdP
  console.log('\n[2/4] 检查已有 Identity Providers…');
  const existing = await call('GET', `${base}/identity_providers`);
  const existingList = existing.result || [];
  const byType = new Map(existingList.map((item) => [item.type, item]));
  console.log(`  已有 ${existingList.length} 个：${existingList.map((i) => `${i.name}(${i.type})`).join(', ') || '无'}`);

  const wanted = [
    {
      type: 'onetimepin',
      name: 'One-time PIN login',
      config: {},
      needs: [],
    },
    {
      type: 'github',
      name: 'GitHub',
      config: { client_id: env.GITHUB_CLIENT_ID || '', client_secret: env.GITHUB_CLIENT_SECRET || '' },
      needs: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
    },
    {
      type: 'google',
      name: 'Google',
      config: { client_id: env.GOOGLE_CLIENT_ID || '', client_secret: env.GOOGLE_CLIENT_SECRET || '' },
      needs: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    },
  ];

  const idpIds = [];
  for (const item of wanted) {
    if (byType.has(item.type)) {
      console.log(`  ✓ ${item.label || item.name} (${item.type}) 已存在，复用 id=${byType.get(item.type).id}`);
      idpIds.push(byType.get(item.type).id);
      continue;
    }
    const missing = item.needs.filter((key) => !env[key]);
    if (missing.length) {
      console.log(`  ⚠ 跳过 ${item.name}：缺少 ${missing.join(', ')}。可在 .dev.vars 补齐后重跑本脚本。`);
      continue;
    }
    const created = await call('POST', `${base}/identity_providers`, {
      name: item.name,
      type: item.type,
      config: item.config,
    });
    idpIds.push(created.result.id);
    console.log(`  + 已创建 ${item.name} (${item.type}) id=${created.result.id}`);
  }

  if (idpIds.length === 0) throw new Error('没有任何可用 IdP，Access 应用无法创建');

  // 3. Access Application
  console.log('\n[3/4] 创建 Access Application 与 Allow 策略…');
  const appBody = {
    name: APP_NAME,
    type: 'self_hosted',
    domain: APP_DOMAIN,
    session_duration: '24h',
    auto_redirect_to_identity: false, // 关闭 Instant Auth，才能在登录页看到三种方式
    app_launcher_visible: false,
    allowed_idps: idpIds,
    policies: [
      {
        name: 'Allow configured identities',
        decision: 'allow',
        precedence: 1,
        include: buildIncludeRules(),
      },
    ],
  };
  // 幂等：失败重跑时复用同 domain 的已有应用，避免产生第二个 Access Application。
  const appsList = await call('GET', `${base}/apps`);
  const existingApp = (appsList.result || []).find(
    (item) => item.domain === APP_DOMAIN || String(item.domain || '').split(',')[0].trim() === APP_DOMAIN,
  );
  let aud;
  if (existingApp) {
    aud = existingApp.aud;
    console.log(`  ✓ 已存在同名应用 id=${existingApp.id}（domain=${APP_DOMAIN}），复用，不重复创建`);
    console.log('    如需调整 IdP 绑定 / Allow 策略，请到 Zero Trust 控制台修改；本脚本不覆盖已有应用。');
  } else {
    const app = await call('POST', `${base}/apps`, appBody);
    aud = app.result?.aud;
    console.log(`  应用 id = ${app.result?.id}`);
  }
  console.log(`  AUD tag = ${aud || '【未返回，请到控制台复制】'}`);

  // 4. 输出回填信息
  console.log('\n[4/4] 需要回填到 wrangler.jsonc 的值：');
  console.log(`  "TEAM_DOMAIN": "${teamDomain}"`);
  console.log(`  "POLICY_AUD": "${aud || ''}"`);

  if (WRITE_CONFIG && !DRY_RUN && aud) {
    const configPath = resolve(ROOT, 'wrangler.jsonc');
    let text = readFileSync(configPath, 'utf8');
    text = text.replace(/("TEAM_DOMAIN"\s*:\s*)"[^"]*"/, `$1"${teamDomain}"`);
    text = text.replace(/("POLICY_AUD"\s*:\s*)"[^"]*"/, `$1"${aud}"`);
    writeFileSync(configPath, text, 'utf8');
    console.log('  ✓ 已自动写回 wrangler.jsonc');
  } else if (!DRY_RUN && !aud) {
    console.log('  ! 未取得 AUD，已跳过写回；请在控制台复制后手动填入 POLICY_AUD');
  } else if (!DRY_RUN) {
    console.log('  （可加 --write-config 自动写回，或手动粘贴）');
  }

  console.log('\n' + '='.repeat(64));
  console.log('后续步骤：');
  console.log('  1. 在 GitHub OAuth App / Google OAuth Client 中把回调地址设为上面的 callback URL');
  console.log('  2. 确认 APP_DOMAIN 的 DNS 记录已开启 Cloudflare 代理（橙色云朵）');
  console.log('  3. npm install && npm run deploy（或在 Workers & Pages → Access 里开启 Worker 级保护）');
  console.log('  4. 确认 POLICY_AUD 已写入 wrangler.jsonc（--write-config 自动完成）后重新部署并访问应用域名');
  console.log('');

  if (DRY_RUN) {
    console.log('DRY-RUN 完成：以上请求体均未真正发送。\n');
  }
}

main().catch((error) => {
  reportFailure(error);
  process.exit(1);
});
