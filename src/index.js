import { buildSnapshot, fetchFullIdentity } from './identity.js';
import { renderPage, renderForbidden } from './render.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    // 健康检查：不返回任何身份数据，便于探活。
    if (url.pathname === '/health') {
      return json({ ok: true, service: env.APP_NAME || 'identity-console', time: new Date().toISOString() });
    }

    const snapshot = await buildSnapshot(request, env, ctx);

    if (snapshot.meta.forbidden) {
      const message = snapshot.jwt.verified === false && !snapshot.jwt.skipped
        ? snapshot.jwt.reason
        : '请求没有携带可验证的 Cloudflare Access 身份，请先通过 Access 登录页完成认证。';
      if (url.pathname.startsWith('/api/')) {
        return json({ error: 'forbidden', message, sources: snapshot.sources }, 403);
      }
      return new Response(renderForbidden(message, snapshot.meta.devMode), { status: 403, headers: HTML_HEADERS });
    }

    // 结构化快照，便于导出 / 对接其他系统。
    if (url.pathname === '/api/snapshot') {
      return json(snapshot);
    }

    // 单独暴露 get-identity 的原始响应（含设备会话等扩展字段）。
    if (url.pathname === '/api/identity') {
      const result = await fetchFullIdentity(
        request,
        env,
        request.headers.get('cf-access-jwt-assertion'),
      );
      return json({
        ok: result.ok,
        reason: result.reason,
        data: result.data,
        fallback: result.ok ? undefined : snapshot.identity,
      });
    }

    if (url.pathname !== '/' && url.pathname !== '/index.html') {
      return new Response(renderForbidden('未知路径。本 MVP 只提供 /、/api/snapshot、/api/identity、/health。', false), {
        status: 404,
        headers: HTML_HEADERS,
      });
    }

    return new Response(renderPage(snapshot), { status: 200, headers: HTML_HEADERS });
  },
};
