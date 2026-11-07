import { buildSnapshot, fetchFullIdentity } from './identity.js';
import {
  renderPage, renderForbidden, renderLogsPage, renderLogDetailPage, renderLogoutPage,
} from './render.js';
import {
  getAvatar, putAvatar, recordLogin, listLogs, getLog,
  viewerUuid, isAdmin, storageStatus, MAX_AVATAR_BYTES,
} from './storage.js';

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

function html(body, status = 200) {
  return new Response(body, { status, headers: HTML_HEADERS });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // 只有头像上传允许 POST，其余一律 GET / HEAD。
    const isAvatarUpload = method === 'POST' && pathname === '/api/avatar';
    if (method !== 'GET' && method !== 'HEAD' && !isAvatarUpload) {
      return json({ error: 'method_not_allowed' }, 405);
    }

    // 健康检查：不返回任何身份数据，便于探活。
    if (pathname === '/health') {
      return json({
        ok: true,
        service: env.APP_NAME || 'identity-console',
        time: new Date().toISOString(),
        storage: storageStatus(env),
      });
    }

    const snapshot = await buildSnapshot(request, env, ctx);

    if (snapshot.meta.forbidden) {
      const message = snapshot.jwt.verified === false && !snapshot.jwt.skipped
        ? snapshot.jwt.reason
        : '请求没有携带可验证的 Cloudflare Access 身份，请先通过 Access 登录页完成认证。';
      if (pathname.startsWith('/api/')) {
        return json({ error: 'forbidden', message, sources: snapshot.sources }, 403);
      }
      return html(renderForbidden(message, snapshot.meta.devMode), 403);
    }

    const access = { viewer: viewerUuid(snapshot), admin: isAdmin(snapshot) };
    const storage = storageStatus(env);

    // ------------------------------------------------------------ R2 头像
    if (pathname === '/api/avatar') {
      if (isAvatarUpload) {
        // 简单同源校验：Access cookie 敏感，拒绝跨站发起的写入。
        const origin = request.headers.get('origin');
        if (origin && new URL(origin).host !== url.host) {
          return json({ ok: false, reason: '跨站请求被拒绝' }, 403);
        }
        const declared = Number(request.headers.get('content-length') || 0);
        if (declared > MAX_AVATAR_BYTES) {
          return json({ ok: false, reason: '图片超过 2 MB 限制' }, 413);
        }
        const bytes = new Uint8Array(await request.arrayBuffer());
        const result = await putAvatar(
          env, access.viewer, request.headers.get('content-type'), bytes,
          snapshot.identity?.email || '',
        );
        return json(result, result.ok ? 200 : 400);
      }
      const avatar = await getAvatar(env, access.viewer);
      if (!avatar) return json({ ok: false, reason: '该用户尚未上传头像' }, 404);
      const headers = {
        'content-type': avatar.contentType,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      };
      if (avatar.etag) headers.etag = avatar.etag;
      if (avatar.uploadedAt) headers['x-avatar-uploaded-at'] = avatar.uploadedAt;
      return new Response(method === 'HEAD' ? null : avatar.body, { status: 200, headers });
    }

    // ------------------------------------------------------- 登录日志写入
    // 只在页面路由记账；API 轮询不会重复触发，(user_uuid, iat) 唯一键也会兜底去重。
    const isPage = pathname === '/' || pathname === '/index.html'
      || pathname === '/logs' || /^\/logs\/[^/]+$/.test(pathname);
    if (isPage) await recordLogin(env, snapshot);

    // ------------------------------------------------------------ JSON API
    if (pathname === '/api/snapshot') return json(snapshot);

    if (pathname === '/api/identity') {
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

    if (pathname === '/api/logs') {
      const data = await listLogs(env, {
        ...access,
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
        q: url.searchParams.get('q'),
      });
      return json({ ...data, storage });
    }

    const apiDetail = /^\/api\/logs\/([^/]+)$/.exec(pathname);
    if (apiDetail) {
      const result = await getLog(env, decodeURIComponent(apiDetail[1]), access);
      const status = result.row || result.skipped ? 200 : 404;
      return json({ ...result, storage }, status);
    }

    // ------------------------------------------------------------- 页面
    // 退出中间页：撤销会话并跳回登录页。不属于「登录」，不写入登录日志。
    if (pathname === '/logout') return html(renderLogoutPage(snapshot));

    if (pathname === '/logs') {
      const data = await listLogs(env, {
        ...access,
        page: url.searchParams.get('page'),
        pageSize: url.searchParams.get('pageSize'),
        q: url.searchParams.get('q'),
      });
      return html(renderLogsPage(snapshot, { ...data, storage }));
    }

    const pageDetail = /^\/logs\/([^/]+)$/.exec(pathname);
    if (pageDetail) {
      const result = await getLog(env, decodeURIComponent(pageDetail[1]), access);
      return html(renderLogDetailPage(snapshot, { ...result, storage }), result.row ? 200 : 404);
    }

    if (pathname !== '/' && pathname !== '/index.html') {
      return html(renderForbidden('未知路径。可用：/、/logout、/logs、/logs/:id、/api/snapshot、/api/identity、/api/logs、/api/avatar、/health。', false, false), 404);
    }

    return html(renderPage(snapshot, storage));
  },
};
