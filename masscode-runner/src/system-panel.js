/* CodeScope 本机管家（前端）
 * ---------------------------------------------------------------------------
 * 为什么单独做成一个资源文件，而不是写进 index.html：
 *   1. index.html 有 1.5MB / 1.8 万行，几个人同时改它必然互相覆盖；
 *      所以这里的按钮、面板、样式**全部在运行时自建**，index.html 只加一行 script。
 *   2. 和「编辑工作台 / Harness / opencode / 知识库」完全同构：
 *      一个 header 按钮 + 一个 position:absolute 的工作区 section + 一个 body 模式类。
 *
 * 复用的宿主能力（拿不到就退回本地实现，保证独立可用）：
 *   window.api(path, body)        —— 带错误处理的 JSON 请求
 *   window.askConfirm / askText   —— 应用统一的确认/输入弹窗
 *   window.setStatus              —— 右下角状态提示
 *   window.leaveEmbeddedWorkspaces—— 关掉其它内嵌工作区
 */
(() => {
  'use strict';
  if (window.__CODESCOPE_SYSTEM_PANEL__) return;
  window.__CODESCOPE_SYSTEM_PANEL__ = true;

  const API = '/api/system-panel';
  const MODE = 'system-mode';
  const OTHER_MODES = ['dsh-mode', 'opencode-mode', 'vscode-mode', 'study-mode', 'office-mode', 'reading-mode', 'drawing-mode', 'knowledge-mode', 'system-mode'];
  const OTHER_BUTTONS = ['btn-vscode', 'btn-dsh', 'btn-dsh-restart', 'btn-knowledge-launch', 'btn-study'];

  /* ---------------------------------------------------------------- 工具 */

  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function fmtBytes(value) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let size = Number(value) || 0;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
    return (index === 0 ? String(Math.round(size)) : size.toFixed(size >= 100 ? 0 : 1)) + ' ' + units[index];
  }

  function fmtDuration(seconds) {
    let value = Math.max(0, Math.floor(Number(seconds) || 0));
    const days = Math.floor(value / 86400); value -= days * 86400;
    const hours = Math.floor(value / 3600); value -= hours * 3600;
    const minutes = Math.floor(value / 60); value -= minutes * 60;
    if (days) return days + ' 天 ' + hours + ' 小时';
    if (hours) return hours + ' 小时 ' + minutes + ' 分';
    if (minutes) return minutes + ' 分 ' + value + ' 秒';
    return value + ' 秒';
  }

  function fmtTime(ms) {
    if (!ms) return '';
    const date = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function relTime(ms) {
    if (!ms) return '';
    const diff = Date.now() - ms;
    if (diff < 1000) return '刚刚';
    if (diff < 60000) return Math.round(diff / 1000) + ' 秒前';
    if (diff < 3600000) return Math.round(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.round(diff / 3600000) + ' 小时前';
    return Math.round(diff / 86400000) + ' 天前';
  }

  /* 宿主的 api() 在非 2xx / ok:false 时**不会抛异常**，而是把 {ok:false,error} 当正常结果返回。
     以前这里直接把它当数据用，于是界面只能报 "undefined is not an object" —— 用户完全看不出
     真正原因（例如后端接口还没生效）。所以现在统一在这里收口成异常，并保留服务端原文。 */
  function unwrap(result, status) {
    if (!result || typeof result !== 'object') throw new Error('后端没有返回有效数据' + (status ? '（HTTP ' + status + '）' : ''));
    if (result.ok === false || result.ok === undefined) {
      const message = String(result.error || ('请求失败' + (status ? '（HTTP ' + status + '）' : '')));
      const error = new Error(message);
      /* 路由不存在 = 服务端还是旧代码（改过 server.js 必须重启），要专门认出来给提示。 */
      error.missingRoute = /not found|404|无法连接/i.test(message + ' ' + status);
      error.network = !!result.networkError;
      throw error;
    }
    return result;
  }

  function requireShape(data, fields, label) {
    for (const field of fields) {
      if (data[field] === undefined) throw new Error('后端返回的数据缺少字段 ' + field + '（' + label + '）');
    }
    return data;
  }

  async function api(path, body) {
    const blocked = guardWrite(path, body);
    if (blocked) throw blocked;
    if (typeof window.api === 'function') return unwrap(await window.api(API + path, body));
    const init = body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : undefined;
    const res = await fetch(API + path, init);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error((data && data.error) || ('请求失败 HTTP ' + res.status)), { missingRoute: res.status === 404 });
    return unwrap(data, res.status);
  }

  function askConfirm(options) {
    if (typeof window.askConfirm === 'function') return window.askConfirm(options);
    const text = [options.title || '确认', options.message || ''].filter(Boolean).join('\n\n');
    return Promise.resolve(window.confirm(text));
  }

  function askText(options) {
    if (typeof window.askText === 'function') return window.askText(options);
    return Promise.resolve(window.prompt(options.title || '输入', options.value == null ? '' : String(options.value)));
  }

  function toast(kind, text) {
    try { if (typeof window.setStatus === 'function') window.setStatus(kind, text); } catch (_) { /* 忽略 */ }
    const status = $('system-head-status');
    if (status) status.textContent = text;
  }

  function barClass(percent) {
    if (percent >= 90) return 'crit';
    if (percent >= 75) return 'warn';
    return 'ok';
  }

  function bar(percent, label) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    return '<div class="sp-bar ' + barClass(value) + '" title="' + esc(label || value.toFixed(1) + '%') + '">' +
      '<i style="width:' + value.toFixed(2) + '%"></i></div>';
  }

  /* 温度行：温度是 CPU 的属性，所以放在 CPU 卡底部，不单开一张卡。
     两种状态都给出信息量：读得到 → 温度计条 + 度数 + 水位色；
     读不到（macOS 默认就不让读）→ 仍然把「热压力」这个有效的健康信号摆出来，不假装有数据。 */
  function thermalRow(thermal) {
    if (!thermal) return '';
    const pressureText = { normal: '热压力正常', high: '热压力偏高', unknown: '热压力未知' }[thermal.pressure] || '';
    const speedNote = thermal.speedLimit != null && thermal.speedLimit < 100 ? ' · CPU 已限速至 ' + thermal.speedLimit + '%' : '';  /* 只进 title，不占行内宽度 */
    if (thermal.available && thermal.celsius != null) {
      const celsius = Number(thermal.celsius);
      const level = celsius >= 80 ? ' hot' : celsius >= 60 ? ' warm' : '';
      const width = Math.max(4, Math.min(100, celsius)).toFixed(0);
      return '<div class="sp-temp' + level + '" title="' + esc('来源 ' + (thermal.source || '未知') + speedNote) + '">' +
        '<span class="k">温度</span>' +
        '<span class="sp-tempbar"><i style="width:' + width + '%"></i></span>' +
        '<b>' + celsius.toFixed(1) + '℃</b>' +
        '<span class="note">' + esc(pressureText) + '</span>' +
        '</div>';
    }
    const level = thermal.pressure === 'high' ? ' hot' : '';
    return '<div class="sp-temp' + level + '" title="' + esc(thermal.hint || '') + '">' +
      '<span class="k">温度</span>' +
      '<span class="note">' + esc(pressureText) + '</span>' +
      '<span class="sp-hint">温度暂不可读</span>' +
      '</div>';
  }

  /* ---------------------------------------------------------------- 人话词典
     面板列的都是技术标识（mds_stores、com.apple.xpc.launchd.…、*:5000），
     对不熟悉的人等于乱码。这里把常见的翻成一句人话 —— 不认识的不编，退回中性描述。 */

  const PROCESS_NOTES = {
    WindowServer: '图形界面服务：窗口、动画、显示都归它管',
    kernel_task: '系统内核：占用高多半是在散热保护，不是真的在忙',
    mds: 'Spotlight 索引：为「聚焦搜索」扫描文件',
    mds_stores: 'Spotlight 索引：配合 mds 保存索引数据',
    mdworker_shared: 'Spotlight 索引：为新文件建索引',
    mdwrite: 'Spotlight 索引写入',
    launchd: '系统总管：负责拉起并守护所有后台服务',
    runningboardd: '应用启动管理',
    notifyd: '系统通知中心',
    logd: '系统日志服务',
    cfprefsd: '读写 App 的偏好设置',
    distnoted: '系统内部消息分发',
    configd: '网络配置管理',
    powerd: '电源与睡眠管理',
    syslogd: '系统日志收集',
    mDNSResponder: '局域网设备发现（Bonjour）',
    airportd: 'Wi-Fi 管理服务',
    bluetoothd: '蓝牙管理服务',
    coreaudiod: '声音输出与输入',
    corebrightnessd: '屏幕亮度与夜览',
    securityd: '钥匙串与安全认证',
    tccd: '隐私权限管理（谁能用摄像头、麦克风等）',
    node: 'Node.js 程序：可能是 CodeScope 或你的开发服务',
    WorkBuddy: 'WorkBuddy AI 助手',
    Safari: 'Safari 浏览器',
    'Google Chrome': 'Chrome 浏览器',
    Chrome: 'Chrome 浏览器',
    Finder: '访达（文件管理器）',
    bird: 'iCloud 云盘同步',
    cloudd: 'iCloud 云端同步服务',
    mdsync: 'iCloud 文件同步',
    sshd: 'SSH 远程登录服务',
    syncthing: 'Syncthing 文件同步',
    docker: 'Docker 容器服务',
    ARDAgent: '远程管理（屏幕共享）',
    ControlCenter: '菜单栏控制中心',
    screencaptureui: '截图工具的界面（按 Shift+Cmd+4 时出现）',
    corebrightnessd2: '屏幕亮度管理',
    sharingd: '隔空投送（AirDrop）与共享',
    rapportd: '设备互联（接力、通用剪贴板）',
    nsurlsessiond: '系统后台下载（更新、iCloud 文件）',
    softwareupdated: '系统更新检查',
    'com.apple.WebKit.WebContent': '网页渲染进程（Safari 等在用）',
    ufnode: '坚果云同步客户端',
    ControlCe: '隔空播放接收器（AirPlay）',
    loginwindow: '登录窗口',
    Dock: '程序坞',
    WindowManager: '窗口管理',
    opencode: 'opencode 编码助手',
    'code-server': '浏览器版 VS Code（编辑工作台）',
  };

  const PORT_NOTES = {
    22: 'SSH 远程登录', 80: 'HTTP 网页服务', 443: 'HTTPS 网页服务',
    3000: '常见开发服务（Node / React 等）', 3306: 'MySQL 数据库',
    4877: 'CodeScope 主服务', 4878: 'CodeScope 的 VS Code 代理', 4899: 'CodeScope 的 VS Code 内部端口',
    5000: '常见开发服务；macOS 也用它做隔空播放接收',
    5432: 'PostgreSQL 数据库', 6379: 'Redis 缓存',
    7000: 'macOS 隔空播放接收器（AirPlay）',
    8080: '常见网页服务 / 本地代理', 8384: 'Syncthing 管理界面', 8874: 'WorkBuddy',
    27017: 'MongoDB 数据库', 11434: 'Ollama 本地大模型',
  };

  function describeProcess(app, command) {
    if (PROCESS_NOTES[app]) return PROCESS_NOTES[app];
    const text = String(command || app || '');
    if (/^com\.apple\./.test(text)) return 'Apple 系统组件（可忽略）';
    if (/^com\.google\./.test(text)) return 'Google 软件的后台组件';
    if (/^com\.microsoft\./.test(text)) return '微软软件的后台组件';
    if (/^[a-z]+\.[a-z0-9-]+\.[A-Za-z]/.test(text)) return '第三方软件的后台组件';
    if (/Helper|helper/.test(text)) return '某软件的辅助进程';
    return '';
  }

  /* 绑定地址翻译：用户看不懂 *:5000 和 127.0.0.1:5000 的区别，
     而这恰好是「有没有把服务暴露到局域网」的关键。 */
  function describeBind(address) {
    const text = String(address || '');
    if (!text) return '';
    if (text.startsWith('127.0.0.1') || text.startsWith('[::1]')) return '仅本机可访问';
    if (text.startsWith('*') || text.startsWith('0.0.0.0') || text.startsWith('[::]')) return '局域网可访问';
    return '指定网卡';
  }

  function describePort(port, command) {
    if (PORT_NOTES[port]) return PORT_NOTES[port];
    const text = String(command || '');
    if (/node|vite|webpack|next|nuxt|bun|deno/i.test(text)) return '开发服务（' + text + '）';
    if (/python|flask|django|uvicorn/i.test(text)) return 'Python 服务（' + text + '）';
    if (/docker|containerd/i.test(text)) return 'Docker 相关';
    return '';
  }

  /* ---------------------------------------------------------------- 样式注入 */

  /* 文件管理视图：独立模块，只做 UI，IO 全部走下面注入的宿主契约。
     CommonJS require —— esbuild 会把它一起打进 IIFE。 */
  const { createScanView } = require('./system-scan-view.js');
  const { createEnvView } = require('./system-env-view.js');
  const { createSyncView } = require('./system-sync-view.js');
  const { createSoftwareView } = require('./system-software-view.js');
  const { createFilesView } = require('./system-files-view.js');

  const CSS = `
#system-workspace{display:none;position:absolute;inset:0;z-index:76;min-height:0;overflow:hidden;background:var(--bg);
  /* 语义色与尺度一律走变量：宿主有 7 套主题（含浅色），写死颜色会直接瞎掉。 */
  --sp-warn:var(--warn,color-mix(in srgb, var(--ok) 45%, var(--err)));
  --sp-danger:var(--err);
  --sp-tint:color-mix(in srgb, var(--dim) 10%, transparent);
  --sp-tint-strong:color-mix(in srgb, var(--dim) 18%, transparent);
  /* 圆角只留四档，且内层永远比外层小一档（同心圆角）：相邻元素半径不打架，才不显得突兀。 */
  --sp-r-lg:14px;
  --sp-r:11px;
  --sp-r-sm:8px;
  --sp-r-xs:6px;
  /* 用柔和发丝线替代满屏描边 —— 之前 90% 的「方框感」来自这里。 */
  --sp-hair:color-mix(in srgb, var(--border) 50%, transparent);
  --sp-hair-strong:color-mix(in srgb, var(--border) 78%, transparent);
  --sp-ring:inset 0 0 0 1px var(--sp-hair);
  --sp-surface:var(--panel);
  --sp-surface-2:var(--panel2, var(--panel));
  --sp-raise:var(--ui-shadow, 0 12px 34px color-mix(in srgb, var(--bg) 72%, transparent));
  /* 字号只留六档、间距只留四档、动效只留一档时长。 */
  --sp-fs-xs:10.5px; --sp-fs-sm:11.5px; --sp-fs:12.5px; --sp-fs-md:13.5px; --sp-fs-lg:15px; --sp-fs-xl:22px;
  --sp-gap-sm:6px; --sp-gap:12px; --sp-gap-lg:16px;
  --sp-ease:100ms ease;
  --sp-mono:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);
}

/* 同一套设计令牌再声明一次在 :root 上：挂到 document.body 的浮层（右键菜单、预览、
   命令面板）不在 #system-workspace 里面，继承不到上面那份，否则圆角与投影会静默失效。 */
:root{
  --sp-warn:var(--warn,color-mix(in srgb, var(--ok) 45%, var(--err)));
  --sp-danger:var(--err);
  --sp-tint:color-mix(in srgb, var(--dim) 10%, transparent);
  --sp-tint-strong:color-mix(in srgb, var(--dim) 18%, transparent);
  --sp-r-lg:14px;
  --sp-r:11px;
  --sp-r-sm:8px;
  --sp-r-xs:6px;
  --sp-hair:color-mix(in srgb, var(--border) 50%, transparent);
  --sp-hair-strong:color-mix(in srgb, var(--border) 78%, transparent);
  --sp-ring:inset 0 0 0 1px var(--sp-hair);
  --sp-surface:var(--panel);
  --sp-surface-2:var(--panel2, var(--panel));
  --sp-raise:var(--ui-shadow, 0 12px 34px color-mix(in srgb, var(--bg) 72%, transparent));
  --sp-fs-xs:10.5px; --sp-fs-sm:11.5px; --sp-fs:12.5px; --sp-fs-md:13.5px; --sp-fs-lg:15px; --sp-fs-xl:22px;
  --sp-gap-sm:6px; --sp-gap:12px; --sp-gap-lg:16px;
  --sp-ease:100ms ease;
  --sp-mono:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);
}
body.system-mode #system-workspace{display:flex;}
/* 兜底：万一宿主的按钮没被上一次点击拦到，只要别的内嵌工作区模式还在，
   本机管家就不显示 —— 绝不能出现两个工作区叠在一起。 */
#system-workspace body.system-mode:is(.dsh-mode, #system-workspace .opencode-mode, #system-workspace .vscode-mode, #system-workspace .study-mode, #system-workspace .office-mode, #system-workspace .reading-mode, #system-workspace .drawing-mode, .knowledge-mode) #system-workspace{display:none !important;}
body.system-mode #side,body.system-mode #split-v,body.system-mode #split-v2,body.system-mode #outline-panel,
body.system-mode #toolbar,body.system-mode #tabs,body.system-mode #document-mode-tools,body.system-mode #code-context-bar,
body.system-mode #draw-editor,body.system-mode #office-workspace,body.system-mode #reading-workspace,body.system-mode #study-workspace,
body.system-mode #edit-split,body.system-mode #resource-viewer,body.system-mode #preview,body.system-mode #input-area,
body.system-mode #split-h, body.system-mode #output{display:none !important;}
body.system-mode #main{flex:1;min-width:0;}
#system-workspace *, #system-workspace *::before, #system-workspace *::after{box-sizing:border-box;}
#system-workspace :focus-visible{outline:2px solid color-mix(in srgb, var(--accent) 65%, transparent);outline-offset:1px;}

/* ── 骨架：左侧分区栏 + 右侧内容。分区固定六个加底部设置，子视图在分区内切换。 ── */
#system-shell{flex:1;min-height:0;display:flex;align-items:stretch;}
#system-nav{position:relative;width:198px;flex:none;display:flex;flex-direction:column;gap:2px;padding:12px 10px;
  border-right:1px solid var(--sp-hair);background:var(--sp-surface);overflow:auto;}
/* 拖拽手柄：6px 热区贴右边缘，平时透明、hover/拖动才亮 —— 不占视觉、但好抓。
   注意两点（都踩过）：① 必须**完全落在侧栏内**（right:0），侧栏是 overflow:auto，
   探出去的部分会被裁掉、拿不到指针；② z-index 要高过侧栏内容，否则命中测试拿到的是 aside 本身。 */
#system-workspace .nav-resizer{position:absolute;top:0;right:0;bottom:0;width:6px;cursor:col-resize;z-index:20;touch-action:none;}
#system-workspace .nav-resizer::after{content:'';position:absolute;top:0;bottom:0;right:0;width:2px;background:transparent;
  transition:background var(--sp-ease);}
#system-workspace .nav-resizer:hover::after,#system-workspace .nav-resizer.active::after{background:var(--accent);}
/* 拖动期间整页光标保持 col-resize，并且不要选中文字 */
body.sp-nav-resizing{cursor:col-resize;user-select:none;}
#system-nav .nav-title{padding:2px 8px 10px;font-size:var(--sp-fs-md);font-weight:600;color:var(--text);display:flex;align-items:baseline;gap:6px;}
#system-nav .nav-title span{font-size:var(--sp-fs-xs);font-weight:400;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
/* 搜索放在侧栏顶部：高频入口不该塞在左下角。做成输入框的样子，点哪儿都能进搜索面板。 */
#system-nav .nav-search{display:flex;align-items:center;gap:7px;width:100%;margin:0 0 10px;box-sizing:border-box;
  background:var(--sp-surface-2);border:1px solid var(--sp-hair);border-radius:var(--sp-r-sm);
  padding:6px 9px;color:var(--dim);font-size:var(--sp-fs-sm);cursor:pointer;text-align:left;
  transition:border-color var(--sp-ease),background var(--sp-ease),color var(--sp-ease);}
#system-nav .nav-search:hover{color:var(--text);border-color:var(--sp-hair-strong);background:var(--sp-tint);}
#system-nav .nav-search .ico{flex:none;font-size:var(--sp-fs-md);line-height:1;opacity:.85;}
#system-nav .nav-search .txt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#system-nav .nav-search kbd{flex:none;font:var(--sp-fs-xs) var(--sp-mono);border:1px solid var(--sp-hair);
  border-radius:var(--sp-r-xs);padding:1px 4px;color:var(--dim);}
#system-nav-list{display:flex;flex-direction:column;gap:1px;}
/* 分组小标题：小、疏、不抢戏，只负责把 7 个分区切成两段 */
#system-nav-list .nav-group{padding:10px 10px 4px;color:var(--dim);font-size:var(--sp-fs-xs);letter-spacing:.1em;opacity:.75;}
#system-nav-list .nav-group:first-child{padding-top:2px;}
/* 侧栏项：不加边框，选中靠「淡色底 + 左侧强调条」，比描一圈方框安静得多。 */
#system-nav-list button{position:relative;display:flex;align-items:center;gap:10px;width:100%;text-align:left;
  background:transparent;color:var(--dim);border:0;border-radius:var(--sp-r-sm);padding:8px 10px;
  font-size:var(--sp-fs);cursor:pointer;transition:background var(--sp-ease),color var(--sp-ease);}
/* 图标做成底色块：7 个分区平铺时，有块比只有一个字符更容易扫读。 */
#system-nav-list button i{font-style:normal;flex:none;display:grid;place-items:center;width:22px;height:22px;
  border-radius:var(--sp-r-xs);background:var(--sp-tint);font-size:var(--sp-fs);color:var(--dim);
  transition:background var(--sp-ease),color var(--sp-ease);}
#system-nav-list button:hover i{color:var(--text);}
#system-nav-list button.on i{background:var(--ui-accent-soft, var(--sp-tint-strong));color:var(--accent);}
#system-nav-list button:hover{color:var(--text);background:var(--sp-tint);}
#system-nav-list button.on{color:var(--text);background:var(--ui-accent-soft, var(--sp-tint));font-weight:600;}
#system-nav-list button.on::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);
  width:2px;height:16px;border-radius:2px;background:var(--accent);}
#system-nav-list button .badge{margin-left:auto;font-size:var(--sp-fs-xs);color:var(--dim);font-variant-numeric:tabular-nums;}
#system-workspace .nav-foot{margin-top:auto;padding-top:10px;display:flex;flex-direction:column;gap:var(--sp-gap-sm);border-top:1px solid var(--sp-hair);}
#system-workspace .nav-foot button{background:transparent;color:var(--dim);border:1px solid var(--sp-hair);border-radius:var(--sp-r-sm);
  padding:7px 10px;font-size:var(--sp-fs-sm);cursor:pointer;text-align:left;display:flex;gap:8px;align-items:center;
  transition:background var(--sp-ease),color var(--sp-ease),border-color var(--sp-ease);}
#system-workspace .nav-foot button:hover{color:var(--text);background:var(--sp-tint);border-color:var(--sp-hair-strong);}
#system-workspace .nav-foot button kbd{font:var(--sp-fs-xs) var(--sp-mono);border:1px solid var(--sp-hair);border-radius:var(--sp-r-xs);padding:1px 4px;color:var(--dim);}
#system-workspace .nav-foot .sp-auto{display:flex;align-items:center;gap:6px;color:var(--dim);font-size:var(--sp-fs-sm);cursor:pointer;user-select:none;padding:2px 2px;}
#system-workspace .nav-foot .sp-auto input{margin:0;}
#system-main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;}
#system-head{height:46px;flex:none;display:flex;align-items:center;gap:10px;padding:0 14px;
  border-bottom:1px solid var(--sp-hair);background:var(--sp-surface);}
#system-head strong{color:var(--text);font-size:var(--sp-fs-md);font-weight:600;letter-spacing:.01em;}
/* 页头标题组：分区名 + 这一页是干嘛的。管理面板的标配，省得用户从标题猜。 */
#system-head .head-title{display:flex;align-items:baseline;gap:9px;min-width:0;flex:0 1 auto;}
#system-head #system-subtitle{color:var(--dim);font-size:var(--sp-fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#system-head #system-head-status{color:var(--dim);font-size:var(--sp-fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;}
#system-head .sp{flex:1;}
#system-head button{background:transparent;color:var(--dim);border:1px solid transparent;border-radius:var(--sp-r-sm);
  padding:5px 10px;font-size:var(--sp-fs-sm);cursor:pointer;transition:background var(--sp-ease),color var(--sp-ease);}
#system-head button:hover{color:var(--text);background:var(--sp-tint);}
/* 子视图：分段控件（一个底槽 + 选中态浮起），不再是一排各自描边的胶囊。 */
#system-subnav{flex:none;display:flex;gap:3px;align-items:center;padding:8px 14px;border-bottom:1px solid var(--sp-hair);overflow-x:auto;}
#system-subnav[hidden]{display:none;}
#system-subnav button{background:transparent;color:var(--dim);border:0;border-radius:var(--sp-r-xs);padding:4px 11px;
  font-size:var(--sp-fs-sm);cursor:pointer;white-space:nowrap;transition:background var(--sp-ease),color var(--sp-ease);}
#system-subnav button:hover{color:var(--text);background:var(--sp-tint);}
#system-subnav button.on{color:var(--text);background:var(--ui-accent-soft, var(--sp-tint-strong));font-weight:600;}
#system-subnav .subnav-count{color:var(--dim);font-size:var(--sp-fs-sm);margin-left:auto;}
#system-body{flex:1;min-height:0;overflow:auto;padding:16px 20px 30px;}
#system-task{flex:none;border-top:1px solid var(--sp-hair);background:var(--sp-surface);max-height:34vh;display:flex;flex-direction:column;}
#system-task[hidden]{display:none;}
#system-task .task-head{display:flex;align-items:center;gap:10px;padding:8px 14px;font-size:var(--sp-fs-sm);color:var(--dim);}
#system-task .task-head b{color:var(--text);font-size:var(--sp-fs);font-weight:600;}
#system-task .task-head .sp{flex:1;}
#system-task .task-head button{background:transparent;color:var(--dim);border:1px solid var(--sp-hair);border-radius:var(--sp-r-xs);
  padding:3px 9px;font-size:var(--sp-fs-sm);cursor:pointer;}
#system-task .task-head button:hover{color:var(--text);background:var(--sp-tint);}
#system-task pre{margin:0;padding:0 14px 12px;overflow:auto;font:var(--sp-fs-sm)/1.6 var(--sp-mono);color:var(--dim);white-space:pre-wrap;word-break:break-all;}
#system-task pre .err{color:var(--sp-danger);}
#system-task pre .ok{color:var(--ok);}

/* ── 命令面板 ── */
#system-palette-layer{position:fixed;inset:0;z-index:96;background:color-mix(in srgb, var(--bg) 58%, transparent);
  display:flex;justify-content:center;align-items:flex-start;padding-top:12vh;}
#system-palette-layer[hidden]{display:none;}
#system-palette-box{width:min(620px,92vw);background:var(--sp-surface);border:1px solid var(--sp-hair);border-radius:var(--sp-r-lg);
  box-shadow:var(--sp-raise);overflow:hidden;display:flex;flex-direction:column;max-height:70vh;}
#system-palette-input{border:0;border-bottom:1px solid var(--sp-hair);background:transparent;color:var(--text);
  font-size:var(--sp-fs-lg);padding:14px 16px;outline:none;}
#system-palette-input::placeholder{color:var(--dim);}
#system-palette-list{overflow:auto;padding:6px;}
#system-palette-list .pgroup{font-size:var(--sp-fs-xs);color:var(--dim);padding:9px 10px 4px;letter-spacing:.08em;}
#system-palette-list button{display:flex;align-items:baseline;gap:10px;width:100%;text-align:left;background:transparent;border:0;
  color:var(--text);border-radius:var(--sp-r-sm);padding:8px 10px;font-size:var(--sp-fs);cursor:pointer;transition:background var(--sp-ease);}
#system-palette-list button .why{margin-left:auto;color:var(--dim);font-size:var(--sp-fs-sm);font-family:var(--sp-mono);max-width:54%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#system-palette-list button.on{background:var(--ui-accent-soft, var(--sp-tint-strong));}

/* ── 通用组件（类名保持不变，既有渲染函数不需要改）── */
#system-workspace .sp-grid{display:grid;gap:var(--sp-gap);}
#system-workspace .sp-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--sp-gap);margin-bottom:var(--sp-gap-lg);}
/* 卡片不再描一圈边框，改用「面板底 + 极淡内描边」：层级靠底色和间距表达。 */
#system-workspace .sp-card{position:relative;overflow:hidden;background:var(--sp-surface);box-shadow:var(--sp-ring);border-radius:var(--sp-r);padding:15px 16px;min-width:0;}
#system-workspace .sp-card h4{margin:0 0 10px;font-size:var(--sp-fs-xs);font-weight:600;color:var(--dim);letter-spacing:.08em;display:flex;align-items:center;gap:6px;}
#system-workspace .sp-card .big{font-size:var(--sp-fs-xl);font-weight:600;color:var(--text);line-height:1.15;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}
#system-workspace .sp-card .big small{font-size:var(--sp-fs);font-weight:500;color:var(--dim);margin-left:4px;letter-spacing:0;}
#system-workspace .sp-card .sub{font-size:var(--sp-fs-sm);color:var(--dim);margin-top:6px;line-height:1.55;}
/* 每张卡片一条 2px 顶边色条 + 标题小图标：四张卡一眼分得清，且不用再加边框。 */
#system-workspace .sp-card::before{content:'';position:absolute;left:0;right:0;top:0;height:2px;
  background:var(--sp-card-accent, transparent);opacity:.85;}
#system-workspace .sp-card.cpu{--sp-card-accent:var(--accent);}
#system-workspace .sp-card.mem{--sp-card-accent:var(--ok);}
#system-workspace .sp-card.disk{--sp-card-accent:var(--sp-warn);}
#system-workspace .sp-card.sys{--sp-card-accent:color-mix(in srgb, var(--dim) 50%, transparent);}
#system-workspace .sp-card h4 i{font-style:normal;font-size:var(--sp-fs);color:var(--sp-card-accent, var(--dim));opacity:.95;}
/* 大数字按水位着色：70% 起提醒、85% 起告警 —— 一眼看出哪项吃紧。 */
#system-workspace .sp-card .big.warn{color:var(--sp-warn);}
#system-workspace .sp-card .big.crit{color:var(--sp-danger);}

/* ── 概览页布局（参考 1Panel）：左主区 + 右信息栏 ──
   左区放「状态（大圆环排）/ 监控（曲线）/ 磁盘卷」，右区放系统信息与快捷操作。
   圆环不再被卡片包着 —— 环本身就是主角，卡片框只会加噪。 */
#system-workspace .sp-ov{display:grid;grid-template-columns:minmax(0,1fr) 296px;gap:var(--sp-gap-lg);align-items:start;}
#system-workspace .sp-ov-main,#system-workspace .sp-ov-side{min-width:0;display:flex;flex-direction:column;gap:var(--sp-gap-lg);}
#system-workspace .sp-sec{min-width:0;}
#system-workspace .sp-sec h3{margin:0 0 12px;font-size:var(--sp-fs);color:var(--text);font-weight:600;display:flex;align-items:center;gap:8px;letter-spacing:.01em;}
/* 圆环排：等宽单元纵向排（环 / 名称 / 明细），环径一致才能横向比出谁吃紧 */
#system-workspace .sp-gauges{display:flex;flex-wrap:wrap;gap:18px 14px;}
#system-workspace .sp-gcell{flex:0 0 auto;width:132px;display:flex;flex-direction:column;align-items:center;gap:7px;text-align:center;}
#system-workspace .sp-gcell .sp-gauge-ring{width:112px;height:112px;}
#system-workspace .sp-gcell .sp-gauge-center b{font-size:23px;}
#system-workspace .sp-gcap{font-size:var(--sp-fs-sm);color:var(--text);font-weight:600;}
#system-workspace .sp-gsub{font-size:var(--sp-fs-xs);color:var(--dim);line-height:1.45;min-height:2.9em;}
#system-workspace .sp-gcell .sp-cores{justify-content:center;gap:1.5px;margin-top:1px;}
#system-workspace .sp-gcell .sp-core{width:11px;height:16px;}
#system-workspace .sp-gcell .sp-gauge-ring.crit .sp-gauge-center b{color:var(--sp-danger);}
/* 右侧栏的快捷操作：竖排更好点，也省得文字被挤断行 */
#system-workspace .sp-actions-stack{flex-direction:column;align-items:stretch;margin:0;}
#system-workspace .sp-actions-stack .sp-btn{justify-content:flex-start;text-align:left;}
@media (max-width:1080px){
  #system-workspace .sp-ov{grid-template-columns:1fr;}
}

/* ── 环形仪表（对齐 1Panel 首页那种圆环）──
   三张卡的环径完全一致，弧长直接表达「占满程度」，并排时能横向比出谁更吃紧；
   水位色（绿→黄→红）跟着变，不用读数字也能看出问题。 */
#system-workspace .sp-gauge{display:flex;align-items:center;gap:16px;margin-top:6px;}
#system-workspace .sp-gauge-ring{position:relative;flex:none;width:100px;height:100px;}
#system-workspace .sp-gauge-ring svg{width:100%;height:100%;display:block;}
#system-workspace .sp-gauge-ring .track{fill:none;stroke:var(--sp-tint-strong);stroke-width:7;}
#system-workspace .sp-gauge-ring .value{fill:none;stroke:var(--accent);stroke-width:7;stroke-linecap:round;
  transition:stroke-dashoffset 420ms cubic-bezier(.22,.61,.36,1),stroke var(--sp-ease);}
#system-workspace .sp-gauge-ring.warn .value{stroke:var(--sp-warn);}
#system-workspace .sp-gauge-ring.crit .value{stroke:var(--sp-danger);}
#system-workspace .sp-gauge-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;}
#system-workspace .sp-gauge-center .v{display:flex;align-items:baseline;line-height:1;}
#system-workspace .sp-gauge-center b{font-size:21px;font-weight:600;color:var(--text);font-variant-numeric:tabular-nums;letter-spacing:-.02em;}
#system-workspace .sp-gauge-center small{font-size:10px;color:var(--dim);margin-left:1px;}
#system-workspace .sp-gauge-center em{font-style:normal;font-size:9.5px;color:var(--dim);letter-spacing:.1em;margin-top:3px;}
#system-workspace .sp-gauge-ring.warn .sp-gauge-center b{color:var(--sp-warn);}
#system-workspace .sp-gauge-ring.crit .sp-gauge-center b{color:var(--sp-danger);}
#system-workspace .sp-gauge-info{flex:1;min-width:0;}
#system-workspace .sp-gauge-info .sub{margin-top:0;}
#system-workspace .sp-gauge-info .sub + .sub{margin-top:5px;}
#system-workspace .sp-gauge-info .sub b{color:var(--text);font-weight:600;}
/* 温度行：温度计条 + 度数，颜色随温度升高从绿到黄到红 */
#system-workspace .sp-temp{display:flex;align-items:center;gap:9px;margin-top:12px;padding-top:11px;
  border-top:1px solid var(--sp-hair);font-size:var(--sp-fs-sm);}
#system-workspace .sp-temp .k{color:var(--dim);flex:none;}
#system-workspace .sp-temp .sp-tempbar{flex:1;min-width:36px;height:6px;border-radius:3px;background:var(--sp-tint-strong);overflow:hidden;}
#system-workspace .sp-temp .sp-tempbar i{display:block;height:100%;border-radius:3px;background:var(--ok);
  transition:width 420ms cubic-bezier(.22,.61,.36,1),background var(--sp-ease);}
#system-workspace .sp-temp.warm .sp-tempbar i{background:var(--sp-warn);}
#system-workspace .sp-temp.hot .sp-tempbar i{background:var(--sp-danger);}
#system-workspace .sp-temp b{color:var(--text);font-weight:600;font-variant-numeric:tabular-nums;flex:none;}
#system-workspace .sp-temp.hot b{color:var(--sp-danger);}
#system-workspace .sp-temp .note{color:var(--dim);font-size:var(--sp-fs-xs);flex:none;}
#system-workspace .sp-temp .sp-hint{flex:none;}

/* 核心条在环右侧，尺寸收小以适配 */
#system-workspace .sp-gauge-info .sp-cores{margin-top:8px;gap:2px;}
#system-workspace .sp-gauge-info .sp-core{width:13px;height:20px;}
@media (max-width:1180px){
  #system-workspace .sp-gauge{gap:12px;}
  #system-workspace .sp-gauge-ring{width:84px;height:84px;}
  #system-workspace .sp-gauge-center b{font-size:18px;}
}

/* 状态/标签：淡色底代替描边，小尺寸下更像「标记」而不是小方框。 */
#system-workspace .sp-state{font-size:var(--sp-fs-xs);padding:2px 7px;border-radius:var(--sp-r-xs);border:0;color:var(--dim);
  background:var(--sp-tint);white-space:nowrap;}
#system-workspace .sp-state.ok{color:var(--ok);background:color-mix(in srgb, var(--ok) 15%, transparent);}
#system-workspace .sp-state.warn{color:var(--sp-warn);background:color-mix(in srgb, var(--sp-warn) 15%, transparent);}
#system-workspace .sp-state.crit{color:var(--sp-danger);background:color-mix(in srgb, var(--sp-danger) 15%, transparent);}
#system-workspace .sp-bar{height:6px;border-radius:3px;background:var(--sp-tint-strong);overflow:hidden;}
#system-workspace .sp-bar i{display:block;height:100%;background:var(--accent);border-radius:3px;}
#system-workspace .sp-bar.ok i{background:var(--ok);}
#system-workspace .sp-bar.warn i{background:var(--sp-warn);}
#system-workspace .sp-bar.crit i{background:var(--sp-danger);}
#system-workspace .sp-cores{display:flex;gap:3px;margin-top:10px;flex-wrap:wrap;}
#system-workspace .sp-core{width:16px;height:24px;border-radius:3px;background:var(--sp-tint-strong);position:relative;overflow:hidden;}
#system-workspace .sp-core i{position:absolute;bottom:0;left:0;right:0;background:var(--accent);}
#system-workspace .sp-spark{margin-top:8px;height:46px;width:100%;display:block;overflow:visible;}
#system-workspace .sp-spark .grid{stroke:var(--sp-hair);stroke-width:1;}
#system-workspace .sp-spark polyline{fill:none;stroke:var(--accent);stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round;}
#system-workspace .sp-spark .fill{fill:color-mix(in srgb, var(--accent) 15%, transparent);stroke:none;}
/* 内存曲线换一种系列色（绿），两条线叠在同一屏时才分得清谁是谁。 */
#system-workspace .sp-spark.mem polyline{stroke:var(--ok);}
#system-workspace .sp-spark.mem .fill{fill:color-mix(in srgb, var(--ok) 14%, transparent);}
/* 曲线下的统计行：当前 / 均值 / 峰值 */
#system-workspace .sp-axis{display:flex;justify-content:space-between;margin-top:5px;font-size:var(--sp-fs-xs);
  color:var(--dim);font-variant-numeric:tabular-nums;opacity:.9;}
#system-workspace .sp-stats{display:flex;gap:14px;margin-top:7px;font-size:var(--sp-fs-xs);color:var(--dim);font-variant-numeric:tabular-nums;}
#system-workspace .sp-stats b{color:var(--text);font-weight:600;}
#system-workspace .sp-hint{font-weight:400;color:var(--dim);font-size:var(--sp-fs-xs);letter-spacing:0;}
#system-workspace .sp-row .v{font-weight:600;font-variant-numeric:tabular-nums;}
#system-workspace .sp-row{display:flex;align-items:center;gap:10px;font-size:var(--sp-fs);color:var(--text);}
#system-workspace .sp-row .k{color:var(--dim);min-width:96px;}
#system-workspace .sp-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:var(--sp-gap);align-items:start;}
#system-workspace .sp-cols>*{min-width:0;}
#system-workspace .sp-band{min-width:0;}
/* 表格过宽时在区块内横向滚动，而不是把整个面板顶出横向滚动条 */
#system-workspace .sp-band:has(.sp-table){overflow-x:auto;}
#system-workspace .sp-kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:var(--sp-fs);color:var(--text);}
#system-workspace .sp-kv .k{color:var(--dim);}
/* 表格：只在表头下和行之间留发丝线，不做「行内小方框」。 */
#system-workspace .sp-table{width:100%;border-collapse:collapse;font-size:var(--sp-fs);}
#system-workspace .sp-table th{position:sticky;top:0;z-index:2;text-align:left;font-weight:600;color:var(--dim);background:var(--sp-surface);
  border-bottom:1px solid var(--sp-hair-strong);padding:8px 10px;font-size:var(--sp-fs-sm);white-space:nowrap;}
#system-workspace .sp-table td{padding:7px 10px;border-bottom:1px solid var(--sp-hair);color:var(--text);vertical-align:middle;}
#system-workspace .sp-table tr:hover td{background:var(--sp-tint);}
#system-workspace .sp-table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
#system-workspace .sp-table .mono{font-family:var(--sp-mono);font-size:var(--sp-fs-sm);}
#system-workspace .sp-table .muted{color:var(--dim);}
#system-workspace .sp-table .ellip{max-width:min(520px,36vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#system-workspace .sp-table tbody tr{cursor:default;}
#system-workspace .sp-table tbody tr.pick{cursor:pointer;}
/* 文件视图用的是裸 .num/.muted，这里统一补上（并限定在面板内，绝不外溢到宿主）。 */
#system-workspace .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
#system-workspace .muted{color:var(--dim);}
#system-workspace .mono{font-family:var(--sp-mono);}
#system-workspace .sp-tag{display:inline-block;padding:2px 7px;border-radius:var(--sp-r-xs);font-size:var(--sp-fs-xs);border:0;background:var(--sp-tint);color:var(--dim);}
#system-workspace .sp-tag.low, #system-workspace .sp-tag.good{color:var(--ok);background:color-mix(in srgb, var(--ok) 15%, transparent);}
#system-workspace .sp-tag.medium{color:var(--sp-warn);background:color-mix(in srgb, var(--sp-warn) 15%, transparent);}
#system-workspace .sp-tag.high, #system-workspace .sp-tag.bad{color:var(--sp-danger);background:color-mix(in srgb, var(--sp-danger) 15%, transparent);}
/* 按钮：次级一律幽灵态（无框无底），悬浮才浮出底色 —— 工具栏因此安静很多。 */
#system-workspace .sp-btn, .fsv-menu .sp-btn, .fsv-preview .sp-btn{background:transparent;color:var(--dim);border:1px solid transparent;border-radius:var(--sp-r-sm);
  padding:5px 10px;font-size:var(--sp-fs-sm);cursor:pointer;white-space:nowrap;
  transition:background var(--sp-ease),color var(--sp-ease),border-color var(--sp-ease);}
#system-workspace .sp-btn:hover{color:var(--text);background:var(--sp-tint);}
#system-workspace .sp-btn:active{background:var(--sp-tint-strong);}
#system-workspace .sp-btn[disabled]{opacity:.42;cursor:not-allowed;background:transparent;}
#system-workspace .sp-btn.danger{color:var(--sp-danger);}
#system-workspace .sp-btn.danger:hover{background:color-mix(in srgb, var(--sp-danger) 14%, transparent);}
#system-workspace .sp-btn.primary{background:var(--accent);border-color:transparent;color:var(--bg);font-weight:600;}
#system-workspace .sp-btn.primary:hover{background:color-mix(in srgb, var(--accent) 88%, var(--text));color:var(--bg);}
#system-workspace .sp-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0 16px;}
#system-workspace .sp-input{background:var(--sp-surface-2);color:var(--text);border:1px solid var(--sp-hair);border-radius:var(--sp-r-sm);
  padding:6px 10px;font-size:var(--sp-fs);min-width:120px;height:var(--ui-control-height,30px);
  transition:border-color var(--sp-ease),background var(--sp-ease);}
#system-workspace .sp-input:hover{border-color:var(--sp-hair-strong);}
#system-workspace .sp-input:focus{outline:none;border-color:color-mix(in srgb, var(--accent) 60%, transparent);background:var(--sp-surface);}
#system-workspace .sp-note{font-size:var(--sp-fs-sm);color:var(--dim);line-height:1.65;margin:8px 0 0;}
/* 区块（band）：和卡片同一套语言；上下用间距分节，不靠层层嵌套的框。 */
#system-workspace .sp-band{background:var(--sp-surface);box-shadow:var(--sp-ring);border-radius:var(--sp-r);padding:14px 16px;margin-bottom:var(--sp-gap-lg);}
#system-workspace .sp-band h3{margin:0 0 10px;font-size:var(--sp-fs);color:var(--text);font-weight:600;display:flex;align-items:center;gap:8px;letter-spacing:.01em;}
#system-workspace .sp-band > :last-child{margin-bottom:0;}
#system-workspace .sp-list{display:flex;flex-direction:column;gap:8px;}
#system-workspace .sp-li{display:flex;align-items:center;gap:10px;font-size:var(--sp-fs);color:var(--text);}
#system-workspace .sp-li .grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#system-workspace .sp-li .barwrap{width:190px;flex:none;}
#system-workspace .sp-empty{color:var(--dim);font-size:var(--sp-fs);padding:18px 0;text-align:center;}
/* 每行都挂一个按钮太吵：默认隐去，鼠标进到这一行才浮出来（键盘 Tab 聚焦同样可见）。 */
#system-workspace .sp-li .sp-rowbtn, #system-workspace .sp-pitem .sp-rowbtn{opacity:0;transition:opacity var(--sp-ease);}
#system-workspace .sp-li:hover .sp-rowbtn, #system-workspace .sp-li .sp-rowbtn:focus-visible,
#system-workspace .sp-pitem:hover .sp-rowbtn, #system-workspace .sp-pitem .sp-rowbtn:focus-visible{opacity:1;}
#system-workspace .sp-li .num.cap{width:52px;text-align:right;font-variant-numeric:tabular-nums;}
#system-workspace .sp-li .num.cap.warn{color:var(--sp-warn);}
#system-workspace .sp-li .num.cap.crit{color:var(--sp-danger);}

/* ── 结论条：每页先给一句「有没有事」的答案，再摊细节 ── */
#system-workspace .sp-summary{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:0 0 14px;
  padding:11px 14px;border-radius:var(--sp-r);background:var(--sp-tint);font-size:var(--sp-fs);color:var(--text);line-height:1.5;}
#system-workspace .sp-summary b{font-weight:600;}
#system-workspace .sp-summary .muted{font-size:var(--sp-fs-sm);}

/* ── 进程/启动项行：名字 + 一句人话 + 占用条 + 数值，一行一件事（替代 7 列表格） ── */
#system-workspace .sp-plist{display:flex;flex-direction:column;gap:1px;}
#system-workspace .sp-pitem{display:flex;align-items:center;gap:12px;padding:7px 9px;border-radius:var(--sp-r-sm);
  transition:background var(--sp-ease);}
#system-workspace .sp-pitem:hover{background:var(--sp-tint);}
#system-workspace .sp-pmain{flex:1 1 auto;min-width:0;}
#system-workspace .sp-pname{font-size:var(--sp-fs);color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#system-workspace .sp-pnote{font-size:var(--sp-fs-xs);color:var(--dim);margin-top:2px;line-height:1.45;}
#system-workspace .sp-pbar{flex:0 0 140px;width:140px;}
#system-workspace .sp-pbar .sp-bar{height:5px;}
#system-workspace .sp-pnum{flex:0 0 92px;display:flex;flex-direction:column;align-items:flex-end;
  font-size:var(--sp-fs-sm);font-variant-numeric:tabular-nums;line-height:1.35;}
#system-workspace .sp-pnum b{color:var(--text);font-weight:600;}
#system-workspace .sp-pnum .muted{font-size:var(--sp-fs-xs);}
/* 排序按钮的选中态（原来只靠一个「当前：按 CPU 排序」标签，看不出哪个按钮是开的） */
#system-workspace .sp-btn.on{color:var(--text);background:var(--ui-accent-soft, var(--sp-tint-strong));font-weight:600;}
#system-workspace .sp-actcol{width:1%;white-space:nowrap;text-align:right;}
@media (max-width:900px){
  #system-workspace .sp-pbar{display:none;}
}
#system-workspace .sp-warn{color:var(--sp-danger);}
#system-workspace .sp-ok{color:var(--ok);}
#system-workspace .sp-check{display:flex;align-items:center;gap:8px;font-size:var(--sp-fs);}
#system-workspace input[type=checkbox]{accent-color:var(--accent);}
/* 「值得关注」：成组连续的面板，行间发丝线，不逐条描框。 */
#system-workspace .sp-attn{display:flex;flex-direction:column;border:1px solid var(--sp-hair);border-radius:var(--sp-r);overflow:hidden;background:var(--sp-surface);}
#system-workspace .sp-attn .item{display:flex;align-items:flex-start;gap:10px;padding:11px 14px;font-size:var(--sp-fs);color:var(--text);
  background:transparent;border-bottom:1px solid var(--sp-hair);}
#system-workspace .sp-attn .item:last-child{border-bottom:0;}
#system-workspace .sp-attn .item .txt{flex:1;min-width:0;}
#system-workspace .sp-attn .item .txt b{font-weight:600;}
#system-workspace .sp-attn .item .txt em{font-style:normal;display:block;color:var(--dim);font-size:var(--sp-fs-sm);margin-top:3px;line-height:1.55;}
#system-workspace .sp-attn .item.ok{padding:13px 14px;color:var(--dim);}
#system-workspace .sp-tabs{display:flex;gap:2px;align-items:center;flex-wrap:wrap;}
#system-workspace .sp-skel{background:var(--sp-tint-strong);border-radius:var(--sp-r-xs);height:12px;animation:sp-pulse 1.4s ease-in-out infinite;}
@keyframes sp-pulse{0%,100%{opacity:.45}50%{opacity:.85}}

/* ── 文件视图（fsv-*）：模块只做结构与行为，皮肤全部在这里统一 ── */
#system-workspace .fsv-root{display:flex;flex-direction:column;gap:10px;}
#system-workspace .fsv-view{display:flex;flex-direction:column;gap:10px;}
#system-workspace .fsv-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}
#system-workspace .fsv-crumbs{display:flex;align-items:center;gap:2px;flex-wrap:wrap;font-size:var(--sp-fs);}
#system-workspace .fsv-crumb{background:transparent;border:0;color:var(--dim);border-radius:var(--sp-r-xs);padding:2px 6px;font-size:var(--sp-fs);cursor:pointer;}
#system-workspace .fsv-crumb:hover{color:var(--text);background:var(--sp-tint);}
#system-workspace .fsv-crumb-sep{color:var(--dim);opacity:.6;font-size:var(--sp-fs-sm);}
#system-workspace .fsv-crumb-blank{flex:1;min-width:0;background:transparent;border:1px solid transparent;
  color:var(--dim);border-radius:var(--sp-r-xs);padding:2px 8px;text-align:left;font-size:var(--sp-fs);cursor:text;
  transition:background var(--sp-ease),border-color var(--sp-ease),color var(--sp-ease);}
#system-workspace .fsv-crumb-blank:hover{background:var(--sp-tint);border-color:var(--sp-hair);color:var(--text);}
#system-workspace .fsv-tabs{display:flex;gap:2px;align-items:center;}
#system-workspace .fsv-tab{background:transparent;border:0;color:var(--dim);border-radius:var(--sp-r-xs);padding:4px 10px;font-size:var(--sp-fs-sm);cursor:pointer;}
#system-workspace .fsv-tab:hover{color:var(--text);background:var(--sp-tint);}
#system-workspace .fsv-tab.on{color:var(--text);background:var(--ui-accent-soft, var(--sp-tint-strong));font-weight:600;}
#system-workspace .fsv-tbody tr{transition:background var(--sp-ease);}
#system-workspace .fsv-tbody tr:hover{background:var(--sp-tint);}
#system-workspace .fsv-tbody tr:has(input[type=checkbox]:checked){background:var(--ui-accent-soft, var(--sp-tint));}
#system-workspace .fsv-tbody td{border-bottom:1px solid var(--sp-hair);}
#system-workspace .fsv-row.pick, #system-workspace .fsv-tbody tr{cursor:default;}
#system-workspace .fsv-name{display:flex;align-items:center;gap:8px;min-width:0;}
#system-workspace .fsv-name-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#system-workspace .fsv-checkcol, #system-workspace .fsv-actcol{width:1%;white-space:nowrap;}
#system-workspace .fsv-checkcol{padding-right:0;}
#system-workspace .fsv-filter{min-width:160px;}
#system-workspace .fsv-createrow{display:flex;gap:6px;align-items:center;}
#system-workspace .fsv-createrow input{flex:1;min-width:0;}
#system-workspace .fsv-noterow td{color:var(--dim);font-size:var(--sp-fs-sm);}
#system-workspace .fsv-stats{color:var(--dim);font-size:var(--sp-fs-sm);font-variant-numeric:tabular-nums;}
#system-workspace .fsv-selcount{color:var(--text);font-variant-numeric:tabular-nums;}
#system-workspace .fsv-locked{opacity:.45;}
#system-workspace .fsv-ops-type{color:var(--dim);font-size:var(--sp-fs-sm);}
#system-workspace .fsv-undo{background:transparent;border:0;color:var(--accent);cursor:pointer;font-size:var(--sp-fs-sm);padding:2px 6px;border-radius:var(--sp-r-xs);}
#system-workspace .fsv-undo:hover{background:color-mix(in srgb, var(--accent) 14%, transparent);}
/* 浮动：右键菜单、预览、提示、闪现条 —— 之前这些类完全没有样式，
   菜单因此被当成正文整块铺在页面里（position:static、宽 1440px）。 */
#system-workspace .fsv-menu, .fsv-menu{position:fixed;z-index:120;min-width:200px;max-height:60vh;overflow:auto;padding:5px;
  background:var(--sp-surface);border:1px solid var(--sp-hair);border-radius:var(--sp-r);box-shadow:var(--sp-raise);}
#system-workspace .fsv-menu-item, body .fsv-menu .fsv-menu-item{display:flex;align-items:baseline;gap:12px;width:100%;text-align:left;
  background:transparent;border:0;border-radius:var(--sp-r-xs);color:var(--text);padding:6px 9px;font-size:var(--sp-fs-sm);cursor:pointer;
  color:var(--text);border-radius:var(--sp-r-xs);padding:7px 10px;font-size:var(--sp-fs);cursor:pointer;}
#system-workspace .fsv-menu-item:hover, .fsv-menu-item:hover{background:var(--ui-accent-soft, var(--sp-tint));}
#system-workspace .fsv-menu-item em, .fsv-menu-item em{margin-left:auto;font-style:normal;color:var(--dim);font-size:var(--sp-fs-sm);font-family:var(--sp-mono);}
#system-workspace .fsv-menu-item.danger, .fsv-menu-item.danger{color:var(--sp-danger);}
#system-workspace .fsv-menu-item.danger:hover, .fsv-menu-item.danger:hover{background:color-mix(in srgb, var(--sp-danger) 14%, transparent);}
#system-workspace .fsv-menu-item[disabled], .fsv-menu-item[disabled]{opacity:.42;cursor:not-allowed;}
#system-workspace .fsv-menu-sep, .fsv-menu-sep{height:1px;background:var(--sp-hair);margin:5px 4px;}
#system-workspace .fsv-preview, .fsv-preview{position:fixed;inset:0;z-index:110;background:color-mix(in srgb, var(--bg) 62%, transparent);
  display:flex;align-items:center;justify-content:center;padding:26px;}
/* 预览对话框本体：文本/图片/PDF 都放进这张卡片，浮层只当半透明背板 */
#system-workspace .fsv-preview-card, .fsv-preview-card{display:flex;flex-direction:column;width:min(840px,92vw);max-height:84vh;
  background:var(--sp-surface);border:1px solid var(--sp-hair);border-radius:var(--sp-r-lg);box-shadow:var(--sp-raise);overflow:hidden;}
#system-workspace .fsv-preview-frame, .fsv-preview-frame{width:100%;height:min(72vh,620px);border:0;border-radius:var(--sp-r-sm);background:var(--bg);}
#system-workspace .fsv-preview-head, .fsv-preview-head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--sp-hair);font-size:var(--sp-fs);}
#system-workspace .fsv-preview-head strong, .fsv-preview-head strong{font-weight:600;color:var(--text);}
#system-workspace .fsv-preview-body, .fsv-preview-body{overflow:auto;padding:14px;}
#system-workspace .fsv-preview-image, .fsv-preview-image{max-width:100%;max-height:72vh;display:block;margin:0 auto;border-radius:var(--sp-r-sm);}
#system-workspace .fsv-preview-text, .fsv-preview-text{margin:0;font:var(--sp-fs)/1.7 var(--sp-mono);color:var(--text);white-space:pre-wrap;word-break:break-word;}
#system-workspace .fsv-selbar{position:sticky;top:0;z-index:5;display:flex;gap:8px;align-items:center;flex-wrap:wrap;
  padding:8px 12px;background:var(--ui-accent-soft, var(--sp-tint));border-radius:var(--sp-r-sm);}
#system-workspace .fsv-usage-cols, #system-workspace .fsv-organize-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--sp-gap);align-items:start;}
#system-workspace .fsv-organize-group{background:var(--sp-surface);box-shadow:var(--sp-ring);border-radius:var(--sp-r);padding:12px 14px;}
#system-workspace .fsv-organize-group h4{margin:0 0 8px;font-size:var(--sp-fs-sm);color:var(--dim);font-weight:600;}
#system-workspace .fsv-batch-head{position:sticky;top:0;z-index:4;padding:8px 12px;font-size:var(--sp-fs-sm);color:var(--dim);
  background:var(--sp-surface);border-bottom:1px solid var(--sp-hair);}
#system-workspace .fsv-batch-list{display:flex;flex-direction:column;max-height:320px;overflow:auto;}
#system-workspace .fsv-batch-list .item{padding:6px 12px;font-size:var(--sp-fs);border-bottom:1px solid var(--sp-hair);}
#system-workspace .fsv-batch-mark{color:var(--dim);}
#system-workspace .fsv-treemap{position:relative;}
#system-workspace .fsv-tip{position:absolute;z-index:20;max-width:240px;padding:6px 9px;border-radius:var(--sp-r-xs);
  background:var(--sp-surface);border:1px solid var(--sp-hair);box-shadow:var(--sp-raise);
  font-size:var(--sp-fs-sm);color:var(--text);pointer-events:none;line-height:1.5;}
#system-workspace .fsv-flash{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:130;padding:8px 14px;
  border-radius:var(--sp-r-sm);background:var(--sp-surface);border:1px solid var(--sp-hair);box-shadow:var(--sp-raise);
  font-size:var(--sp-fs-sm);color:var(--text);}
#system-workspace .fsv-switch{display:flex;align-items:center;gap:6px;color:var(--dim);font-size:var(--sp-fs-sm);cursor:pointer;user-select:none;}
#system-workspace .fsv-switch input{margin:0;}

/* ── 软件管理（sw-*）：图标网格 + 分类 + 常用；同样不做「满屏方框」 ── */
#system-workspace .sw-root{display:flex;flex-direction:column;gap:10px;}
#system-workspace .sw-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
#system-workspace .sw-search{flex:1 1 260px;max-width:340px;}
#system-workspace .sw-sort{flex:none;min-width:130px;cursor:pointer;}
#system-workspace .sw-cats{display:flex;gap:4px;flex-wrap:wrap;}
#system-workspace .sw-cat{display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px solid transparent;
  color:var(--dim);border-radius:var(--sp-r-sm);padding:4px 9px;font-size:var(--sp-fs-sm);cursor:pointer;
  transition:background var(--sp-ease),color var(--sp-ease);}
#system-workspace .sw-cat i{font-style:normal;opacity:.75;font-size:var(--sp-fs);}
#system-workspace .sw-cat:hover{color:var(--text);background:var(--sp-tint);}
#system-workspace .sw-cat.on{color:var(--text);background:var(--ui-accent-soft, var(--sp-tint-strong));font-weight:600;}
#system-workspace .sw-info{display:flex;gap:14px;align-items:baseline;color:var(--dim);font-size:var(--sp-fs-sm);font-variant-numeric:tabular-nums;}
#system-workspace .sw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(216px,1fr));gap:6px;}
#system-workspace .sw-list{display:flex;flex-direction:column;gap:2px;}
#system-workspace .sw-tile{position:relative;display:flex;align-items:center;gap:10px;min-width:0;text-align:left;
  background:transparent;border:1px solid transparent;border-radius:var(--sp-r);padding:9px 10px;cursor:pointer;
  transition:background var(--sp-ease),border-color var(--sp-ease);}
#system-workspace .sw-tile:hover{background:var(--sp-tint);border-color:var(--sp-hair);}
#system-workspace .sw-tile-body{flex:1;min-width:0;}
#system-workspace .sw-tile-name{color:var(--text);font-size:var(--sp-fs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#system-workspace .sw-tile-meta{display:flex;gap:7px;align-items:baseline;margin-top:3px;color:var(--dim);font-size:var(--sp-fs-xs);}
#system-workspace .sw-tile-cat{background:var(--sp-tint);border-radius:var(--sp-r-xs);padding:1px 6px;}
#system-workspace .sw-tile-ver{font-family:var(--sp-mono);}
/* 图标块：默认是字母块，图片加载成功才换成真图标 */
#system-workspace .sw-icon{flex:none;display:flex;align-items:center;justify-content:center;border-radius:var(--sp-r-sm);
  background:var(--sp-tint);color:var(--dim);overflow:hidden;}
#system-workspace .sw-icon{position:relative;}
#system-workspace .sw-icon-glyph{line-height:1;}
#system-workspace .sw-icon-img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;opacity:0;}
#system-workspace .sw-icon.has-img{background:transparent;}
#system-workspace .sw-icon.has-img .sw-icon-glyph{visibility:hidden;}
#system-workspace .sw-icon.has-img .sw-icon-img{opacity:1;}
#system-workspace .sw-star{position:absolute;right:6px;top:6px;color:var(--dim);opacity:0;font-size:var(--sp-fs);cursor:pointer;
  padding:0 3px;border-radius:var(--sp-r-xs);transition:opacity var(--sp-ease),color var(--sp-ease);}
#system-workspace .sw-tile:hover .sw-star{opacity:.8;}
#system-workspace .sw-star.on{opacity:1;color:var(--accent);}
#system-workspace .sw-runs{position:absolute;right:8px;bottom:6px;color:var(--dim);font-size:var(--sp-fs-xs);font-family:var(--sp-mono);}
#system-workspace .sw-fav-row{display:flex;gap:6px;flex-wrap:wrap;}
#system-workspace .sw-fav-chip{display:inline-flex;align-items:center;gap:7px;background:var(--sp-tint);border:1px solid transparent;
  color:var(--text);border-radius:var(--sp-r-sm);padding:5px 10px 5px 6px;font-size:var(--sp-fs);cursor:pointer;
  transition:background var(--sp-ease);}
#system-workspace .sw-fav-chip:hover{background:var(--sp-tint-strong);}
#system-workspace .sw-detail-layer{position:fixed;inset:0;z-index:112;background:color-mix(in srgb, var(--bg) 62%, transparent);
  display:flex;align-items:center;justify-content:center;padding:24px;}
#system-workspace .sw-detail{width:min(620px,94vw);max-height:86vh;overflow:auto;background:var(--sp-surface);
  border:1px solid var(--sp-hair);border-radius:var(--sp-r-lg);box-shadow:var(--sp-raise);padding:16px;}
#system-workspace .sw-detail-head{display:flex;align-items:center;gap:12px;margin-bottom:12px;}
#system-workspace .sw-detail-head .sp-btn{margin-left:auto;}
#system-workspace .sw-detail-title{display:flex;flex-direction:column;gap:3px;min-width:0;}
#system-workspace .sw-detail-title strong{color:var(--text);font-size:var(--sp-fs-md);}
#system-workspace .sw-detail-title .sp-note{margin:0;}

/* ── 全盘扫描 / 安全管理 ── */
#system-workspace .scan-root{display:flex;flex-direction:column;gap:10px;}
#system-workspace .scan-roots,#system-workspace .scan-options{display:flex;gap:8px 14px;flex-wrap:wrap;align-items:center;margin-top:6px;}
#system-workspace .scan-check{display:inline-flex;align-items:center;gap:6px;color:var(--text);font-size:var(--sp-fs-sm);cursor:pointer;}
#system-workspace .scan-check input{accent-color:var(--accent);cursor:pointer;}
#system-workspace .scan-check select{padding:2px 6px;font-size:var(--sp-fs-sm);}
#system-workspace .scan-progress{margin-top:2px;}
#system-workspace .scan-bar{height:4px;border-radius:3px;background:var(--sp-tint-strong);overflow:hidden;}
#system-workspace .scan-bar i{display:block;height:100%;width:2%;background:var(--accent);transition:width 220ms ease;}
#system-workspace .scan-bar i.stop{background:var(--dim);}
#system-workspace .scan-bar i.done{background:var(--ok);}
#system-workspace .scan-line{display:flex;gap:14px;flex-wrap:wrap;margin-top:7px;color:var(--dim);font-size:var(--sp-fs-sm);font-variant-numeric:tabular-nums;}
#system-workspace .scan-current{margin-top:3px;color:var(--dim);font-size:var(--sp-fs-xs);font-family:var(--sp-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#system-workspace .scan-results{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;}
#system-workspace .scan-card{background:var(--sp-tint);border-radius:var(--sp-r);padding:11px 13px;}
#system-workspace .scan-card h4{margin:0 0 8px;color:var(--text);font-size:var(--sp-fs-sm);font-weight:600;letter-spacing:.02em;}
#system-workspace .scan-list{display:flex;flex-direction:column;}
#system-workspace .scan-row{display:flex;align-items:center;gap:9px;padding:4px 0;font-size:var(--sp-fs-xs);border-bottom:1px solid var(--sp-hair);}
#system-workspace .scan-row:last-child{border-bottom:0;}
#system-workspace .scan-size{color:var(--dim);font-family:var(--sp-mono);min-width:62px;text-align:right;font-variant-numeric:tabular-nums;}
#system-workspace .scan-name{flex:1;min-width:0;text-align:left;background:transparent;border:0;padding:0;color:var(--text);
  font-family:var(--sp-mono);font-size:var(--sp-fs-xs);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#system-workspace .scan-name:hover{color:var(--accent);text-decoration:underline;}
#system-workspace .scan-count{color:var(--dim);font-variant-numeric:tabular-nums;}
#system-workspace .scan-meter{flex:1;height:3px;border-radius:2px;background:var(--sp-tint-strong);overflow:hidden;min-width:40px;}
#system-workspace .scan-meter i{display:block;height:100%;background:var(--accent);opacity:.75;}
#system-workspace .scan-ext .scan-name{flex:0 0 84px;}
#system-workspace .scan-safety{background:var(--sp-tint);}
#system-workspace .safe-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;}
#system-workspace .safe-paths{display:flex;flex-direction:column;gap:3px;max-height:190px;overflow:auto;}
#system-workspace .safe-paths code{font-family:var(--sp-mono);font-size:var(--sp-fs-xs);color:var(--text);opacity:.9;word-break:break-all;}
#system-workspace .safe-rules{margin:0;padding-left:20px;color:var(--dim);font-size:var(--sp-fs-sm);line-height:1.75;}
#system-workspace .safe-type{color:var(--accent);font-size:var(--sp-fs-xs);min-width:56px;}
#system-workspace .sp-btn.tiny{padding:1px 7px;font-size:var(--sp-fs-xs);border-radius:var(--sp-r-xs);}

/* ── 环境与更新 ──
   这一屏的任务是「一眼看出缺什么」+「就地能修」。所以：状态用徽标不用方框，
   动作区用淡底块，命令一律等宽可点复制。 */
#system-workspace .env-root{display:flex;flex-direction:column;gap:var(--sp-gap);}
#system-workspace .env-summary{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:var(--sp-r);
  background:var(--sp-tint);}
#system-workspace .env-summary.warn{background:color-mix(in srgb, var(--sp-warn) 10%, transparent);}
#system-workspace .env-summary-main{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
#system-workspace .env-summary-main b{font-size:var(--sp-fs-lg);}
#system-workspace .env-summary-main span{color:var(--dim);font-size:var(--sp-fs-sm);min-width:0;}
#system-workspace .env-summary-foot{display:flex;align-items:center;gap:10px;}
#system-workspace .env-summary-foot .dim{flex:1;min-width:0;color:var(--dim);font-size:var(--sp-fs-xs);}
#system-workspace .env-badge{flex:none;padding:2px 8px;border-radius:var(--sp-r-xs);font-size:var(--sp-fs-xs);
  background:var(--sp-tint-strong);color:var(--dim);white-space:nowrap;}
#system-workspace .env-badge.ok{color:var(--ok);background:color-mix(in srgb, var(--ok) 14%, transparent);}
#system-workspace .env-badge.warn{color:var(--sp-warn);background:color-mix(in srgb, var(--sp-warn) 15%, transparent);}
#system-workspace .env-badge.err{color:var(--sp-danger);background:color-mix(in srgb, var(--sp-danger) 15%, transparent);}
#system-workspace .env-rows{display:flex;flex-direction:column;}
#system-workspace .env-row{display:flex;align-items:baseline;gap:10px;padding:5px 0;border-bottom:1px solid var(--sp-hair);}
#system-workspace .env-row:last-child{border-bottom:0;}
#system-workspace .env-row .k{flex:none;width:84px;color:var(--dim);font-size:var(--sp-fs-sm);}
#system-workspace .env-row .v{flex:1;min-width:0;word-break:break-word;}
#system-workspace .env-row .v code,#system-workspace .env-lan code,#system-workspace .env-cmd{font-family:var(--sp-mono);font-size:var(--sp-fs-sm);}
#system-workspace .env-row .x{flex:none;}
#system-workspace .env-lan-list{display:flex;flex-direction:column;gap:6px;margin-top:10px;}
#system-workspace .env-lan{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
#system-workspace .env-lan .dim{color:var(--dim);font-size:var(--sp-fs-xs);}
#system-workspace .env-action{margin-top:10px;padding:10px 12px;border-radius:var(--sp-r-sm);background:var(--sp-tint);}
#system-workspace .env-action.needed{background:color-mix(in srgb, var(--sp-warn) 9%, transparent);}
#system-workspace .env-action-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
#system-workspace .env-why{margin:6px 0;color:var(--dim);font-size:var(--sp-fs-sm);line-height:1.55;}
#system-workspace .env-cmd{display:inline-flex;align-items:center;gap:8px;cursor:pointer;padding:4px 8px;
  border-radius:var(--sp-r-xs);background:var(--sp-tint);color:var(--text);word-break:break-all;}
#system-workspace .env-cmd:hover{background:var(--sp-tint-strong);}
#system-workspace .env-copy{flex:none;color:var(--dim);font-size:var(--sp-fs-xs);}
#system-workspace .env-action-foot{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}
#system-workspace .env-btn{background:transparent;border:1px solid transparent;border-radius:var(--sp-r-xs);
  padding:5px 11px;color:var(--text);cursor:pointer;font-size:var(--sp-fs-sm);
  transition:background var(--sp-ease),color var(--sp-ease);}
#system-workspace .env-btn:hover{background:var(--sp-tint-strong);}
/* ── 远程同步（系统 · 远程同步）：表单与动作块 ── */
#system-workspace .sync-root{display:flex;flex-direction:column;gap:10px;min-width:0;}
#system-workspace .sync-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px;min-width:0;}
#system-workspace .sync-field{display:flex;flex-direction:column;gap:4px;min-width:0;}
#system-workspace .sync-field>span{color:var(--dim);font-size:var(--sp-fs-sm);}
#system-workspace .sync-field input{width:100%;min-width:0;box-sizing:border-box;}
#system-workspace .sync-toggles{display:flex;flex-wrap:wrap;gap:6px 16px;margin:10px 0 2px;}
#system-workspace .sync-toggle{display:flex;align-items:center;gap:6px;font-size:var(--sp-fs-sm);color:var(--dim);}
#system-workspace .sync-action{border:1px solid var(--sp-line);border-radius:var(--sp-r-sm);padding:10px 12px;margin-top:8px;min-width:0;}
#system-workspace .sync-action.idle{opacity:.62;}
#system-workspace .sync-action-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
#system-workspace .sync-cmd{margin:6px 0 2px;padding:8px 10px;background:var(--sp-tint);border-radius:var(--sp-r-xs);font-size:var(--sp-fs-xs);overflow-x:auto;white-space:pre;max-width:100%;}
#system-workspace .sync-action .sp-note{margin:4px 0 0;}
/* 窄屏下视图内部会溢出：长命令、长路径、以及 li 里没有断行机会的中文串都会把宽度顶出去。
   页面级没溢出不代表视图内没有横向滚动条 —— 这里统一给同步视图加断行与最小宽度约束。 */
#system-workspace .sync-root,#system-workspace .sync-root *{min-width:0;}
#system-workspace .sync-root .sp-band,#system-workspace .sync-root .env-issues li{max-width:100%;}
#system-workspace .sync-root code,#system-workspace .sync-root .sp-note,#system-workspace .sync-root .env-issues li,
#system-workspace .sync-root .env-row-value{overflow-wrap:anywhere;word-break:break-word;}
#system-workspace .sync-root .env-row{flex-wrap:wrap;}
@media (max-width:900px){
  #system-workspace .sync-form{grid-template-columns:minmax(0,1fr);}
}

#system-workspace .env-btn.primary{background:color-mix(in srgb, var(--accent) 15%, transparent);color:var(--accent);font-weight:600;}
#system-workspace .env-btn.primary:hover{background:color-mix(in srgb, var(--accent) 24%, transparent);}
#system-workspace .env-btn[disabled]{opacity:.5;cursor:progress;}
#system-workspace .env-assets{display:flex;flex-direction:column;gap:8px;}
#system-workspace .env-asset{padding:8px 10px;border-radius:var(--sp-r-sm);background:var(--sp-tint);}
#system-workspace .env-asset-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
#system-workspace .env-asset-head .sp{flex:1;}
#system-workspace .env-asset-meta{margin-top:4px;color:var(--dim);font-size:var(--sp-fs-sm);word-break:break-word;}
#system-workspace .env-asset-meta code{font-family:var(--sp-mono);font-size:var(--sp-fs-xs);}
#system-workspace .env-chips{display:flex;flex-wrap:wrap;gap:6px;}
#system-workspace .env-chip{padding:3px 9px;border-radius:var(--sp-r-xs);font-size:var(--sp-fs-sm);
  background:color-mix(in srgb, var(--ok) 13%, transparent);color:var(--ok);}
#system-workspace .env-chip.off{background:var(--sp-tint-strong);color:var(--dim);}
#system-workspace .env-missing,#system-workspace .env-issues{margin:8px 0 0;padding-left:18px;color:var(--dim);
  font-size:var(--sp-fs-sm);line-height:1.6;word-break:break-word;}
#system-workspace .env-idle{margin-top:10px;}
#system-workspace .env-idle summary{cursor:pointer;color:var(--dim);font-size:var(--sp-fs-sm);}
#system-workspace .dim{color:var(--dim);font-style:normal;}

/* ── 多端适配 ──
   一台机器会被三种窗口看到：桌面浏览器、手机/平板、以及 code-server 里那个窄 iframe。
   窄屏下左侧分区栏改成顶部横向条（分区不隐藏，都能点到），主列一律单列，触摸目标加大。 */
@media (max-width: 900px) {
  body.system-mode #system-workspace{flex-direction:column;}
  /* 注意：真正横排的是 #system-shell（导航 + 主列），只改 #system-workspace 没用 ——
     导航那一行内容约 600px、flex:none，会把主列挤成 153px。 */
  #system-workspace #system-shell{flex-direction:column;}
  #system-workspace #system-main{width:100%;flex:1 1 auto;min-height:0;}
  #system-workspace #system-nav{width:100%;max-width:100%;min-width:0;flex:none;flex-direction:row;align-items:center;gap:8px;
    padding:8px 10px;border-right:0;border-bottom:1px solid var(--sp-hair);overflow-x:auto;overflow-y:hidden;}
  #system-workspace #system-nav .nav-title{padding:0 8px 0 2px;flex:none;white-space:nowrap;}
  #system-workspace #system-nav .nav-foot{flex:none;margin:0;padding:0;border:0;flex-direction:row;gap:8px;}
  #system-workspace #system-nav-list{flex-direction:row;gap:6px;flex:none;}
  #system-workspace #system-nav-list .nav-group{display:none;}
  #system-workspace #system-nav-list button{width:auto;padding:7px 12px;white-space:nowrap;}
  #system-workspace #system-nav-list button.on::before{display:none;}
  #system-workspace #system-subnav{flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;}
  #system-workspace .sp-cols{grid-template-columns:1fr;}
  #system-workspace #system-body{padding:12px;}
  #system-workspace #system-head{padding:0 12px;}
}
@media (max-width: 720px) {
  #system-workspace #system-head{height:auto;flex-wrap:wrap;gap:6px;padding:8px 12px;}
  #system-workspace #system-head .head-title{flex:1;min-width:0;}
  #system-workspace #system-head-status{order:9;width:100%;}
  #system-workspace #system-body{padding:10px;}
  #system-workspace .env-summary-main b{font-size:var(--sp-fs-md);}
  #system-workspace .env-summary-main span{word-break:break-word;}
  #system-workspace .env-row .k{width:70px;}
  #system-workspace .env-lan code{word-break:break-all;}
  #system-workspace .sp-cards{grid-template-columns:1fr;}
  #system-workspace .sp-table{font-size:var(--sp-fs-sm);}
}
@media (max-width: 520px) {
  #system-workspace #system-body{padding:8px;}
  #system-workspace .sp-band{padding:10px;}
  #system-workspace .env-row{flex-wrap:wrap;gap:2px 8px;}
  #system-workspace .env-row .k{width:100%;}
  #system-workspace .env-badge{white-space:normal;word-break:break-word;}
  #system-workspace .env-action-head{align-items:flex-start;}
  #system-workspace .env-action-foot .env-btn{flex:1 1 42%;text-align:center;}
}
/* 触摸设备没有 hover：把关键控件撑到能点得准的高度。 */
@media (pointer: coarse) {
  #system-workspace .sp-btn,#system-workspace .env-btn,#system-workspace .env-chip{min-height:34px;
    display:inline-flex;align-items:center;justify-content:center;}
  #system-workspace #system-nav-list button{min-height:38px;}
  #system-workspace #system-subnav button{min-height:34px;}
}

@media (prefers-reduced-motion:reduce){
  #system-workspace *{transition:none !important;}
  #system-workspace .sp-skel{animation:none;opacity:.6;}
}
@media (max-width:820px){
  /* 窄屏是图标栏，宽度写死，拖拽手柄一并收起 */
  #system-nav{width:60px !important;padding:10px 8px;}
  #system-workspace .nav-resizer{display:none;}
  #system-nav .nav-title span, #system-nav-list button span, #system-nav .nav-foot button span{display:none;}
  #system-nav .nav-search{justify-content:center;padding:6px 0;}
  #system-nav .nav-search .txt, #system-nav .nav-search kbd{display:none;}
  #system-body{padding:14px 14px 26px;}
}
`;

  function injectStyle() {
    if ($('codescope-system-panel-style')) return;
    const style = document.createElement('style');
    style.id = 'codescope-system-panel-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* ---------------------------------------------------------------- 状态 */

  const state = {
    built: false,
    backend: null,
    tab: 'overview',
    auto: true,
    timer: null,
    busy: false,
    history: { cpu: [], mem: [], ts: [] },
    overview: null,
    processes: null,
    processSort: 'cpu',
    processQuery: '',
    processLimit: 10,
    portLimit: 8,
    caches: [],
    cacheScanAt: 0,
    software: null,
    softwareQuery: '',
    showAllAgents: false,
    docker: null,
    dev: null,
    devRootInput: '',
    usageRoot: '',
    usage: null,
    largeRoot: '',
    large: null,
    eventSource: null,
    taskId: '',
  };
  state.usageRoot = '';
  state.largeRoot = '';

  /* ---------------------------------------------------------------- 任务控制台（SSE） */

  function taskConsoleOpen(label) {
    const box = $('system-task');
    if (!box) return;
    box.hidden = false;
    $('system-task-label').textContent = label || '任务';
    $('system-task-status').textContent = '运行中…';
    $('system-task-out').textContent = '';
    $('system-task-cancel').hidden = false;
  }

  function taskLine(entry) {
    const out = $('system-task-out');
    if (!out) return;
    const line = document.createElement('span');
    if (entry.stream === 'err') line.className = 'err';
    line.textContent = entry.text + '\n';
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  }

  function taskDone(info) {
    const status = $('system-task-status');
    const out = $('system-task-out');
    if (status) {
      status.textContent = info.status === 'ok' ? '完成（' + ((info.ms || 0) / 1000).toFixed(1) + 's）'
        : info.status === 'cancelled' ? '已取消'
          : '失败' + (info.exit == null ? '' : '（退出码 ' + info.exit + '）');
    }
    if (out && info.error) {
      const line = document.createElement('span');
      line.className = 'err';
      line.textContent = info.error + '\n';
      out.appendChild(line);
    }
    if (out && info.result) {
      const line = document.createElement('span');
      line.className = 'ok';
      if (info.result.freed != null) line.textContent = '释放空间：' + fmtBytes(info.result.freed) + '\n';
      else if (info.result.total != null) line.textContent = '合计：' + fmtBytes(info.result.total) + '\n';
      out.appendChild(line);
      out.scrollTop = out.scrollHeight;
    }
    const cancel = $('system-task-cancel');
    if (cancel) cancel.hidden = true;
    state.taskId = '';
    setTimeout(() => { state.busy = false; refresh(true); }, 260);
  }

  function streamTask(task) {
    if (state.eventSource) { try { state.eventSource.close(); } catch (_) {} state.eventSource = null; }
    state.taskId = task.id;
    state.busy = true;
    taskConsoleOpen(task.label);
    const source = new EventSource(API + '/tasks/' + task.id + '/stream');
    state.eventSource = source;
    source.addEventListener('line', (event) => { try { taskLine(JSON.parse(event.data)); } catch (_) {} });
    source.addEventListener('done', (event) => {
      try { source.close(); } catch (_) {}
      state.eventSource = null;
      let info = {};
      try { info = JSON.parse(event.data); } catch (_) {}
      taskDone(info);
    });
    source.onerror = () => {
      /* EventSource 会无限重连，这里主动断掉并核对一次任务状态。 */
      try { source.close(); } catch (_) {}
      if (state.eventSource === source) state.eventSource = null;
      api('/tasks').then((data) => {
        const found = (data.tasks || []).find((item) => item.id === task.id);
        if (found && found.status !== 'running') taskDone({ status: found.status, exit: found.exit, ms: found.endedAt - found.startedAt, error: found.error, result: found.result });
        else { state.busy = false; }
      }).catch(() => { state.busy = false; });
    };
    return true;
  }

  async function startTask(request) {
    if (state.busy) { toast('warn', '上一个任务还在跑，先等它结束或取消'); return; }
    try {
      const data = await request();
      if (data && data.task) streamTask(data.task);
      else { state.busy = false; refresh(true); }
    } catch (error) {
      state.busy = false;
      toast('err', String(error.message || error));
    }
  }

  /* ---------------------------------------------------------------- 装配：按钮 / 面板 / 事件 */

  function buildShell() {
    injectStyle();
    if (!$('btn-system') && $('header-center')) {
      const button = el('button', 'header-action', '本机管家');
      button.id = 'btn-system';
      button.title = '本机管家：一站式查看与清理这台电脑 —— 实时状态、进程、磁盘与缓存、软件、服务与端口、Docker、开发环境';
      button.setAttribute('aria-pressed', 'false');
      const anchor = $('knowledge-launch') || $('btn-dsh-restart') || $('btn-dsh');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(button, anchor);
      else $('header-center').appendChild(button);
      button.addEventListener('click', () => { if (document.body.classList.contains(MODE)) close(); else openPanel(); });
    }
    if (!$('system-workspace')) {
      const section = document.createElement('section');
      section.id = 'system-workspace';
      section.setAttribute('aria-label', '本机管家');
      section.innerHTML = `
        <div id="system-shell">
          <aside id="system-nav" aria-label="本机管家分区">
            <div class="nav-title">本机管家 <span id="system-nav-host"></span></div>
            <button id="system-palette" class="nav-search" type="button" title="搜索文件、进程与功能（⌘K）">
              <span class="ico" aria-hidden="true">⌕</span><span class="txt">搜索与命令</span><kbd>⌘K</kbd>
            </button>
            <nav id="system-nav-list"></nav>
            <div class="nav-foot">
              <label class="sp-auto" title="自动刷新实时数据"><input type="checkbox" id="system-auto" checked> 实时刷新</label>
            </div>
            <div class="nav-resizer" role="separator" aria-orientation="vertical" title="拖动调整侧栏宽度（双击恢复默认）"></div>
          </aside>
          <div id="system-main">
            <header id="system-head">
              <button id="system-back" title="返回代码工作区">← 返回</button>
              <div class="head-title">
                <strong id="system-title">概览</strong>
                <span id="system-subtitle"></span>
              </div>
              <span id="system-head-status">等待打开</span>
              <span class="sp"></span>
              <button id="system-refresh" title="立即刷新当前页面">↻ 刷新</button>
            </header>
            <div id="system-subnav" role="tablist"></div>
            <div id="system-body"></div>
            <div id="system-task" hidden>
              <div class="task-head"><b id="system-task-label">任务</b><span id="system-task-status"></span><span class="sp"></span>
                <button id="system-task-cancel" type="button">取消</button>
                <button id="system-task-close" type="button">收起</button></div>
              <pre id="system-task-out"></pre>
            </div>
          </div>
        </div>
        <div id="system-palette-layer" hidden>
          <div id="system-palette-box">
            <input id="system-palette-input" type="text" placeholder="搜索文件、进程与功能…（↑↓ 选择 · Enter 执行 · Esc 关闭）" autocomplete="off" spellcheck="false">
            <div id="system-palette-list"></div>
          </div>
        </div>`;
      const anchor = $('vscode-workspace') || $('dsh-workspace');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(section, anchor.nextSibling);
      else document.body.appendChild(section);
    }
    wireShellEvents();
    wireNavResizer();
    restoreNavWidth();
    state.built = true;
  }

  /* ---------------------------------------------------------------- 信息架构 */

  /* 六个分区 + 底部设置。state.tab 仍然是「视图键」，所有既有渲染函数一行都不用改，
     这里只是把入口从一排顶部 tab 换成左侧分区 + 分区内胶囊（调研：顶栏平铺最多 6 项，
     再多就该分层；宝塔 15 个子页平铺是典型反面教材）。 */
  /* 命名规范（对齐主流管理面板的通用叫法，避免自造词与语义重叠）：
     · 分区用「名词、短、互斥」：概览 / 性能 / 文件 / 存储 / 系统 / 软件 / 设置。
       - 「监控」是动作不是对象 → 改「性能」（里面装的是进程与资源）；
       - 「运行时」是术语误用（Runtimes 指语言运行时）→ 里面是服务/端口/容器/开发环境，改「系统」；
       - 「存储」（磁盘空间）与「文件」（用户文件）是两件事，保持并列，不合并。
     · 子视图用「对象名」，不用描述句、不中英混排：
       - 「一眼看全」这类口语 → 「概览」；
       - 「Docker」→「容器」（Docker 只是容器的一种实现）；
       - 「更新与包管理」（开发者术语）→「更新与安装」；
       - 「应用管理」与分区「软件」语义重复 → 「已安装」；
       - 「浏览 / 占用分析」→「文件浏览 / 空间分析」，与「存储」分区区分开。
     · id 保持原样（只改展示名），避免动到任何逻辑分支。 */
  const SECTIONS = [
    { id: 'home', group: '查看', label: '概览', icon: '◎', views: [['overview', '概览']] },
    { id: 'monitor', group: '查看', label: '性能', icon: '◈', views: [['processes', '进程']] },
    { id: 'files', group: '查看', label: '文件', icon: '▤', views: [['files', '文件浏览'], ['files-usage', '空间分析'], ['files-organize', '整理归类'], ['files-trash', '回收站'], ['scan', '全盘扫描'], ['safety', '安全管理']] },
    { id: 'storage', group: '查看', label: '存储', icon: '◍', views: [['storage', '磁盘与清理']] },
    { id: 'runtime', group: '管理', label: '系统', icon: '⚙', views: [['services', '服务与端口'], ['docker', '容器'], ['dev', '开发环境'], ['env', '环境与更新'], ['sync', '远程同步'] ] },
    { id: 'software', group: '管理', label: '软件', icon: '⤓', views: [['apps', '已安装'], ['software', '更新与安装']] },
    { id: 'settings', group: '管理', label: '设置', icon: '⌥', views: [['settings', '设置']] },
  ];

  /* 每个视图一句话说明：管理面板的标配，告诉用户「这一页是干嘛的」，
     而不是让他从标题去猜。显示在页头标题右侧。 */
  const VIEW_NOTES = {
    overview: '这台电脑的实时状态',
    processes: '谁在占资源，一眼看清',
    files: '浏览、搜索与整理你的文件',
    'files-usage': '看看空间都被什么占满了',
    'files-organize': '把散乱的文件按类型归档',
    'files-trash': '误删的文件先放这里，可还原',
    scan: '全盘扫描大文件、重复文件与旧文件',
    safety: '哪些目录受保护、哪些操作会被拦下',
    storage: '磁盘容量、缓存与可回收空间',
    services: '后台服务、开机启动项与端口占用',
    docker: '容器、镜像与数据卷',
    dev: '语言工具链、Git 仓库与开发目录',
    apps: '这台电脑上装了哪些应用',
    software: '可升级的软件与安装包管理',
    settings: '面板的行为与安全选项',
  };

  function sectionOf(view) {
    for (const section of SECTIONS) for (const pair of section.views) if (pair[0] === view) return section;
    return SECTIONS[0];
  }

  function renderNav() {
    const list = $('system-nav-list');
    if (!list) return;
    const active = sectionOf(state.tab);
    /* 按 group 分段：7 个分区平铺太散，分成「查看 / 管理」两组更容易定位。
       group 名相同时不重复输出小标题。 */
    let lastGroup = '';
    list.innerHTML = SECTIONS.map((section) => {
      const on = section.id === active.id ? ' class="on"' : '';
      const head = section.group && section.group !== lastGroup
        ? '<div class="nav-group">' + esc(section.group) + '</div>'
        : '';
      lastGroup = section.group || lastGroup;
      return head + '<button type="button" data-section="' + section.id + '"' + on + '><i>' + section.icon + '</i><span>' + esc(section.label) + '</span></button>';
    }).join('');
    const host = $('system-nav-host');
    if (host) {
      const identity = state.overview && state.overview.identity;
      host.textContent = identity ? (identity.hostname || '') : '';
    }
  }

  function renderSubnav() {
    const nav = $('system-subnav');
    const title = $('system-title');
    const subtitle = $('system-subtitle');
    const active = sectionOf(state.tab);
    if (title) title.textContent = active.label;
    /* 副标题给「当前这一页」，不是分区名 —— 单项分区（概览/存储/设置）才说得出区别。 */
    if (subtitle) subtitle.textContent = VIEW_NOTES[state.tab] || '';
    if (!nav) return;
    if (active.views.length <= 1) { nav.hidden = true; nav.innerHTML = ''; return; }
    nav.hidden = false;
    nav.innerHTML = active.views.map((pair) => {
      const on = pair[0] === state.tab ? ' class="on"' : '';
      return '<button type="button" data-view="' + pair[0] + '"' + on + '>' + esc(pair[1]) + '</button>';
    }).join('');
  }

  function setView(view) {
    state.tab = view;
    state.mountedKey = '';
    renderNav();
    renderSubnav();
    const body = $('system-body');
    if (body) body.innerHTML = skeleton();
    render();
  }

  /* 加载骨架：先给结构再填数字，避免每次切换都「一闪全白」。 */
  function skeleton() {
    return '<div class="sp-cards">' + [0, 1, 2, 3].map(() => '<div class="sp-card"><div class="sp-skel" style="width:38%"></div><div class="sp-skel" style="width:62%;height:20px;margin-top:10px"></div><div class="sp-skel" style="width:80%;margin-top:9px"></div></div>').join('') + '</div>';
  }

  /* ---------------------------------------------------------------- 只读安全模式 */

  /* 总开关：开启后一切写操作在浏览器侧就被拦掉，并把原因说清楚。
     后端也有自己的保护，这里是「防手滑」，不是安全边界。 */
  const READONLY_KEY = 'codescope.system-panel.readonly';

  function readOnlyMode() {
    try { return window.localStorage.getItem(READONLY_KEY) === '1'; } catch (_) { return false; }
  }

  function setReadOnly(on) {
    try { window.localStorage.setItem(READONLY_KEY, on ? '1' : '0'); } catch (_) {}
  }

  const READONLY_NOTE = '只读安全模式已开启：改名、移动、删除、新建、清理、重启等写操作都已禁用。在「设置」里可以关掉。';

  /* 写操作清单：只读模式下这些请求根本发不出去。 */
  const WRITE_ROUTES = /^\/(clean|restart|caches\/clean)|^\/files\/(mkdir|rename|move|trash|restore|purge|write|organize|upload|reveal|open)$/;

  function guardWrite(path, body) {
    if (!readOnlyMode()) return null;
    if (!WRITE_ROUTES.test(path.split('?')[0])) return null;
    return new Error('只读安全模式已开启，已阻止写操作：' + path.split('?')[0]);
  }

  /* ---------------------------------------------------------------- 命令面板 */

  /* ⌘K：一个入口同时找功能、文件、进程。调研结论里「性价比最高的便捷杠杆」。
     文件和进程并发查，谁先回来先渲染，不让一个慢查询卡住整个面板。 */
  const PALETTE = { open: false, items: [], index: 0, seq: 0 };

  function paletteFeatures() {
    const items = [];
    for (const section of SECTIONS) {
      for (const pair of section.views) {
        items.push({
          group: '功能', title: section.label + (section.views.length > 1 ? ' · ' + pair[1] : ''), why: '打开这个视图',
          run: () => { closePalette(); setView(pair[0]); },
        });
      }
    }
    if (!readOnlyMode()) {
      items.push({ group: '动作', title: '清理向导（先扫描再决定）', why: '存储 · 不会直接删', run: () => { closePalette(); setView('storage'); } });
      items.push({ group: '动作', title: '归类整理（先预演）', why: '文件 · 只动文件不动目录', run: () => { closePalette(); setView('files-organize'); } });
    }
    items.push({ group: '动作', title: '打开 VS Code', why: '宿主编辑器', run: () => { closePalette(); openVSCode(); } });
    items.push({ group: '动作', title: readOnlyMode() ? '关闭只读安全模式' : '开启只读安全模式', why: '设置 · 总开关', run: () => { setReadOnly(!readOnlyMode()); closePalette(); setView('settings'); toast('ok', readOnlyMode() ? '已开启只读安全模式' : '已关闭只读安全模式'); } });
    return items;
  }

  async function paletteSearch(query) {
    const text = String(query || '').trim();
    const features = paletteFeatures();
    if (!text) return features;
    const lower = text.toLowerCase();
    const head = features.filter((item) => (item.title + item.why).toLowerCase().includes(lower));
    const home = (state.overview && state.overview.identity && state.overview.identity.home) || '';
    const found = await Promise.all([
      home ? api('/files/search?path=' + encodeURIComponent(home) + '&q=' + encodeURIComponent(text) + '&recursive=1&limit=12')
        .then((data) => (data.matches || []).slice(0, 10).map((hit) => ({
          group: '文件', title: hit.name, why: hit.path,
          run: () => { closePalette(); setView('files'); window.setTimeout(() => filesView().navigateTo(hit.path.slice(0, hit.path.lastIndexOf('/')) || '/'), 60); },
        }))).catch(() => []) : Promise.resolve([]),
      api('/processes?sort=cpu&limit=250')
        .then((data) => (data.list || []).filter((proc) => ((proc.app || '') + ' ' + (proc.command || '')).toLowerCase().includes(lower)).slice(0, 8).map((proc) => ({
          group: '进程', title: (proc.app || String(proc.command || '').split('/').pop() || '?') + ' · PID ' + proc.pid,
          why: 'CPU ' + (Number(proc.cpu) || 0).toFixed(1) + '% · 内存 ' + fmtBytes(proc.rss),
          run: () => { closePalette(); setView('processes'); },
        }))).catch(() => []),
    ]);
    return head.concat(found[0], found[1]);
  }

  function renderPalette() {
    const list = $('system-palette-list');
    if (!list) return;
    if (!PALETTE.items.length) {
      list.innerHTML = '<div class="pgroup">没有匹配的结果</div>';
      return;
    }
    let lastGroup = '';
    list.innerHTML = PALETTE.items.map((item, position) => {
      const head = item.group !== lastGroup ? '<div class="pgroup">' + esc(item.group) + '</div>' : '';
      lastGroup = item.group;
      return head + '<button type="button" data-index="' + position + '"' + (position === PALETTE.index ? ' class="on"' : '') + '>' +
        esc(item.title) + '<span class="why">' + esc(item.why || '') + '</span></button>';
    }).join('');
  }

  async function refreshPalette() {
    const input = $('system-palette-input');
    const seq = (PALETTE.seq += 1);
    const items = await paletteSearch(input ? input.value : '');
    if (seq !== PALETTE.seq || !PALETTE.open) return;               // 慢查询回来时用户已经改了输入
    PALETTE.items = items;
    PALETTE.index = 0;
    renderPalette();
  }

  function openPalette() {
    const layer = $('system-palette-layer');
    if (!layer) return;
    PALETTE.open = true;
    layer.hidden = false;
    const input = $('system-palette-input');
    if (input) { input.value = ''; input.focus(); }
    refreshPalette();
  }

  function closePalette() {
    const layer = $('system-palette-layer');
    PALETTE.open = false;
    if (layer) layer.hidden = true;
  }

  function paletteMove(step) {
    if (!PALETTE.items.length) return;
    PALETTE.index = (PALETTE.index + step + PALETTE.items.length) % PALETTE.items.length;
    renderPalette();
    const active = $('system-palette-list') && $('system-palette-list').querySelector('button.on');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  /* ---------------------------------------------------------------- 文件视图接线 */

  /* 宿主契约：文件视图模块只做 UI，所有 IO 都通过这里注入（详见 src/system-files-view.js）。 */
  let FILES_VIEW = null;

  function openVSCode() {
    const button = document.querySelector('#btn-vscode, #vscode-launch, [data-open-vscode]');
    if (button && typeof button.click === 'function') { button.click(); return; }
    toast('warn', '没有找到打开 VS Code 的入口，可以在「运行时 · 开发环境」里看状态');
  }

  function filesView() {
    if (FILES_VIEW) return FILES_VIEW;
    FILES_VIEW = createFilesView({
      api: (path, body) => api(path, body),
      el: (tag, className, text) => el(tag, className, text),
      esc, fmtBytes, fmtTime, relTime, toast, askConfirm,
      canWrite: () => !readOnlyMode(),
      readonlyNote: () => READONLY_NOTE,
      openEditor: (path) => { toast('info', '已选中的文件：' + path + '（在系统默认程序里打开请用右键菜单）'); },
      upload: async (url, file) => {
        const response = await fetch(url, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
        return response.json();
      },
    });
    return FILES_VIEW;
  }

  let SOFTWARE_VIEW = null;

  function softwareView() {
    if (SOFTWARE_VIEW) return SOFTWARE_VIEW;
    SOFTWARE_VIEW = createSoftwareView({
      api: (path, body) => api(path, body),
      el: (tag, className, text) => el(tag, className, text),
      esc, fmtBytes, fmtTime, relTime, toast, askConfirm,
    });
    return SOFTWARE_VIEW;
  }

  let SCAN_VIEW = null;

  function scanView() {
    if (SCAN_VIEW) return SCAN_VIEW;
    SCAN_VIEW = createScanView({
      api: (path, body) => api(path, body),
      el: (tag, className, text) => el(tag, className, text),
      esc, fmtBytes, fmtTime, relTime, toast,
      get home() { return (state.identity && state.identity.home) || ''; },
      get user() { return (state.identity && state.identity.user) || ''; },
      openInFiles: (target) => {
        /* 点扫描结果里的路径 → 跳到「文件浏览」并定位过去 */
        setView('files');
        setTimeout(() => { try { filesView().navigateTo(target); } catch (_) { /* 忽略 */ } }, 40);
      },
    });
    return SCAN_VIEW;
  }

  let ENV_VIEW = null;

  function envView() {
    if (ENV_VIEW) return ENV_VIEW;
    ENV_VIEW = createEnvView({
      api: (path, body) => api(path, body),
      el: (tag, className, text) => el(tag, className, text),
      esc, fmtBytes, fmtTime, relTime, toast, askConfirm,
      /* 更新动作交给面板自己的任务控制台：同一套 SSE、同一套取消逻辑。 */
      startTask: (request) => startTask(request),
    });
    return ENV_VIEW;
  }

  let SYNC_VIEW = null;

  function syncView() {
    if (SYNC_VIEW) return SYNC_VIEW;
    SYNC_VIEW = createSyncView({
      api: (path, body) => api(path, body),
      el: (tag, className, text) => el(tag, className, text),
      esc, fmtTime, relTime, toast,
      /* 同步动作同样交给面板的任务控制台：实时输出、可取消，不需要视图自己长一套。 */
      startTask: (request) => startTask(request),
    });
    return SYNC_VIEW;
  }

  /* ---------------------------------------------------------------- 设置 */

  function renderSettings(body) {
    const identity = (state.overview && state.overview.identity) || {};
    const readOnly = readOnlyMode();
    body.innerHTML = '' +
      '<div class="sp-band"><h3>只读安全模式 <span class="sp-state ' + (readOnly ? 'warn' : 'ok') + '">' + (readOnly ? '已开启' : '未开启') + '</span></h3>' +
        '<label class="sp-check"><input type="checkbox" id="system-readonly"' + (readOnly ? ' checked' : '') + '> 开启后一切写操作在浏览器侧就被拦下</label>' +
        '<p class="sp-note">拦下的是：改名、移动、复制、删除、新建、归类整理、清理缓存、重启 CodeScope。' +
        '读操作（浏览、搜索、预览、统计）不受影响。这个开关存在本机浏览器里，不写服务器。</p>' +
      '</div>' +
      '<div class="sp-cols">' +
        '<div class="sp-band"><h3>这台电脑</h3><div class="sp-kv">' +
          [['主机名', identity.hostname], ['机型', identity.model], ['系统', (identity.osName || '') + ' ' + (identity.osVersion || '')],
           ['CPU', (identity.cpuModel || '') + ' · ' + (identity.cores || '?') + ' 核'], ['内存', fmtBytes(identity.totalMemory)],
           ['当前用户', identity.user], ['家目录', identity.home], ['Node', identity.node], ['已开机', fmtDuration(identity.uptime)]]
            .map((pair) => '<span class="k">' + esc(pair[0]) + '</span><span>' + esc(pair[1] == null ? '—' : String(pair[1])) + '</span>').join('') +
        '</div></div>' +
        '<div class="sp-band"><h3>关于面板</h3><div class="sp-kv">' +
          '<span class="k">版本</span><span>' + esc(window.CodeScopeSystemPanel ? window.CodeScopeSystemPanel.version : '—') + '</span>' +
          '<span class="k">后端</span><span>' + (state.backend && state.backend.ok ? '正常' : '未生效（需要重启一次 CodeScope）') + '</span>' +
          '<span class="k">快捷键</span><span>⌘K 打开命令面板 · / 聚焦搜索</span>' +
        '</div>' +
        '<div class="sp-actions" style="margin:12px 0 0">' +
          '<button class="sp-btn" id="system-settings-refresh" type="button">刷新全部数据</button>' +
        '</div></div>' +
        '<div class="sp-band"><h3>重启 CodeScope</h3>' +
          '<p class="sp-note">改了后端代码（lib/**、server.js）后需要重启一次才生效。重启只换进程，不动你的文件和设置。</p>' +
          '<div class="sp-actions" style="margin:10px 0 0"><button class="sp-btn danger" id="system-settings-restart" type="button">重启 CodeScope</button></div>' +
        '</div>' +
      '</div>';
    const toggle = $('system-readonly');
    if (toggle) toggle.onchange = () => {
      setReadOnly(toggle.checked);
      toast(toggle.checked ? 'warn' : 'ok', toggle.checked ? '已开启只读安全模式' : '已关闭只读安全模式');
      renderSettings(body);
    };
    const refreshAll = $('system-settings-refresh');
    if (refreshAll) refreshAll.onclick = () => { state.caches = []; refresh(true); toast('ok', '已刷新'); };
    const restart = $('system-settings-restart');
    if (restart) restart.onclick = async () => {
      if (readOnlyMode()) return toast('err', READONLY_NOTE);
      const yes = await askConfirm({
        title: '重启 CodeScope？',
        message: '当前正在运行的后台任务会中断，面板会短暂失联，随后自动恢复。不会影响你的文件、笔记与设置。',
        okLabel: '重启', danger: true,
      });
      if (!yes) return;
      try { await api('/restart', { ok: true }); toast('ok', '已发出重启指令，几秒后刷新页面即可'); }
      catch (error) { toast('err', String((error && error.message) || error)); }
    };
  }

  /* ---------------------------------------------------------------- 骨架事件 */

  /* 侧栏宽度：可拖拽调整并记住（双击手柄恢复默认）。
     和宿主左侧代码树是同一套手感：pointer capture + 整页 col-resize 光标；
     但**自己实现**而不复用宿主函数 —— 本机管家要能在拿不到宿主能力时独立可用。 */
  const NAV_W_KEY = 'codescope-system-nav-w';
  const NAV_W_DEFAULT = 198;
  const NAV_W_MIN = 160;
  const NAV_W_MAX = 420;

  function applyNavWidth(width, persist) {
    const nav = $('system-nav');
    if (!nav) return;
    const value = Math.max(NAV_W_MIN, Math.min(NAV_W_MAX, Math.round(Number(width) || NAV_W_DEFAULT)));
    nav.style.width = value + 'px';
    if (persist) { try { localStorage.setItem(NAV_W_KEY, String(value)); } catch (_) {} }
  }

  function restoreNavWidth() {
    try {
      const saved = parseInt(localStorage.getItem(NAV_W_KEY), 10);
      if (Number.isFinite(saved)) applyNavWidth(saved, false);
    } catch (_) {}
  }

  function wireNavResizer() {
    const handle = document.querySelector('#system-nav .nav-resizer');
    const nav = $('system-nav');
    if (!handle || !nav || handle.dataset.wired) return;
    handle.dataset.wired = '1';
    let start = null;
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      start = { x: event.clientX, width: nav.getBoundingClientRect().width };
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
      handle.classList.add('active');
      document.body.classList.add('sp-nav-resizing');
    });
    handle.addEventListener('pointermove', (event) => {
      if (!start) return;
      applyNavWidth(start.width + (event.clientX - start.x), true);
    });
    const end = () => {
      if (!start) return;
      start = null;
      handle.classList.remove('active');
      document.body.classList.remove('sp-nav-resizing');
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    /* 双击恢复默认宽度：拖窄了想快速还原时不用来回找位置 */
    handle.addEventListener('dblclick', () => applyNavWidth(NAV_W_DEFAULT, true));
  }

  function wireShellEvents() {
    const back = $('system-back'); if (back) back.onclick = () => close();
    const refreshButton = $('system-refresh'); if (refreshButton) refreshButton.onclick = () => refresh(true);
    const auto = $('system-auto');
    if (auto) {
      auto.checked = state.auto;
      auto.onchange = () => { state.auto = auto.checked; schedule(); };
    }
    const navList = $('system-nav-list');
    if (navList) {
      navList.onclick = (event) => {
        const button = event.target.closest('button[data-section]');
        if (!button) return;
        const section = SECTIONS.find((item) => item.id === button.dataset.section);
        if (section) setView(section.views[0][0]);
      };
    }
    const subnav = $('system-subnav');
    if (subnav) {
      subnav.onclick = (event) => {
        const button = event.target.closest('button[data-view]');
        if (button) setView(button.dataset.view);
      };
    }
    const paletteButton = $('system-palette');
    if (paletteButton) paletteButton.onclick = () => openPalette();
    const paletteLayer = $('system-palette-layer');
    if (paletteLayer) {
      paletteLayer.addEventListener('click', (event) => {
        if (event.target === paletteLayer) return closePalette();
        const hit = event.target.closest('button[data-index]');
        if (!hit) return undefined;
        const item = PALETTE.items[Number(hit.dataset.index)];
        if (item) item.run();
        return undefined;
      });
    }
    const paletteInput = $('system-palette-input');
    if (paletteInput) {
      paletteInput.oninput = () => refreshPalette();
      paletteInput.onkeydown = (event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); paletteMove(1); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); paletteMove(-1); }
        else if (event.key === 'Enter') {
          event.preventDefault();
          const item = PALETTE.items[PALETTE.index];
          if (item) item.run();
        } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePalette(); }
      };
    }
    const cancel = $('system-task-cancel');
    if (cancel) cancel.onclick = async () => { if (!state.taskId) return; try { await api('/tasks/' + state.taskId + '/cancel', { ok: true }); toast('warn', '已请求取消任务'); } catch (error) { toast('err', String(error.message || error)); } };
    const taskClose = $('system-task-close');
    if (taskClose) taskClose.onclick = () => { $('system-task').hidden = true; };
    /* 全局监听只能挂一次。wireShellEvents 每次打开面板都会执行，挂两次会让快捷键互相抵消
       （⌘K 刚打开又被另一个监听关掉），也会让文件视图的按键执行两遍（回车删除会删两次）。 */
    if (wireShellEvents.globalDone) return;
    wireShellEvents.globalDone = true;
    /* 快捷键：⌘K 命令面板、/ 聚焦搜索；文件视图里的键位交给模块自己处理。 */
    document.addEventListener('keydown', (event) => {
      if (!document.body.classList.contains(MODE)) return;
      const inField = event.target && typeof event.target.closest === 'function' && event.target.closest('input,textarea,select');
      window.__spTrace = (window.__spTrace || []); window.__spTrace.push('到达快捷键处理器 key=' + event.key + ' meta=' + event.metaKey + ' ctrl=' + event.ctrlKey + ' mode=' + document.body.classList.contains(MODE));
      if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        if (PALETTE.open) closePalette(); else openPalette();
        return;
      }
      if (PALETTE.open) return;                                     // 面板打开时输入框自己处理按键
      if (event.key === '/' && !inField) { event.preventDefault(); openPalette(); return; }
      if (FILES_VIEW && FILES_VIEW.isFilesView(state.tab) && !inField && FILES_VIEW.handleKey(event)) event.preventDefault();
    }, true);
    /* 别的内嵌工作区被打开时，本机管家要自己退出，避免两个工作区同时盖着。
       注意宿主按钮里往往还包着 <span>，所以必须用 closest 认「按钮」而不是 event.target。 */
    const OTHER_SELECTOR = OTHER_BUTTONS.map((id) => '#' + id).join(',');
    document.addEventListener('click', (event) => {
      if (!document.body.classList.contains(MODE)) return;
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      if (target.closest(OTHER_SELECTOR)) close();
    }, true);
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !document.body.classList.contains(MODE)) return;
      if (PALETTE.open) return;                                     // 命令面板自己吞掉 Esc
      if (event.target.closest('#system-task')) return;
      close();
    });
  }

  function schedule() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    if (!state.auto) return;
    state.timer = setInterval(() => {
      if (!document.body.classList.contains(MODE) || document.hidden || state.busy) return;
      refresh(false);
    }, state.tab === 'overview' ? 1500 : 4000);
  }

  /* 打开面板先探一次 /ping：后端没生效（比如改过 server.js 还没重启）时，
     直接给出「重启 CodeScope」这种可执行的说法，而不是让各个标签页各自报奇怪的错。 */
  async function ensureBackend() {
    try {
      const ping = await api('/ping');
      state.backend = { ok: true, version: ping.version || '' };
      return true;
    } catch (error) {
      state.backend = {
        ok: false,
        error: String((error && error.message) || error),
        missingRoute: !!(error && error.missingRoute),
        network: !!(error && error.network),
      };
      return false;
    }
  }

  function renderBackendBanner() {
    const body = $('system-body');
    if (!body) return;
    const info = state.backend || {};
    body.innerHTML = `
      <div class="sp-band">
        <h3>本机管家的后端接口还没生效</h3>
        <p class="sp-note">服务端返回：<code>${esc(info.error || '未知错误')}</code></p>
        <p class="sp-note">${info.missingRoute
          ? '本机管家的后端是 <code>lib/system-panel.js</code>，由 <code>server.js</code> 挂载 —— <b>改过 server.js 必须重启 CodeScope 才会生效</b>。重启后在浏览器刷新本页即可（前端资源是 no-cache，不用清缓存）。'
          : (info.network ? '连不上 CodeScope 后端，请确认服务进程还在运行。' : '请重启 CodeScope 后再试。')}</p>
        <div class="sp-actions">
          <button class="sp-btn primary" data-recheck="1">重新检测</button>
          ${info.missingRoute ? '' : '<button class="sp-btn" data-restart="1">重启 CodeScope</button>'}
          <span class="muted">${info.missingRoute ? '手动重启：在启动 CodeScope 的终端里按 Ctrl+C，再执行 node server.js；环境检测弹窗里也有一个可用的重启按钮。' : '打开面板期间每 5 秒自动重试一次'}</span>
        </div>
      </div>`;
    const button = body.querySelector('button[data-recheck]');
    if (button) button.onclick = () => retryBackend();
    /* 只有「后端在、只是这次请求失败」时才给重启按钮；接口本身不存在时按钮按不了，只会误导。 */
    const restartButton = body.querySelector('button[data-restart]');
    if (restartButton) restartButton.onclick = () => restartCore();
  }

  let backendTimer = null;
  function scheduleBackendRetry() {
    if (backendTimer) return;
    backendTimer = setInterval(async () => {
      if (!document.body.classList.contains(MODE)) { clearInterval(backendTimer); backendTimer = null; return; }
      if (await ensureBackend()) { clearInterval(backendTimer); backendTimer = null; await refresh(true); }
      else renderBackendBanner();
    }, 5000);
  }

  async function retryBackend() {
    if (await ensureBackend()) { if (backendTimer) { clearInterval(backendTimer); backendTimer = null; } await refresh(true); }
    else renderBackendBanner();
  }

  async function openPanel() {
    renderNav();
    renderSubnav();
    buildShell();
    try {
      /* 宿主自带的收尾：它只认 dsh/opencode/vscode 三种模式。 */
      if (typeof window.leaveEmbeddedWorkspaces === 'function') window.leaveEmbeddedWorkspaces(MODE);
      if (document.body.classList.contains('study-mode') && window.CodeScopeStudy) window.CodeScopeStudy.close();
      if (document.body.classList.contains('office-mode') && typeof window.closeOffice === 'function') await window.closeOffice();
      if (document.body.classList.contains('reading-mode') && typeof window.closeReading === 'function') window.closeReading();
      if (document.body.classList.contains('drawing-mode') && typeof window.closeDrawEditor === 'function') await window.closeDrawEditor(true);
      /* 知识库工作区走它自己的关闭函数；宿主那个 MutationObserver 的白名单里没有
         system-mode，所以不会替我们收 —— 这里必须自己叫一声。 */
      if (document.body.classList.contains('knowledge-mode')) {
        if (typeof window.closeKnowledgeWorkspace === 'function') window.closeKnowledgeWorkspace();
        else { document.body.classList.remove('knowledge-mode'); const kb = $('btn-knowledge-launch'); if (kb) { kb.classList.remove('on'); kb.setAttribute('aria-pressed', 'false'); } }
      }
    } catch (_) { /* 宿主没这些模式也无所谓 */ }
    /* 最后一道保险：不管上面谁没收干净，都不能留下别的模式类 ——
       否则兜底 CSS 会把本机管家藏起来，用户点了按钮却像没反应。 */
    for (const residue of OTHER_MODES) if (residue !== MODE) document.body.classList.remove(residue);
    document.body.classList.add(MODE);
    const button = $('btn-system');
    if (button) { button.classList.add('on'); button.setAttribute('aria-pressed', 'true'); }
    state.auto = $('system-auto') ? $('system-auto').checked : true;
    loadHistory();
    schedule();
    if (!(await ensureBackend())) {
      renderBackendBanner();
      scheduleBackendRetry();
      return;
    }
    await refresh(true);
    /* 历史点不够就先补两次：曲线在 1 秒内成形，而不是留一块空白让人以为坏了。 */
    if (state.history.cpu.length < 3) primeHistory();
  }

  function close() {
    closePalette();
    if (FILES_VIEW) { try { FILES_VIEW.onPanelClosed(); } catch (_) {} }
    document.body.classList.remove(MODE);
    const button = $('btn-system');
    if (button) { button.classList.remove('on'); button.setAttribute('aria-pressed', 'false'); }
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    if (backendTimer) { clearInterval(backendTimer); backendTimer = null; }
  }

  /* ---------------------------------------------------------------- 刷新与分发 */

  function busyTyping() {
    const body = $('system-body');
    if (!body) return false;
    const active = document.activeElement;
    if (!active || !body.contains(active)) return false;
    return active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT';
  }

  async function refresh(force) {
    if (!state.built) return;
    const body = $('system-body');
    if (!body) return;
    /* 后端已知不可用时不要再打自动刷新：那只会每 1.5 秒刷出一个 404，
       还把横幅上的原因从 /ping 覆盖成 /overview。重试统一交给 5 秒那个定时器。 */
    if (state.backend && state.backend.ok === false) return;
    /* 自动刷新时不要在用户正打字时重绘，否则输入框会被清空。 */
    if (!force && busyTyping()) return;
    try {
      if (state.tab === 'overview') {
        state.overview = requireShape(await api('/overview'), ['cpu', 'memory', 'disks', 'identity'], '总览');
        pushHistory(state.overview);
        renderOverview(body);
        setHeadStatus();
      } else if (state.tab === 'processes') {
        state.processes = requireShape(await api('/processes?sort=' + encodeURIComponent(state.processSort) + '&limit=60'), ['list', 'groups', 'total'], '进程');
        renderProcesses(body);
      } else if (state.tab === 'storage') {
        if (!state.caches.length) { try { const data = requireShape(await api('/caches'), ['targets'], '缓存'); state.caches = data.targets || []; state.cacheScanAt = data.scannedAt || 0; } catch (_) {} }
        renderStorage(body);
      } else if (state.tab === 'software') {
        state.software = requireShape(await api('/software'), ['brew'], '软件');
        renderSoftware(body);
      } else if (state.tab === 'services') {
        state.services = requireShape(await api('/services'), ['brew', 'agents', 'ports'], '服务与端口');
        renderServices(body);
      } else if (state.tab === 'docker') {
        state.docker = requireShape(await api('/docker'), ['state'], 'Docker');
        renderDocker(body);
      } else if (state.tab === 'dev') {
        state.dev = requireShape(await api('/dev'), ['config', 'versions', 'repos'], '开发环境');
        renderDev(body);
      } else if (state.tab === 'settings') {
        renderSettings(body);
      } else if (filesView().isFilesView(state.tab)) {
        if (state.mountedKey !== state.tab) { FILES_VIEW.mount(body, state.tab); state.mountedKey = state.tab; }
        setHeadStatus();
      } else if (softwareView().isSoftwareView(state.tab)) {
        if (state.mountedKey !== state.tab) { SOFTWARE_VIEW.mount(body); state.mountedKey = state.tab; }
        setHeadStatus();
      } else if (scanView().isScanView(state.tab)) {
        if (state.mountedKey !== state.tab) { SCAN_VIEW.mount(body, state.tab); state.mountedKey = state.tab; }
      } else if (envView().isEnvView(state.tab)) {
        if (state.mountedKey !== state.tab) { ENV_VIEW.mount(body); state.mountedKey = state.tab; }
      } else if (syncView().isSyncView(state.tab)) {
        if (state.mountedKey !== state.tab) { SYNC_VIEW.mount(body); state.mountedKey = state.tab; }
      }
    } catch (error) {
      if (error && error.missingRoute) {
        state.backend = { ok: false, error: String(error.message || error), missingRoute: true };
        renderBackendBanner();
        scheduleBackendRetry();
        return;
      }
      body.innerHTML = '<div class="sp-band"><h3 class="sp-warn">读取失败</h3><p class="sp-note">' + esc((error && error.message) || error) + '</p></div>';
    }
  }

  function render() { return refresh(true); }

  function setHeadStatus() {
    const node = $('system-head-status');
    const data = state.overview;
    if (!node || !data) return;
    node.textContent = data.identity.hostname + ' · 运行 ' + fmtDuration(data.identity.uptime) + ' · 更新于 ' + new Date(data.ts).toLocaleTimeString();
  }

  function pushHistory(data) {
    state.history.cpu.push(Number(data && data.cpu && data.cpu.usage) || 0);
    state.history.mem.push(Number(data && data.memory && data.memory.usage) || 0);
    /* 采样时间戳：曲线下方的横轴要标出「这段是从几点到几点」，
       没有时间戳就只能画一条没有刻度的线（1Panel 的监控区就是带时间轴的）。 */
    state.history.ts.push(Date.now());
    for (const key of ['cpu', 'mem', 'ts']) if (state.history[key].length > 90) state.history[key].shift();
    saveHistory();
  }

  /* 使用率 → 语义色（卡片大数字用）。低于 70 保持中性，70~85 提醒，85 以上告警。 */
  function levelClass(percent) {
    const value = Number(percent) || 0;
    return value >= 85 ? ' crit' : value >= 70 ? ' warn' : '';
  }

  /* 环形仪表（对齐 1Panel 首页那种圆环）：底环 + 进度弧 + 中心大数字。
     为什么比一根横条直观：百分比是个「占满程度」的量，圆环的弧长天然表达它，
     而且三张卡并排时环的大小一致，一眼就能横向比较谁更吃紧。
     stroke-dasharray/offset 是 SVG 画进度弧的标准做法；rotate(-90) 让弧从 12 点方向起画。 */
  function gauge(percent, caption) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    const radius = 42;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - value / 100);
    const cls = levelClass(value);
    return '<div class="sp-gauge-ring' + cls + '">' +
      '<svg viewBox="0 0 100 100" aria-hidden="true">' +
        '<circle class="track" cx="50" cy="50" r="' + radius + '"/>' +
        '<circle class="value" cx="50" cy="50" r="' + radius + '"' +
          ' stroke-dasharray="' + circumference.toFixed(1) + '"' +
          ' stroke-dashoffset="' + offset.toFixed(1) + '"' +
          ' transform="rotate(-90 50 50)"/>' +
      '</svg>' +
      '<div class="sp-gauge-center">' +
        '<span class="v"><b>' + (value < 10 ? value.toFixed(1) : value.toFixed(0)) + '</b><small>%</small></span>' +
        '<em>' + esc(caption || '') + '</em>' +
      '</div></div>';
  }

  /* 曲线：网格基线 + 面积填充 + 系列配色。
     三个要点：
     ① 点数不足时也要给一张「有底」的图（网格 + 采集提示），否则首屏是一片空白；
     ② 面积填充（.fill）之前只有样式、没有几何，等于白定义；
     ③ preserveAspectRatio=none 会把线宽也拉变形，靠 vector-effect=non-scaling-stroke 固定线宽。 */
  const SPARK_H = 46;
  const SPARK_GRID = [0.25, 0.5, 0.75].map((ratio) =>
    '<line class="grid" x1="0" y1="' + (SPARK_H * ratio).toFixed(1) + '" x2="100" y2="' + (SPARK_H * ratio).toFixed(1) + '" vector-effect="non-scaling-stroke"/>').join('');
  function sparkline(values, series) {
    const cls = 'sp-spark' + (series === 'mem' ? ' mem' : '');
    const head = '<svg class="' + cls + '" viewBox="0 0 100 ' + SPARK_H + '" preserveAspectRatio="none" aria-hidden="true">' + SPARK_GRID;
    if (!values || values.length < 2) return head + '</svg>';
    const pad = 2;
    const points = values.map((value, index) => {
      const x = index / (values.length - 1) * 100;
      const y = SPARK_H - pad - Math.max(0, Math.min(1, (Number(value) || 0) / 100)) * (SPARK_H - pad * 2);
      return x.toFixed(2) + ',' + y.toFixed(2);
    }).join(' ');
    return head + '<polygon class="fill" points="0,' + SPARK_H + ' ' + points + ' 100,' + SPARK_H + '"/>' +
      '<polyline points="' + points + '" vector-effect="non-scaling-stroke"/></svg>';
  }

  /* 曲线下方的时间轴：左/中/右三个刻度，回答「这条线覆盖的是哪段时间」。 */
  function sparkAxis(timestamps) {
    if (!timestamps || timestamps.length < 2) return '';
    const fmt = (value) => {
      const date = new Date(value);
      return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    };
    const first = timestamps[0];
    const last = timestamps[timestamps.length - 1];
    const mid = timestamps[Math.floor(timestamps.length / 2)];
    return '<div class="sp-axis"><span>' + fmt(first) + '</span><span>' + fmt(mid) + '</span><span>' + fmt(last) + '</span></div>';
  }

  /* 曲线下的一行统计：当前 / 均值 / 峰值。数字比一条线更能说明「稳不稳」。 */
  function sparkStats(values) {
    if (!values || values.length < 2) return '<div class="sp-stats"><span>采集中…</span></div>';
    const sum = values.reduce((acc, value) => acc + (Number(value) || 0), 0);
    return '<div class="sp-stats"><span>当前 <b>' + values[values.length - 1].toFixed(1) + '%</b></span>' +
      '<span>均值 <b>' + (sum / values.length).toFixed(1) + '%</b></span>' +
      '<span>峰值 <b>' + Math.max(...values).toFixed(1) + '%</b></span></div>';
  }

  /* 采样历史持久化：关掉面板再打开（或刷新页面）曲线还在，不用从零等 3 秒。 */
  const HISTORY_KEY = 'codescope-system-history';
  function loadHistory() {
    try {
      const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || 'null');
      if (!saved) return;
      if (Array.isArray(saved.cpu)) state.history.cpu = saved.cpu.filter((v) => Number.isFinite(v)).slice(-90);
      if (Array.isArray(saved.mem)) state.history.mem = saved.mem.filter((v) => Number.isFinite(v)).slice(-90);
      if (Array.isArray(saved.ts)) state.history.ts = saved.ts.filter((v) => Number.isFinite(v)).slice(-90);
    } catch (_) {}
  }
  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify({
        cpu: state.history.cpu.slice(-90), mem: state.history.mem.slice(-90), ts: state.history.ts.slice(-90),
      }));
    } catch (_) {}
  }

  /* 首屏补点：进面板时若历史点太少，连着补两次，曲线 1 秒内就出来，而不是空白等 3 秒。 */
  function primeHistory() {
    let round = 0;
    const tick = () => {
      if (round >= 2 || !document.body.classList.contains(MODE) || document.hidden) return;
      round += 1;
      refresh(false).finally(() => setTimeout(tick, 420));
    };
    setTimeout(tick, 420);
  }

  /* ---------------------------------------------------------------- 总览 */

    function renderOverview(body) {
    const data = state.overview;
    if (!data) { body.innerHTML = '<div class="sp-empty">正在读取…</div>'; return; }
    const cpu = data.cpu || {};
    const memory = data.memory || {};
    const swap = data.swap;
    const disk = data.primaryDisk;
    const loadPercent = (cpu.loadPercent || []).map((v) => Number(v) || 0);
    const loadText = (cpu.load || []).map((v) => (Number(v) || 0).toFixed(2)).join(' / ');
    const cores = (cpu.perCore || []).map((value) => '<div class="sp-core" title="核心 ' + Number(value).toFixed(0) + '%"><i style="height:' + Math.max(2, Math.min(100, Number(value))).toFixed(1) + '%"></i></div>').join('');

    /* 温度单元：读得到就给温度环，读不到就明确说「不可读」并把热压力摆出来 —— 不编数字。 */
    const thermal = data.thermal;
    const hasTemp = thermal && thermal.available && thermal.celsius != null;
    const tempLevel = hasTemp ? (thermal.celsius >= 80 ? ' hot' : thermal.celsius >= 60 ? ' warm' : '') : '';
    const pressureText = { normal: '热压力正常', high: '热压力偏高', unknown: '热压力未知' }[(thermal && thermal.pressure) || 'unknown'] || '';
    const tempCell = '<div class="sp-gcell' + tempLevel + '" title="' + esc((thermal && thermal.hint) || '') + '">' +
      (hasTemp ? gauge(thermal.celsius, '') : '<div class="sp-gauge-ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="42"/></svg><div class="sp-gauge-center"><span class="v"><b>—</b></span></div></div>') +
      '<div class="sp-gcap">温度</div>' +
      '<div class="sp-gsub">' + (hasTemp ? Number(thermal.celsius).toFixed(1) + ' ℃<br>' + esc(pressureText) : esc(pressureText) + '<br>温度暂不可读') + '</div>' +
      '</div>';

    body.innerHTML = `
      <div class="sp-ov">
        <div class="sp-ov-main">
          <section class="sp-sec">
            <h3>状态<span class="sp-hint">实时 · 每 1.5 秒刷新</span></h3>
            <div class="sp-gauges">
              <div class="sp-gcell">
                ${gauge(cpu.usage, '')}
                <div class="sp-gcap">CPU</div>
                <div class="sp-gsub">${cpu.cores} 核<br>负载 ${loadText || '—'}</div>
                <div class="sp-cores">${cores}</div>
              </div>
              <div class="sp-gcell">
                ${gauge(memory.usage, '')}
                <div class="sp-gcap">内存</div>
                <div class="sp-gsub">已用 ${fmtBytes(memory.used)}<br>共 ${fmtBytes(memory.total)}</div>
              </div>
              <div class="sp-gcell">
                ${gauge(disk ? disk.capacity : 0, '')}
                <div class="sp-gcap">主磁盘</div>
                <div class="sp-gsub">可用 ${disk ? fmtBytes(disk.free) : '—'}<br>共 ${disk ? fmtBytes(disk.total) : '—'}</div>
              </div>
              <div class="sp-gcell">
                ${gauge(loadPercent.length ? loadPercent[0] : 0, '')}
                <div class="sp-gcap">负载</div>
                <div class="sp-gsub">每核 ${loadPercent.length ? loadPercent[0].toFixed(0) + '%' : '—'}<br>1 / 5 / 15 分钟</div>
              </div>
              ${tempCell}
            </div>
            ${disk && Number(disk.capacity) >= 90
              ? '<p class="sp-note sp-warn">主磁盘已用 ' + Number(disk.capacity).toFixed(0) + '%，去「存储」清理一下缓存与大文件。</p>'
              : ''}
          </section>

          <section class="sp-sec">
            <h3>监控<span class="sp-hint">最近 ${state.history.cpu.length} 次采样 · 每 1.5 秒一次</span></h3>
            <div class="sp-cols">
              <div><div class="sp-row"><span class="k">CPU</span><span class="v">${(Number(cpu.usage) || 0).toFixed(1)}%</span></div>${sparkline(state.history.cpu, 'cpu')}${sparkAxis(state.history.ts)}${sparkStats(state.history.cpu)}</div>
              <div><div class="sp-row"><span class="k">内存</span><span class="v">${(Number(memory.usage) || 0).toFixed(1)}%</span></div>${sparkline(state.history.mem, 'mem')}${sparkAxis(state.history.ts)}${sparkStats(state.history.mem)}</div>
            </div>
          </section>

          <section class="sp-sec">
            <h3>磁盘卷<span class="sp-hint">含外接与网络卷</span></h3>
            <div class="sp-list">
              ${(data.disks || []).map((item) => `
                <div class="sp-li">
                  <span class="grow" title="${esc(item.mount)}">${esc(item.mount)} <span class="muted">${esc(item.device)}</span></span>
                  <span class="muted">${fmtBytes(item.free)} 可用 / ${fmtBytes(item.total)}</span>
                  <span class="barwrap">${bar(item.capacity, '容量 ' + item.capacity + '%')}</span>
                  <span class="num cap${levelClass(item.capacity)}">${Number(item.capacity).toFixed(0)}%</span>
                  <button class="sp-btn sp-rowbtn" data-reveal="${esc(item.mount)}">在访达显示</button>
                </div>`).join('') || '<div class="sp-empty">没有读到磁盘</div>'}
            </div>
          </section>
        </div>

        <aside class="sp-ov-side">
          <section class="sp-sec">
            <h3>系统信息</h3>
            <div class="sp-kv">
              <span class="k">主机</span><span>${esc(data.identity.hostname)}</span>
              <span class="k">用户</span><span>${esc(data.identity.user)}</span>
              <span class="k">系统</span><span>${esc(data.identity.osName)} ${esc(data.identity.osVersion)}</span>
              <span class="k">型号</span><span>${esc(data.identity.model || '—')}</span>
              <span class="k">架构</span><span>${esc(data.identity.arch)}</span>
              <span class="k">已运行</span><span>${fmtDuration(data.identity.uptime)}</span>
              <span class="k">开机于</span><span>${esc(fmtTime(data.identity.bootAt))}</span>
              <span class="k">Node</span><span>${esc(data.identity.node)}</span>
              ${data.battery ? '<span class="k">电池</span><span>' + data.battery.percent + '%' + (data.battery.charging ? '（供电中）' : '') + (data.battery.remaining ? ' · 剩余 ' + esc(data.battery.remaining) : '') + '</span>' : ''}
            </div>
          </section>
          <section class="sp-sec">
            <h3>快捷操作</h3>
            <div class="sp-actions sp-actions-stack">
              <button class="sp-btn primary" data-goto="storage">去清理磁盘 / 缓存</button>
              <button class="sp-btn" data-goto="processes">看谁在吃 CPU</button>
              <button class="sp-btn" data-goto="software">检查软件更新</button>
              <button class="sp-btn" data-goto="docker">Docker 状态</button>
            </div>
          </section>
        </aside>
      </div>`;
    body.querySelectorAll('button[data-goto]').forEach((button) => { button.onclick = () => setView(button.dataset.goto); });
    body.querySelectorAll('button[data-reveal]').forEach((button) => { button.onclick = () => reveal(button.dataset.reveal); });
  }


  async function reveal(target) {
    try { await api('/reveal', { path: target }); }
    catch (error) { toast('err', String(error.message || error)); }
  }

  /* ---------------------------------------------------------------- 进程 */

  function renderProcesses(body) {
    const data = state.processes;
    if (!data) { body.innerHTML = '<div class="sp-empty">正在读取进程…</div>'; return; }
    const query = state.processQuery.trim().toLowerCase();
    const all = (data.list || []).filter((item) => !query || (item.app + ' ' + item.command).toLowerCase().includes(query));
    const groups = (data.groups || []).filter((item) => !query || item.app.toLowerCase().includes(query));
    const rows = query ? all : all.slice(0, state.processLimit);
    const byMemory = state.processSort === 'mem';
    const top = all[0];
    const peak = byMemory ? Math.max(1, ...all.map((item) => item.rss || 0)) : Math.max(1, ...all.map((item) => item.cpu || 0));
    /* 结论条：先给答案，再给表格。用户要的是「谁在吃资源」，不是 60 行原始数据。 */
    const summary = top
      ? '<div class="sp-summary"><b>' + esc(top.app) + '</b> 最占' + (byMemory ? '内存' : ' CPU') +
        '（' + (byMemory ? fmtBytes(top.rss) : top.cpu.toFixed(1) + '%') + '）' +
        '<span class="muted">· 这台机器上共 ' + data.total + ' 个进程，占用高的就这几个</span></div>'
      : '';
    body.innerHTML = `
      ${summary}
      <div class="sp-actions">
        <button class="sp-btn${byMemory ? '' : ' on'}" data-sort="cpu">按 CPU 排</button>
        <button class="sp-btn${byMemory ? ' on' : ''}" data-sort="mem">按内存排</button>
        <input class="sp-input" id="system-proc-query" placeholder="搜进程名（例如 chrome、node）" value="${esc(state.processQuery)}" style="min-width:200px">
        <span class="muted">共 ${data.total} 个进程</span>
      </div>
      <div class="sp-cols">
        <div class="sp-band">
          <h3>占用最高的进程${query ? '（搜索结果 ' + all.length + ' 条）' : ''}<span class="sp-hint">鼠标停在行上可看完整信息</span></h3>
          <div class="sp-plist">
            ${rows.map((item) => {
              const note = describeProcess(item.app, item.command);
              const value = byMemory ? item.rss : item.cpu;
              const pct = Math.max(1, Math.min(100, value / peak * 100));
              return `
              <div class="sp-pitem" title="PID ${item.pid} · 用户 ${esc(item.user)} · 已运行 ${esc(item.elapsed)}\n${esc(item.command)}">
                <div class="sp-pmain">
                  <div class="sp-pname">${esc(item.app)}</div>
                  ${note ? '<div class="sp-pnote">' + esc(note) + '</div>' : ''}
                </div>
                <div class="sp-pbar">${bar(pct, '')}</div>
                <div class="sp-pnum">
                  <b>${byMemory ? fmtBytes(item.rss) : item.cpu.toFixed(1) + '%'}</b>
                  <span class="muted">${byMemory ? item.cpu.toFixed(1) + '% CPU' : fmtBytes(item.rss)}</span>
                </div>
                <button class="sp-btn danger sp-rowbtn" data-kill="${item.pid}" data-app="${esc(item.app)}">结束</button>
              </div>`;
            }).join('') || '<div class="sp-empty">没有匹配的进程</div>'}
          </div>
          ${!query && all.length > state.processLimit
            ? '<div class="sp-actions"><button class="sp-btn" data-more="' + (state.processLimit >= 60 ? 10 : 60) + '">' + (state.processLimit >= 60 ? '收起，只看前 10 个' : '显示更多（共 ' + Math.min(60, all.length) + ' 个占用较高的）') + '</button></div>'
            : ''}
        </div>
        <div class="sp-band">
          <h3>按应用合并<span class="sp-hint">同一个 App 的多个进程算在一起</span></h3>
          <div class="sp-plist">${groups.slice(0, 12).map((item) => {
            const note = describeProcess(item.app, item.app);
            const pct = Math.max(1, Math.min(100, byMemory ? item.rss / 17179869184 * 100 : item.cpu));
            return `
            <div class="sp-pitem">
              <div class="sp-pmain">
                <div class="sp-pname">${esc(item.app)} <span class="muted">×${item.count}</span></div>
                ${note ? '<div class="sp-pnote">' + esc(note) + '</div>' : ''}
              </div>
              <div class="sp-pbar">${bar(pct, '')}</div>
              <div class="sp-pnum"><b>${item.cpu.toFixed(1)}%</b><span class="muted">${fmtBytes(item.rss)}</span></div>
            </div>`;
          }).join('') || '<div class="sp-empty">无</div>'}</div>
        </div>
      </div>`;
    body.querySelectorAll('button[data-sort]').forEach((button) => {
      button.onclick = () => { state.processSort = button.dataset.sort === 'mem' ? 'mem' : 'cpu'; state.processLimit = 10; refresh(true); };
    });
    body.querySelectorAll('button[data-more]').forEach((button) => {
      button.onclick = () => { state.processLimit = Number(button.dataset.more) || 10; renderProcesses(body); };
    });
    body.querySelectorAll('button[data-kill]').forEach((button) => {
      button.onclick = () => killPid(Number(button.dataset.kill), button.dataset.app);
    });
  }

  async function killPid(pid, app) {
    if (!pid) return;
    const ok = await askConfirm({
      title: '结束进程',
      message: '要结束 ' + app + '（PID ' + pid + '）吗？\n\n先发 SIGTERM 让它自己收尾；没退出的话可以再选强制结束。',
      okLabel: '结束进程', danger: true,
    });
    if (!ok) return;
    try {
      await api('/process/kill', { pid, signal: 'SIGTERM' });
      toast('ok', '已向 ' + app + '（PID ' + pid + '）发送 SIGTERM');
      setTimeout(() => refresh(true), 700);
    } catch (error) {
      const force = await askConfirm({
        title: '结束失败，要强制结束吗？',
        message: String(error.message || error) + '\n\nSIGKILL 不会给它保存数据的机会。',
        okLabel: '强制结束', danger: true,
      });
      if (!force) return;
      try { await api('/process/kill', { pid, signal: 'SIGKILL' }); toast('ok', '已强制结束 PID ' + pid); setTimeout(() => refresh(true), 700); }
      catch (second) { toast('err', String(second.message || second)); }
    }
  }

  /* ---------------------------------------------------------------- 存储与清理 */

  function selectedCacheIds() { return state.caches.filter((item) => item.selected).map((item) => item.id); }

  /* 清理项里有父子关系（例如 ~/Library/Caches 与它下面的 Homebrew 缓存），
     直接相加会把同一块空间算两遍。这里把被父项覆盖的子项剔掉再求和，
     免得用户照着一个虚高的数字做决定。 */
  function dedupedSize(list) {
    const norm = (value) => String(value || '').trim().replace(/\/+$/, '');
    const paths = list.map((item) => norm(item.path)).filter(Boolean);
    const counted = new Set();
    return list.reduce((sum, item) => {
      if (!item.size) return sum;
      const mine = norm(item.path);
      if (mine) {
        /* 同一个路径可能出现两次（brew-cache 与 homebrew-downloads 就是同一个目录），只算一次。 */
        if (counted.has(mine)) return sum;
        counted.add(mine);
        /* 如果列表里还有它的父目录，那这块空间已经计入父目录了，跳过。 */
        if (paths.some((other) => other !== mine && mine.startsWith(other + '/'))) return sum;
      }
      return sum + item.size;
    }, 0);
  }

  function renderStorage(body) {
    const data = state.overview;
    const disks = (data && data.disks) || [];
    const caches = state.caches || [];
    const total = dedupedSize(caches);
    const picked = caches.filter((item) => item.selected);
    const pickedSize = dedupedSize(picked);
    body.innerHTML = `
      <div class="sp-cards">
        ${disks.slice(0, 3).map((item) => `
          <div class="sp-card">
            <h4>${esc(item.mount)}</h4>
            <div class="big">${fmtBytes(item.free)} 可用</div>
            <div class="sub">共 ${fmtBytes(item.total)} · 已用 ${fmtBytes(item.used)}</div>
            ${bar(item.capacity)}
            <div class="sp-actions" style="margin:9px 0 0"><button class="sp-btn" data-reveal="${esc(item.mount)}">在访达显示</button></div>
          </div>`).join('') || '<div class="sp-card"><h4>磁盘</h4><div class="sub">读取中…</div></div>'}
      </div>
      <div class="sp-band">
        <h3>缓存与可回收空间${state.cacheScanAt ? ' <span class="muted">· 统计于 ' + esc(relTime(state.cacheScanAt)) + '</span>' : ''}</h3>
        <p class="sp-note">${caches.length ? '合计约 <b id="system-cache-total" data-bytes="' + total + '">' + fmtBytes(total) + '</b>（父子目录已去重，不会把同一块空间算两遍）；已勾选 <b>' + picked.length + '</b> 项，约 <b id="system-cache-picked" data-bytes="' + pickedSize + '">' + fmtBytes(pickedSize) + '</b>。' : '还没有统计过。点「统计占用」会真实遍历这些目录（大目录可能要几十秒，会显示在这里）。'}</p>
        <div class="sp-actions">
          <button class="sp-btn" data-scan="1">统计占用</button>
          <button class="sp-btn" data-clean-dry="1"${picked.length ? '' : ' disabled'}>预览清理（不删东西）</button>
          <button class="sp-btn danger" data-clean="1"${picked.length ? '' : ' disabled'}>立即清理选中项</button>
          <button class="sp-btn" data-pick="low">只选低风险</button>
          <button class="sp-btn" data-pick="none">全不选</button>
        </div>
        <table class="sp-table"><thead><tr><th style="width:34px"></th><th>项目</th><th>风险</th><th class="num">占用</th><th>说明</th><th></th></tr></thead>
        <tbody>${caches.map((item) => `
          <tr data-bytes="${Number(item.size) || 0}" data-path="${esc(item.path || '')}">
            <td><input type="checkbox" data-cache="${esc(item.id)}"${item.selected ? ' checked' : ''}></td>
            <td>${esc(item.label)}<div class="muted mono ellip" title="${esc(item.path)}">${esc(item.path || '（官方清理命令）')}</div></td>
            <td><span class="sp-tag ${esc(item.risk)}">${item.risk === 'low' ? '低' : item.risk === 'medium' ? '中' : '高'}</span></td>
            <td class="num">${item.size == null ? '<span class="muted">' + (item.timedOut ? '统计超时' : item.exists === false ? '不存在' : '未统计') + '</span>' : fmtBytes(item.size)}</td>
            <td class="muted">${esc(item.note || '')}</td>
            <td>${item.kind === 'dir' && item.exists ? '<button class="sp-btn" data-reveal="' + esc(item.path) + '">显示</button>' : ''}</td>
          </tr>`).join('') || '<tr><td colspan="6" class="sp-empty">尚未统计</td></tr>'}</tbody></table>
        <p class="sp-note">「官方清理命令」走软件自带的清理方式（brew cleanup -s、npm cache clean、pnpm store prune…），比直接删目录稳妥；「目录」类只删除上表里写死的那个绝对路径，接口不接受任意路径。</p>
      </div>
      <div class="sp-cols">
        <div class="sp-band">
          <h3>目录占用<span class="sp-hint">一级子目录</span></h3>
          <div class="sp-actions">
            <input class="sp-input" id="system-usage-root" value="${esc(state.usageRoot)}" placeholder="绝对路径，如 /Users/you" style="min-width:250px">
            <button class="sp-btn" data-usage="1">开始扫描</button>
          </div>
          <div class="sp-list">${((state.usage && state.usage.items) || []).map((item) => `
            <div class="sp-li">
              <span class="grow" title="${esc(item.path)}">${item.dir ? '📁' : '📄'} ${esc(item.name)}</span>
              <span class="barwrap">${bar(state.usage.total ? item.size / state.usage.total * 100 : 0, '')}</span>
              <span class="num" style="width:84px;text-align:right">${fmtBytes(item.size)}</span>
              <button class="sp-btn" data-reveal="${esc(item.path)}">显示</button>
            </div>`).join('') || '<div class="sp-empty">选一个目录扫描，看看空间去哪儿了</div>'}</div>
        </div>
        <div class="sp-band">
          <h3>大文件</h3>
          <div class="sp-actions">
            <input class="sp-input" id="system-large-root" value="${esc(state.largeRoot)}" placeholder="绝对路径" style="min-width:190px">
            <input class="sp-input" id="system-large-min" value="200" style="width:76px" title="只列大于多少 MB 的文件">
            <button class="sp-btn" data-large="1">找出大文件</button>
          </div>
          <div class="sp-list">${((state.large && state.large.items) || []).map((item) => `
            <div class="sp-li">
              <span class="grow" title="${esc(item.path)}">${esc(item.name)}<span class="muted"> · ${esc(relTime(item.mtime))}</span></span>
              <span class="num" style="width:84px;text-align:right">${fmtBytes(item.size)}</span>
              <button class="sp-btn" data-reveal="${esc(item.path)}">显示</button>
            </div>`).join('') || '<div class="sp-empty">还没有扫描</div>'}
            ${state.large && state.large.truncated ? '<p class="sp-note sp-warn">目录太大，这次只扫描了一部分（' + state.large.scanned + ' 个条目）。</p>' : ''}
          </div>
        </div>
      </div>`;
    body.querySelectorAll('button[data-reveal]').forEach((button) => { button.onclick = () => reveal(button.dataset.reveal); });
    body.querySelectorAll('input[data-cache]').forEach((box) => {
      box.onchange = () => {
        const item = state.caches.find((entry) => entry.id === box.dataset.cache);
        if (item) item.selected = box.checked;
        renderStorage(body);
      };
    });
    const scan = body.querySelector('button[data-scan]');
    if (scan) scan.onclick = () => startTask(() => api('/caches/scan', {}));
    const dry = body.querySelector('button[data-clean-dry]');
    if (dry) dry.onclick = () => startTask(() => api('/clean', { ids: selectedCacheIds(), dryRun: true }));
    const clean = body.querySelector('button[data-clean]');
    if (clean) clean.onclick = async () => {
      const ids = selectedCacheIds();
      if (!ids.length) return;
      const risky = picked.filter((item) => item.risk !== 'low');
      const ok = await askConfirm({
        title: '清理 ' + picked.length + ' 项（约 ' + fmtBytes(pickedSize) + '）',
        message: picked.map((item) => '· ' + item.label + '（' + (item.size == null ? '未知' : fmtBytes(item.size)) + '）').join('\n') +
          (risky.length ? '\n\n注意：其中 ' + risky.length + ' 项是中/高风险（' + risky.map((item) => item.label).join('、') + '），请确认不需要。' : '\n\n这些都是可重新生成的缓存，删除是安全的。'),
        okLabel: '开始清理', danger: true,
      });
      if (!ok) return;
      startTask(() => api('/clean', { ids, dryRun: false }));
    };
    const pickLow = body.querySelector('button[data-pick="low"]');
    if (pickLow) pickLow.onclick = () => { for (const item of state.caches) item.selected = item.risk === 'low'; renderStorage(body); };
    const pickNone = body.querySelector('button[data-pick="none"]');
    if (pickNone) pickNone.onclick = () => { for (const item of state.caches) item.selected = false; renderStorage(body); };
    const usage = body.querySelector('button[data-usage]');
    if (usage) usage.onclick = async () => {
      const input = $('system-usage-root');
      const root = (input && input.value.trim()) || '/';
      state.usageRoot = root;
      state.usage = null;
      renderStorage(body);
      try { state.usage = await api('/usage?path=' + encodeURIComponent(root) + '&limit=30&minBytes=10485760'); }
      catch (error) { toast('err', String(error.message || error)); }
      renderStorage(body);
    };
    const large = body.querySelector('button[data-large]');
    if (large) large.onclick = async () => {
      const rootInput = $('system-large-root');
      const minInput = $('system-large-min');
      const root = (rootInput && rootInput.value.trim()) || '/';
      state.largeRoot = root;
      state.large = null;
      renderStorage(body);
      try { state.large = await api('/large-files?path=' + encodeURIComponent(root) + '&minMiB=' + encodeURIComponent((minInput && minInput.value) || '200') + '&limit=40&depth=4'); }
      catch (error) { toast('err', String(error.message || error)); }
      renderStorage(body);
    };
  }

  /* ---------------------------------------------------------------- 软件（Homebrew） */

  function brewMatches(item, query) {
    return !query || String(item.name || '').toLowerCase().includes(query);
  }

  function renderSoftware(body) {
    const data = state.software;
    if (!data) { body.innerHTML = '<div class="sp-empty">正在读取软件清单…</div>'; return; }
    const brew = data.brew || {};
    const loading = data.loading || {};
    const query = state.softwareQuery.trim().toLowerCase();
    const outdated = (data.outdated || []).filter((item) => brewMatches(item, query));
    const installed = (brew.formulae || []).map((item) => Object.assign({ cask: false }, item))
      .concat((brew.casks || []).map((item) => Object.assign({ cask: true }, item)))
      .filter((item) => brewMatches(item, query));
    const busyNote = loading.installed
      ? '<span class="muted">正在后台读取 brew 清单（满载时可能要几分钟，读完会自动出现，不影响你现在做别的事）</span>'
      : (data.loadedAt ? '<span class="muted">清单读取于 ' + esc(relTime(data.loadedAt)) + '</span>' : '');
    body.innerHTML = `
      <div class="sp-actions">
        <input class="sp-input" id="system-soft-query" placeholder="搜索包名" value="${esc(state.softwareQuery)}" style="min-width:170px">
        <span class="sp-tag">已装 ${(brew.formulae || []).length + (brew.casks || []).length}</span>
        <span class="sp-tag ${outdated.length ? 'bad' : 'good'}">可升级 ${(data.outdated || []).length}</span>
        <button class="sp-btn primary" data-brew-upgrade-all${(data.outdated || []).length ? '' : ' disabled'}>升级全部可升级项</button>
        <button class="sp-btn" data-brew-cleanup>清理旧版本缓存</button>
        <button class="sp-btn" data-brew-autoremove>清理无用依赖</button>
        <input class="sp-input" id="system-soft-install" placeholder="要安装的包名，如 wget" style="min-width:170px">
        <button class="sp-btn" data-soft-install="1">安装</button>
        ${busyNote}
      </div>
      <div class="sp-band">
        <h3>可升级（${outdated.length}）</h3>
        ${outdated.length ? `<table class="sp-table"><thead><tr><th>包名</th><th>已装</th><th>最新</th><th></th></tr></thead><tbody>
          ${outdated.map((item) => `<tr>
            <td>${esc(item.name)}${item.pinned ? ' <span class="sp-tag">已锁定</span>' : ''}</td>
            <td class="muted mono">${esc(item.installed || '')}</td>
            <td class="mono">${esc(item.current || '')}</td>
            <td><button class="sp-btn" data-brew-upgrade="${esc(item.name)}">升级</button></td>
          </tr>`).join('')}</tbody></table>`
        : '<div class="sp-empty">' + (loading.outdated ? '正在检查更新…' : '全部都是最新的') + '</div>'}
      </div>
      <div class="sp-band">
        <h3>已安装（${installed.length}）</h3>
        ${installed.length ? `<table class="sp-table"><thead><tr><th>包名</th><th>类型</th><th>版本</th><th></th></tr></thead><tbody>
          ${installed.slice(0, 400).map((item) => `<tr>
            <td class="ellip">${esc(item.name)}</td>
            <td><span class="sp-tag">${item.cask ? 'cask' : 'formula'}</span></td>
            <td class="muted mono">${esc(item.versions || '')}</td>
            <td><button class="sp-btn danger" data-brew-uninstall="${esc(item.name)}" data-cask="${item.cask ? '1' : ''}">卸载</button></td>
          </tr>`).join('')}</tbody></table>
          ${installed.length > 400 ? '<p class="sp-note">只显示前 400 项，用搜索框过滤。</p>' : ''}`
        : '<div class="sp-empty">' + (loading.installed ? '正在读取…' : '没有读到已安装的包') + '</div>'}
      </div>
      <p class="sp-note">升级 / 安装 / 卸载都会作为任务在下方控制台实时输出，长任务随时可以取消。</p>`;
    const input = $('system-soft-query');
    if (input) {
      input.oninput = () => {
        state.softwareQuery = input.value;
        const caret = input.selectionStart;
        renderSoftware(body);
        const again = $('system-soft-query');
        if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (_) {} }
      };
    }
    const upgradeAll = body.querySelector('button[data-brew-upgrade-all]');
    if (upgradeAll) upgradeAll.onclick = async () => {
      const ok = await askConfirm({ title: '升级全部可升级的包？', message: '共 ' + (data.outdated || []).length + ' 个（含 formula 与 cask）。\n\nbrew upgrade 会逐项下载安装，可能很久；期间可以用下方「取消」停止。', okLabel: '开始升级', danger: true });
      if (ok) startTask(() => api('/software', { action: 'upgrade' }));
    };
    body.querySelectorAll('button[data-brew-upgrade]').forEach((button) => {
      button.onclick = () => startTask(() => api('/software', { action: 'upgrade', name: button.dataset.brewUpgrade }));
    });
    body.querySelectorAll('button[data-brew-uninstall]').forEach((button) => {
      button.onclick = async () => {
        const name = button.dataset.brewUninstall;
        const ok = await askConfirm({ title: '卸载 ' + name, message: '会执行 brew uninstall ' + name + '。\n依赖它的其它软件可能受影响。', okLabel: '卸载', danger: true });
        if (ok) startTask(() => api('/software', { action: 'uninstall', name, cask: button.dataset.cask === '1' }));
      };
    });
    const cleanup = body.querySelector('button[data-brew-cleanup]');
    if (cleanup) cleanup.onclick = () => startTask(() => api('/software', { action: 'cleanup' }));
    const autoremove = body.querySelector('button[data-brew-autoremove]');
    if (autoremove) autoremove.onclick = () => startTask(() => api('/software', { action: 'autoremove' }));
    const install = body.querySelector('button[data-soft-install]');
    if (install) install.onclick = () => {
      const field = $('system-soft-install');
      const name = (field && field.value.trim()) || '';
      if (!name) { toast('warn', '先填要安装的包名'); return; }
      startTask(() => api('/software', { action: 'install', name }));
    };
  }

  /* ---------------------------------------------------------------- 服务与端口 */

  /* 启动项标识 → 人话。这些标识（com.tencent.LemonMonitor、application.com.apple.Safari）
     对用户就是乱码，翻一句才知道要不要管它。 */
  function describeAgent(label) {
    const text = String(label || '');
    if (/^application\./.test(text)) return '正在运行的应用（系统登记的）';
    if (/ShipIt|\.update|Updater/i.test(text)) return '自动更新组件';
    if (/Lemon|tencent/i.test(text)) return '腾讯柠檬清理';
    if (/codescope/i.test(text)) return 'CodeScope 自己';
    if (/workbuddy/i.test(text)) return 'WorkBuddy';
    if (/docker|docker\.dna/i.test(text)) return 'Docker';
    if (/syncthing/i.test(text)) return 'Syncthing 文件同步';
    if (/^com\.apple\./.test(text)) return 'Apple 系统组件';
    if (/^com\.microsoft\./.test(text)) return '微软软件的后台组件';
    if (/^com\.google\./.test(text)) return 'Google 软件的后台组件';
    if (/^com\.[a-z0-9-]+\.[A-Z]/.test(text)) return '第三方软件的后台组件';
    return '';
  }

  function renderServices(body) {
    const data = state.services;
    if (!data) { body.innerHTML = '<div class="sp-empty">正在读取服务与端口…</div>'; return; }
    const allAgents = data.agents || [];
    const failedAgents = allAgents.filter((item) => item.failed);
    const agents = state.showAllAgents ? allAgents : failedAgents;
    const brew = data.brew || [];
    const ports = (data.ports || []).slice().sort((a, b) => {
      const lanA = describeBind(a.address) === '局域网可访问' ? 0 : 1;
      const lanB = describeBind(b.address) === '局域网可访问' ? 0 : 1;
      return lanA - lanB || Number(a.port) - Number(b.port);
    });
    const lanCount = ports.filter((item) => describeBind(item.address) === '局域网可访问').length;
    const shownPorts = ports.slice(0, state.portLimit);

    /* 顶部结论条：先把「有没有事」说清楚，再摊细节。 */
    const summary = '<div class="sp-summary">' +
      (failedAgents.length
        ? '<b class="sp-warn">' + failedAgents.length + ' 个开机启动项异常</b><span class="muted">· 其余 ' + (allAgents.length - failedAgents.length) + ' 个正常</span>'
        : '<b>' + allAgents.length + ' 个开机启动项都正常</b>') +
      '<span class="muted">· ' + ports.length + ' 个端口在监听' +
      (lanCount ? '，其中 <b class="sp-warn">' + lanCount + ' 个局域网可访问</b>' : '，都只对本机开放') + '</span></div>';

    body.innerHTML = `
      ${summary}
      <div class="sp-cols">
        <div class="sp-band">
          <h3>Homebrew 后台服务（${brew.length}）<span class="sp-hint">brew services 托管的常驻服务</span></h3>
          ${brew.length ? `<table class="sp-table"><thead><tr><th>服务</th><th>状态</th><th>用户</th><th></th></tr></thead><tbody>
            ${brew.map((item) => `<tr>
              <td>${esc(item.name)}</td>
              <td><span class="sp-tag ${item.running ? 'good' : ''}">${esc(item.status)}</span></td>
              <td class="muted">${esc(item.user || '')}</td>
              <td>${item.running
                ? '<button class="sp-btn" data-svc="restart" data-name="' + esc(item.name) + '">重启</button> <button class="sp-btn danger" data-svc="stop" data-name="' + esc(item.name) + '">停止</button>'
                : '<button class="sp-btn" data-svc="start" data-name="' + esc(item.name) + '">启动</button>'}</td>
            </tr>`).join('')}</tbody></table>` : '<div class="sp-empty">没有通过 brew services 托管的服务</div>'}
        </div>
        <div class="sp-band">
          <h3>开机启动项（${allAgents.length}）<span class="sp-hint">${failedAgents.length ? '只列异常项' : '只列异常项 · 目前没有'}</span></h3>
          <div class="sp-plist">
            ${agents.length ? agents.map((item) => {
              const note = describeAgent(item.label);
              return `<div class="sp-pitem" title="${esc(item.label)}">
                <div class="sp-pmain">
                  <div class="sp-pname">${esc(note || item.label)}</div>
                  <div class="sp-pnote ellip">${esc(item.label)}</div>
                </div>
                <span class="sp-state ${item.failed ? 'crit' : 'ok'}">${item.failed ? '异常' : '正常'}</span>
              </div>`;
            }).join('') : '<div class="sp-empty">没有异常的启动项，一切正常</div>'}
          </div>
          <div class="sp-actions"><button class="sp-btn" data-agents="${state.showAllAgents ? '0' : '1'}">${state.showAllAgents ? '只看异常项' : '展开全部 ' + allAgents.length + ' 项'}</button></div>
        </div>
      </div>
      <div class="sp-band">
        <h3>监听中的端口（${ports.length}）<span class="sp-hint">局域网可访问的排在前面</span></h3>
        <table class="sp-table"><thead><tr><th class="num">端口</th><th>这个端口是干嘛的</th><th>谁能访问</th><th></th></tr></thead><tbody>
          ${shownPorts.map((item) => {
            const note = describePort(item.port, item.command);
            const bind = describeBind(item.address);
            const open = bind === '局域网可访问';
            return `<tr title="PID ${item.pid == null ? '—' : item.pid} · 绑定 ${esc(item.address || '')}">
              <td class="num"><b>${item.port}</b></td>
              <td class="ellip">${esc(note || item.command || '未知服务')}${note && item.command ? '<span class="muted mono" style="font-size:10.5px"> ' + esc(item.command) + '</span>' : ''}</td>
              <td><span class="sp-state ${open ? 'warn' : ''}">${esc(bind || '—')}</span></td>
              <td class="sp-actcol">
                <button class="sp-btn" data-open-url="http://127.0.0.1:${item.port}">打开</button>
                ${item.pid ? '<button class="sp-btn danger sp-rowbtn" data-kill="' + item.pid + '" data-app="' + esc(item.command || ('PID ' + item.pid)) + '">结束</button>' : ''}
              </td>
            </tr>`;
          }).join('') || '<tr><td colspan="4" class="sp-empty">没有监听的端口</td></tr>'}</tbody></table>
        ${ports.length > state.portLimit
          ? '<div class="sp-actions"><button class="sp-btn" data-ports="' + (state.portLimit >= ports.length ? 8 : ports.length) + '">' + (state.portLimit >= ports.length ? '收起，只看前 8 个' : '显示全部 ' + ports.length + ' 个端口') + '</button></div>'
          : ''}
      </div>`;

    body.querySelectorAll('button[data-svc]').forEach((button) => {
      button.onclick = () => startTask(() => api('/software', { action: 'service', serviceAction: button.dataset.svc, name: button.dataset.name }));
    });
    const agentsToggle = body.querySelector('button[data-agents]');
    if (agentsToggle) agentsToggle.onclick = () => { state.showAllAgents = agentsToggle.dataset.agents === '1'; renderServices(body); };
    const portsToggle = body.querySelector('button[data-ports]');
    if (portsToggle) portsToggle.onclick = () => { state.portLimit = Number(portsToggle.dataset.ports) || 8; renderServices(body); };
    body.querySelectorAll('button[data-open-url]').forEach((button) => {
      button.onclick = async () => {
        try { await api('/open', { path: button.dataset.openUrl }); }
        catch (error) { toast('err', String(error.message || error)); }
      };
    });
    body.querySelectorAll('button[data-kill]').forEach((button) => {
      button.onclick = () => killPid(Number(button.dataset.kill), button.dataset.app || '');
    });
  }
  /* ---------------------------------------------------------------- Docker */

  function renderDocker(body) {
    const data = state.docker;
    if (!data) { body.innerHTML = '<div class="sp-empty">正在读取 Docker 状态…</div>'; return; }
    const st = data.state || {};
    const running = !!st.available;
    body.innerHTML = `
      <div class="sp-cards">
        <div class="sp-card">
          <h4>Docker 守护进程</h4>
          <div class="big ${running ? 'sp-ok' : 'sp-warn'}">${running ? '运行中' : '未运行'}</div>
          <div class="sub">${esc(st.manager || '未检测到运行时')}${st.serverVersion ? ' · 服务端 ' + esc(st.serverVersion) : ''}${st.context ? ' · context ' + esc(st.context) : ''}${st.endpoint ? ' · 端点 ' + esc(st.endpoint) : ''}</div>
          <div class="sp-actions" style="margin:9px 0 0">
            ${running ? '<button class="sp-btn danger" data-docker-daemon="daemon-stop">停止运行时</button>'
              : '<button class="sp-btn primary" data-docker-daemon="daemon-start">启动运行时</button>'}
            <button class="sp-btn" data-docker-refresh="1">刷新</button>
          </div>
          ${running ? (st.contextHint ? '<p class="sp-note sp-warn">' + esc(st.contextHint) + '</p>' : '') : '<p class="sp-note sp-warn">' + esc(st.message || '') + '</p>'}
        </div>
        <div class="sp-card">
          <h4>概览</h4>
          <div class="sp-kv">
            <span class="k">容器</span><span>${(data.containers || []).length} 个（运行中 ${(data.containers || []).filter((item) => item.running).length}）</span>
            <span class="k">镜像</span><span>${(data.images || []).length}</span>
            <span class="k">数据卷</span><span>${(data.volumes || []).length}</span>
          </div>
        </div>
      </div>
      ${running ? `
      <div class="sp-band">
        <h3>容器（${(data.containers || []).length}）</h3>
        <div class="sp-actions">
          <button class="sp-btn danger" data-docker="prune">清理无用容器与镜像</button>
          <button class="sp-btn danger" data-docker="prune-volumes">清理无用数据卷</button>
        </div>
        ${(data.containers || []).length ? `<table class="sp-table"><thead><tr><th>名称</th><th>镜像</th><th>状态</th><th>端口</th><th></th></tr></thead><tbody>
          ${data.containers.map((item) => `<tr>
            <td>${esc(item.name)}</td>
            <td class="ellip muted">${esc(item.image)}</td>
            <td><span class="sp-tag ${item.running ? 'good' : ''}">${esc(item.status || item.state)}</span></td>
            <td class="mono muted ellip">${esc(item.ports || '')}</td>
            <td>${item.running
              ? '<button class="sp-btn" data-docker="restart" data-id="' + esc(item.name) + '">重启</button> <button class="sp-btn" data-docker="stop" data-id="' + esc(item.name) + '">停止</button>'
              : '<button class="sp-btn" data-docker="start" data-id="' + esc(item.name) + '">启动</button>'}
              <button class="sp-btn danger" data-docker="rm" data-id="${esc(item.name)}">删除</button></td>
          </tr>`).join('')}</tbody></table>` : '<div class="sp-empty">没有容器</div>'}
      </div>
      <div class="sp-cols">
        <div class="sp-band">
          <h3>镜像（${(data.images || []).length}）</h3>
          ${(data.images || []).length ? `<table class="sp-table"><thead><tr><th>仓库:标签</th><th class="num">大小</th><th>创建</th><th></th></tr></thead><tbody>
            ${data.images.slice(0, 60).map((item) => `<tr>
              <td class="ellip">${esc(item.repository)}:${esc(item.tag)}</td>
              <td class="num muted">${esc(item.size || '')}</td>
              <td class="muted">${esc(item.created || '')}</td>
              <td><button class="sp-btn danger" data-docker="rmi" data-id="${esc(item.id)}">删除</button></td>
            </tr>`).join('')}</tbody></table>` : '<div class="sp-empty">没有镜像</div>'}
        </div>
        <div class="sp-band">
          <h3>数据卷（${(data.volumes || []).length}）</h3>
          ${(data.volumes || []).length ? `<table class="sp-table"><thead><tr><th>名称</th><th>驱动</th><th></th></tr></thead><tbody>
            ${data.volumes.slice(0, 60).map((item) => `<tr>
              <td class="ellip mono">${esc(item.name)}</td>
              <td class="muted">${esc(item.driver || '')}</td>
              <td><button class="sp-btn danger" data-docker="rm-volume" data-id="${esc(item.name)}">删除</button></td>
            </tr>`).join('')}</tbody></table>` : '<div class="sp-empty">没有数据卷</div>'}
          <p class="sp-note">数据卷里通常是数据库的真实数据，删除前请确认。</p>
        </div>
      </div>
      <div class="sp-band">
        <h3>磁盘占用</h3>
        ${(data.usage || []).length ? `<table class="sp-table"><thead><tr><th>类型</th><th class="num">总数</th><th class="num">活跃</th><th class="num">占用</th><th class="num">可回收</th></tr></thead><tbody>
          ${data.usage.map((item) => `<tr><td>${esc(item.type)}</td><td class="num muted">${esc(item.count)}</td><td class="num muted">${esc(item.active)}</td><td class="num">${esc(item.size)}</td><td class="num sp-ok">${esc(item.reclaimable)}</td></tr>`).join('')}</tbody></table>` : '<div class="sp-empty">docker system df 没有返回数据</div>'}
      </div>` : '<div class="sp-band"><p class="sp-note">Docker 没运行，容器与镜像信息读不到。点上面「启动运行时」可以用 colima 或 Docker Desktop 拉起（首次启动要几十秒，过程显示在下方控制台）。</p></div>'}`;
    body.querySelectorAll('button[data-docker-refresh]').forEach((button) => { button.onclick = () => { state.docker = null; refresh(true); }; });
    body.querySelectorAll('button[data-docker-daemon]').forEach((button) => {
      button.onclick = async () => {
        const action = button.dataset.dockerDaemon;
        const ok = await askConfirm({
          title: action === 'daemon-stop' ? '停止 Docker 运行时？' : '启动 Docker 运行时？',
          message: action === 'daemon-stop' ? '所有正在运行的容器都会被停掉。' : '会调用 colima start 或打开 Docker Desktop，可能要几十秒。',
          okLabel: '确定', danger: action === 'daemon-stop',
        });
        if (ok) startTask(() => api('/docker', { action }));
      };
    });
    body.querySelectorAll('button[data-docker]').forEach((button) => {
      button.onclick = async () => {
        const action = button.dataset.docker;
        const id = button.dataset.id || '';
        const labels = { prune: '清理无用容器与镜像', 'prune-volumes': '清理无用数据卷', rm: '删除容器 ' + id, rmi: '删除镜像 ' + id, 'rm-volume': '删除数据卷 ' + id, start: '启动 ' + id, stop: '停止 ' + id, restart: '重启 ' + id };
        const ok = await askConfirm({ title: labels[action] || action, message: /prune|rm/.test(action) ? '这个操作不可撤销。' : '继续？', okLabel: '确定', danger: /prune|rm/.test(action) });
        if (ok) startTask(() => api('/docker', { action, id }));
      };
    });
  }

  /* ---------------------------------------------------------------- 开发环境 */

  function renderDev(body) {
    const data = state.dev;
    if (!data) { body.innerHTML = '<div class="sp-empty">正在读取开发环境…</div>'; return; }
    const versions = data.versions || [];
    const repos = data.repos || [];
    const roots = (data.config && data.config.devRoots) || [];
    body.innerHTML = `
      <div class="sp-band">
        <h3>工具链</h3>
        <div class="sp-cols">
          ${versions.map((item) => `<div class="sp-li">
            <span class="grow" title="${esc(item.path)}">${esc(item.label)}</span>
            <span class="mono ${item.available ? '' : 'muted'}">${esc(item.available ? item.version : '未安装')}</span>
          </div>`).join('') || '<div class="sp-empty">没有检测到工具链</div>'}
        </div>
      </div>
      <div class="sp-band">
        <h3>开发目录<span class="sp-hint">Git 仓库的扫描来源</span></h3>
        <div class="sp-list">
          ${roots.map((root, index) => `<div class="sp-li">
            <span class="grow mono">${esc(root)}</span>
            <button class="sp-btn" data-reveal="${esc(root)}">显示</button>
            <button class="sp-btn danger" data-root-remove="${index}">移除</button>
          </div>`).join('') || '<div class="sp-empty">还没有配置开发目录</div>'}
        </div>
        <div class="sp-actions">
          <button class="sp-btn" data-root-add="1">添加目录</button>
          <span class="muted">最多 12 个；扫描深度 ${(data.config && data.config.maxDepth) || 3} 层</span>
        </div>
      </div>
      <div class="sp-band">
        <h3>Git 仓库（${repos.length}）</h3>
        <div class="sp-actions">
          <button class="sp-btn" data-dev-fetch="1">拉取所有仓库的远端信息</button>
          <span class="muted">有改动 / 落后远端的排在最前</span>
        </div>
        ${repos.length ? `<table class="sp-table"><thead><tr><th>仓库</th><th>分支</th><th>状态</th><th>最近提交</th><th></th></tr></thead><tbody>
          ${repos.map((item) => `<tr>
            <td class="ellip" title="${esc(item.path)}">${esc(item.name)}</td>
            <td class="mono">${esc(item.branch || '—')}${item.upstream ? '' : ' <span class="sp-tag">无上游</span>'}</td>
            <td>${item.error ? '<span class="sp-tag bad">' + esc(item.error) + '</span>' : ((item.dirty ? '<span class="sp-tag bad">有 ' + item.changed + ' 处改动</span>' : '<span class="sp-tag good">干净</span>') +
              (item.ahead ? ' <span class="sp-tag">领先 ' + item.ahead + '</span>' : '') + (item.behind ? ' <span class="sp-tag">落后 ' + item.behind + '</span>' : ''))}</td>
            <td class="muted ellip" title="${esc(item.subject)}">${esc(item.commit || '')} ${esc(item.subject || '')} <span class="muted">${esc(item.commitAt ? relTime(item.commitAt) : '')}</span></td>
            <td><button class="sp-btn" data-reveal="${esc(item.path)}">在访达显示</button></td>
          </tr>`).join('')}</tbody></table>` : '<div class="sp-empty">已配置的开发目录里没找到 git 仓库</div>'}
      </div>`;
    body.querySelectorAll('button[data-reveal]').forEach((button) => { button.onclick = () => reveal(button.dataset.reveal); });
    const add = body.querySelector('button[data-root-add]');
    if (add) add.onclick = async () => {
      const value = await askText({ title: '添加开发目录', message: '填一个绝对路径，本机管家会在里面找 git 仓库。', placeholder: '/Users/you/Projects' });
      if (!value) return;
      await saveDevRoots(roots.concat(String(value).trim()).slice(0, 12), body);
    };
    body.querySelectorAll('button[data-root-remove]').forEach((button) => {
      button.onclick = () => saveDevRoots(roots.filter((_, index) => index !== Number(button.dataset.rootRemove)), body);
    });
    const fetchAll = body.querySelector('button[data-dev-fetch]');
    if (fetchAll) fetchAll.onclick = () => startTask(() => api('/dev', { action: 'fetch' }));
  }

  async function saveDevRoots(next, body) {
    try {
      const data = await api('/dev', { action: 'config', config: { devRoots: next } });
      const fresh = await api('/dev');
      state.dev = Object.assign({}, state.dev, { config: data.config || (fresh && fresh.config), repos: (fresh && fresh.repos) || [] });
      renderDev(body);
      toast('ok', '开发目录已保存');
    } catch (error) {
      toast('err', String(error.message || error));
    }
  }

  /* ---------------------------------------------------------------- 启动装配 */

  function boot() {
    buildShell();
    const button = $('btn-system');
    if (button) button.title += '（前端 1.0.0）';
    /* 环境检测弹窗是 index.html 里的静态结构，defer 脚本跑的时候已经在了。 */
    try { injectEnvCard(); hookEnvDialog(); refreshCoreCard(); } catch (_) {}
  }

  /* ================================================================ 环境检测：CodeScope 本地服务卡片
     直接复用环境检测里 DSH 那张卡片的类名（.env-dsh-card / .env-dsh-actions），
     所以外观和应用原生卡片完全一致，而且**不用改 index.html**（运行时注入）。
     它的价值：改过 server.js 之后，不用再去终端找人肉重启。 */
  const CORE = { injected: false, busy: false, pid: 0, port: 0, restartable: true, blockReason: '', error: '', log: '', lastAt: 0 };

  async function rawPing() {
    const res = await fetch(API + '/ping', { cache: 'no-store' });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok === false) {
      const error = new Error((data && data.error) || ('HTTP ' + res.status));
      error.missingRoute = res.status === 404;
      throw error;
    }
    return data;
  }

  function injectEnvCard() {
    const host = document.querySelector('#env-body .env-dsh-card');
    if (!host || $('env-core-card')) return;
    const card = document.createElement('div');
    card.className = 'env-dsh-card';
    card.id = 'env-core-card';
    card.innerHTML = `
      <div>
        <strong id="env-core-title">CodeScope 本地服务 · 检测中</strong>
        <p id="env-core-detail">正在读取服务进程信息…</p>
      </div>
      <div class="env-dsh-actions"><button id="btn-env-core-restart" class="primary">重启 CodeScope</button></div>`;
    host.insertAdjacentElement('afterend', card);
    const button = $('btn-env-core-restart');
    if (button) button.onclick = () => restartCore();
    CORE.injected = true;
  }

  function renderCoreCard() {
    const title = $('env-core-title');
    const detail = $('env-core-detail');
    const button = $('btn-env-core-restart');
    if (!title || !detail || !button) return;
    if (CORE.busy) {
      title.textContent = 'CodeScope 本地服务 · 重启中…';
      detail.textContent = CORE.status || '正在让服务换一个新进程，请稍候（旧进程退出 → 新进程接管端口）。';
      button.disabled = true;
      button.textContent = '重启中…';
      return;
    }
    if (CORE.error) {
      title.textContent = 'CodeScope 本地服务 · ' + (CORE.error === 'noRoute' ? '后端未生效' : '读取失败');
      detail.textContent = CORE.error === 'noRoute'
        ? '本机管家的后端接口还没生效：请在启动 CodeScope 的终端里按 Ctrl+C，然后重新执行 node server.js。之后这张卡片上的按钮就能一直用了。'
        : (CORE.message || '无法读取服务进程信息。');
      button.disabled = true;
      button.textContent = '重启 CodeScope';
      return;
    }
    const seconds = Math.max(0, Math.round(CORE.uptime || 0));
    title.textContent = 'CodeScope 本地服务 · PID ' + CORE.pid;
    detail.textContent = '端口 ' + CORE.port + ' · 已运行 ' + fmtDuration(seconds) + ' · Node ' + (CORE.node || '') + ' · 面板前端 v1.0.0'
      + (CORE.log ? ' · 日志 ' + CORE.log : '');
    button.disabled = !CORE.restartable;
    button.textContent = CORE.restartable ? '重启 CodeScope' : '重启不可用';
    button.title = CORE.restartable ? '换一个新进程接管当前端口（约 3-10 秒不可用）' : (CORE.blockReason || '当前启动方式不支持自动重启');
  }

  async function refreshCoreCard() {
    if (!CORE.injected || CORE.busy) return;
    try {
      const data = await rawPing();
      Object.assign(CORE, {
        pid: data.pid, port: data.port, uptime: data.uptime, node: data.node, log: data.logPath,
        restartable: data.restartable !== false, blockReason: data.restartBlockReason || '', error: '', message: '',
      });
    } catch (error) {
      CORE.error = error && error.missingRoute ? 'noRoute' : 'failed';
      CORE.message = String((error && error.message) || error);
    }
    renderCoreCard();
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function restartCore() {
    if (CORE.busy) return;
    const confirmed = await askConfirm({
      title: '重启 CodeScope 本地服务',
      message: '服务会在约 3-10 秒内换一个新进程：期间页面请求会失败，正在编辑的内容以服务端已保存的为准。'
        + (CORE.pid ? '\n\n当前进程：PID ' + CORE.pid + '（端口 ' + CORE.port + '）' : ''),
      danger: true,
      okLabel: '立即重启',
    });
    if (!confirmed) return;
    const before = CORE.pid;
    CORE.busy = true;
    CORE.status = '正在请求服务重启…';
    renderCoreCard();
    try {
      await api('/restart', {});
    } catch (error) {
      /* 服务可能在回包之前就被引导脚本收走了，这不代表失败，继续等新进程。 */
      CORE.status = '重启请求已发出（连接被中断属正常）。';
    }
    const deadline = Date.now() + 70000;
    let swapped = false;
    while (Date.now() < deadline) {
      await sleep(700);
      let live = null;
      try { live = await rawPing(); } catch (_) { live = null; }
      if (live && live.pid && live.pid !== before) { swapped = true; CORE.pid = live.pid; break; }
      CORE.status = '等待新进程接管端口…已等待 ' + Math.round((Date.now() - (deadline - 70000)) / 1000) + ' 秒';
      renderCoreCard();
    }
    CORE.busy = false;
    if (swapped) {
      CORE.at = Date.now();
      toast('ok', 'CodeScope 已重启，新进程 PID ' + CORE.pid);
      setStatus('CodeScope 已重启（PID ' + CORE.pid + '）');
      await refreshCoreCard();
      /* 面板后端此刻也活了：把之前那个「后端还没生效」的横幅收掉。 */
      if (document.body.classList.contains(MODE)) await retryBackend();
    } else {
      CORE.error = 'failed';
      CORE.message = '等待 70 秒仍没等到新进程。请查看日志：' + (CORE.log || '临时目录下的 codescope-server.log');
      toast('bad', '重启超时，请检查日志');
      renderCoreCard();
    }
  }

  function hookEnvDialog() {
    /* 打开环境检测、或点它自己的「重新检测」时，顺手刷新这张卡片。 */
    const button = $('btn-env');
    if (button) button.addEventListener('click', () => { injectEnvCard(); setTimeout(refreshCoreCard, 60); });
    const refreshButton = $('btn-env-refresh');
    if (refreshButton) refreshButton.addEventListener('click', () => setTimeout(refreshCoreCard, 300));
  }

  window.CodeScopeSystemPanel = {
    open: openPanel,
    close,
    refresh,
    version: '1.0.0',
    get state() { return { tab: state.tab, busy: state.busy, core: { pid: CORE.pid, port: CORE.port, restartable: CORE.restartable } }; },
    restart: restartCore,
    refreshEnvCard: refreshCoreCard,
    openEnv: () => { injectEnvCard(); return refreshCoreCard(); },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
