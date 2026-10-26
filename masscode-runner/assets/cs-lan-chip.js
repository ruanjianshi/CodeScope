/* ── 顶栏「局域网地址」标签 ────────────────────────────────────────────────
   用户诉求（2026-10-26）：Mac 重启后 IP 会变，每次都要重新查一遍才知道
   Windows 那边该输什么地址 ✓ → 把**当前可用的局域网地址**常驻在顶栏，
   点一下直接复制 ✓，30 秒自动刷新（换网后不用刷新页面就能看到新地址）✓

   ⚠️ 剪贴板：局域网 http 访问**不是安全上下文** ✗ —— `navigator.clipboard` 会直接拒绝 ✓，
      必须回退到「隐藏 textarea + execCommand('copy')」那套老办法 ✓ */
(function () {
  var el = document.getElementById('cs-lan-chip');
  if (!el) return;

  var data = null;

  function text() {
    if (!data || !data.primary) return '局域网 —';
    return data.primary.address + ':' + data.port;
  }

  function tip() {
    if (!data || !data.urls.length) return '没有找到可用的局域网地址（可能没连网）';
    var lines = data.urls.map(function (u) { return u.url + '   (' + u.iface + ')'; });
    return '点击复制：' + (data.primary ? data.primary.url : '') + '\n\n' + lines.join('\n');
  }

  function paint() {
    if (el.dataset.flash === '1') return;
    el.textContent = text();
    el.title = tip();
    el.classList.toggle('is-empty', !data || !data.urls.length);
  }

  function copy(textToCopy) {
    /* 老办法先试：局域网 http 下只有它能用 ✓ */
    try {
      var ta = document.createElement('textarea');
      ta.value = textToCopy;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return true;
    } catch (_) {}
    try { if (navigator.clipboard) { navigator.clipboard.writeText(textToCopy); return true; } } catch (_) {}
    return false;
  }

  function refresh() {
    fetch('/api/lan', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) { data = d; if (d.vaultRoot) window.__csVaultRoot = d.vaultRoot; paint(); } })
      .catch(function () { /* 拿不到就保持原样 */ });
  }

  el.addEventListener('click', function () {
    if (!data || !data.primary) return;
    var url = data.primary.url;
    copy(url);
    el.dataset.flash = '1';
    el.textContent = '已复制 ' + url;
    el.title = url;
    setTimeout(function () { el.dataset.flash = ''; paint(); }, 1500);
  });

  refresh();
  setInterval(refresh, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  window.addEventListener('focus', refresh);
})();

/* ═══ 右键菜单扩展：复制路径 / 下载到本地 ═══════════════════════════════════
   用户：「右键新增复制当前文件、文件夹路径，还有如果在局域网访问，
          需要有下载到本地电脑功能」✓
   ⚠️ 为什么要挂到 window 上 ✗：app.js 里这两个菜单都是**闭包内**构造的 ✓，
      直接写函数名是 ReferenceError（点了没反应）✓ —— 见 app.js 里
      `window.__openNewDialog` 那段注释，同一个坑 ✓ */

window.__csVaultRoot = '';

function ensureRoot() {
  if (window.__csVaultRoot) return Promise.resolve(window.__csVaultRoot);
  return fetch('/api/lan', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d.vaultRoot) window.__csVaultRoot = d.vaultRoot; return window.__csVaultRoot || ''; })
    .catch(function () { return ''; });
}

/* 轻量提示：app.js 的 setStatus 在闭包里，这里自己弹一个小条 ✓ */
function flash(msg, bad) {
  var tip = document.getElementById('cs-menu-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'cs-menu-tip';
    document.body.appendChild(tip);
  }
  tip.textContent = msg;
  tip.className = 'on' + (bad ? ' bad' : '');
  clearTimeout(tip.__t);
  tip.__t = setTimeout(function () { tip.className = ''; }, 1600);
}

/* ⚠️ 上面的 copy() 在 IIFE 作用域里 ✗ —— 这里必须自带一份，否则点了 ReferenceError ✓ */
function copyText(t) {
  try {
    var ta = document.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch (_) { return false; }
}

window.__csCopyPath = function (text) {
  if (!text) return flash('没有拿到路径', true);
  copyText(text);
  flash('已复制路径：' + text);
};

window.__csDownload = function (abs) {
  if (!abs) return flash('没有拿到文件路径', true);
  var a = document.createElement('a');
  a.href = '/api/lan/download?path=' + encodeURIComponent(abs);
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  flash('已开始下载：' + abs.split('/').pop());
};

/* 文件菜单传**绝对路径**（snippets 的 s.file 本来就是绝对路径 ✓）；
   文件夹菜单传树里的相对路径，需要拼上 `<vault>/code/` ✓ */
window.__csMenuItems = function (p, isFolder) {
  var items = [{
    icon: '⧉',
    label: '复制路径',
    run: function () {
      if (!isFolder) return window.__csCopyPath(p);
      ensureRoot().then(function (root) {
        window.__csCopyPath(root ? root.replace(/\/$/, '') + '/code/' + p : p);
      });
    },
  }];
  if (!isFolder) {
    items.push({ icon: '⤓', label: '下载到本地', run: function () { window.__csDownload(p); } });
  }
  return items;
};

/* ═══ 统一给**所有模块**的右键菜单补「复制路径 / 下载到本地」══════════════════
   用户：「怎么其他模块没有新增」✓ —— 之前只加在「项目」树的两个菜单上 ✗
   做法：app.js 的 `showContextMenu()` 是所有右键菜单的**唯一出口** ✓
        （项目 / 绘图 / 阅读 / 知识库 / Office 全走它），在那里挂钩子最省 ✓
   ⚠️ 路径来源各模块不一样 ✗：
     · `.draw-row`     → 没有 data，但 title 是 `我的绘图/x.drawio　点击打开（…）` ✓ 取全角空格前那段
     · `.office-row`   → `data-path` ✓
     · `.reading-*`    → 原本只在闭包里，已在 app.js 里补了 `row.dataset.path` ✓ */
window.__csExtendMenu = function (event, items) {
  if (!items || !items.length) return;
  /* 项目树的两个菜单已经显式加过 → 别重复 ✓ */
  for (var i = 0; i < items.length; i++) if (items[i] && items[i].label === '复制路径') return;

  var t = event && event.target;
  var el = t && t.closest ? t.closest('.draw-row, .office-row, .reading-folder') : null;
  if (!el) return;
  var root = window.__csVaultRoot;
  if (!root) return;

  var rel = '', base = '';
  if (el.classList.contains('draw-row')) {
    rel = String(el.title || '').split('\u3000')[0].trim();
    base = '/drawings/';
  } else if (el.classList.contains('office-row')) {
    rel = el.dataset.path || '';
    base = '/office/';
  } else {
    rel = el.dataset.path || '';
    base = '/readings/';
  }
  if (!rel) return;

  var abs = root.replace(/\/$/, '') + base + rel;
  /* 绘图行一定是文件（文件夹是 .draw-frow，不走这个钩子）✓ 其余按扩展名判断 ✓ */
  var isFile = el.classList.contains('draw-row') || /\.[a-z0-9]{1,8}$/i.test(rel);
  var extra = [
    { type: 'separator' },
    { icon: '⧉', label: '复制路径', run: function () { window.__csCopyPath(abs); } },
  ];
  if (isFile) extra.push({ icon: '⤓', label: '下载到本地', run: function () { window.__csDownload(abs); } });
  /* 插在「打开」之后，和项目树里的位置一致 ✓ */
  items.splice.apply(items, [1, 0].concat(extra));
};
