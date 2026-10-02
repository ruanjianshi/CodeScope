'use strict';

/* ── CodeScope 自身的环境：检测 + 更新 ──
   为什么单独做一个模块：环境检测以前散在 server.js 的 detectEnv（工具链）和 index.html 的
   环境检测弹窗（只报告）里，而「能不能把它修好」没人负责。code-server 就是典型例子——
   它是 CodeScope 后来新加的环境需求，检测到了却只告诉用户「去终端跑这行 npm install」，
   面板里既看不到进度，也拿不到装完之后的真实版本。

   本模块负责三件事：
   ① 检测：运行时 / 服务端与多端访问 / 依赖 / 前端产物新旧 / 集成（code-server、DSH）/ 外部工具；
   ② 更新：把「装 code-server、重建前端产物、装依赖」变成可预演、可流式、可取消的任务；
   ③ 忠实：只读检测 + 只写该写的地方（code-server 只装进 ~/.codescope，产物只经 npm 脚本重建），
      任何删除动作这里都没有。

   依赖方向：本模块可以 require ./code-server-service（复用同一套 code-server 定位逻辑），
   反过来不行 —— 否则 code-server 服务就得知道任务系统。 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { resolveCodeServer, resetProbe: resetCodeServerProbe } = require('./code-server-service');
/* 平台差异（命令在哪、这条探测在这个平台上有没有意义）统一问 ./platform 的 HOST。 */
const { HOST } = require('./platform');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

/* 前端产物与源码的对应关系：产物比任何源文件旧，就算「需要重建」。
   这几个 id 同时是 build:* 脚本名的一部分，别随手改名。 */
const BUILD_TARGETS = [
  {
    id: 'system-panel',
    label: '本机管家面板',
    script: 'build:system-panel',
    output: path.join('assets', 'system-panel.js'),
    sources: [
      path.join('src', 'system-panel.js'),
      path.join('src', 'system-files-view.js'),
      path.join('src', 'system-software-view.js'),
      path.join('src', 'system-scan-view.js'),
      path.join('src', 'system-env-view.js'),
    ],
  },
  {
    id: 'reading-editor',
    label: '阅读块编辑器',
    script: 'build:reading-editor',
    output: path.join('assets', 'reading-block-editor.js'),
    sources: [path.join('src', 'reading-block-editor.js')],
  },
  {
    id: 'study-workspace',
    label: '学习工作台',
    script: 'build:study-workspace',
    output: path.join('assets', 'study-workspace.js'),
    sources: [path.join('src', 'study-workspace.js'), path.join('src', 'study-sites.js')],
  },
];

const CODE_SERVER_DIR = path.join(os.homedir(), '.codescope');

function statOrNull(file) {
  try { return fs.statSync(file); } catch (_) { return null; }
}

function mtimeOf(file) {
  const stat = statOrNull(file);
  return stat ? stat.mtimeMs : 0;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/* 只跑命令、不碰文件系统；超时一律杀掉，绝不留下挂着的子进程。 */
function exec(command, args, options = {}) {
  const timeout = options.timeout || 20000;
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(command, args, { timeout, maxBuffer: 4 * 1024 * 1024, env: Object.assign({}, process.env, options.env || {}) });
    } catch (error) {
      return resolve({ ok: false, code: -1, out: '', err: String((error && error.message) || error) });
    }
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += String(chunk); });
    child.stderr.on('data', (chunk) => { err += String(chunk); });
    child.on('error', (error) => resolve({ ok: false, code: -1, out, err: String((error && error.message) || error) }));
    child.on('close', (code) => resolve({ ok: code === 0, code: code == null ? -1 : code, out, err: err || out }));
  });
}

/* ── 运行时：Node / Electron / 包管理器 ── */

function runtimeInfo(projectRoot) {
  const pkg = readJson(path.join(projectRoot, 'package.json')) || {};
  const engines = String((pkg.engines && pkg.engines.node) || '');
  const majorWanted = (engines.match(/\d+/) || [])[0];
  const majorNow = Number(String(process.versions.node).split('.')[0]);
  return {
    mode: process.versions.electron ? 'desktop' : 'web',
    modeLabel: process.versions.electron ? '桌面应用（Electron ' + process.versions.electron + '）' : '命令行 / 服务端（node）',
    node: process.versions.node,
    electron: process.versions.electron || '',
    execPath: process.execPath,
    platform: process.platform,
    arch: process.arch,
    osVersion: IS_MAC ? (os.release() + ' (Darwin)') : (os.type() + ' ' + os.release()),
    cpu: (os.cpus()[0] || {}).model || '',
    cpuCount: os.cpus().length,
    memBytes: os.totalmem(),
    uptimeSec: Math.round(process.uptime()),
    engineWanted: engines,
    engineOk: !majorWanted || majorNow >= Number(majorWanted),
    pid: process.pid,
  };
}

/* ── 服务端与「多端」访问 ──
   默认只绑回环；要让手机 / 平板 / 另一台机器访问，得显式 CODESCOPE_HOST=0.0.0.0。
   同时写入类请求要过 trustedHttpOrigin 网关 —— 这两件事必须一起说清楚，
   否则用户会以为「打不开就是坏了」。 */
function serverInfo(options) {
  const port = Number(options.port) || 4877;
  const host = String(options.host || '127.0.0.1');
  const loopback = ['127.0.0.1', 'localhost', '::1', ''].includes(host);
  const lan = [];
  try {
    for (const [name, rows] of Object.entries(os.networkInterfaces())) {
      for (const row of rows || []) {
        if (row.internal || row.family !== 'IPv4') continue;
        lan.push({ iface: name, address: row.address, url: 'http://' + row.address + ':' + port });
      }
    }
  } catch (_) { /* 拿不到网卡就当没有 */ }
  return {
    port,
    host,
    loopbackOnly: loopback,
    localUrl: 'http://127.0.0.1:' + port,
    lanUrls: lan,
    writeGate: loopback
      ? '本机访问：写入类请求放行（同源校验按回环判定）'
      : '已对局域网开放：写入类请求仍要求同源，跨站写入会被拒绝',
    multiClientHint: loopback
      ? '当前只监听回环，手机/平板/其他电脑访问不到。需要多端时用 CODESCOPE_HOST=0.0.0.0 启动，并只在可信网络里使用。'
      : '已监听所有网卡，同一局域网内的设备可以直接打开上面的地址。',
  };
}

/* ── 依赖：装没装、装的是哪个版本 ── */

function depsInfo(projectRoot) {
  const pkg = readJson(path.join(projectRoot, 'package.json')) || {};
  const modules = path.join(projectRoot, 'node_modules');
  const declared = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
  const entries = Object.keys(declared).map((name) => {
    const installed = readJson(path.join(modules, name, 'package.json'));
    return { name, want: String(declared[name]), have: installed ? String(installed.version) : '', ok: !!installed };
  });
  const missing = entries.filter((item) => !item.ok);
  /* npm 会在 node_modules/.package-lock.json 里记录最后一次安装的树；
     它比 package-lock.json 旧，就说明有人改了依赖但没装。 */
  const lock = path.join(projectRoot, 'package-lock.json');
  const installedAt = mtimeOf(path.join(modules, '.package-lock.json'));
  const lockAt = mtimeOf(lock);
  return {
    declaredCount: entries.length,
    installedCount: entries.length - missing.length,
    missing: missing.slice(0, 40),
    missingCount: missing.length,
    modulesPresent: !!statOrNull(modules),
    lockFile: statOrNull(lock) ? path.basename(lock) : '',
    lockAt,
    installedAt,
    stale: !!lockAt && (!installedAt || lockAt > installedAt + 1000),
    entries,
  };
}

/* ── 前端产物：比源码旧就要重建 ── */

function assetsInfo(projectRoot) {
  return BUILD_TARGETS.map((target) => {
    const output = path.join(projectRoot, target.output);
    const outputAt = mtimeOf(output);
    let newestSource = 0;
    let newestName = '';
    let missingSource = '';
    for (const rel of target.sources) {
      const full = path.join(projectRoot, rel);
      const at = mtimeOf(full);
      if (!at) { if (!missingSource) missingSource = rel; continue; }
      if (at > newestSource) { newestSource = at; newestName = rel; }
    }
    const state = !outputAt ? 'missing' : (newestSource > outputAt + 1000 ? 'stale' : 'ok');
    return {
      id: target.id,
      label: target.label,
      script: target.script,
      output: target.output,
      outputBytes: (statOrNull(output) || {}).size || 0,
      outputAt,
      newestSource: newestName,
      newestSourceAt: newestSource,
      missingSource,
      state,
      stateLabel: state === 'ok' ? '已是最新' : state === 'stale' ? '源码比产物新，需要重建' : '产物不存在',
      fix: 'npm run ' + target.script,
    };
  });
}

/* ── 集成：code-server（新加的环境需求）与 DSH ── */

async function codeServerInfo(options) {
  const resolved = resolveCodeServer();
  const dir = path.join(CODE_SERVER_DIR, 'node_modules', 'code-server');
  const installedAt = mtimeOf(path.join(dir, 'package.json'));
  const installedVersion = (readJson(path.join(dir, 'package.json')) || {}).version || '';
  const info = {
    key: 'code-server',
    label: '浏览器版 VS Code（编辑工作台）',
    dir: CODE_SERVER_DIR,
    installDir: dir,
    installed: !!(resolved && resolved.command),
    resolvedVia: (resolved && (resolved.via || resolved.broken)) || '',
    command: (resolved && resolved.command) || '',
    args: (resolved && resolved.args) || [],
    packageVersion: installedVersion,
    installedAt,
    version: '',
    runnable: false,
    probeError: '',
    state: '',
    url: '',
    port: 0,
    proxyPort: 0,
    node: '',
  };
  /* 真跑一次 --version：code-server 声明 engines.node=22，但实测在 Node 26 上可用，
     所以「能不能用」必须以实测为准，不能拿版本号吓人也不能替它下结论。 */
  if (resolved && resolved.command) {
    const probe = await exec(resolved.command, [...resolved.args, '--version'], { timeout: 15000 });
    const matched = (probe.out + probe.err).match(/(\d+\.\d+\.\d+)[^\n]*with Code/i) || (probe.out + probe.err).match(/\b(\d+\.\d+\.\d+)\b/);
    info.runnable = probe.ok && !!matched;
    info.version = matched ? matched[1] : '';
    if (!info.runnable) info.probeError = String((probe.err || probe.out || '').trim().split('\n').pop() || '退出码 ' + probe.code).slice(0, 200);
    else info.node = 'v' + process.versions.node;
  } else if (resolved && resolved.broken) {
    info.probeError = resolved.broken;
  }
  /* 托管状态走宿主自己的集成接口：它是唯一知道自己有没有在跑的那个。 */
  try {
    const response = await fetch('http://127.0.0.1:' + (options.port || 4877) + '/api/integrations/code-server', { signal: AbortSignal.timeout(2500) });
    const body = await response.json();
    const service = (body && body.service) || {};
    info.state = service.state || '';
    info.url = service.url || '';
    info.port = Number(service.port) || 0;
    info.proxyPort = Number(service.proxyPort) || 0;
    if (!info.version && service.version) info.version = service.version;
  } catch (_) { /* 宿主没响应也不影响检测本身 */ }
  info.canInstall = true;
  info.needsInstall = !info.installed;
  info.needsUpdate = !!installedVersion && !!info.version && installedVersion !== info.version;
  info.stateLabel = !info.installed ? '未安装'
    : info.runnable ? ('可用 ' + info.version + (info.state === 'running' ? ' · 正在运行' : info.state === 'external' ? ' · 已连接外部实例' : ''))
      : '已安装但跑不起来';
  info.hint = info.installed
    ? (info.runnable
      ? '由 CodeScope 托管；扩展市场是 Open VSX（非微软市场）。装到 ' + info.installDir
      : '已安装但实测无法运行：' + (info.probeError || '未知原因'))
    : '这是 CodeScope 新加的环境需求：code-server 不进 package.json（695MB 且 postinstall 会和 Electron 打架），单独装在 ' + CODE_SERVER_DIR + '。可以直接在这里装。';
  return info;
}

/* ── 外部工具：有就报、没有就说明它管什么 ── */

async function toolInfo() {
  const tools = [];
  const probe = async (key, label, cmd, args, forWhat) => {
    const result = await exec(cmd, args, { timeout: 8000 });
    const text = String((result.out || result.err || '').trim().split('\n')[0] || '');
    tools.push({ key, label, for: forWhat, ok: result.ok, version: result.ok ? text.slice(0, 80) : '', missing: result.ok ? '' : '未安装或不在 PATH' });
    return result;
  };
  /* 不再借 /bin/sh + command -v 找 brew：Windows 上没有 /bin/sh，这条路必失败。
     HOST.which 会按各平台的 PATH 与惯例目录找，找不到才退回裸命令名（结果同样是「未安装」）。 */
  await probe('brew', 'Homebrew', HOST.which('brew') || 'brew', ['--version'], '装/更新命令行软件（软件页的包管理也靠它）');
  await probe('git', 'Git', 'git', ['--version'], '版本控制、克隆仓库');
  await probe('npm', 'npm', 'npm', ['--version'], '安装依赖、装 code-server 都走它');
  await probe('docker', 'Docker CLI', 'docker', ['--version'], '容器工作区');
  await probe('colima', 'Colima', 'colima', ['version'], '在 macOS 上提供 Docker 运行环境');
  return tools;
}

/* ── 更新动作：面板只认这几个 id ── */

function actionSpecs() {
  return [
    {
      id: 'code-server',
      label: '安装 / 更新 code-server',
      target: CODE_SERVER_DIR,
      why: '编辑工作台（浏览器版 VS Code）依赖它；CodeScope 不会自动装，因为它是 695MB 的外部工具。',
      command: 'npm install --prefix ' + CODE_SERVER_DIR + ' code-server@latest',
      heavy: true,
    },
    {
      id: 'assets',
      label: '重建前端产物',
      target: 'assets/',
      why: '改过 src/ 之后没重新构建，浏览器里跑的还是旧代码。',
      command: 'npm run build:assets',
      heavy: false,
    },
    {
      id: 'deps',
      label: '安装 / 更新项目依赖',
      target: 'node_modules/',
      why: 'node_modules 缺失或与 package-lock.json 不一致时，功能会缺胳膊少腿。',
      command: 'npm install',
      heavy: true,
    },
  ];
}

function createEnvManager(options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  const projectRoot = options.projectRoot || path.join(__dirname, '..');
  const port = Number(options.port || process.env.CODESCOPE_PORT || process.env.MASSCODE_RUNNER_PORT || 4877);
  const host = String(options.host || process.env.CODESCOPE_HOST || process.env.MASSCODE_RUNNER_HOST || '127.0.0.1');
  const npmBin = options.npmBin || 'npm';
  let cache = null;
  let cacheAt = 0;

  async function report(force) {
    if (!force && cache && Date.now() - cacheAt < 20000) return cache;
    const [codeServer, tools] = await Promise.all([codeServerInfo({ port }), toolInfo()]);
    const assets = assetsInfo(projectRoot);
    const deps = depsInfo(projectRoot);
    const runtime = runtimeInfo(projectRoot);
    const server = serverInfo({ port, host });
    const staleAssets = assets.filter((item) => item.state !== 'ok');
    const actions = actionSpecs().map((spec) => {
      let needed = false;
      let status = '';
      if (spec.id === 'code-server') {
        needed = codeServer.needsInstall || !codeServer.runnable;
        status = codeServer.stateLabel;
      } else if (spec.id === 'assets') {
        needed = staleAssets.length > 0;
        status = staleAssets.length ? (staleAssets.length + ' 项需要重建：' + staleAssets.map((a) => a.label).join('、')) : '全部已是最新';
      } else {
        needed = !deps.modulesPresent || deps.missingCount > 0 || deps.stale;
        status = !deps.modulesPresent ? 'node_modules 不存在'
          : deps.missingCount > 0 ? (deps.missingCount + ' 个依赖没装')
            : deps.stale ? 'package-lock.json 比 node_modules 新' : '依赖齐全';
      }
      return Object.assign({}, spec, { needed, status });
    });
    const problems = [];
    const notes = [];
    if (!runtime.engineOk) problems.push('Node 版本低于 package.json 要求（' + runtime.engineWanted + '）');
    if (staleAssets.length) problems.push(staleAssets.length + ' 项前端产物需要重建');
    if (!deps.modulesPresent || deps.missingCount) problems.push('依赖不完整（缺 ' + deps.missingCount + ' 个）');
    if (codeServer.needsInstall) problems.push('code-server 未安装：编辑工作台用不了');
    else if (!codeServer.runnable) problems.push('code-server 装了但实测跑不起来');
    if (!server.loopbackOnly && !server.lanUrls.length) problems.push('监听非回环地址但没找到局域网地址');
    /* 锁文件比 node_modules 新，只说明「装过依赖之后又动过 package.json」。
       依赖其实齐全时这是提示而不是故障，别把它算成问题。 */
    if (deps.stale && deps.modulesPresent && !deps.missingCount) notes.push('package-lock.json 比 node_modules 新，必要时可重新安装一次依赖');
    cache = {
      ok: problems.length === 0,
      problems,
      notes,
      runtime,
      server,
      deps: {
        declaredCount: deps.declaredCount, installedCount: deps.installedCount, missingCount: deps.missingCount,
        missing: deps.missing, modulesPresent: deps.modulesPresent, stale: deps.stale, lockFile: deps.lockFile,
        lockAt: deps.lockAt, installedAt: deps.installedAt,
      },
      assets,
      codeServer,
      tools,
      actions,
      paths: {
        projectRoot,
        assetsDir: path.join(projectRoot, 'assets'),
        dataRoot: options.dataRoot || '',
        codeServerDir: CODE_SERVER_DIR,
        home: os.homedir(),
      },
      checkedAt: Date.now(),
    };
    cacheAt = Date.now();
    return cache;
  }

  /* 更新动作只做「装/构建」这一类可重复、非破坏性的事；每一步都先打印将要执行的命令。 */
  async function runAction(action, params, helpers, task) {
    const spec = actionSpecs().find((item) => item.id === action);
    if (!spec) throw Object.assign(new Error('未知的环境更新动作：' + action), { statusCode: 400 });
    const dryRun = !!(params && params.dryRun);
    const emit = (stream, text) => helpers.emit(stream, text);
    if (action === 'assets') {
      const script = 'build:assets';
      const args = ['--prefix', projectRoot, 'run', script];
      emit('out', '工作目录：' + projectRoot);
      emit('out', '命令：' + npmBin + ' ' + args.join(' '));
      if (dryRun) { emit('out', '[预演] 依次重建：' + BUILD_TARGETS.map((t) => t.label).join('、')); return 0; }
      const code = await helpers.spawnStep(task, npmBin, args, 600000);
      const after = assetsInfo(projectRoot);
      const stale = after.filter((item) => item.state !== 'ok');
      emit(code === 0 && !stale.length ? 'out' : 'err',
        stale.length ? '仍有 ' + stale.length + ' 项不是最新：' + stale.map((a) => a.label).join('、') : '全部产物已是最新');
      task.result = { rebuilt: BUILD_TARGETS.length - stale.length, stale: stale.length };
      return code === 0 && !stale.length ? 0 : 1;
    }
    if (action === 'deps') {
      const args = ['--prefix', projectRoot, 'install'];
      emit('out', '命令：' + npmBin + ' ' + args.join(' '));
      if (dryRun) {
        const deps = depsInfo(projectRoot);
        emit('out', '[预演] 声明依赖 ' + deps.declaredCount + ' 个，已装 ' + deps.installedCount + ' 个；缺 ' + deps.missingCount + ' 个'
          + (deps.missingCount ? '：' + deps.missing.map((m) => m.name).join('、') : '') + (deps.stale ? '；package-lock.json 比 node_modules 新' : ''));
        return 0;
      }
      const code = await helpers.spawnStep(task, npmBin, args, 1800000);
      const after = depsInfo(projectRoot);
      emit(after.missingCount === 0 ? 'out' : 'err', after.missingCount === 0 ? '依赖已齐全（' + after.installedCount + ' 个）' : '仍缺 ' + after.missingCount + ' 个依赖');
      task.result = { installed: after.installedCount, missing: after.missingCount };
      return code === 0 && after.missingCount === 0 ? 0 : 1;
    }
    /* code-server：写死装进 ~/.codescope，绝不装进项目（iCloud + 695MB + postinstall 会打爆 Electron） */
    fs.mkdirSync(CODE_SERVER_DIR, { recursive: true });
    const args = ['install', '--prefix', CODE_SERVER_DIR, 'code-server@latest'];
    emit('out', '安装位置：' + CODE_SERVER_DIR + '（不会写进项目目录）');
    emit('out', '命令：' + npmBin + ' ' + args.join(' '));
    if (dryRun) { emit('out', '[预演] 只下载安装 code-server，不碰 CodeScope 自身文件。'); return 0; }
    const code = await helpers.spawnStep(task, npmBin, args, 1800000);
    /* 探测结果是全局缓存的，装完必须让它失效，否则集成卡片会一直说「未安装」。 */
    resetCodeServerProbe();
    const info = await codeServerInfo({ port });
    emit(info.runnable ? 'out' : 'err', info.runnable
      ? '装好了：code-server ' + info.version + '（实测可运行，通过 ' + info.resolvedVia + ' 启动）'
      : '装完但实测不可用：' + (info.probeError || '未知原因'));
    task.result = { version: info.version, runnable: info.runnable, dir: CODE_SERVER_DIR };
    cache = null;
    return code === 0 && info.runnable ? 0 : 1;
  }

  return { report, runAction, projectRoot, port, host, actionSpecs, BUILD_TARGETS };
}

module.exports = { createEnvManager, BUILD_TARGETS, CODE_SERVER_DIR, actionSpecs };
