#!/usr/bin/env node
/**
 * Cloudflare API 配置脚本的共享基础设施：本地凭证加载、认证头、错误诊断。
 * 纯 Node，无第三方依赖；被 setup-access.mjs / doctor.mjs / show-callbacks.mjs 复用。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const API = 'https://api.cloudflare.com/client/v4';

/** 按 .dev.vars → .env → process.env 的优先级合并（环境变量里的非空值优先）。 */
export function loadEnv() {
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

/** 同时接受纯 team name（seazen）与完整域名（seazen.cloudflareaccess.com）。 */
export function normalizeTeamDomain(input) {
  const raw = String(input || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!raw) return '';
  return raw.includes('.') ? `https://${raw}` : `https://${raw}.cloudflareaccess.com`;
}

/** 凭证脱敏摘要：只描述形态，绝不输出值本身。 */
export function fingerprint(value) {
  if (!value) return '【空】';
  const v = String(value);
  const parts = [`长度 ${v.length}`];
  if (/\s/.test(v)) parts.push('含空白字符(!)');
  if (/^Bearer\s/i.test(v)) parts.push('自带 Bearer 前缀(!)');
  if (/^[0-9a-fA-F]{37}$/.test(v)) parts.push('疑似 Global API Key（不是 API Token）');
  if (/^[A-Za-z0-9_-]{30,}$/.test(v)) parts.push('API Token 形态');
  return parts.join(' · ');
}

/** 两种认证方式：优先 API Token；显式配置 CF_API_EMAIL + CF_GLOBAL_API_KEY 时改用 Global API Key。 */
export function authMode(env) {
  return env.CF_API_EMAIL && env.CF_GLOBAL_API_KEY ? 'global-key' : 'token';
}

export function authHeaders(env) {
  if (authMode(env) === 'global-key') {
    return {
      'x-auth-email': env.CF_API_EMAIL,
      'x-auth-key': env.CF_GLOBAL_API_KEY,
      'content-type': 'application/json',
    };
  }
  return {
    authorization: `Bearer ${env.CF_API_TOKEN || ''}`,
    'content-type': 'application/json',
  };
}

export const REQUIRED_PERMISSIONS = [
  'Access: Organizations, Identity Providers, and Groups · Edit',
  'Access: Apps and Policies · Edit',
  'Account Settings · Read（读取账号信息）',
  'Workers Scripts · Edit + Zone DNS · Edit（npm run deploy 时需要）',
];

export const TOKEN_CONSOLE = 'https://dash.cloudflare.com/profile/api-tokens';

/** 携带 HTTP 状态与 Cloudflare 错误码的异常，附带可操作的修复提示。 */
export class ApiError extends Error {
  constructor(message, status, codes = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.codes = codes;
  }

  get hint() {
    const c = this.codes;
    if (c.includes(1010)) {
      return [
        'Token 身份有效，但被拒绝写入（403 + 1010 auth.forbidden）：对 Zero Trust 资源缺少 Edit/Write 权限。',
        '注意：GET 端点全部 200 只说明有读权限，不能据此判断可以创建资源。',
        `请到 ${TOKEN_CONSOLE} 编辑/重建 Token，把以下权限都设为 Edit（不是 Read）：`,
        ...REQUIRED_PERMISSIONS.slice(0, 2).map((p) => `          - ${p}`),
        '        Account Resources 需包含目标账号，且不要设置会挡住当前出口 IP 的 IP 过滤 / TTL。',
        '        兜底方案：在 .dev.vars 填 CF_API_EMAIL + CF_GLOBAL_API_KEY，脚本会改用全局密钥认证。',
      ].join('\n');
    }
    if (c.includes(1000) || c.includes(9106) || c.includes(9109)) {
      return [
        'Token 本身未通过认证（不是权限问题）。常见原因：复制不完整、多/少字符、Token 已被删除或过期、',
        '误把 Global API Key / Token ID 当成 API Token、或 Token 设置了 IP 白名单而当前出口 IP 不在其中。',
        `请到 ${TOKEN_CONSOLE} 重新创建一个 Token 并完整复制；也可填 CF_API_EMAIL + CF_GLOBAL_API_KEY 改用全局密钥。`,
      ].join('\n        ');
    }
    if (c.includes(10000)) {
      return [
        'Token 有效，但缺少这个 Zero Trust 端点所需的权限（403 + 10000 = 权限不足，不是凭证错误）。',
        `请到 ${TOKEN_CONSOLE} 编辑该 Token，确认包含：`,
        ...REQUIRED_PERMISSIONS.map((p) => `          - ${p}`),
        '        Account Resources 要包含目标账号；若设置了 IP 过滤 / TTL，也要覆盖当前环境。',
        '        注意：如果已知 CF_TEAM_NAME，/access/organizations 这一端点并非必需，脚本会自动降级继续。',
      ].join('\n');
    }
    return '';
  }
}

/** 发起一次真实的 Cloudflare API 请求并统一封装错误。 */
export async function request(env, method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: authHeaders(env),
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const errors = payload.errors || [];
    const codes = errors.map((e) => e.code);
    // Cloudflare 的错误对象有时用 message，有时用 error（例如 1010 只给 error: "auth.forbidden"）。
    const detail = errors.map((e) => `${e.code}: ${e.message ?? e.error ?? '(无说明)'}`).join('; ') || `HTTP ${response.status}`;
    throw new ApiError(`${method} ${path} 失败 → ${detail}`, response.status, codes);
  }
  return payload;
}

/** 统一打印失败原因与修复建议。 */
export function reportFailure(error) {
  console.error(`\n[失败] ${error.message}`);
  if (error instanceof ApiError && error.hint) {
    console.error(`\n  诊断：HTTP ${error.status}，错误码 ${error.codes.join(', ') || '无'}`);
    for (const line of error.hint.split('\n')) console.error(`        ${line.trimStart()}`);
  }
  console.error('');
}
