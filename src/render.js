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
.avatar{position:relative;overflow:hidden}
.avatar img{width:100%;height:100%;object-fit:cover;border-radius:21px;display:block}
.avatar-fallback{width:100%;height:100%;display:grid;place-items:center;font-size:31px;font-weight:700;color:#d7e3ff}
.nav{display:flex;gap:4px;align-items:center}
.nav a{font-size:12px;padding:6px 11px;border-radius:8px;border:1px solid transparent;color:var(--muted)}
.nav a:hover{text-decoration:none;color:var(--text);background:var(--surface-2)}
.nav a.on{color:var(--accent);border-color:#5a3a17;background:#2a1c0d}
.upload{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:14px}
.upload input[type=file]{font-size:12px;color:var(--muted);max-width:220px}
.upload-note{font-size:11.5px;color:var(--muted)}
.logs-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap;margin:30px 0 16px}
.logs-head h1{margin:0;font-size:23px}
.logs-head p{margin:5px 0 0;color:var(--muted);font-size:12.5px}
.search{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}
.search input{background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:8px 11px;color:var(--text);font-size:12.5px;font-family:inherit;min-width:230px}
.search input:focus{outline:none;border-color:var(--accent)}
.table-wrap{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);background:var(--surface-2);font-weight:600}
tr:last-child td{border-bottom:none}
tbody tr:hover{background:#161e29}
.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.pager{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:16px;font-size:12.5px;color:var(--muted)}
.pager .pages{display:flex;gap:6px;align-items:center}
.pager a,.pager span.cur{padding:6px 11px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px}
.pager span.cur{border-color:var(--accent);color:var(--accent)}
.pager a:hover{text-decoration:none;border-color:var(--accent)}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin:16px 0}
.kv .item{background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:12px 14px}
.kv .k{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px}
.kv .v{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;margin-top:5px;word-break:break-all}
.back{display:inline-block;margin:26px 0 0;font-size:12.5px}
.userbox{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.user-email{font-size:12px;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btn.logout{border-color:#5a2b2b;color:#ff9d97;background:#2a1719}
.btn.logout:hover{border-color:var(--red);color:#fff;background:#3a1c1f}
.btn.login{background:var(--accent);border-color:var(--accent);color:#1a1206;font-weight:650}
.btn.login:hover{filter:brightness(1.1);color:#1a1206}
.logout-stage{max-width:660px;padding:64px 20px 80px}
.logout-card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:30px 32px}
.logout-card h1{margin:14px 0 6px;font-size:22px}
.logout-card p{color:var(--muted);font-size:13px;margin:6px 0 0}
.logout-state{display:flex;align-items:center;gap:12px;margin:22px 0 4px;padding:14px 16px;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;font-size:13px}
.spinner{width:17px;height:17px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
.logout-steps{margin:18px 0 0;padding-left:20px;color:var(--muted);font-size:12.5px;line-height:1.7}
.logout-steps li{margin:6px 0}
.logout-steps code,.logout-card code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--blue);font-size:12px}
.logout-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:24px}
@media(max-width:780px){.methods{grid-template-columns:1fr}.hero{padding-top:26px}.wrap{padding:0 16px 60px}.topbar-in{padding:12px 16px}.nav a{padding:6px 8px}.user-email{display:none}.logout-card{padding:22px}.logout-stage{padding:40px 16px 60px}}
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
  "  var avatarImg = document.getElementById('avatar-img');",
  "  if (avatarImg) {",
  "    avatarImg.addEventListener('load', function(){ avatarImg.style.display='block'; var fb=document.getElementById('avatar-fallback'); if(fb) fb.style.display='none'; });",
  "    avatarImg.addEventListener('error', function(){ avatarImg.style.display='none'; var fb=document.getElementById('avatar-fallback'); if(fb) fb.style.display='grid'; });",
  "    if (avatarImg.complete && avatarImg.naturalWidth > 0) avatarImg.dispatchEvent(new Event('load'));",
  "  }",
  "  var fileInput = document.getElementById('avatar-file');",
  "  var uploadBtn = document.getElementById('avatar-upload');",
  "  var uploadMsg = document.getElementById('avatar-msg');",
  "  if (uploadBtn && fileInput) uploadBtn.addEventListener('click', function(){",
  "    var f = fileInput.files && fileInput.files[0];",
  "    if (!f) { if(uploadMsg) uploadMsg.textContent='请先选择图片'; return; }",
  "    if (f.size > 2*1024*1024) { if(uploadMsg) uploadMsg.textContent='图片不能超过 2MB'; return; }",
  "    uploadBtn.disabled = true; if(uploadMsg) uploadMsg.textContent='上传中…';",
  "    fetch('/api/avatar', { method:'POST', headers:{'content-type': f.type || 'application/octet-stream'}, body: f })",
  "      .then(function(r){ return r.json().then(function(d){ return { ok:r.ok, d:d }; }); })",
  "      .then(function(x){",
  "        if(uploadMsg) uploadMsg.textContent = x.d.ok ? '上传成功' : ('上传失败：' + (x.d.reason || x.d.error || '未知原因'));",
  "        if (x.d.ok && avatarImg) avatarImg.src = '/api/avatar?t=' + Date.now();",
  "      })",
  "      .catch(function(e){ if(uploadMsg) uploadMsg.textContent='上传失败：' + e.message; })",
  "      .then(function(){ uploadBtn.disabled = false; });",
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

  return `<div class="hero">
    <div class="avatar">
      <div class="avatar-fallback" id="avatar-fallback">${esc(initials(snapshot))}</div>
      <img id="avatar-img" src="/api/avatar" alt="用户头像" referrerpolicy="no-referrer" style="display:none">
    </div>
    <div class="hero-main">
      <h1>${esc(name)}</h1>
      <div class="email">${esc(email)}</div>
      <div class="hero-tags">
        <span class="tag hl">${esc(snapshot.loginMethod.label)}</span>
        <span class="tag ok">已通过 Access 认证</span>
        ${snapshot.meta.devMode ? '<span class="tag">本地 dev 身份</span>' : ''}
        ${snapshot.meta.audConfigured ? '<span class="tag">JWT 验签已启用</span>' : '<span class="tag">JWT 验签待配置</span>'}
      </div>
      <div class="upload">
        <input type="file" id="avatar-file" accept="image/png,image/jpeg,image/webp,image/gif">
        <button class="btn" id="avatar-upload" type="button">上传头像</button>
        <span class="upload-note" id="avatar-msg">头像存于 R2 · PNG / JPEG / WebP / GIF · ≤ 2MB</span>
      </div>
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
    点击右上角「退出登录」结束当前会话，即可回到登录页重新选择。
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
      <li><strong>头像来自 R2，不是 IdP</strong>：由于上面这条限制，本项目用 Cloudflare R2 保存用户自行上传的头像，按 <code>user_uuid</code> 命名，经 <code>/api/avatar</code> 读写；未上传时降级显示姓名首字母。要自动同步 IdP 头像，只能改用通用 OIDC + 自定义 claims，或在应用内另做 OAuth。</li>
      <li><strong>groups 有坑</strong>：写入 JWT 的 <code>custom</code> claims 超过约 1 KB 会被从尾部裁剪，groups 最容易丢；完整分组请走 <code>/cdn-cgi/access/get-identity</code>（本页通道 ③）。GitHub/Google 内置集成也不会自动带 groups，只有通用 OIDC/SAML IdP 支持显式配置 claims。</li>
      <li><strong>想拿到原始 profile 的三条路</strong>：① 改用通用 OIDC 集成并配置自定义 claims / SCIM；② 应用内另行实现 GitHub/Google OAuth（自己保管 client secret 与 token，等于绕开 Access 的部分价值）；③ 让用户在前端自行授权后由浏览器直连 IdP API。MVP 阶段不建议，先把网关身份用好。</li>
      <li><strong>安全约定</strong>：<code>cookie</code>、<code>authorization</code>、<code>cf-access-jwt-assertion</code> 等头已脱敏；JWT 验签失败会直接返回 403，不会把未验证的声明渲染出来。</li>
    </ul>
  </div>`;
}

function fmtIso(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function parseStored(text, fallback) {
  try {
    const value = JSON.parse(text || 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function shell(snapshot, title, active, body, withScript = true) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · ${esc(snapshot.meta.appName)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="topbar"><div class="topbar-in">
  <div class="brand"><span class="brand-mark">CF</span><span>${esc(snapshot.meta.appName)}</span></div>
  <nav class="nav">
    <a href="/" class="${active === 'home' ? 'on' : ''}">身份信息</a>
    <a href="/logs" class="${active === 'logs' ? 'on' : ''}">登录记录</a>
  </nav>
  <span class="spacer"></span>
  <div class="userbox">
    <span class="pill ${snapshot.meta.devMode ? 'dev' : 'live'}">${snapshot.meta.devMode ? '本地 dev 身份' : '已登录'}</span>
    <span class="user-email" title="${esc(snapshot.identity?.email || '')}">${esc(snapshot.identity?.email || '未知用户')}</span>
    <span class="pill">${esc(new Date(snapshot.meta.collectedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))} UTC+8</span>
    <a class="btn logout" href="/logout" title="结束当前 Access 会话并回到登录页">退出登录</a>
  </div>
</div></div>

<div class="wrap">
  ${body}
  <footer>
    <span>Cloudflare Workers + Zero Trust Access · R2 头像 / D1 登录日志</span>
    <span>快照生成于 ${esc(snapshot.meta.collectedAt)}</span>
  </footer>
</div>
${withScript ? `<script>${CLIENT_SCRIPT}</script>` : ''}
</body>
</html>`;
}

export function renderPage(snapshot, storage) {
  const rawJson = JSON.stringify(snapshot, null, 2);
  const body = `
  ${hero(snapshot)}

  <div class="section-title">三种登录方式</div>
  ${methods(snapshot)}

  <div class="section-title">数据来源状态</div>
  ${sources(snapshot)}

  <div class="section-title">所有可获取的个人信息</div>
  ${dataPanels(snapshot)}

  <div class="section-title">头像与登录记录</div>
  <div class="facts">
    <div class="fact"><div class="label">R2 头像存储</div><div class="value">${storage?.r2 ? '已绑定' : '未绑定'}</div></div>
    <div class="fact"><div class="label">D1 登录日志</div><div class="value">${storage?.d1 ? '已绑定' : '未绑定'}</div></div>
    <div class="fact"><div class="label">记录列表</div><div class="value"><a href="/logs">查看登录记录 →</a></div></div>
  </div>

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
    <a class="btn" href="/logs">登录记录</a>
    <a class="btn" href="/api/snapshot" target="_blank" rel="noopener">API: /api/snapshot</a>
    <a class="btn" href="/api/identity" target="_blank" rel="noopener">API: /api/identity</a>
    <a class="btn" href="/api/logs" target="_blank" rel="noopener">API: /api/logs</a>
  </div>`;
  return shell(snapshot, '身份信息', 'home', body);
}

function logRows(data) {
  if (!data.rows?.length) {
    return '<div class="table-wrap"><div class="empty" style="padding:26px">暂无登录记录。绑定 D1 并完成首次登录后，这里会出现数据。</div></div>';
  }
  return `<div class="table-wrap"><table>
    <thead><tr><th>登录时间 (UTC+8)</th><th>用户</th><th>登录方式</th><th>IP / 地区</th><th>入口节点</th><th>环境</th><th></th></tr></thead>
    <tbody>${data.rows.map((row) => `<tr>
      <td class="mono">${esc(fmtIso(row.created_at))}</td>
      <td>${esc(row.name || '—')}<div style="color:var(--muted);font-size:11.5px">${esc(row.email || '')}</div></td>
      <td>${esc(row.login_method || '—')}</td>
      <td class="mono">${esc(row.ip || '—')} <span style="color:var(--muted)">${esc([row.country, row.city].filter(Boolean).join(' · '))}</span></td>
      <td class="mono">${esc(row.colo || '—')}</td>
      <td>${row.dev_mode ? '<span class="tag">本地 dev</span>' : '<span class="tag ok">生产</span>'}</td>
      <td><a href="/logs/${esc(encodeURIComponent(row.id))}">详情 →</a></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function pager(data) {
  const link = (page) => `/logs?page=${page}&pageSize=${data.pageSize}${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}`;
  return `<div class="pager">
    <span>共 ${data.total} 条 · 第 ${data.page} / ${data.pageCount} 页 · ${data.admin ? '管理员视图（全部用户）' : '仅本人记录'}</span>
    <div class="pages">
      ${data.page > 1 ? `<a href="${link(data.page - 1)}">← 上一页</a>` : ''}
      <span class="cur">${data.page}</span>
      ${data.page < data.pageCount ? `<a href="${link(data.page + 1)}">下一页 →</a>` : ''}
    </div>
  </div>`;
}

export function renderLogsPage(snapshot, data) {
  const notice = data.skipped
    ? `<div class="notice"><strong>存储尚未配置</strong>：${esc(data.reason || 'D1 未绑定')}。部署并绑定 D1 后自动生效。</div>`
    : data.error
      ? `<div class="notice"><strong>查询失败</strong>：${esc(data.error)}。请确认已执行 <code>npm run db:init</code> 建表。</div>`
      : '';
  const body = `
  <div class="logs-head">
    <div>
      <h1>登录记录</h1>
      <p>每次通过 Access 认证后访问页面时写入 D1，按 (user_uuid, iat) 去重；身份对象落库前已递归脱敏。</p>
    </div>
    <a class="btn" href="/api/logs" target="_blank" rel="noopener">API: /api/logs</a>
  </div>
  ${notice}
  <form class="search" method="get" action="/logs">
    <input type="hidden" name="pageSize" value="${data.pageSize}">
    <input type="text" name="q" value="${esc(data.q)}" placeholder="按邮箱 / 姓名 / IP / 登录方式搜索">
    <button class="btn primary" type="submit">搜索</button>
    <a class="btn" href="/logs">重置</a>
  </form>
  ${logRows(data)}
  ${pager(data)}
  <div class="section-title">当前视图</div>
  <div class="facts">
    <div class="fact"><div class="label">登录用户</div><div class="value">${esc(snapshot.identity?.email || '—')}</div></div>
    <div class="fact"><div class="label">可见范围</div><div class="value">${data.admin ? '管理员 · 全部记录' : '普通用户 · 仅本人'}</div></div>
    <div class="fact"><div class="label">D1 绑定</div><div class="value">${data.storage?.d1 ? '已绑定' : '未绑定'}</div></div>
    <div class="fact"><div class="label">R2 绑定</div><div class="value">${data.storage?.r2 ? '已绑定' : '未绑定'}</div></div>
  </div>`;
  return shell(snapshot, '登录记录', 'logs', body, false);
}

export function renderLogDetailPage(snapshot, result) {
  const row = result.row;
  const body = row ? `
  <a class="back" href="/logs">← 返回登录记录</a>
  <div class="logs-head">
    <div><h1>登录详情</h1><p>${esc(row.email || '未知用户')} · ${esc(fmtIso(row.created_at))} (UTC+8)</p></div>
    <a class="btn" href="/api/logs/${esc(encodeURIComponent(row.id))}" target="_blank" rel="noopener">API: 原始 JSON</a>
  </div>
  <div class="section-title">概要字段</div>
  <div class="kv">${[
    ['记录 ID', row.id],
    ['用户 UUID', row.user_uuid],
    ['邮箱', row.email],
    ['姓名', row.name],
    ['登录方式', row.login_method],
    ['IdP 类型', row.idp_type],
    ['认证来源 IP', row.ip],
    ['国家 / 城市', [row.country, row.city].filter(Boolean).join(' / ')],
    ['入口节点 colo', row.colo],
    ['ASN / 运营商', [row.asn, row.as_org].filter(Boolean).join(' / ')],
    ['登录时间 iat (UTC+8)', row.auth_at ? fmtTime(row.auth_at) : ''],
    ['会话过期 exp (UTC+8)', row.session_exp ? fmtTime(row.session_exp) : ''],
    ['Application AUD', row.aud],
    ['写入时间', row.created_at],
    ['环境', row.dev_mode ? '本地 dev' : '生产'],
    ['User-Agent', row.user_agent],
  ].map(([label, value]) => `<div class="item"><div class="k">${esc(label)}</div><div class="v">${esc(value || '—')}</div></div>`).join('')}</div>
  <div class="section-title">分组 claims</div>
  ${renderFields(parseStored(row.groups_json, []))}
  <div class="section-title">落库的身份对象（已脱敏）</div>
  ${renderFields(parseStored(row.identity_json, {}))}
  <div class="section-title">完整记录 JSON</div>
  <pre class="raw" id="raw-json">${esc(JSON.stringify(row, null, 2))}</pre>
  <div class="toolbar"><button class="btn primary" id="copy-json" type="button">复制 JSON</button></div>
  ` : `
  <a class="back" href="/logs">← 返回登录记录</a>
  <div class="notice"><strong>无法查看该记录</strong><br>${esc(result.reason || result.error || '记录不存在')}
  ${result.skipped ? '<br>请先部署并绑定 D1，再执行数据库迁移。' : ''}</div>
  `;
  return shell(snapshot, '登录详情', 'logs', body, true);
}

/**
 * 退出中间页。
 *
 * Cloudflare Access 的 /cdn-cgi/access/logout 只会清除会话 Cookie、撤销 token，
 * 本身并不跳转到登录页（无 Cookie 时甚至只返回错误页）。登录页 URL 还带动态
 * 生成的 meta 参数，无法硬编码。因此流程是：
 *   ① 本页用同源请求触发官方登出端点；
 *   ② 跳回受 Access 保护的 /，边缘自动 302 到带 meta 的登录页；
 *   ③ 用户在登录页重新选择 IdP，完成「登录 / 退出」的状态切换。
 */
export function renderLogoutPage(snapshot) {
  const meta = snapshot?.meta || {};
  const devMode = !!meta.devMode;
  const team = String(meta.teamDomain || '').replace(/\/+$/, '');
  const host = snapshot?.context?.request?.host || '';
  const aud = snapshot?.jwt?.claims?.aud || snapshot?.ctxAud || '';
  const teamReady = team && !team.includes('your-team');
  const directLogin = teamReady && host && aud
    ? `${team}/cdn-cgi/access/login/${host}?kid=${encodeURIComponent(aud)}&redirect_url=%2F`
    : '';
  // 应用登出清 hostname 上的授权 Cookie；team 域名登出额外清全局 SSO Cookie。
  // 两者都会由 Cloudflare 服务端撤销该用户的会话（约 20–30 秒全网生效）。
  const teamLogout = teamReady ? `${team}/cdn-cgi/access/logout` : '';
  const email = snapshot?.identity?.email || '';

  const script = [
    '(function(){',
    `  var devMode = ${devMode ? 'true' : 'false'};`,
    "  var status = document.getElementById('logout-status');",
    "  var goBtn = document.getElementById('login-now');",
    "  function go(){ window.location.replace('/'); }",
    "  if (goBtn) goBtn.addEventListener('click', go);",
    "  if (devMode) return;",
    "  var done = false;",
    "  function finish(){",
    "    if (done) return; done = true;",
    "    if (status) status.textContent = '会话已撤销，正在前往 Access 登录页…';",
    "    window.setTimeout(go, 1200);",
    "  }",
    "  // 同源请求触发官方登出端点；即使被 X-Frame-Options / CORS 拦下，Set-Cookie 仍已生效。",
    "  fetch('/cdn-cgi/access/logout', { credentials: 'include' }).catch(function(){});",
    "  function ping(src, onLoad){",
    "    var frame = document.createElement('iframe');",
    "    frame.src = src;",
    "    frame.title = 'access-logout';",
    "    frame.setAttribute('aria-hidden', 'true');",
    "    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0';",
    "    frame.addEventListener('load', onLoad);",
    "    frame.addEventListener('error', onLoad);",
    "    document.body.appendChild(frame);",
    "  }",
    "  ping('/cdn-cgi/access/logout', function(){ window.setTimeout(finish, 400); });",
    `  if (${JSON.stringify(teamLogout)}) ping(${JSON.stringify(teamLogout)}, function(){});`,
    "  window.setTimeout(finish, 3000);",
    '})();',
  ].join('\n');

  const devNotice = devMode
    ? '<div class="notice"><strong>本地 dev 模式</strong>：身份由 <code>wrangler.jsonc</code> 的 <code>access.dev</code> 注入，浏览器里没有真实 Access 会话可撤销。部署到生产后会自动完成登出并跳转登录页。</div>'
    : '';

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>退出登录 · ${esc(meta.appName || 'Identity Console')}</title><style>${CSS}</style></head>
<body>
<div class="wrap logout-stage">
  <div class="logout-card">
    <div class="brand"><span class="brand-mark">CF</span><span>${esc(meta.appName || 'Identity Console')}</span></div>
    <h1>正在退出登录…</h1>
    <p>即将结束${email ? ` ${esc(email)} 的` : '当前'} Zero Trust Access 会话，并返回登录页重新选择登录方式。</p>
    ${devNotice}
    <div class="logout-state">
      ${devMode ? '<span class="chip off">dev</span>' : '<span class="spinner"></span>'}
      <span id="logout-status">${devMode ? '本地 dev 模式：无需撤销会话' : '正在撤销 Access 会话…'}</span>
    </div>
    <ol class="logout-steps">
      <li>调用同源 <code>/cdn-cgi/access/logout</code> 与 team 域名同名端点，由 Cloudflare 撤销会话并清除应用 + 全局授权 Cookie（约 20–30 秒全网生效）。</li>
      <li>跳回应用首页 <code>/</code>。整个 hostname 都受 Access 保护，未认证请求会被 302 到登录页。</li>
      <li>在 Cloudflare 托管的登录页重新选择 GitHub / Google / 邮箱验证码，完成登录。</li>
    </ol>
    <div class="logout-actions">
      <button class="btn login" id="login-now" type="button">${devMode ? '返回首页（重新登录）' : '立即重新登录 →'}</button>
      ${directLogin ? `<a class="btn" href="${esc(directLogin)}">直接打开 Access 登录页</a>` : ''}
    </div>
    <p style="margin-top:18px;font-size:12px">提示：若 Google / GitHub 等 IdP 仍保持登录，可能自动完成 SSO；需要彻底换账号请先在 IdP 侧登出。</p>
  </div>
  <footer><span>Cloudflare Workers + Zero Trust Access · 登录 / 退出由 Access 统一管理</span><span>${esc(meta.collectedAt || '')}</span></footer>
</div>
<script>${script}</script>
</body></html>`;
}

export function renderForbidden(message, devHint = false, showLogin = true) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>403 · 未通过 Access 认证</title><style>${CSS}</style></head>
<body><div class="wrap" style="padding-top:90px;max-width:680px">
  <div class="notice" style="font-size:15px"><strong>403 · 请求被拒绝</strong><br>${esc(message)}</div>
  ${showLogin ? '<div class="toolbar"><a class="btn login" href="/">前往 Access 登录页 →</a></div>' : ''}
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
