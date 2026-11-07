/**
 * 存储层：R2 头像 + D1 登录日志。
 *
 * 约定：
 *  - 头像按 Access 归一化身份里的 user_uuid 命名，由 Worker 代理读写，不暴露 R2 公开域名。
 *    Cloudflare Access 不透传 IdP access token，拿不到 GitHub avatar_url / Google picture，
 *    因此头像是「应用内头像」（用户自行上传），不是 IdP 头像的自动同步。
 *  - 日志按 (user_uuid, auth_at) 唯一：JWT 的 iat 在一次登录会话内稳定，
 *    配合 INSERT OR IGNORE 实现幂等，刷新页面不会产生重复记录。
 *  - identity_json 存全量身份但递归脱敏，绝不落库 cookie / JWT 原文 / client secret。
 *  - 没有绑定时（离线预览、资源未创建）一律降级返回，不抛异常。
 */

const AVATAR_PREFIX = 'avatars/';
const ALLOWED_AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const SENSITIVE_KEY = /^(cookie|set-cookie|authorization|proxy-authorization|cf-access-jwt-assertion|cf-access-client-id|cf-access-client-secret|x-api-key|password|client_secret|access_token|refresh_token|id_token|secret)$/i;

export function storageStatus(env) {
  return { r2: !!env?.AVATARS, d1: !!env?.DB };
}

/** 当前登录用户在组织内的稳定标识，用作头像 key 与日志归属。 */
export function viewerUuid(snapshot) {
  return String(
    snapshot?.identity?.user_uuid || snapshot?.identity?.id ||
    snapshot?.jwt?.claims?.sub || snapshot?.identity?.email || '',
  );
}

function collectGroups(snapshot) {
  const out = new Set();
  const add = (value) => {
    if (Array.isArray(value)) value.forEach((item) => out.add(String(item)));
    else if (typeof value === 'string' && value) out.add(value);
    else if (value && typeof value === 'object') Object.keys(value).forEach((key) => out.add(String(key)));
  };
  add(snapshot?.identity?.custom?.groups);
  add(snapshot?.fullIdentity?.custom?.groups);
  add(snapshot?.jwt?.claims?.custom?.groups);
  add(snapshot?.jwt?.claims?.groups);
  return [...out];
}

/** 管理员可查看全部日志；普通用户只能看自己的。 */
export function isAdmin(snapshot) {
  const groups = collectGroups(snapshot);
  return groups.includes('identity-console-admin') || groups.includes('admin');
}

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 8) return '[深度截断]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[已脱敏]' : redact(item, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…[截断]`;
  return value;
}

// ---------------------------------------------------------------- R2 头像

export function avatarKey(userUuid) {
  return `${AVATAR_PREFIX}${userUuid}`;
}

export async function getAvatar(env, userUuid) {
  if (!env?.AVATARS || !userUuid) return null;
  try {
    const object = await env.AVATARS.get(avatarKey(userUuid));
    if (!object) return null;
    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType || 'image/png',
      size: object.size || 0,
      uploadedAt: object.customMetadata?.uploadedAt || '',
      etag: object.httpEtag || '',
    };
  } catch {
    return null;
  }
}

export async function putAvatar(env, userUuid, contentType, bytes, uploaderEmail) {
  if (!env?.AVATARS) return { ok: false, reason: 'R2 未绑定（本地预览或未部署存储资源）' };
  if (!userUuid) return { ok: false, reason: '无法确定当前用户标识' };
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_AVATAR_TYPES.has(type)) {
    return { ok: false, reason: `仅支持 PNG / JPEG / WebP / GIF，收到 ${type || '未知类型'}` };
  }
  if (!bytes || bytes.byteLength === 0) return { ok: false, reason: '文件内容为空' };
  if (bytes.byteLength > MAX_AVATAR_BYTES) return { ok: false, reason: '图片超过 2 MB 限制' };
  try {
    await env.AVATARS.put(avatarKey(userUuid), bytes, {
      httpMetadata: { contentType: type, cacheControl: 'private, no-store' },
      customMetadata: {
        uploadedAt: new Date().toISOString(),
        uploader: String(uploaderEmail || '').slice(0, 200),
      },
    });
    return { ok: true, contentType: type, size: bytes.byteLength };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

// ------------------------------------------------------------- D1 登录日志

const INSERT_SQL = `INSERT OR IGNORE INTO login_logs
  (id, user_uuid, email, name, login_method, login_method_key, idp_type,
   country, city, ip, colo, asn, as_org, user_agent,
   auth_at, session_exp, aud, groups_json, identity_json, dev_mode, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** 从已脱敏的身份快照里抽取要落库的字段。 */
export function buildLogRecord(snapshot) {
  const identity = snapshot.identity || {};
  const claims = snapshot.jwt?.claims || {};
  const cf = snapshot.context?.cf || {};
  const headers = snapshot.context?.headers || {};
  const email = String(identity.email || claims.email || '');

  return {
    id: crypto.randomUUID(),
    user_uuid: viewerUuid(snapshot),
    email,
    name: String(identity.name || claims.name || email.split('@')[0] || ''),
    login_method: String(snapshot.loginMethod?.label || ''),
    login_method_key: String(snapshot.loginMethod?.key || ''),
    idp_type: String(identity.idp?.type || snapshot.loginMethod?.raw || ''),
    country: String(identity.geo?.country || cf.country || claims.country || ''),
    city: String(cf.city || ''),
    ip: String(identity.ip || headers['cf-connecting-ip'] || ''),
    colo: String(cf.colo || ''),
    asn: cf.asn != null ? String(cf.asn) : '',
    as_org: String(cf.asOrganization || ''),
    user_agent: String(headers['user-agent'] || ''),
    auth_at: Number(identity.iat || claims.iat || 0),
    session_exp: Number(claims.exp || 0),
    aud: String(claims.aud || snapshot.ctxAud || ''),
    groups_json: JSON.stringify(collectGroups(snapshot)),
    identity_json: JSON.stringify(redact(identity)),
    dev_mode: snapshot.meta?.devMode ? 1 : 0,
    created_at: new Date().toISOString(),
  };
}

export async function recordLogin(env, snapshot) {
  if (!env?.DB) return { skipped: true, reason: 'D1 未绑定' };
  if (!snapshot?.meta?.authenticated) return { skipped: true, reason: '未通过认证' };
  const record = buildLogRecord(snapshot);
  const values = [
    record.id, record.user_uuid, record.email, record.name,
    record.login_method, record.login_method_key, record.idp_type,
    record.country, record.city, record.ip, record.colo, record.asn, record.as_org,
    record.user_agent, record.auth_at, record.session_exp, record.aud,
    record.groups_json, record.identity_json, record.dev_mode, record.created_at,
  ];
  try {
    const result = await env.DB.prepare(INSERT_SQL).bind(...values).run();
    const changes = Number(result?.changes ?? result?.meta?.changes ?? 0);
    return { ok: true, inserted: changes > 0, id: record.id };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function listLogs(env, { viewer, admin = false, page = 1, pageSize = 20, q = '' } = {}) {
  const p = Math.min(1000, Math.max(1, Number.parseInt(page, 10) || 1));
  const size = Math.min(50, Math.max(1, Number.parseInt(pageSize, 10) || 20));
  const keyword = String(q || '').trim().slice(0, 80);
  const base = { rows: [], total: 0, page: p, pageSize: size, pageCount: 1, q: keyword, admin };
  if (!env?.DB) return { ...base, skipped: true, reason: 'D1 未绑定' };

  const where = [];
  const args = [];
  if (!admin) {
    where.push('user_uuid = ?');
    args.push(String(viewer || ''));
  }
  if (keyword) {
    where.push('(email LIKE ? OR name LIKE ? OR ip LIKE ? OR login_method LIKE ?)');
    const like = `%${keyword}%`;
    args.push(like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM login_logs ${clause}`)
      .bind(...args).first();
    const total = Number(count?.total || 0);
    const result = await env.DB.prepare(
      `SELECT * FROM login_logs ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    ).bind(...args, size, (p - 1) * size).all();
    return {
      ...base,
      rows: result?.results || [],
      total,
      pageCount: Math.max(1, Math.ceil(total / size)),
    };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getLog(env, id, { viewer, admin = false } = {}) {
  if (!env?.DB) return { row: null, skipped: true, reason: 'D1 未绑定' };
  if (!id) return { row: null, reason: '缺少记录 ID' };
  try {
    const row = await env.DB.prepare('SELECT * FROM login_logs WHERE id = ?').bind(String(id)).first();
    if (!row) return { row: null, reason: '记录不存在' };
    if (!admin && String(row.user_uuid) !== String(viewer || '')) {
      return { row: null, reason: '无权查看该记录' };
    }
    return { row };
  } catch (error) {
    return { row: null, error: error instanceof Error ? error.message : String(error) };
  }
}
