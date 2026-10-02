'use strict';

/* ── 平台差异的唯一落点 ──
   为什么存在：CodeScope 原来在 macOS 上长大，`open` / `osascript` / `/Applications` / `brew`
   这些假设散落在 server.js、lib/system-*.js 与前端里，到了 Windows / Linux 就成片失效
   （有的只是报错，有的是「保护区失效 → 能删系统目录」这种数据安全问题）。

   边界：这里**只**回答「这个平台上，某件事该用哪条命令 / 哪些目录 / 哪种计划」，
   不碰业务逻辑、不自己决定要不要执行。所有命令构造与计划函数都是**纯函数**——
   在 macOS 上也能拿着 win32/linux 的注入跑一遍，这正是我们验收 Windows 分支的方式
   （本机没有 Windows 可跑，靠注入仿真 + 静态审计兜底，这一点不含糊）。 */

const os = require('os');
const path = require('path');
/* 模拟 Windows 时必须用 Windows 的路径语义：本机的 path 是 posix 的，拿它去 join
   'C:\\Users\\demo' 会拼出 /宿主家目录/C:\Users\demo\... 这种怪路径，让注入仿真失真。 */
const winPath = path.win32;
const fs = require('fs');
const cp = require('child_process');

const PLATFORM_IDS = ['darwin', 'win32', 'linux'];

function defaultExec(cmd, args, options = {}) {
  try {
    const result = cp.spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: options.timeout || 8000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      env: options.env || process.env,
    });
    return { ok: result.status === 0, code: result.status, stdout: String(result.stdout || ''), stderr: String(result.stderr || result.error || '') };
  } catch (error) {
    return { ok: false, code: -1, stdout: '', stderr: String((error && error.message) || error) };
  }
}

/* Windows 下参数交给 cmd.exe 时要自己加引号，否则路径里的空格会把它切成两半。 */
function quoteWinArg(value) {
  const text = String(value);
  if (text === '') return '""';
  if (!/[\s"^&|<>()]/.test(text)) return text;
  return '"' + text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1') + '"';
}

/* PowerShell 单引号字符串：里面唯一要转义的是单引号本身（写两个）。
   这里**不能**复用 quoteWinArg —— 它是给 cmd.exe 用的（\" 转义 + 反斜杠倍增，
   且没有空格时原样不引号）。在 PowerShell 的方法实参里，反斜杠不是转义符，
   不带空格的裸路径还可能在表达式模式下解析不了；单引号则既恒被引号包住、
   又不会被 $ 之类的变量插值。 */
function quotePsArg(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function createPlatformHost(options = {}) {
  const id = options.platform || process.platform;
  const env = options.env || process.env;
  const arch = options.arch || process.arch;
  const release = options.release || os.release();
  /* 家目录优先用注入值；没注入时按平台从环境的 HOME / USERPROFILE 兜底，最后才问 os。
     这样「注入一个 Linux/Windows」时，废纸篓、应用扫描根、应用数据目录都会跟着走，
     仿真出来的是那台机器的真实布局，而不是把 macOS 的家目录带进去。 */
  /* 注意：这里不能用 isWin —— 它在下面才声明（暂时性死区）。按注入值就地判定平台。 */
  const hostIsWin = (options.platform || process.platform) === 'win32';
  const home = options.homedir
    || (hostIsWin ? env.USERPROFILE : env.HOME)
    || os.homedir();
  const exec = options.exec || defaultExec;
  const exists = options.exists || ((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
  const readdir = options.readdir || ((p) => { try { return fs.readdirSync(p); } catch (_) { return []; } });
  const readFile = options.readFile || ((p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; } });

  const isMac = id === 'darwin';
  const isWin = id === 'win32';
  const isLinux = id === 'linux';
  const label = isMac ? 'macOS' : isWin ? 'Windows' : isLinux ? 'Linux' : id;

  const appDataDir = isMac
    ? path.join(home, 'Library', 'Application Support')
    : isWin
      ? (env.APPDATA || winPath.join(home, 'AppData', 'Roaming'))
      : (env.XDG_DATA_HOME || path.join(home, '.local', 'share'));

  const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows';

  /* PATH 之外还要按平台惯例补目录：macOS 的 Homebrew、Linux 的 sbin/snap、Windows 的 %APPDATA%\npm。 */
  function searchDirs() {
    if (isWin) {
      return [
        winPath.join(env.APPDATA || winPath.join(home, 'AppData', 'Roaming'), 'npm'),
        winPath.join(env.LOCALAPPDATA || winPath.join(home, 'AppData', 'Local'), 'Programs'),
        winPath.join(env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
        winPath.join(systemRoot, 'System32'),
      ];
    }
    if (isLinux) return ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin', '/snap/bin', '/home/linuxbrew/.linuxbrew/bin'];
    return ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  }

  function which(bin, extra = []) {
    const probe = isWin ? 'where' : 'which';
    const viaPath = exec(probe, [bin], { timeout: 4000 });
    if (viaPath.ok) {
      const first = String(viaPath.stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
      if (first && exists(first)) return first;
    }
    const names = isWin ? [bin + '.exe', bin + '.cmd', bin + '.bat', bin] : [bin];
    /* 第二步不依赖任何外部命令：先按真实 $PATH 的顺序找，再退回各平台惯例目录。
       精简镜像/容器里可能连 which 都没有（实测 Ubuntu 容器有、alpine 类镜像没有），
       这条纯 JS 路径让探测在这些环境里照样准确。 */
    const pathDirs = String(env.PATH || '').split(isWin ? ';' : ':').map((item) => item.trim()).filter(Boolean);
    for (const dir of [...extra, ...pathDirs, ...searchDirs()]) {
      for (const name of names) {
        const candidate = path.join(dir, name);
        if (exists(candidate)) return candidate;
      }
    }
    return null;
  }

  /* 命令构造：纯函数，只产出 argv，不执行。 */
  const commands = {
    openExternal(target) {
      if (isWin) return { file: 'cmd.exe', args: ['/d', '/s', '/c', 'start "" ' + quoteWinArg(target)], shell: false };
      if (isLinux) return { file: 'xdg-open', args: [String(target)], shell: false };
      return { file: 'open', args: [String(target)], shell: false };
    },
    revealInFileManager(target) {
      if (isWin) return { file: 'explorer.exe', args: ['/select,' + String(target)], shell: false };
      if (isLinux) return { file: 'xdg-open', args: [path.dirname(String(target))], shell: false };
      return { file: 'open', args: ['-R', String(target)], shell: false };
    },
    /* 查端口占用：macOS 用 lsof；Linux 优先 ss（实测 Ubuntu 24.04 上没有 lsof），lsof 只作兜底；
       Windows 走 netstat -ano（OwningProcess 再交给 tasklist 查名字）。 */
    listenerPlans(port) {
      /* 不传端口就查「所有 TCP 监听」。以前的写法会把 undefined 拼进 argv，
         变成 lsof -iTCP:undefined —— 一个必然报错的参数，属于真 bug。 */
      const p = port === undefined || port === null || port === '' ? '' : String(port);
      const lsofArgs = ['-nP'].concat(p ? ['-iTCP:' + p] : ['-iTCP'], ['-sTCP:LISTEN', '-t']);
      if (isWin) return [{ via: 'netstat', file: 'netstat', args: ['-ano', '-p', 'TCP'] }];
      if (isLinux) {
        /* 实测 Ubuntu 24.04 上没有 lsof，所以 ss 在前、lsof 只当兜底。 */
        return [
          { via: 'ss', file: 'ss', args: ['-ltnp'] },
          { via: 'lsof', file: 'lsof', args: lsofArgs },
        ];
      }
      return [{ via: 'lsof', file: 'lsof', args: lsofArgs }];
    },
    diskInfo() {
      if (isWin) return { file: 'powershell.exe', args: ['-NoProfile', '-Command', 'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,Size,FreeSpace,DriveType | ConvertTo-Json -Compress'] };
      return { file: 'df', args: ['-Pk'] };
    },
    memoryInfo() {
      if (isWin) return { file: 'powershell.exe', args: ['-NoProfile', '-Command', 'Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory | ConvertTo-Json -Compress'] };
      if (isLinux) return { file: 'cat', args: ['/proc/meminfo'] };
      return { file: 'vm_stat', args: [] };
    },
    loadAverage() {
      if (isWin) return null; /* Windows 没有 loadavg 语义，别编一个。 */
      return { file: 'uptime', args: [] };
    },
    networkAddresses() {
      if (isWin) return { file: 'powershell.exe', args: ['-NoProfile', '-Command', 'Get-NetIPAddress -AddressFamily IPv4 | Select-Object IPAddress,InterfaceAlias | ConvertTo-Json -Compress'] };
      if (isLinux) return { file: 'ip', args: ['-o', 'addr'] };
      return { file: 'ifconfig', args: [] };
    },
    /* 第二个参数是「图标落点」（文件路径），不是可选的装饰：
       macOS 的 sips 一直支持 --out，不传就沿用它原来的 /dev/stdout（既有调用方行为不变）；
       Windows 的 Bitmap.Save() 必须有落点，不传 outPath 时**返回 null** ——
       宁可明说「这条路上给不出命令」，也不交出一条 .Save("") 必然抛异常的命令。 */
    appIconExtract(appPath, outPath) {
      if (isMac) return { file: 'sips', args: ['-s', 'format', 'png', String(appPath), '--out', outPath ? String(outPath) : '/dev/stdout'], via: 'sips' };
      if (isWin) {
        if (!outPath) return null;
        return { file: 'powershell.exe', args: ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Drawing; ([System.Drawing.Icon]::ExtractAssociatedIcon(' + quotePsArg(appPath) + ')).ToBitmap().Save(' + quotePsArg(outPath) + ')'], via: 'powershell' };
      }
      return null; /* Linux 的图标来自 .desktop 的 Icon=，不需要提取可执行文件图标。 */
    },
    launchApp(app) {
      if (isMac) return { file: 'open', args: ['-a', String(app)], shell: false };
      if (isWin) return { file: String(app), args: [], shell: false };
      return { file: 'gtk-launch', args: [path.basename(String(app)).replace(/\.desktop$/, '')], shell: false };
    },
    packageInstall(pm, pkg) {
      const table = {
        brew: ['brew', ['install', pkg]],
        mas: ['mas', ['install', pkg]],
        apt: ['sudo', ['apt-get', 'install', '-y', pkg]],
        dnf: ['sudo', ['dnf', 'install', '-y', pkg]],
        pacman: ['sudo', ['pacman', '-S', '--noconfirm', pkg]],
        zypper: ['sudo', ['zypper', 'install', '-y', pkg]],
        snap: ['sudo', ['snap', 'install', pkg]],
        flatpak: ['flatpak', ['install', '-y', 'flathub', pkg]],
        winget: ['winget', ['install', '--id', pkg, '-e', '--accept-source-agreements']],
        choco: ['choco', ['install', pkg, '-y']],
        scoop: ['scoop', ['install', pkg]],
        npm: ['npm', ['install', '-g', pkg]],
      };
      const row = table[pm];
      return row ? { file: row[0], args: row[1], shell: false } : null;
    },
    installHint(kind) {
      const hints = {
        node: { darwin: 'brew install node', linux: 'sudo apt-get install -y nodejs npm  # 或 nvm', win32: 'winget install OpenJS.NodeJS.LTS' },
        git: { darwin: 'brew install git', linux: 'sudo apt-get install -y git', win32: 'winget install Git.Git' },
        docker: { darwin: 'brew install --cask docker', linux: 'sudo apt-get install -y docker.io', win32: 'winget install Docker.DockerDesktop' },
        'code-server': { darwin: 'curl -fsSL https://code-server.dev/install.sh | sh', linux: 'curl -fsSL https://code-server.dev/install.sh | sh', win32: 'npm install -g code-server  # Windows 走 npm 包' },
        rsync: { darwin: 'brew install rsync', linux: 'sudo apt-get install -y rsync', win32: 'winget install RsyncProject.WindowsRsync' },
        ssh: { darwin: '系统自带 ssh', linux: 'sudo apt-get install -y openssh-client', win32: 'winget install Microsoft.OpenSSH.Beta' },
      };
      const row = hints[kind];
      if (!row) return null;
      return { kind, command: row[id] || row.linux, target: id };
    },
  };

  /* 废纸篓/回收站计划（纯函数，只给计划不执行）。 */
  function trashPlan(target) {
    /* Windows 分支把 full 直接写进 PowerShell 脚本，仿真 win32 时必须按 Windows 语义解析，
       否则 path.resolve 会把宿主 cwd 拼在 'C:\...' 前面（真 Windows 上 path 本来就是 win32，行为不变）。 */
    const full = isWin ? winPath.resolve(String(target)) : path.resolve(String(target));
    if (isMac) {
      return { ok: true, method: 'finder', command: { file: 'osascript', args: ['-e', 'tell application "Finder" to delete POSIX file ' + JSON.stringify(full)], shell: false }, note: '经 Finder 进废纸篓，可以从废纸篓还原' };
    }
    if (isWin) {
      const script = 'Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile("' + full.replace(/"/g, '') + '","OnlyErrorDialogs","SendToRecycleBin")';
      const dirScript = 'Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory("' + full.replace(/"/g, '') + '","OnlyErrorDialogs","SendToRecycleBin")';
      const isDir = exists(full) && (() => { try { return fs.statSync(full).isDirectory(); } catch (_) { return false; } })();
      return { ok: true, method: 'recycle-bin', command: { file: 'powershell.exe', args: ['-NoProfile', '-Command', isDir ? dirScript : script], shell: false }, note: '进系统回收站' };
    }
    /* Linux：按 XDG 规范自己写 files/ 与 info/*.trashinfo，与桌面环境的废纸篓互通。 */
    const trashRoot = path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'Trash');
    const base = path.basename(full);
    return {
      ok: true,
      method: 'xdg-trash',
      trashRoot,
      moves: [{ from: full, to: path.join(trashRoot, 'files', base) }],
      files: [{ path: path.join(trashRoot, 'info', base + '.trashinfo'), content: '[Trash Info]\nPath=' + encodeURI(full) + '\nDeletionDate=' + new Date().toISOString().replace(/\.\d+Z$/, '') + '\n' }],
      note: '写 XDG 废纸篓：files/ 放内容，info/ 放路径与删除时间',
    };
  }

  /* 应用扫描根：三个平台各一套，Windows 从开始菜单与 Program Files 找。 */
  function appRoots() {
    /* source 必须是**机器可读**的值：lib/system-software.js 用它决定排序优先级、
       是否算「系统自带」（system === 'apple'）以及能不能卸载（uninstallable）。
       中文只放 label，是给人看的 —— 上一版把 source 写成中文，直接导致 macOS 上
       rank[source] 变 NaN、系统自带应用被标成「可卸载」，属于危险的回归。 */
    if (isMac) return [
      { dir: '/Applications', source: 'system', label: '系统应用' },
      { dir: '/System/Applications', source: 'apple', label: '系统内置' },
      { dir: '/System/Applications/Utilities', source: 'apple', label: '系统工具' },
      { dir: path.join(home, 'Applications'), source: 'user', label: '用户应用' },
    ];
    if (isWin) return [
      { dir: winPath.join(env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'), source: 'system', label: '开始菜单（全局）' },
      { dir: winPath.join(env.APPDATA || winPath.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), source: 'user', label: '开始菜单（用户）' },
      { dir: env.ProgramFiles || 'C:\\Program Files', source: 'system', label: 'Program Files' },
      { dir: env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', source: 'system', label: 'Program Files (x86)' },
      { dir: winPath.join(env.LOCALAPPDATA || winPath.join(home, 'AppData', 'Local'), 'Programs'), source: 'user', label: '用户安装' },
    ];
    return [
      { dir: '/usr/share/applications', source: 'system', label: '系统应用' },
      { dir: '/usr/local/share/applications', source: 'system', label: '本地应用' },
      { dir: path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'applications'), source: 'user', label: '用户应用' },
      { dir: path.join(home, '.local', 'share', 'flatpak', 'exports', 'share', 'applications'), source: 'flatpak', label: 'Flatpak' },
      { dir: '/var/lib/snapd/desktop/applications', source: 'snap', label: 'Snap' },
    ];
  }

  /* .desktop 解析：纯字符串函数 —— 我在 macOS 上就能拿真实 Ubuntu 的 .desktop 内容验收。 */
  function parseDesktopEntry(text) {
    if (!text || typeof text !== 'string') return null;
    const section = text.split(/^\[/m).find((block) => /^Desktop Entry\]/.test(block));
    if (!section) return null;
    const get = (key) => {
      const match = new RegExp('^' + key + '=(.*)$', 'm').exec(section);
      return match ? match[1].trim() : '';
    };
    /* 已翻译名优先给中文，没有就用默认 Name。 */
    const name = get('Name\\[zh_CN\\]') || get('Name\\[zh\\]') || get('Name');
    const execLine = get('Exec');
    const noDisplay = /^(true|1)$/i.test(get('NoDisplay')) || /^(true|1)$/i.test(get('Hidden'));
    const type = get('Type');
    if (!name || !execLine || (type && type !== 'Application')) return null;
    /* NoDisplay/Hidden 不再直接丢掉：它们也是「装在这台机器上的东西」，
       调用方（软件清单）自己决定要不要显示，而不是在这里替它决定。 */
    return {
      name,
      exec: execLine.replace(/%[fFuUdDnNickvm]/g, '').trim(),
      icon: get('Icon'),
      categories: get('Categories'),
      comment: get('Comment\\[zh_CN\\]') || get('Comment'),
      terminal: /^(true|1)$/i.test(get('Terminal')),
      noDisplay,
    };
  }

  /* 保护区：这是安全线，不是提示线 —— 面板的删除能力必须永远绕开它们。
     Linux 按 FHS，Windows 按 %SystemRoot% 与 Program Files 系列，macOS 按 SIP 常见路径。 */
  function protectedRoots() {
    if (isWin) {
      return [systemRoot, env.ProgramFiles || 'C:\\Program Files', env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', env.ProgramData || 'C:\\ProgramData', winPath.join(systemRoot, 'System32')];
    }
    if (isLinux) return ['/bin', '/sbin', '/lib', '/lib64', '/usr', '/etc', '/var', '/boot', '/proc', '/sys', '/dev', '/snap', '/opt'];
    return ['/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/private', '/dev', '/etc', '/var', '/Volumes', '/opt/homebrew'];
  }

  /* 纯候选表：只回答「这个平台通常有哪些包管理器」，不探测、不执行。
     真正探测可用性用 detectPackageManagers()，好让 report() 保持零副作用。 */
  function packageManagers() {
    const wanted = isWin
      ? [['winget', 'winget'], ['choco', 'Chocolatey'], ['scoop', 'Scoop']]
      : isLinux
        ? [['apt', 'APT'], ['dnf', 'DNF'], ['pacman', 'Pacman'], ['zypper', 'Zypper'], ['snap', 'Snap'], ['flatpak', 'Flatpak']]
        : [['brew', 'Homebrew'], ['mas', 'Mac App Store']];
    return wanted.map(([pm, pmLabel]) => ({ id: pm, label: pmLabel, installHint: pm }));
  }

  function detectPackageManagers() {
    return packageManagers().map((pm) => Object.assign({}, pm, { path: which(pm.id), available: !!which(pm.id) }));
  }

  /* 给界面直接渲染的能力自述：纯数据，不执行任何命令。 */
  function report() {
    const adapters = {
      openExternal: isMac ? { ok: true, via: 'open' } : isWin ? { ok: true, via: 'cmd start' } : { ok: true, via: 'xdg-open' },
      reveal: isMac ? { ok: true, via: 'open -R' } : isWin ? { ok: true, via: 'explorer /select' } : { ok: true, via: 'xdg-open 目录' },
      trash: isMac ? { ok: true, via: 'Finder 废纸篓' } : isWin ? { ok: true, via: '回收站(SendToRecycleBin)' } : { ok: true, via: 'XDG ~/.local/share/Trash' },
      apps: { ok: true, via: isMac ? '.app 扫描' : isWin ? '开始菜单 .lnk + Program Files' : '.desktop 解析' },
      icons: isMac ? { ok: true, via: 'sips 提取 .icns' } : isWin ? { ok: true, via: 'PowerShell ExtractAssociatedIcon' } : { ok: true, via: '.desktop 的 Icon= 查表' },
      packages: { ok: true, via: packageManagers().map((pm) => pm.label).join(' / '), candidates: packageManagers().map((pm) => pm.id) },
      ports: isMac ? { ok: true, via: 'lsof' } : isWin ? { ok: true, via: 'netstat -ano' } : { ok: true, via: 'ss（无 lsof 时兜底）' },
      disk: isMac ? { ok: true, via: 'df -Pk' } : isWin ? { ok: true, via: 'Win32_LogicalDisk' } : { ok: true, via: 'df -Pk' },
      memory: isMac ? { ok: true, via: 'vm_stat' } : isWin ? { ok: true, via: 'Win32_OperatingSystem' } : { ok: true, via: '/proc/meminfo' },
      network: isMac ? { ok: true, via: 'ifconfig' } : isWin ? { ok: true, via: 'Get-NetIPAddress' } : { ok: true, via: 'ip -o addr' },
    };
    const missing = Object.keys(adapters).filter((key) => !adapters[key].ok);
    return {
      id, label, arch, release, home, appDataDir, systemRoot,
      shell: isWin ? null : (env.SHELL || (isMac ? '/bin/zsh' : '/bin/bash')),
      npmCmd: isWin ? 'npm.cmd' : 'npm',
      exeSuffix: isWin ? '.exe' : '',
      pathSep: isWin ? winPath.delimiter : path.delimiter,
      sep: isWin ? winPath.sep : path.sep,
      adapters,
      adaptersReady: Object.keys(adapters).filter((key) => adapters[key].ok),
      adaptersMissing: missing,
    };
  }

  /* 子进程规格：Windows 上的 .cmd（npm/npx/where…）必须经 shell，否则 spawn 直接 EINVAL。
     参数一律由本模块用 quoteWinArg 处理；调用方不要把用户输入拼进命令名。 */
  function spawnSpec(cmd, args = []) {
    const list = args.map(String);
    if (isWin && /\.(cmd|bat)$/i.test(String(cmd))) {
      return { file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', [String(cmd), ...list.map(quoteWinArg)].join(' ')], shell: false, windowsHide: true };
    }
    return { file: String(cmd), args: list, shell: false, windowsHide: isWin };
  }

  return {
    id, isMac, isWin, isLinux, label, arch, release, home, appDataDir, systemRoot,
    sep: isWin ? winPath.sep : path.sep, pathSep: isWin ? winPath.delimiter : path.delimiter, exeSuffix: isWin ? '.exe' : '',
    shell: isWin ? null : (env.SHELL || (isMac ? '/bin/zsh' : '/bin/bash')),
    npmCmd: isWin ? 'npm.cmd' : 'npm',
    nodeBin: options.nodeBin || process.execPath,
    searchDirs, which, commands, trashPlan, appRoots, parseDesktopEntry, protectedRoots, packageManagers, detectPackageManagers, report, spawnSpec,
  };
}

const HOST = createPlatformHost();

module.exports = { createPlatformHost, HOST, PLATFORM_IDS };
