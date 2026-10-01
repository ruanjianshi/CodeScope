'use strict';

/* ── 环境与更新（本机管家的「系统 · 环境与更新」视图）──
   这个视图回答两个问题，且只回答这两个：
   ① 这台机器上跑 CodeScope 需要的东西，现在是什么状态（缺什么、旧什么）；
   ② 缺了/旧了，我在这里能不能直接修好，修的时候看得见进度吗。

   为什么值得单独一个视图：环境问题以前只有「环境检测」弹窗会讲，而且讲完就完了——
   code-server 这种后加进来的外部依赖，弹窗里只会给一行「去终端跑 npm install」。
   这里把它变成可预演、可流式、可取消的任务，跑完再回头实测一遍给你看结论。

   与后端的分工：本视图不自己探测任何东西，全部来自 GET /env；
   更新动作只是 POST /env/update 起一个任务，然后交给面板的任务控制台（SSE）显示。 */

function createEnvView(host) {
  const { api, el, esc, fmtBytes, relTime, toast, askConfirm, startTask } = host;

  const S = {
    root: null,
    data: null,
    loading: false,
    error: '',
    busy: '',
    lastLoadedAt: 0,
  };

  function isEnvView(view) { return view === 'env'; }

  /* ------------------------------------------------------------ 数据 */

  async function load(force) {
    if (S.loading) return;
    S.loading = true;
    if (!S.data) render();
    try {
      const data = await api('/env' + (force ? '?refresh=1' : ''));
      if (!data || !data.env) throw new Error('环境检测返回异常');
      S.data = data.env;
      S.error = '';
      S.lastLoadedAt = Date.now();
    } catch (error) {
      S.error = String((error && error.message) || error);
    } finally {
      S.loading = false;
      render();
    }
  }

  /* ------------------------------------------------------------ 小组件 */

  function badge(state, text) {
    const cls = state === 'ok' ? 'ok' : state === 'warn' ? 'warn' : 'err';
    return '<span class="env-badge ' + cls + '">' + esc(text) + '</span>';
  }

  function row(label, value, extra) {
    return '<div class="env-row"><span class="k">' + esc(label) + '</span><span class="v">'
      + (value == null || value === '' ? '<i class="dim">—</i>' : value) + '</span>'
      + (extra ? '<span class="x">' + extra + '</span>' : '') + '</div>';
  }

  function actionBlock(action, compact) {
    const buttons = '<button class="env-btn" data-env-dry="' + esc(action.id) + '" type="button">预演</button>'
      + '<button class="env-btn primary" data-env-run="' + esc(action.id) + '" type="button">' + (compact ? '执行' : '执行更新') + '</button>';
    return '<div class="env-action' + (action.needed ? ' needed' : '') + '">'
      + '<div class="env-action-head"><b>' + esc(action.label) + '</b>'
      + badge(action.needed ? 'warn' : 'ok', action.status) + '</div>'
      + '<p class="env-why">' + esc(action.why) + '</p>'
      + '<code class="env-cmd" data-env-copy="' + esc(action.command) + '" title="点击复制">' + esc(action.command) + ' <span class="env-copy">复制</span></code>'
      + '<div class="env-action-foot">' + buttons + '</div>'
      + '</div>';
  }

  /* ------------------------------------------------------------ 渲染 */

  function renderRuntime(data) {
    const r = data.runtime || {};
    return '<div class="sp-band"><h3>运行时</h3><div class="env-rows">'
      + row('当前形态', esc(r.modeLabel || '—'))
      + row('Node', esc(r.node || '—') + (r.electron ? ' · Electron ' + esc(r.electron) : ''))
      + row('引擎要求', r.engineWanted
        ? esc(r.engineWanted) + ' ' + badge(r.engineOk ? 'ok' : 'err', r.engineOk ? '满足' : '不满足')
        : '<i class="dim">未声明</i>')
      + row('平台', esc((r.platform || '') + ' / ' + (r.arch || '')) + ' · ' + esc(r.osVersion || ''))
      + row('CPU', esc((r.cpu || '未知').slice(0, 46)) + ' · ' + esc(String(r.cpuCount || '?')) + ' 核')
      + row('内存', fmtBytes(r.memBytes || 0))
      + row('进程', 'PID ' + esc(String(r.pid || '—')) + ' · 已运行 ' + esc(relTime ? relTime(data.checkedAt - (r.uptimeSec || 0) * 1000) : String(r.uptimeSec) + 's'))
      + '</div></div>';
  }

  function renderServer(data) {
    const s = data.server || {};
    const lan = (s.lanUrls || []);
    const lanHtml = lan.length
      ? lan.map((item) => '<div class="env-lan"><code>' + esc(item.url) + '</code><span class="dim">' + esc(item.iface) + '</span>'
        + '<button class="env-btn" data-env-copy="' + esc(item.url) + '" type="button">复制</button></div>').join('')
      : '<p class="sp-note">没有找到可用的局域网地址（可能没连网）。</p>';
    return '<div class="sp-band"><h3>服务端与多端访问 '
      + badge(s.loopbackOnly ? 'warn' : 'ok', s.loopbackOnly ? '仅本机' : '已对局域网开放') + '</h3><div class="env-rows">'
      + row('本机地址', '<code>' + esc(s.localUrl || '') + '</code>')
      + row('监听', esc((s.host || '') + ':' + String(s.port || '')))
      + row('写入闸门', esc(s.writeGate || '—'))
      + '</div>'
      + '<p class="sp-note">' + esc(s.multiClientHint || '') + '</p>'
      + '<div class="env-lan-list">' + lanHtml + '</div>'
      + '</div>';
  }

  function renderCodeServer(data) {
    const c = data.codeServer || {};
    const state = c.installed && c.runnable ? 'ok' : c.installed ? 'warn' : 'warn';
    const busy = S.busy === 'code-server';
    return '<div class="sp-band"><h3>编辑工作台 · code-server ' + badge(state, c.stateLabel || '—') + '</h3><div class="env-rows">'
      + row('版本', esc(c.version || c.packageVersion || '—') + (c.packageVersion && c.version && c.packageVersion !== c.version ? ' <i class="dim">（包 ' + esc(c.packageVersion) + '）</i>' : ''))
      + row('安装位置', '<code>' + esc(c.installDir || '') + '</code>')
      + row('启动方式', esc(c.resolvedVia || '—'))
      + row('端口', esc(String(c.port || '—')) + ' · 代理 ' + esc(String(c.proxyPort || '—')))
      + '</div>'
      + '<p class="sp-note">' + esc(c.hint || '') + '</p>'
      + '<div class="env-action-foot">'
      + '<button class="env-btn" data-env-vscode="start" type="button"' + (busy ? ' disabled' : '') + '>' + (busy ? '正在启动…' : '启动编辑工作台') + '</button>'
      + '<button class="env-btn" data-env-vscode="open" type="button"' + (busy ? ' disabled' : '') + '>打开</button>'
      + '<button class="env-btn" data-env-vscode="stop" type="button"' + (busy ? ' disabled' : '') + '>停止</button>'
      + '</div></div>';
  }

  function renderDeps(data) {
    const d = data.deps || {};
    const missing = (d.missing || []).map((item) => '<li><code>' + esc(item.name) + '</code> <span class="dim">声明 ' + esc(item.want) + '</span></li>').join('');
    return '<div class="sp-band"><h3>项目依赖 '
      + badge(d.modulesPresent && !d.missingCount ? 'ok' : 'err', d.modulesPresent ? (d.missingCount ? '缺 ' + d.missingCount + ' 个' : '齐全') : 'node_modules 不存在')
      + '</h3><div class="env-rows">'
      + row('声明 / 已装', esc(String(d.declaredCount || 0)) + ' / ' + esc(String(d.installedCount || 0)))
      + row('锁文件', d.lockFile ? esc(d.lockFile) + (d.stale ? ' <i class="dim">（比 node_modules 新）</i>' : '') : '<i class="dim">无</i>')
      + '</div>'
      + (missing ? '<ul class="env-missing">' + missing + '</ul>' : '')
      + '</div>';
  }

  function renderAssets(data) {
    const rows = (data.assets || []).map((item) => {
      const cls = item.state === 'ok' ? 'ok' : 'warn';
      return '<div class="env-asset">'
        + '<div class="env-asset-head">' + badge(cls, item.stateLabel) + '<b>' + esc(item.label) + '</b><span class="sp"></span>'
        + '<code>' + esc(item.output) + '</code></div>'
        + '<div class="env-asset-meta">产物 ' + (item.outputBytes ? fmtBytes(item.outputBytes) : '不存在')
        + (item.newestSource ? ' · 最新源码 <code>' + esc(item.newestSource) + '</code>' : '')
        + (item.missingSource ? ' · <span class="sp-warn">缺少 ' + esc(item.missingSource) + '</span>' : '')
        + '</div></div>';
    }).join('');
    return '<div class="sp-band"><h3>前端产物</h3><div class="env-assets">' + rows + '</div>'
      + '<p class="sp-note">产物比源码旧的时候，浏览器里跑的其实还是旧代码 —— 面板上看不到新功能，多半是这个原因。</p></div>';
  }

  function renderTools(data) {
    const chips = (data.tools || []).map((tool) => '<span class="env-chip ' + (tool.ok ? 'ok' : 'off') + '" title="'
      + esc(tool.for + (tool.ok ? '' : ' · ' + tool.missing)) + '">' + esc(tool.label) + (tool.ok ? '' : ' · 未装') + '</span>').join('');
    return '<div class="sp-band"><h3>外部工具</h3><div class="env-chips">' + chips + '</div>'
      + '<p class="sp-note">这些是 CodeScope 会用到的可选工具：没有也能用，只是对应功能会少一块。</p></div>';
  }

  function renderPaths(data) {
    const p = data.paths || {};
    return '<div class="sp-band"><h3>路径</h3><div class="env-rows">'
      + row('项目', '<code>' + esc(p.projectRoot || '') + '</code>')
      + row('产物', '<code>' + esc(p.assetsDir || '') + '</code>')
      + row('code-server', '<code>' + esc(p.codeServerDir || '') + '</code>')
      + row('数据目录', '<code>' + esc(p.dataRoot || '') + '</code>')
      + row('家目录', '<code>' + esc(p.home || '') + '</code>')
      + '</div></div>';
  }

  function render() {
    if (!S.root) return;
    if (!S.data && S.loading) {
      S.root.innerHTML = '<div class="sp-empty">正在检测环境…（会实测 code-server、比对产物新旧，约 1–2 秒）</div>';
      return;
    }
    if (!S.data) {
      S.root.innerHTML = '<div class="sp-band"><h3 class="sp-warn">环境检测失败</h3><p class="sp-note">'
        + esc(S.error || '未知原因') + '</p><div class="env-action-foot"><button class="env-btn" data-env-reload type="button">重试</button></div></div>';
      return;
    }
    const data = S.data;
    const problems = data.problems || [];
    const notes = data.notes || [];
    const head = '<div class="env-summary ' + (data.ok ? 'ok' : 'warn') + '">'
      + '<div class="env-summary-main">'
      + '<b>' + (data.ok ? '环境正常' : problems.length + ' 个问题') + '</b>'
      + '<span>' + esc(problems.length ? problems.join('；') : '运行时、依赖、前端产物、编辑工作台都就位') + '</span>'
      + '</div>'
      + '<div class="env-summary-foot">'
      + '<span class="dim">检测于 ' + esc(new Date(data.checkedAt || Date.now()).toLocaleTimeString()) + '（本次请求' + (S.loading ? '中' : '已完成') + '）</span>'
      + '<button class="env-btn" data-env-reload type="button"' + (S.loading ? ' disabled' : '') + '>' + (S.loading ? '检测中…' : '重新检测') + '</button>'
      + '</div></div>';
    const needed = (data.actions || []).filter((item) => item.needed);
    const idle = (data.actions || []).filter((item) => !item.needed);
    const actionsHtml = '<div class="sp-band env-updates"><h3>更新与安装 '
      + badge(needed.length ? 'warn' : 'ok', needed.length ? needed.length + ' 项建议处理' : '无需处理') + '</h3>'
      + (needed.length ? needed.map((item) => actionBlock(item)).join('')
        : '<p class="sp-note">没有需要安装或更新的东西。下面这些随时可以手动重跑。</p>')
      + (idle.length ? '<details class="env-idle"><summary>已就位的项（' + idle.length + '）</summary>'
        + idle.map((item) => actionBlock(item, true)).join('') + '</details>' : '')
      + '</div>';
    S.root.innerHTML = head
      + (notes.length ? '<div class="sp-band env-notes"><h3>提示</h3><ul class="env-issues">'
        + notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul></div>' : '')
      + actionsHtml
      + '<div class="sp-cols">' + renderRuntime(data) + renderServer(data) + '</div>'
      + renderCodeServer(data)
      + '<div class="sp-cols">' + renderDeps(data) + renderTools(data) + '</div>'
      + renderAssets(data)
      + renderPaths(data);
  }

  /* ------------------------------------------------------------ 交互 */

  function copy(text, label) {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast('ok', '已复制' + (label ? '：' + label : ''));
    } catch (_) { toast('warn', '复制失败，请手动选择'); }
  }

  async function update(action, dryRun) {
    const spec = (S.data.actions || []).find((item) => item.id === action);
    if (!spec) return;
    if (!dryRun) {
      const heavy = spec.heavy ? '这一步会下载/写入较多内容（' + spec.target + '），' : '';
      const yes = await askConfirm({ title: spec.label, body: heavy + '将执行：\n' + spec.command + '\n\n过程中可以随时取消，输出会实时显示在任务控制台里。', ok: '开始' });
      if (!yes) return;
    }
    try {
      await startTask(() => api('/env/update', { action, dryRun: !!dryRun }));
    } catch (error) {
      toast('err', String((error && error.message) || error));
    }
  }

  async function vscodeAction(action) {
    S.busy = 'code-server';
    render();
    try {
      const response = await fetch('/api/integrations/code-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action === 'stop' ? 'stop' : 'open' }),
      });
      const body = await response.json();
      const service = (body && body.service) || {};
      if (action === 'open') {
        if (!body || !body.ok) throw new Error((service.message || service.hint || '启动失败'));
        const target = 'http://127.0.0.1:' + (service.proxyPort || 4878) + '/';
        window.open(target, '_blank', 'noopener');
        toast('ok', '编辑工作台已打开（新标签页）');
      } else {
        toast(action === 'stop' ? 'warn' : 'ok', action === 'stop' ? '编辑工作台已停止' : '编辑工作台已启动');
      }
      S.busy = '';
      await load(true);
      return;
    } catch (error) {
      S.busy = '';
      toast('err', String((error && error.message) || error));
      render();
    }
  }

  function onClick(event) {
    const node = event.target && event.target.closest ? event.target.closest('[data-env-reload],[data-env-dry],[data-env-run],[data-env-copy],[data-env-vscode]') : null;
    if (!node || !S.root || !S.root.contains(node)) return;
    if (node.hasAttribute('data-env-reload')) { load(true); return; }
    if (node.hasAttribute('data-env-copy')) { copy(node.getAttribute('data-env-copy')); return; }
    if (node.hasAttribute('data-env-dry')) { update(node.getAttribute('data-env-dry'), true); return; }
    if (node.hasAttribute('data-env-run')) { update(node.getAttribute('data-env-run'), false); return; }
    if (node.hasAttribute('data-env-vscode')) { vscodeAction(node.getAttribute('data-env-vscode')); }
  }

  /* ------------------------------------------------------------ 挂载 */

  function mount(container) {
    if (!S.root) {
      S.root = el('div', 'env-root');
      /* 事件委托挂在根上：重新渲染不会丢监听，也不需要每次重绑。 */
      S.root.addEventListener('click', onClick);
    }
    /* setView() 会清空 #system-body，缓存的根会变成游离节点 —— 必须重新挂回去。 */
    if (S.root.parentNode !== container) container.appendChild(S.root);
    if (!S.data && !S.loading) load(false);
    else render();
  }

  return { mount, isEnvView, reload: () => load(true), get data() { return S.data; } };
}

module.exports = { createEnvView };
