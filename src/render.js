import { FIELD_NOTES, LOGIN_METHODS } from './identity.js';

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const TIME_KEYS = new Set(['iat', 'exp', 'nbf', 'last_authenticated', 'expires']);

function formatScalar(key, value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (TIME_KEYS.has(key) && value > 1_000_000_000 && value < 10_000_000_000) {
      return `${value}  ·  ${new Date(value * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} (UTC+8)`;
    }
    return String(value);
  }
  if (typeof value === 'string' && value.length > 300) return `${value.slice(0, 300)}…`;
  return String(value);
}

function renderFields(obj, depth = 0) {
  if (obj === null || obj === undefined) return '<div class="empty">无数据</div>';
  if (typeof obj !== 'object') return `<div class="scalar">${esc(formatScalar('', obj))}</div>`;

  const entries = Array.isArray(obj)
    ? obj.map((value, index) => [`[${index}]`, value])
    : Object.entries(obj);

  if (entries.length === 0) return '<div class="empty">空对象 / 该 IdP 未提供此字段</div>';
  if (depth >= 3) return `<pre class="json-block">${esc(JSON.stringify(obj, null, 2))}</pre>`;

  return `<div class="fields">${entries.map(([key, value]) => {
    const note = FIELD_NOTES[key] ? `<span class="note">${esc(FIELD_NOTES[key])}</span>` : '';
    const isObject = value !== null && typeof value === 'object';
    const typeLabel = isObject ? (Array.isArray(value) ? `array(${value.length})` : 'object') : typeof value;
    return `<div class="field">
      <div class="field-head">
        <span class="key">${esc(key)}</span>
        ${note}
        <span class="type">${esc(typeLabel)}</span>
      </div>
      <div class="field-body">${isObject
        ? renderFields(value, depth + 1)
        : `<div class="scalar">${esc(formatScalar(key, value))}</div>`}</div>
    </div>`;
  }).join('')}</div>`;
}

function panel(id, title, badge, subtitle, body, tone = '') {
  return `<section class="panel ${esc(tone)}" id="${esc(id)}">
    <div class="panel-head">
      <div>
        <h2>${esc(title)}</h2>
        <p>${esc(subtitle)}</p>
      </div>
      <span class="badge">${esc(badge)}</span>
    </div>
    <div class="panel-body">${body}</div>
  </section>`;
}

function statusChip(ok) {
  return ok
    ? '<span class="chip ok">已获取</span>'
    : '<span class="chip off">未获取</span>';
}

const CSS = `
:root{color-scheme:dark;--bg:#0b0e14;--surface:#121821;--surface-2:#171f2b;--line:#252e3c;--text:#e6edf3;--muted:#8b98a9;--accent:#f6821f;--blue:#5b9dff;--green:#3fb950;--purple:#b47cff;--red:#f85149}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;line-height:1.6;font-size:14px}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1160px;margin:0 auto;padding:0 24px 80px}
.topbar{border-bottom:1px solid var(--line);background:rgba(18,24,33,.85);backdrop-filter:blur(12px);position:sticky;top:0;z-index:10}
.topbar-in{max-width:1160px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-weight:650;letter-spacing:.2px}
.brand-mark{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,var(--accent),#ffb35c);display:grid;place-items:center;color:#1a1206;font-weight:800;font-size:13px}
.topbar .spacer{flex:1}
.pill{font-size:12px;padding:4px 11px;border-radius:99px;border:1px solid var(--line);color:var(--muted);background:var(--surface)}
.pill.live{color:var(--green);border-color:#1d4b2b;background:#10251a}
.pill.dev{color:var(--accent);border-color:#5a3a17;background:#2a1c0d}
.btn{font-size:12px;padding:7px 13px;border-radius:8px;border:1px solid var(--line);background:var(--surface-2);color:var(--text);cursor:pointer;font-family:inherit}
.btn:hover{border-color:var(--accent);color:var(--accent)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#1a1206;font-weight:650}
.btn.primary:hover{filter:brightness(1.1);color:#1a1206}
.hero{display:flex;gap:24px;align-items:center;padding:38px 0 30px;flex-wrap:wrap}
.avatar{width:82px;height:82px;border-radius:22px;background:linear-gradient(145deg,#22304a,#3a2a52);border:1px solid #3a4459;display:grid;place-items:center;font-size:31px;font-weight:700;color:#d7e3ff;flex:none}
.hero-main{flex:1;min-width:260px}
.hero h1{margin:0;font-size:27px;letter-spacing:-.4px}
.hero .email{color:var(--muted);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:14px;margin-top:3px}
.hero-tags{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.tag{font-size:12px;padding:4px 10px;border-radius:7px;background:var(--surface-2);border:1px solid var(--line);color:var(--muted)}
.tag.hl{color:var(--accent);border-color:#5a3a17;background:#2a1c0d}
.tag.ok{color:var(--green);border-color:#1d4b2b;background:#10251a}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:34px}
.fact{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.fact .label{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)}
.fact .value{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;margin-top:5px;word-break:break-all}
.section-title{font-size:12px;text-transform:uppercase;letter-spacing:1.4px;color:var(--muted);margin:36px 0 14px;display:flex;align-items:center;gap:10px}
.section-title::after{content:"";flex:1;height:1px;background:var(--line)}
.methods{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.method{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px;position:relative;overflow:hidden}
.method.active{border-color:var(--accent);background:linear-gradient(160deg,#22190e,var(--surface) 60%)}
.method.active::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--accent)}
.method .icon{width:34px;height:34px;border-radius:9px;background:var(--surface-2);border:1px solid var(--line);display:grid;place-items:center;font-weight:700;color:var(--text);margin-bottom:12px}
.method.active .icon{color:var(--accent);border-color:#5a3a17}
.method h3{margin:0;font-size:15px}
.method p{margin:5px 0 0;color:var(--muted);font-size:12px;min-height:34px}
.method .state{font-size:11px;margin-top:12px;color:var(--muted)}
.method.active .state{color:var(--accent);font-weight:650}
.sources{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px}
.source{background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:13px 15px;display:flex;gap:12px;align-items:flex-start}
.source .dot{width:8px;height:8px;border-radius:50%;background:var(--muted);margin-top:7px;flex:none}
.source.on .dot{background:var(--green);box-shadow:0 0 9px rgba(63,185,80,.5)}
.source .s-main{flex:1;min-width:0}
.source .s-name{font-size:12.5px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all}
.source .s-reason{font-size:11.5px;color:var(--muted);margin-top:3px;line-height:1.45}
.chip{font-size:10.5px;padding:2px 8px;border-radius:99px;white-space:nowrap}
.chip.ok{color:var(--green);background:#10251a;border:1px solid #1d4b2b}
.chip.off{color:var(--muted);background:var(--surface-2);border:1px solid var(--line)}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:14px;margin-top:14px;overflow:hidden}
.panel-head{padding:16px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-start;gap:12px;background:var(--surface-2)}
.panel-head h2{margin:0;font-size:15px}
.panel-head p{margin:3px 0 0;color:var(--muted);font-size:12px}
.badge{font-size:11px;color:var(--accent);border:1px solid #5a3a17;background:#2a1c0d;padding:3px 10px;border-radius:99px;white-space:nowrap}
.panel-body{padding:6px 20px 18px}
.field{border-bottom:1px dashed #202836;padding:9px 0}
.field:last-child{border-bottom:none}
.field-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.key{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;color:var(--blue);font-weight:600}
.note{font-size:11.5px;color:var(--muted);flex:1;min-width:180px}
.type{font-size:10px;color:#6c7889;font-family:ui-monospace,monospace}
.field-body{padding-left:12px;border-left:1px solid #222b38;margin-top:4px}
.scalar{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;color:#d5dee9;word-break:break-all;white-space:pre-wrap}
.fields>.field>.field-body>.fields{margin-top:2px}
.empty{color:#697586;font-size:12px;font-style:italic;padding:6px 0}
.json-block{background:#0c1118;border:1px solid var(--line);border-radius:9px;padding:12px;font-size:12px;overflow:auto;color:#c8d4e2;margin:8px 0}
pre.raw{background:#0c1118;border:1px solid var(--line);border-radius:10px;padding:18px;overflow:auto;max-height:460px;font-size:12px;color:#c8d4e2;line-height:1.5;margin:0}
.toolbar{display:flex;gap:9px;flex-wrap:wrap;margin:12px 0 0}
.notice{background:#1a1509;border:1px solid #5a3a17;border-radius:12px;padding:16px 18px;color:#e7c79a;font-size:13px;margin-top:14px}
.notice strong{color:var(--accent)}
.limits{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px 22px}
.limits h3{margin:0 0 8px;font-size:14px;color:var(--text)}
.limits ul{margin:0;padding-left:20px;color:var(--muted);font-size:12.5px}
.limits li{margin:6px 0}
.limits code{font-family:ui-monospace,monospace;color:var(--blue);font-size:12px}
footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);color:#657184;font-size:12px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
@media(max-width:780px){.methods{grid-template-columns:1fr}.hero{padding-top:26px}.wrap{padding:0 16px 60px}.topbar-in{padding:12px 16px}}
`;

const CLIENT_SCRIPT = [
  "(function(){",
  "  var raw = document.getElementById('raw-json');",
  "  var payload = raw ? raw.textContent : '{}';",
  "  function copyText(text, btn){",
  "    var done = function(){ var old = btn.textContent; btn.textContent = '已复制'; setTimeout(function(){ btn.textContent = old; }, 1600); };",
  "    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(done, function(){ fallback(text, done); }); }",
  "    else { fallback(text, done); }",
  "  }",
  "  function fallback(text, done){",
  "    var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';",
  "    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch(e) {} document.body.removeChild(ta);",
  "  }",
  "  var copyBtn = document.getElementById('copy-json');",
  "  if (copyBtn) copyBtn.addEventListener('click', function(){ copyText(payload, copyBtn); });",
  "  var dlBtn = document.getElementById('download-json');",
  "  if (dlBtn) dlBtn.addEventListener('click', function(){",
  "    var blob = new Blob([payload], {type:'application/json'});",
  "    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'access-identity-snapshot.json';",
  "    document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);",
  "  });",
  "  var expandBtn = document.getElementById('expand-all');",
  "  if (expandBtn) expandBtn.addEventListener('click', function(){",
  "    var ds = document.querySelectorAll('details');",
  "    var open = expandBtn.getAttribute('data-open') !== '1';",
  "    for (var i=0;i<ds.length;i++) ds[i].open = open;",
  "    expandBtn.setAttribute('data-open', open ? '1' : '0');",
  "    expandBtn.textContent = open ? '收起全部' : '展开全部';",
  "  });",
  "})();",
].join('\n');

function initials(snapshot) {
  const name = snapshot.identity?.name || snapshot.identity?.email || snapshot.jwt.claims?.email || '?';
  const clean = String(name).trim();
  if (clean.includes('@')) return clean.slice(0, 2).toUpperCase();
  return clean.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function fmtTime(value) {
  if (!value) return '—';
  return new Date(value * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function hero(snapshot) {
  const identity = snapshot.identity || {};
  const claims = snapshot.jwt.claims || {};
  const email = identity.email || claims.email || '未知邮箱';
  const name = identity.name || email.split('@')[0];
  const loginAt = identity.iat || claims.iat;
  const facts = [
    ['登录方式', snapshot.loginMethod.label],
    ['登录时间 (UTC+8)', fmtTime(loginAt)],
    ['用户 UUID', identity.user_uuid || claims.sub || '—'],
    ['认证来源 IP', identity.ip || snapshot.context.headers['cf-connecting-ip'] || '—'],
    ['认证国家', identity.geo?.country || claims.country || snapshot.context.cf?.country || '—'],
    ['会话有效期至', fmtTime(claims.exp)],
  ];

  const logoutUrl = snapshot.meta.teamDomain && !snapshot.meta.teamDomain.includes('your-team')
    ? `${snapshot.meta.teamDomain}/cdn-cgi/access/logout`
    : '';

  return `<div class="hero">
    <div class="avatar">${esc(initials(snapshot))}</div>
    <div class="hero-main">
      <h1>${esc(name)}</h1>
      <div class="email">${esc(email)}</div>
      <div class="hero-tags">
        <span class="tag hl">${esc(snapshot.loginMethod.label)}</span>
        <span class="tag ok">已通过 Access 认证</span>
        ${snapshot.meta.devMode ? '<span class="tag">本地 dev 身份</span>' : ''}
        ${snapshot.meta.audConfigured ? '<span class="tag">JWT 验签已启用</span>' : '<span class="tag">JWT 验签待配置</span>'}
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${snapshot.meta.devMode
        ? '<span class="btn" title="本地预览环境不提供真实登出">切换登录方式（部署后可用）</span>'
        : logoutUrl
          ? `<a class="btn" href="${esc(logoutUrl)}">切换登录方式 / 退出</a>`
          : '<span class="btn" title="配置 TEAM_DOMAIN 后可用">切换登录方式（待配置）</span>'}
    </div>
  </div>
  <div class="facts">${facts.map(([label, value]) => `<div class="fact"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`).join('')}</div>`;
}

function methods(snapshot) {
  return `<div class="methods">${LOGIN_METHODS.map((method) => {
    const active = snapshot.loginMethod.key === method.key;
    return `<div class="method ${active ? 'active' : ''}">
      <div class="icon">${esc(method.icon)}</div>
      <h3>${esc(method.label)}</h3>
      <p>${esc(method.hint)}</p>
      <div class="state">${active ? '● 本次登录使用' : '○ 已在 Access 登录页提供'}</div>
    </div>`;
  }).join('')}</div>
  <p style="color:var(--muted);font-size:12px;margin:10px 0 0">
    三种方式由 Zero Trust 的 Identity providers 提供，登录页由 Cloudflare 托管，Worker 不接触任何 client secret。
    点击右上角「切换登录方式 / 退出」即可重新选择。
  </p>`;
}

function sources(snapshot) {
  return `<div class="sources">${snapshot.sources.map((source) => `<div class="source ${source.ok ? 'on' : ''}">
    <span class="dot"></span>
    <div class="s-main">
      <div class="s-name">${esc(source.label)}</div>
      <div class="s-reason">${esc(source.reason)}</div>
    </div>
    <span class="chip ${source.ok ? 'ok' : 'off'}">${source.ok ? `${source.count} 字段` : '未获取'}</span>
  </div>`).join('')}</div>`;
}

function dataPanels(snapshot) {
  const identityBody = snapshot.identity
    ? renderFields(snapshot.identity)
    : '<div class="empty">无可用的完整身份对象。生产环境由 ctx.access.getIdentity() 提供。</div>';
  const jwtBody = snapshot.jwt.claims
    ? renderFields({ header: snapshot.jwt.header, payload: snapshot.jwt.claims })
    : `<div class="empty">未取得 JWT 声明。原因：${esc(snapshot.jwt.reason)}</div>`;
  const fullBody = snapshot.fullIdentity
    ? renderFields(snapshot.fullIdentity)
    : `<div class="empty">未取得扩展身份。原因：${esc(snapshot.sources[2].reason)}</div>`;
  const requestBody = renderFields({
    request: snapshot.context.request,
    headers: snapshot.context.headers,
    cf: snapshot.context.cf,
  });

  return [
    panel('panel-identity', '① 完整身份 · ctx.access.getIdentity()',
      '官方推荐通道', 'Cloudflare 边缘直接注入的身份对象；包含邮箱、姓名、IdP、分组、设备态势等。', identityBody),
    panel('panel-jwt', '② Access JWT 声明 · CF-Access-Jwt-Assertion',
      snapshot.jwt.verified ? 'RS256 已验签' : '未验签 / 未配置',
      snapshot.jwt.reason, jwtBody,
      snapshot.jwt.verified ? '' : 'dim'),
    panel('panel-full', '③ 扩展身份 · /cdn-cgi/access/get-identity',
      fullBody.includes('class="empty"') ? '待部署后获取' : '已获取',
      '设备会话列表、mTLS 状态、WARP/Gateway 标记、完整 groups 等不受 cookie 大小限制的字段。', fullBody),
    panel('panel-request', '④ 请求上下文 · headers + request.cf',
      `${snapshot.context.redacted.length} 项已脱敏`,
      'Cloudflare 边缘附加的地理、网络与 TLS 信息。会话 Cookie / JWT 原文一律脱敏，绝不回显到页面。', requestBody),
  ].join('');
}

function limits() {
  return `<div class="limits">
    <h3>信息边界：哪些拿得到，哪些拿不到</h3>
    <ul>
      <li><strong>能拿到</strong>：Access 归一化后的身份（email、name、idp、groups、devicePosture、ip、geo、device_sessions…）、JWT 标准与自定义 claims、以及 <code>request.cf</code> 里的地理/ASN/TLS 数据。本页已把这些字段<strong>全量递归展开</strong>，不做白名单过滤。</li>
      <li><strong>拿不到</strong>：GitHub 的 <code>login / avatar_url / bio / company</code>、Google 的 <code>picture / locale / hd</code> 等 IdP 原始 profile。Access 只向应用交付归一化身份，<strong>不透传 IdP 的 access token</strong>，Worker 无法代用户调用 GitHub/Google API。</li>
      <li><strong>groups 有坑</strong>：写入 JWT 的 <code>custom</code> claims 超过约 1 KB 会被从尾部裁剪，groups 最容易丢；完整分组请走 <code>/cdn-cgi/access/get-identity</code>（本页通道 ③）。GitHub/Google 内置集成也不会自动带 groups，只有通用 OIDC/SAML IdP 支持显式配置 claims。</li>
      <li><strong>想拿到原始 profile 的三条路</strong>：① 改用通用 OIDC 集成并配置自定义 claims / SCIM；② 应用内另行实现 GitHub/Google OAuth（自己保管 client secret 与 token，等于绕开 Access 的部分价值）；③ 让用户在前端自行授权后由浏览器直连 IdP API。MVP 阶段不建议，先把网关身份用好。</li>
      <li><strong>安全约定</strong>：<code>cookie</code>、<code>authorization</code>、<code>cf-access-jwt-assertion</code> 等头已脱敏；JWT 验签失败会直接返回 403，不会把未验证的声明渲染出来。</li>
    </ul>
  </div>`;
}

export function renderPage(snapshot) {
  const rawJson = JSON.stringify(snapshot, null, 2);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(snapshot.meta.appName)} · 身份信息</title>
<style>${CSS}</style>
</head>
<body>
<div class="topbar"><div class="topbar-in">
  <div class="brand"><span class="brand-mark">CF</span><span>${esc(snapshot.meta.appName)}</span></div>
  <span class="spacer"></span>
  <span class="pill ${snapshot.meta.devMode ? 'dev' : 'live'}">${snapshot.meta.devMode ? '本地 dev 身份' : 'Zero Trust Access'}</span>
  <span class="pill">${esc(new Date(snapshot.meta.collectedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))} UTC+8</span>
</div></div>

<div class="wrap">
  ${hero(snapshot)}

  <div class="section-title">三种登录方式</div>
  ${methods(snapshot)}

  <div class="section-title">数据来源状态</div>
  ${sources(snapshot)}

  <div class="section-title">所有可获取的个人信息</div>
  ${dataPanels(snapshot)}

  <div class="section-title">信息边界</div>
  ${limits()}

  <div class="section-title">原始快照 JSON</div>
  <details id="raw-details">
    <summary style="cursor:pointer;color:var(--blue);font-size:13px;margin-bottom:10px">展开完整 JSON（可直接复制给后端排查）</summary>
    <pre class="raw" id="raw-json">${esc(rawJson)}</pre>
  </details>
  <div class="toolbar">
    <button class="btn primary" id="copy-json" type="button">复制 JSON</button>
    <button class="btn" id="download-json" type="button">下载 .json</button>
    <button class="btn" id="expand-all" type="button" data-open="0">展开全部</button>
    <a class="btn" href="/api/snapshot" target="_blank" rel="noopener">API: /api/snapshot</a>
    <a class="btn" href="/api/identity" target="_blank" rel="noopener">API: /api/identity</a>
  </div>

  <footer>
    <span>Cloudflare Workers + Zero Trust Access · GitHub / Google / One-time PIN</span>
    <span>快照生成于 ${esc(snapshot.meta.collectedAt)}</span>
  </footer>
</div>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}

export function renderForbidden(message, devHint = false) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>403 · 未通过 Access 认证</title><style>${CSS}</style></head>
<body><div class="wrap" style="padding-top:90px;max-width:680px">
  <div class="notice" style="font-size:15px"><strong>403 · 请求被拒绝</strong><br>${esc(message)}</div>
  <div class="limits" style="margin-top:18px">
    <h3>排查顺序</h3>
    <ul>
      <li>确认该 Worker 的域名已被 Access Application 覆盖，或已在 Workers &amp; Pages → Access 中为该 Worker 开启保护。</li>
      <li>确认 <code>TEAM_DOMAIN</code> 与 <code>POLICY_AUD</code> 与 Zero Trust 控制台中的值完全一致（无尾斜杠）。</li>
      <li>本地开发请在 <code>wrangler.jsonc</code> 保留 <code>access.dev</code> 块，用 <code>npm run dev</code> 启动。</li>
      <li>${devHint ? '当前看起来是本地环境，但没有检测到模拟身份，请检查 access.dev 配置。' : 'JWT 验签失败时本页不会渲染任何未验证的身份数据。'}</li>
    </ul>
  </div>
</div></body></html>`;
}
