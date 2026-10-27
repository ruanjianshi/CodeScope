/* 把「无限画布」（tldraw 白板）内嵌进绘图面板 —— 和 Draw.io 一样用 iframe ✓，不新开标签页 ✓
   ⚠️ 单独一个文件：app.js 有「代码行数只准变小」的棘轮 ✓。
   ⚠️ 别的编辑器露头时要把 iframe 收掉 ✓ → 用 MutationObserver 盯三个容器的 display ✓。 */
(function () {
  const ROOTS = ['excal-root', 'drawio-root', 'xmind-root'];
  const CANVAS = 'canvas-root';

  /* 拆 iframe 之前先把没落盘的改动推出去 ✓（画布页里是 sendBeacon，销毁后仍会送达） */
  function flushCanvas() {
    const frame = window.__canvasFrame;
    try { frame && frame.contentWindow && frame.contentWindow.__canvasFlush && frame.contentWindow.__canvasFlush(); } catch (_) {}
  }

  function hideCanvas() {
    const root = document.getElementById(CANVAS);
    if (!root) return;
    flushCanvas();
    root.style.display = 'none';
    root.innerHTML = '';
    window.__canvasFrame = null;
    window.__canvasFile = '';
  }

  window.__openCanvasEditor = function (name) {
    const root = document.getElementById(CANVAS);
    if (!root) return false;
    ROOTS.forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    root.style.display = 'block';
    /* 同一个文件重复打开就复用 ✓（不然每次点一下都整页重载 2MB 的 tldraw ✗） */
    if (window.__canvasFile === name && window.__canvasFrame && root.contains(window.__canvasFrame)) return true;
    flushCanvas();
    root.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.className = 'canvas-embed-frame';
    frame.src = '/assets/canvas/index.html?v=20261027b&file=' + encodeURIComponent(name);
    frame.setAttribute('title', '无限画布（tldraw）');
    root.appendChild(frame);
    window.__canvasFrame = frame;
    window.__canvasFile = name;
    return true;
  };
  window.__closeCanvasEditor = hideCanvas;

  const watch = () => {
    ROOTS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.__canvasWatched) return;
      el.__canvasWatched = true;
      new MutationObserver(() => {
        if (el.style.display && el.style.display !== 'none') hideCanvas();
      }).observe(el, { attributes: true, attributeFilter: ['style'] });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
