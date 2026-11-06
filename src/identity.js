/**
 * jose 用动态 import：本地 dev / 无 JWT 的请求不会产生模块加载开销，
 * 也让 scripts/render-preview.mjs 可以在不安装依赖的情况下直接生成页面预览。
 */

/**
 * Access 只把「身份的一个子集」塞进 JWT。想拿全量信息，必须走三条互补通道：
 *   1. ctx.access.getIdentity()   —— Workers 原生，最完整、零配置
 *   2. 手动验签 JWT               —— 拿标准 claims + 自定义 claims
 *   3. /cdn-cgi/access/get-identity —— 设备态势、会话列表等扩展字段
 * 再加上第 4 层：请求本身（request.cf / headers）。
 */

const SENSITIVE_HEADERS = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'cf-access-jwt-assertion',
  'cf-access-client-id',
  'cf-access-client-secret',
  'x-api-key',
]);

/** 字段中文释义，页面按此表逐项标注；未收录的字段仍会原样展示。 */
export const FIELD_NOTES = {
  // JWT claims
  aud: '应用的 Audience (AUD) 标签，用于校验令牌是否签发给本应用',
  email: '由身份提供商验证过的邮箱地址',
  exp: '令牌过期时间（Unix 秒）',
  iat: '令牌签发 / 登录时间（Unix 秒）',
  nbf: '令牌生效时间（Unix 秒）',
  iss: '签发方，即 Zero Trust 团队域名',
  type: '令牌类型：app=应用令牌，org=全局会话令牌',
  identity_nonce: '用于换取完整身份的缓存键',
  sub: '用户唯一 ID（同一账号在同一组织内稳定）',
  country: '用户认证时所在国家（ISO 3166-1 二位码）',
  custom: 'IdP 透传的自定义 SAML 属性 / OIDC claims（可能含 groups）',
  groups: 'IdP 分组（需在 IdP 中显式配置才会出现在令牌里）',
  common_name: 'mTLS 客户端证书的 CN，或服务令牌的 Client ID',
  // ctx.access / get-identity
  id: 'Access 内部身份 ID',
  name: '用户显示名（取决于 IdP 是否提供）',
  idp: '本次登录所用的身份提供商信息',
  geo: '认证来源地理位置',
  user_uuid: 'Zero Trust 组织内的用户 UUID',
  account_id: 'Cloudflare / Zero Trust 组织账号 ID',
  devicePosture: '设备态势检查结果（磁盘加密、WARP、第三方 EDR 等）',
  ip: '用户认证时的公网 IP',
  auth_status: 'mTLS 认证状态',
  service_token_id: '服务令牌的 Client ID（非人类登录时）',
  service_token_status: '是否通过服务令牌而非 IdP 认证',
  is_warp: '是否启用 WARP 客户端',
  is_gateway: '是否通过 Cloudflare One Client 接入组织',
  gateway_account_id: 'Cloudflare One Client 生成的组织标识',
  device_id: '认证设备 ID',
  version: 'get-identity 响应结构版本',
  device_sessions: '该用户发起过的全部会话列表',
  amr: '认证方式引用（pwd / mfa / fido / otp 等）',
  oidc_fields: 'OIDC IdP 返回的额外声明',
  // request.cf
  colo: '处理请求的 Cloudflare 数据中心代码',
  city: '请求来源城市',
  continent: '请求来源大洲',
  latitude: '请求来源纬度',
  longitude: '请求来源经度',
  timezone: '请求来源时区',
  region: '请求来源地区 / 省',
  regionCode: '请求来源地区代码',
  postalCode: '请求来源邮编',
  asn: '请求来源自治系统号',
  asOrganization: '请求来源网络运营商',
  httpProtocol: 'HTTP 协议版本',
  tlsVersion: 'TLS 版本',
  tlsCipher: 'TLS 加密套件',
  tlsClientAuth: 'TLS 客户端证书认证结果',
  clientAcceptEncoding: '客户端支持的压缩算法',
  clientTcpRtt: '客户端 TCP 往返时延（毫秒）',
  botManagement: 'Bot Management 判定结果',
  requestPriority: '请求优先级',
};

const IDP_DEFINITIONS = [
  {
    key: 'github',
    label: 'GitHub',
    hint: 'OAuth App · 可读取组织与邮箱',
    match: /github/i,
    icon: 'GH',
  },
  {
    key: 'google',
    label: 'Google',
    hint: 'OAuth Client · 任意 Google 账号',
    match: /google|google-apps|gsuite|workspace/i,
    icon: 'G',
  },
  {
    key: 'pin',
    label: '邮箱验证码',
    hint: 'One-time PIN · 零配置',
    match: /onetimepin|one.?time|otp|^pin$|cloudflare/i,
    icon: '@',
  },
];

export const LOGIN_METHODS = IDP_DEFINITIONS.map(({ key, label, hint, icon }) => ({ key, label, hint, icon }));

export function detectLoginMethod(...identities) {
  for (const value of identities) {
    if (!value || typeof value !== 'object') continue;
    const raw = value?.idp?.type ?? value?.idp?.id ?? value?.idp ??
      value?.custom?.idp?.type ?? value?.login_method ?? value?.type;
    const text = typeof raw === 'string' ? raw : (raw?.type ?? '');
    if (!text) continue;
    const hit = IDP_DEFINITIONS.find((item) => item.match.test(text));
    if (hit) return { key: hit.key, label: hit.label, raw: text };
    return { key: 'other', label: String(text), raw: text };
  }
  return { key: 'unknown', label: '未识别', raw: '' };
}

function mask(value) {
  const text = String(value ?? '');
  if (!text) return '';
  return `${text.slice(0, 6)}…[已脱敏，共 ${text.length} 字符]`;
}

function toPlain(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

// JWKS 按 team domain 缓存，避免每个请求都重新构造远端 KeySet。
const jwksCache = new Map();
function getJwks(teamDomain, createRemoteJWKSet) {
  if (!jwksCache.has(teamDomain)) {
    jwksCache.set(teamDomain, createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`)));
  }
  return jwksCache.get(teamDomain);
}

/** 通道 2：按官方推荐的 jose 流程验签 Access JWT。 */
export async function verifyAccessJwt(request, env) {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) {
    return { verified: false, skipped: true, reason: '请求中没有 CF-Access-Jwt-Assertion 头（本地 dev 模式属正常）', claims: null, header: null };
  }
  if (!env.TEAM_DOMAIN || env.TEAM_DOMAIN.includes('your-team') || !env.POLICY_AUD) {
    return { verified: false, skipped: true, reason: 'TEAM_DOMAIN / POLICY_AUD 尚未配置，跳过验签', claims: null, header: null };
  }
  try {
    const { jwtVerify, createRemoteJWKSet } = await import('jose');
    const jwks = getJwks(env.TEAM_DOMAIN, createRemoteJWKSet);
    const { payload, protectedHeader } = await jwtVerify(token, jwks, {
      issuer: env.TEAM_DOMAIN,
      audience: env.POLICY_AUD,
      algorithms: ['RS256'],
    });
    return {
      verified: true,
      skipped: false,
      reason: '签名 / issuer / audience / exp 全部校验通过',
      claims: toPlain(payload),
      header: toPlain(protectedHeader),
    };
  } catch (error) {
    return {
      verified: false,
      skipped: false,
      reason: `验签失败：${error instanceof Error ? error.message : String(error)}`,
      claims: null,
      header: null,
    };
  }
}

/** 通道 1：Workers 原生 Access 上下文。 */
export async function readCtxIdentity(ctx) {
  if (!ctx?.access) return { ok: false, data: null, reason: 'ctx.access 不存在（请求未经 Access 认证，或本地未启用 access.dev）' };
  try {
    const identity = await ctx.access.getIdentity();
    return {
      ok: !!identity,
      data: identity ? toPlain(identity) : null,
      aud: ctx.access.aud ?? null,
      reason: identity ? '由 Cloudflare 边缘直接注入，无需解析 JWT' : 'ctx.access.getIdentity() 返回空',
    };
  } catch (error) {
    return { ok: false, data: null, reason: `读取失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 通道 3：用 CF_Authorization cookie 向 team domain 换取全量身份。 */
export async function fetchFullIdentity(request, env, fallbackToken) {
  if (!env.TEAM_DOMAIN || env.TEAM_DOMAIN.includes('your-team')) {
    return { ok: false, data: null, reason: 'TEAM_DOMAIN 未配置，跳过 get-identity 代理（部署后自动生效）' };
  }
  const cookieHeader = request.headers.get('cookie') || '';
  const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookieHeader);
  const token = match?.[1] || fallbackToken;
  if (!token) {
    return { ok: false, data: null, reason: '没有可用的 CF_Authorization cookie / Access 令牌' };
  }
  try {
    const response = await fetch(`${env.TEAM_DOMAIN}/cdn-cgi/access/get-identity`, {
      headers: { cookie: `CF_Authorization=${token}` },
    });
    if (!response.ok) {
      return { ok: false, data: null, reason: `get-identity 返回 HTTP ${response.status}` };
    }
    const data = await response.json();
    return { ok: true, data: toPlain(data), reason: '来自 /cdn-cgi/access/get-identity 的完整身份对象' };
  } catch (error) {
    return { ok: false, data: null, reason: `代理请求失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 通道 4：请求上下文。敏感头做脱敏，绝不把会话令牌明文输出到页面。 */
export function collectRequestContext(request) {
  const url = new URL(request.url);
  const headers = {};
  const redacted = [];
  for (const [name, value] of request.headers.entries()) {
    if (SENSITIVE_HEADERS.has(name.toLowerCase())) {
      headers[name] = mask(value);
      redacted.push(name);
    } else {
      headers[name] = value;
    }
  }
  return {
    request: {
      url: url.href,
      origin: url.origin,
      pathname: url.pathname,
      method: request.method,
      host: url.host,
      protocol: url.protocol,
    },
    headers,
    cf: request.cf ? toPlain(request.cf) : {},
    redacted,
  };
}

function countLeaves(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value !== 'object') return 1;
  return Object.values(value).reduce((sum, item) => sum + countLeaves(item), 0);
}

/** 汇总所有通道，产出页面与 /api/snapshot 共用的快照。 */
export async function buildSnapshot(request, env, ctx) {
  const jwt = await verifyAccessJwt(request, env);
  const ctxIdentity = await readCtxIdentity(ctx);
  const fullIdentity = await fetchFullIdentity(
    request,
    env,
    request.headers.get('cf-access-jwt-assertion'),
  );
  const context = collectRequestContext(request);

  // 安全检查：只有真正验签通过（或明确处于 dev 模拟）时才允许进入信息页。
  const devMode = !!ctx?.access && !request.headers.get('cf-access-jwt-assertion');
  const authenticated = ctxIdentity.ok || jwt.verified;
  const forbidden = !authenticated || (jwt.verified === false && !jwt.skipped);

  const identity = ctxIdentity.data || fullIdentity.data || null;
  const loginMethod = detectLoginMethod(identity, fullIdentity.data, jwt.claims?.custom);

  const sources = [
    {
      id: 'ctx',
      label: 'ctx.access.getIdentity()',
      ok: ctxIdentity.ok,
      count: countLeaves(ctxIdentity.data),
      reason: ctxIdentity.reason,
    },
    {
      id: 'jwt',
      label: 'CF-Access-Jwt-Assertion (已验签)',
      ok: jwt.verified,
      count: countLeaves(jwt.claims),
      reason: jwt.reason,
    },
    {
      id: 'getIdentity',
      label: '/cdn-cgi/access/get-identity',
      ok: fullIdentity.ok,
      count: countLeaves(fullIdentity.data),
      reason: fullIdentity.reason,
    },
    {
      id: 'request',
      label: '请求上下文 (headers + request.cf)',
      ok: true,
      count: countLeaves(context.headers) + countLeaves(context.cf),
      reason: '由 Worker 直接读取，与 Access 无关',
    },
  ];

  return {
    meta: {
      collectedAt: new Date().toISOString(),
      appName: env.APP_NAME || 'Identity Console',
      teamDomain: env.TEAM_DOMAIN || '',
      audConfigured: !!env.POLICY_AUD,
      devMode,
      authenticated,
      forbidden,
    },
    loginMethod,
    identity,
    ctxAud: ctxIdentity.aud ?? null,
    fullIdentity: fullIdentity.data,
    jwt,
    context,
    sources,
  };
}
