'use strict';

/* ── 远程同步（本机管家的「系统 · 远程同步」视图）──
   这个视图要回答的问题只有一个：**把当前这台机器上的 CodeScope 推到我的 VPS 上**，
   而且推之前我能先看清它到底会动什么。

   三条设计底线（写在这里，也写进界面，因为用户看不见代码）：
   ① 预演优先：预演（rsync -n）不写远端一个字节，先看清传什么、删什么，再决定同步；
   ② 只写目标机指定目录：所有写入都落在 <remoteDir>/<projectName> 里，绝不动远端家目录；
   ③ 破坏性动作要显式开：--delete 只有用户在设置里打开才加，重启命令只允许 systemctl / pm2 / docker 开头的白名单。

   与后端的分工：本视图不自己 ssh、不自己拼命令，探测与执行全部来自 /sync/vps 与 /sync/vps/update；
   执行交给面板自己的任务控制台（同一套 SSE、同一套取消），所以这里只负责「说清楚 + 起任务」。 */

function createSyncView(host) {
  const { api, el, esc, relTime, toast, startTask } = host;

  const S = {
    root: null,
    report: null,
    config: null,
    loading: false,
    saving: false,
    busy: '',
    error: '',
    lastLoadedAt: 0,
  };

  function isSyncView(view) { return view === 'sync'; }

  /* ------------------------------------------------------------ 数据 */

  async function load(force) {
    if (S.loading) return;
    S.loading = true;
    if (!S.report) render();
    try {
      const data = await api('/sync/vps' + (force ? '?refresh=1' : ''));
      if (!data || !data.report) throw new Error('远程同步检测返回异常');
      S.report = data.report;
      S.config = data.config || data.report.config || {};
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
    return '<span class="env-badge ' + (state || 'ok') + '">' + esc(text) + '</span>';
  }

  function row(label, value, extra) {
    return '<div class="env-row"><span class="env-row-label">' + esc(label) + '</span>'
      + '<span class="env-row-value">' + (value === undefined || value === null || value === '' ? '<span class="dim">—</span>' : value) + '</span>'
      + (extra ? '<span class="env-row-extra">' + extra + '</span>' : '') + '</div>';
  }

  function fmtTime(value) {
    if (!value) return '';
    try { return new Date(value).toLocaleString(); } catch (_) { return ''; }
  }

  function copy(text, label) {
    const done = () => toast('ok', (label || '内容') + '已复制');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => toast('err', '复制失败，请手动选中'));
    } else {
      toast('err', '这个浏览器不允许自动复制，请手动选中');
    }
  }

  /* 后端给的可用传输是「以工具名为键的对象」，不是数组：
     { ssh:{available,path}, rsync:{available,path,kind}, tar:{...} }。
     所以这里必须按对象渲染，写 .map() 会直接抛 (v.local||[]).map is not a function。 */
  function transportList(group) {
    if (!group) return '';
    const entries = Array.isArray(group) ? group.map((x, i) => [String(x), null, i]) : Object.entries(group).map(([key, value]) => [key, value, null]);
    const parts = entries.map(([key, value]) => {
      const missing = value && value.available === false;
      const where = value && value.path ? ' <span class="dim">' + esc(String(value.path)) + '</span>' : '';
      const kind = value && value.kind ? ' <span class="dim">' + esc(String(value.kind)) + '</span>' : '';
      return '<span' + (missing ? ' class="dim"' : '') + '>' + esc(key) + where + kind + (missing ? '（不可用）' : '') + '</span>';
    });
    return parts.join('、') || '<span class="dim">—</span>';
  }

  function probeText(probe) {
    if (typeof probe === 'string') return probe.slice(0, 220);
    try { return JSON.stringify(probe).slice(0, 220); } catch (_) { return ''; }
  }

  /* 配置表单：六项必填参数 + 五个开关。全部从 report.config 回填，保存前不做本地校验，
     交给后端 setConfig 严格判定（非法目标后端直接 400，不落盘）。 */
  const TEXT_FIELDS = [
    ['host', '主机', 'vps.example.com 或 IP'],
    ['user', '登录用户', 'root'],
    ['port', 'SSH 端口', '22'],
    ['identityFile', '私钥文件', '~/.ssh/id_ed25519 （必须免密）'],
    ['remoteDir', '远端根目录', '/srv/codescope'],
    ['projectName', '项目目录名', '留空则用本仓库目录名'],
    ['restartCommand', '部署后重启命令（可留空）', 'systemctl restart codescope'],
  ];
  const BOOL_FIELDS = [
    ['transport_tar', 'transport', '用 tar|ssh 传（远端没有 rsync 时选它）', 'tar', 'rsync'],
    ['includeVault', 'includeVault', '同步 markdown-vault（笔记数据）', true, false],
    ['includeNodeModules', 'includeNodeModules', '同步 node_modules（一般不要）', true, false],
    ['deleteExtraneous', 'deleteExtraneous', '允许 --delete 删除远端多余文件（危险，默认关）', true, false],
    ['remoteInstall', 'remoteInstall', '部署时在远端跑 npm install --omit=dev', true, false],
  ];

  function fieldsHtml() {
    const config = S.config || {};
    const inputs = TEXT_FIELDS.map(([key, label, placeholder]) => {
      const value = config[key] === undefined || config[key] === null ? '' : String(config[key]);
      return '<label class="sync-field"><span>' + esc(label) + '</span>'
        + '<input class="sp-input" data-sync-field="' + esc(key) + '" value="' + esc(value) + '" placeholder="' + esc(placeholder) + '"></label>';
    }).join('');
    const toggles = BOOL_FIELDS.map(([id, key, label, onValue, offValue]) => {
      const on = config[key] === onValue;
      return '<label class="sp-check sync-toggle"><input type="checkbox" data-sync-bool="' + esc(key) + '"'
        + ' data-on="' + esc(String(onValue)) + '" data-off="' + esc(String(offValue)) + '"' + (on ? ' checked' : '') + '>'
        + '<span>' + esc(label) + '</span></label>';
    }).join('');
    return '<div class="sync-form">' + inputs + '</div><div class="sync-toggles">' + toggles + '</div>';
  }

  function actionBlock(action) {
    const id = action.id;
    const isPreview = id === 'vps-preview';
    const command = String(action.command || '');
    return '<div class="sync-action' + (action.needed ? '' : ' idle') + '">'
      + '<div class="sync-action-head">'
      + '<b>' + esc(action.label || id) + '</b>'
      + badge(action.needed ? 'ok' : 'warn', action.needed ? '可执行' : '需先填配置')
      + (action.heavy ? badge('warn', '会写远端') : badge('ok', '只读'))
      + '</div>'
      + '<p class="sp-note">' + esc(action.why || '') + '</p>'
      + (command ? '<pre class="sync-cmd">' + esc(command) + '</pre>' : '')
      + '<div class="env-action-foot">'
      + '<button class="env-btn" data-sync-dry="' + esc(id) + '" type="button"' + (S.busy ? ' disabled' : '') + '>预演</button>'
      + (isPreview ? '' : '<button class="env-btn primary" data-sync-run="' + esc(id) + '" type="button"' + (S.busy ? ' disabled' : '') + '>执行</button>')
      + (command ? '<button class="env-btn" data-sync-copy-command="' + esc(id) + '" type="button">复制命令</button>' : '')
      + '</div></div>';
  }

  /* ------------------------------------------------------------ 渲染 */

  function render() {
    if (!S.root) return;
    if (!S.report && S.loading) {
      S.root.innerHTML = '<div class="sp-empty">正在检查远程同步配置与到达性…（会真的 ssh 一次探目标机）</div>';
      return;
    }
    if (!S.report) {
      S.root.innerHTML = '<div class="sp-band"><h3 class="sp-warn">远程同步状态读不到</h3>'
        + '<p class="sp-note">' + esc(S.error || '未知原因') + '</p>'
        + '<div class="env-action-foot"><button class="env-btn" data-sync-reload type="button">重新检测</button></div></div>';
      return;
    }
    const report = S.report;
    const target = report.target || {};
    const transports = report.transports || {};
    const problems = report.problems || [];
    const notes = report.notes || [];
    const actions = report.actions || [];
    const last = report.lastSync || {};

    const configured = !!target.configured;
    const targetText = target.path
      ? esc(target.path) + ' <span class="dim">（' + esc(target.sshTarget || '') + ':' + esc(String(target.port || 22)) + '）</span>'
      : '<span class="dim">还没配置目标机</span>';

    const summary = '<div class="env-summary ' + (report.ok ? 'ok' : 'warn') + '">'
      + '<div class="env-summary-main">'
      + '<b>' + (configured ? (report.ok ? '目标机就绪' : problems.length + ' 项待处理') : '尚未配置 VPS') + '</b>'
      + '<span>' + esc(configured
        ? (problems.length ? problems.join('；') : '免密 SSH 通、传输方式可用，可以预演了')
        : '先填主机、用户与远端目录，再点预演——预演不写远端任何东西') + '</span>'
      + '</div>'
      + '<div class="env-summary-foot">'
      + '<span class="dim">检测于 ' + esc(fmtTime(report.checkedAt)) + '</span>'
      + '<span class="dim">·</span><span class="dim">目标：' + targetText + '</span>'
      + (last.at ? '<span class="dim">· 上次' + (last.action === 'vps-deploy' ? '部署' : '同步') + ' '
        + esc(relTime ? relTime(last.at) : fmtTime(last.at))
        + (last.ok ? (last.deployed ? '（成功，已部署）' : '（成功）') : '（失败' + (last.stage ? '，停在 ' + esc(last.stage) : '') + '）') + '</span>' : '')
      + (last.message ? '<span class="dim">· ' + esc(String(last.message).slice(0, 90)) + '</span>' : '')
      + '<button class="env-btn" data-sync-reload type="button"' + (S.loading ? ' disabled' : '') + '>' + (S.loading ? '检测中…' : '重新检测') + '</button>'
      + '</div></div>';

    const configBand = '<div class="sp-band"><h3>目标机与同步范围 ' + badge(configured ? 'ok' : 'warn', configured ? '已配置' : '待配置') + '</h3>'
      + '<p class="sp-note">私钥登录走 BatchMode（不弹密码、不交互）。保存时后端会拒绝非法目标：远程根目录写 <code>/</code>、主机名带 shell 元字符、端口越界都会被挡下来，不会落盘。</p>'
      + fieldsHtml()
      + '<div class="env-action-foot">'
      + '<button class="env-btn primary" data-sync-save type="button"' + (S.saving ? ' disabled' : '') + '>' + (S.saving ? '保存中…' : '保存配置') + '</button>'
      + '<button class="env-btn" data-sync-reload type="button">放弃改动并重新检测</button>'
      + '</div></div>';

    const actionsBand = '<div class="sp-band"><h3>同步动作 ' + badge('ok', '预演 → 同步 → 部署') + '</h3>'
      + '<p class="sp-note">四个动作都走任务控制台：有实时输出、能取消。预演与自检不写远端；同步与部署会写，但只写目标目录。</p>'
      + actions.map(actionBlock).join('')
      + '</div>';

    const transportBand = '<div class="sp-band"><h3>传输方式 ' + badge(transports.chosen ? 'ok' : 'warn', transports.chosen || '未确定') + '</h3>'
      + row('本机可用', transportList(transports.local))
      + row('远端可用', transportList(transports.remote))
      + row('选定', esc(transports.chosen || '') + (transports.reason ? ' <span class="dim">（' + esc(transports.reason) + '）</span>' : ''))
      + row('目标路径', target.path ? esc(target.path) : '')
      + row('远端探测', transports.probe ? '<span class="dim">' + esc(probeText(transports.probe)) + '</span>' : '')
      + '</div>';

    const planLines = report.planned || [];
    const planBand = planLines.length
      ? '<div class="sp-band"><h3>这次会怎么做 ' + badge('ok', planLines.length + ' 步') + '</h3>'
        + '<ul class="env-issues">' + planLines.map((line) => '<li>' + esc(line) + '</li>').join('') + '</ul></div>'
      : '';

    const safetyBand = '<div class="sp-band"><h3>安全边界</h3><ul class="env-issues">'
      + '<li>只写 <code>&lt;remoteDir&gt;/&lt;项目目录名&gt;</code>，不碰目标机家目录与系统目录。</li>'
      + '<li>默认<b>不加</b> --delete：远端多出来的文件不会被删；要用得在上面显式打开该开关。</li>'
      + '<li>重启命令只允许 systemctl / pm2 / docker / service 开头的白名单，其他一律拒绝。</li>'
      + '<li>默认不同步 .git、node_modules 与日志；markdown-vault 是否同步由开关决定。</li>'
      + '</ul></div>';

    S.root.innerHTML = summary
      + (notes.length ? '<div class="sp-band"><h3>提示</h3><ul class="env-issues">' + notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul></div>' : '')
      + configBand + actionsBand + transportBand + planBand + safetyBand;
  }

  /* ------------------------------------------------------------ 交互 */

  function formValues() {
    const out = {};
    if (!S.root) return out;
    S.root.querySelectorAll('[data-sync-field]').forEach((input) => {
      const key = input.getAttribute('data-sync-field');
      const raw = String(input.value || '').trim();
      if (key === 'port') { out.port = Number(raw) || 0; return; }
      out[key] = raw;
    });
    S.root.querySelectorAll('[data-sync-bool]').forEach((input) => {
      const key = input.getAttribute('data-sync-bool');
      const on = input.getAttribute('data-on');
      const off = input.getAttribute('data-off');
      const pick = input.checked ? on : off;
      if (key === 'transport') { out.transport = pick; return; }
      out[key] = pick === 'true';
    });
    return out;
  }

  async function save() {
    S.saving = true; render();
    try {
      const data = await api('/sync/vps', formValues());
      if (!data || !data.config) throw new Error('保存没有返回配置');
      S.config = data.config;
      toast('ok', '目标机配置已保存');
      await load(true);
    } catch (error) {
      toast('err', String((error && error.message) || error));
    } finally {
      S.saving = false; render();
    }
  }

  async function run(action, dryRun) {
    S.busy = action + (dryRun ? ':dry' : '');
    render();
    try {
      /* 起任务交给面板的任务控制台：它会自动打开控制台并接上 SSE。 */
      await startTask(() => api('/sync/vps/update', { action, dryRun: !!dryRun }));
    } catch (error) {
      toast('err', String((error && error.message) || error));
    } finally {
      S.busy = '';
      render();
    }
  }

  function actionById(id) {
    return (S.report && S.report.actions || []).find((item) => item.id === id) || null;
  }

  function onClick(event) {
    const node = event.target && event.target.closest
      ? event.target.closest('[data-sync-reload],[data-sync-save],[data-sync-dry],[data-sync-run],[data-sync-copy-command]')
      : null;
    if (!node || !S.root || !S.root.contains(node)) return;
    if (node.hasAttribute('data-sync-reload')) { load(true); return; }
    if (node.hasAttribute('data-sync-save')) { save(); return; }
    if (node.hasAttribute('data-sync-dry')) { run(node.getAttribute('data-sync-dry'), true); return; }
    if (node.hasAttribute('data-sync-run')) { run(node.getAttribute('data-sync-run'), false); return; }
    if (node.hasAttribute('data-sync-copy-command')) {
      const action = actionById(node.getAttribute('data-sync-copy-command'));
      if (action) copy(action.command || '', '命令');
    }
  }

  /* ------------------------------------------------------------ 挂载 */

  function mount(container) {
    if (!S.root) {
      S.root = el('div', 'sync-root');
      /* 事件委托挂在根上：重渲染不丢监听，也不用每次重绑。 */
      S.root.addEventListener('click', onClick);
    }
    /* setView() 会清空 #system-body，缓存的根会变成游离节点 —— 必须重新挂回去。 */
    if (S.root.parentNode !== container) container.appendChild(S.root);
    if (!S.report && !S.loading) load(false);
    else render();
  }

  return { mount, isSyncView, reload: () => load(true), get data() { return S.report; } };
}

module.exports = { createSyncView };
