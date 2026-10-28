/* 码境 CodeScope —— 局域网访问码（前端极简外壳）✓✓（2026-10-28）
   ══════════════════════════════════════════════════════════════════════════
   要解决的就一件事：**页面在局域网设备上打开时，/api/* 会回 401 needsAuth** ✓，
   得让用户输一次访问码，然后一切照旧 ✓。

   ⚠️ 为什么是「包一层 window.fetch」而不是改 app.js ✗✗：
      app.js 有 14k+ 行、且正在被另一个任务改 ✓ —— 在它几百个 fetch 调用点上
      逐个加 token 是必错的做法 ✗（漏一个就是一个静默失败的面板 ✓）。
      包一层是**一处改、全覆盖** ✓：以后新加的请求自动继承 ✓。

   ⚠️ 为什么还要 cookie ✗：EventSource（lib/system-panel.js 那条任务输出流 ✓）
      和 WebSocket **都没法自定义请求头** ✗ → 只能靠同源 cookie ✓
      （登录成功时由服务端种下 ✓，浏览器自己带 ✓）。自定义头 X-CS-Auth 是第二重保险 ✓。

   ⚠️ 死循环防护（最容易踩的坑 ✗✗）：
      · **登录请求本身**回 401 时绝不能再弹框 ✓（判 pathname === '/api/auth/login' ✓）；
      · 每个请求**最多重试一次** ✓（重试还是 401 就原样返回 ✓，交给调用方报错 ✓）；
      · 用户点「取消」→ 原样返回那个 401 ✓（不重试、不弹第二次 ✓）。
      这三条任意一条漏掉，表现都是「弹框关不掉 / 请求风暴」✓（在 401 上打转 ✗）。

   ⚠️ **不依赖 app.css** ✗：这个框会出现于「样式还没加载 / 主题皮肤坏掉」的时刻 ✓ ——
      所以全部样式内联 ✓、用系统字体 ✓、position:fixed + 最大 z-index ✓。
      回环地址（本机）根本不会触发它 ✓（服务端直接放行 ✓），日常用法零变化 ✓。
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var ORIG_FETCH = window.fetch;
  if (typeof ORIG_FETCH !== 'function') return;

  var STORE_KEY = 'cs-auth-code';
  var LOGIN_PATH = '/api/auth/login';
  var cached = '';
  try { cached = String(localStorage.getItem(STORE_KEY) || ''); } catch (_) { /* 隐私模式 / 禁用 storage ✓ 不致命 */ }

  var prompting = false;
  var waiters = [];

  function saveCode(code) {
    cached = code || '';
    try { if (cached) localStorage.setItem(STORE_KEY, cached); else localStorage.removeItem(STORE_KEY); } catch (_) { }
  }
  function pathOf(target) {
    try { return new URL(String(target || ''), location.href).pathname; } catch (_) { return ''; }
  }
  /* ⚠️ 只对**同源**请求插话 ✗ —— 跨站请求的 401 跟访问码无关 ✓，把码发给第三方等于泄露 ✓。 */
  function sameOrigin(target) {
    try { return new URL(String(target || ''), location.href).origin === location.origin; } catch (_) { return false; }
  }

  /* 用**原始** fetch ✓（不是被包的那层 ✓）—— 从根上断开递归 ✓。 */
  function loginWith(code) {
    return ORIG_FETCH.call(window, LOGIN_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok && j && j.ok !== false, data: j }; },
        function () { return { ok: false, data: null }; });
    }).catch(function () { return { ok: false, data: null }; });
  }

  function buildPanel() {
    var mask = document.createElement('div');
    /* 全部内联 ✓；z-index 取 int32 上限 ✓（编辑器 / xterm / 弹窗都可能叠得很高 ✓） */
    mask.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;'
      + 'background:rgba(10,12,16,.82);display:flex;align-items:center;justify-content:center;'
      + 'font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;color:#e8eaed';

    var box = document.createElement('div');
    box.style.cssText = 'box-sizing:border-box;width:min(440px,92vw);background:#1b1f27;'
      + 'border:1px solid #39404d;border-radius:12px;padding:22px 24px;box-shadow:0 24px 60px rgba(0,0,0,.55)';

    var title = document.createElement('div');
    title.textContent = '需要访问码';
    title.style.cssText = 'font-size:17px;font-weight:600;margin-bottom:8px';

    var desc = document.createElement('div');
    desc.style.cssText = 'font-size:13px;color:#aab2bd;margin-bottom:4px';
    desc.textContent = '这个地址是从局域网访问的。访问码在运行 CodeScope 的那台机器上：'
      + '打开 http://127.0.0.1:' + (location.port || '4877') + '/api/auth/status 就能看到，'
      + '或直接看数据目录里的 access-code.json。';

    var input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = '访问码';
    input.style.cssText = 'box-sizing:border-box;width:100%;margin:14px 0 4px;padding:11px 12px;'
      + 'border:1px solid #414a59;border-radius:8px;background:#0f1115;color:#e8eaed;'
      + 'font:15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.4px;outline:none';

    var err = document.createElement('div');
    err.style.cssText = 'min-height:18px;font-size:12px;color:#ff8a80;margin-bottom:10px';

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';

    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    cancel.style.cssText = 'padding:9px 16px;border-radius:8px;border:1px solid #414a59;'
      + 'background:transparent;color:#aab2bd;font:inherit;cursor:pointer';

    var ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = '进入';
    ok.style.cssText = 'padding:9px 18px;border-radius:8px;border:1px solid #2b6cff;'
      + 'background:#2b6cff;color:#fff;font:inherit;font-weight:600;cursor:pointer';

    row.appendChild(cancel);
    row.appendChild(ok);
    box.appendChild(title);
    box.appendChild(desc);
    box.appendChild(input);
    box.appendChild(err);
    box.appendChild(row);
    mask.appendChild(box);
    return { mask: mask, input: input, err: err, ok: ok, cancel: cancel };
  }

  /* 弹一次框 ✓ —— 并发进来的 401 全部排队等同一个码 ✓（不会叠出五个框 ✗）。 */
  function askCode() {
    return new Promise(function (resolve) {
      if (prompting) { waiters.push(resolve); return; }
      prompting = true;
      var ui = buildPanel();
      var done = false;
      function finish(code) {
        if (done) return;
        done = true;
        if (ui.mask.parentNode) ui.mask.parentNode.removeChild(ui.mask);
        prompting = false;
        resolve(code || '');
        var queued = waiters;
        waiters = [];
        queued.forEach(function (fn) { fn(code || ''); });
      }
      function submit() {
        var value = String(ui.input.value || '').trim();
        if (!value) { ui.err.textContent = '请填写访问码'; ui.input.focus(); return; }
        ui.err.textContent = '';
        ui.ok.disabled = true;
        ui.ok.textContent = '验证中…';
        loginWith(value).then(function (r) {
          if (r && r.ok) { saveCode(value); finish(value); return; }
          ui.ok.disabled = false;
          ui.ok.textContent = '进入';
          ui.err.textContent = (r && r.data && r.data.error) || '访问码不对';
          ui.input.value = '';
          ui.input.focus();
        });
      }
      ui.ok.onclick = submit;
      ui.cancel.onclick = function () { finish(''); };
      ui.input.onkeydown = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(''); }
      };
      /* 挂到 body 上而不是原地 ✓ —— 页面根部可能整块被替换掉 ✓（app.js 会重画 #app ✓） */
      (document.body || document.documentElement).appendChild(ui.mask);
      setTimeout(function () { try { ui.input.focus(); } catch (_) { } }, 30);
    });
  }

  function withAuthHeader(init, code) {
    var out = {};
    if (init) for (var k in init) if (Object.prototype.hasOwnProperty.call(init, k)) out[k] = init[k];
    var headers = null;
    try { headers = new Headers(out.headers || {}); } catch (_) { headers = null; }
    if (headers) { headers.set('X-CS-Auth', code); out.headers = headers; }
    else { out.headers = Object.assign({}, out.headers || {}, { 'X-CS-Auth': code }); }
    return out;
  }

  window.fetch = function (input) {
    var args = arguments;
    /* ⚠️ 先把 Request 克隆一份 ✗：第一次请求会把 body 消费掉 ✓，
       重试时同一个 Request 再发出去就是「Body already used」✗。 */
    var retryInput = null;
    if (input && typeof input === 'object' && typeof input.clone === 'function') {
      try { retryInput = input.clone(); } catch (_) { retryInput = null; }
    }
    var init = args[1];
    var target = (input && typeof input === 'object' && input.url) ? input.url : String(input || '');
    return ORIG_FETCH.apply(window, args).then(function (res) {
      if (!res || res.status !== 401) return res;
      if (!sameOrigin(target)) return res;
      if (pathOf(target) === LOGIN_PATH) return res;          /* ⚠️ 登录自己 401 → 原样返回 ✓ */
      return res.clone().json().then(function (data) {
        if (!data || data.needsAuth !== true) return res;     /* 不是鉴权问题 → 不插话 ✓ */
        var ensure = cached ? Promise.resolve(cached) : askCode();
        return ensure.then(function (code) {
          if (!code) return res;                              /* 用户取消 → 原样 401 ✓ */
          return loginWith(code).then(function (r) {
            if (!r || !r.ok) { saveCode(''); return res; }     /* 码失效 → 清掉，下回再问 ✓ */
            saveCode(code);
            return ORIG_FETCH.call(window, retryInput || input, withAuthHeader(init, code));
          });
        });
      }, function () { return res; });                        /* 不是 JSON（代理错误页）→ 不插话 ✓ */
    });
  };

  /* ★ 打开页面就先用已存的码换一次 cookie ✓ —— 否则「上次输过、cookie 已过期」这种情况，
     EventSource / WebSocket 会一直连不上 ✓（它们不能带自定义头 ✗），而 fetch 却看着正常 ✓。 */
  if (cached) loginWith(cached).then(function (r) { if (!r || !r.ok) saveCode(''); });
})();
