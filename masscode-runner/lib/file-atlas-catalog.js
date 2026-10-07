'use strict';
/**
 * 文件全景 · 解释说明目录（catalog）
 *
 * 回答三个问题：**这是什么** / **能不能动** / **动了会怎样**。
 * 覆盖 macOS / Linux / Windows 三平台的系统目录、应用数据目录、缓存、临时区、
 * 开发产物目录，以及"按文件类型"的分类（视频/图片/代码/压缩包/安装包…）。
 *
 * 这里的解释是**目录级常识**，不是对具体文件内容的读取：本模块不打开文件内容，
 * 只按路径、文件名与扩展名给出说明，因此永远不会泄露用户的文件内容。
 */

/** 扩展名 → 文件类型（用于"按类型"查阅全貌） */
const KIND_BY_EXT = {
  视频: ['.mp4', '.mov', '.mkv', '.avi', '.flv', '.wmv', '.webm', '.m4v', '.rmvb', '.mpg', '.mpeg'],
  图片: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.tiff', '.tif', '.bmp', '.svg', '.raw', '.cr2', '.nef', '.psd', '.ai'],
  音频: ['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.aiff', '.ape'],
  文档: ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.md', '.pages', '.epub', '.mobi', '.tex'],
  表格: ['.xls', '.xlsx', '.csv', '.numbers', '.ods'],
  演示: ['.ppt', '.pptx', '.key', '.odp'],
  代码: ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php', '.sh', '.bash', '.zsh', '.fish', '.lua', '.sql', '.vue', '.svelte', '.html', '.css', '.scss', '.less', '.json', '.yaml', '.yml', '.toml', '.ini'],
  压缩包: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tgz', '.dmg', '.iso'],
  安装包: ['.pkg', '.mpkg', '.exe', '.msi', '.deb', '.rpm', '.appimage', '.apk'],
  字体: ['.ttf', '.otf', '.woff', '.woff2', '.ttc'],
  数据库: ['.sqlite', '.sqlite3', '.db', '.realm', '.mdb'],
  日志: ['.log', '.crash', '.dmp', '.trace'],
  虚拟磁盘: ['.vmdk', '.qcow2', '.vdi', '.vhdx', '.sparseimage'],
  模型: ['.gguf', '.safetensors', '.onnx', '.pt', '.pth', '.ckpt', '.bin'],
  邮件: ['.eml', '.msg', '.mbox', '.pst'],
};

const EXT_TO_KIND = (() => {
  const map = new Map();
  for (const kind of Object.keys(KIND_BY_EXT)) for (const ext of KIND_BY_EXT[kind]) map.set(ext, kind);
  return map;
})();

function extOf(value) {
  const text = String(value == null ? '' : value);
  const base = text.slice(Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

function kindOf(value) {
  return EXT_TO_KIND.get(extOf(value)) || '其它';
}

/**
 * 目录说明规则。每条：{ when, title, what, advice, safe }
 *   when  —— 命中条件（平台 + 路径前缀 / 所需路径段 / 文件名正则）
 *   safe  —— never（永不可删）| ask（要人工确认）| yes（可再生，可清理）
 * 顺序即优先级：越具体的规则放越前面。
 */
const RULES = [
  // ── 用户身份与密钥：最高红线 ──
  { seg: '.ssh', platform: ['darwin', 'linux', 'win32'], title: 'SSH 密钥与配置', what: '你的私钥、公钥、known_hosts：登录服务器、推送代码全靠它。', advice: '绝不能删、不能同步进云盘、不能给别人。', safe: 'never' },
  { seg: '.gnupg', title: 'GPG 密钥环', what: '加密与签名的私钥。', advice: '删掉等于永久丢失加密能力。', safe: 'never' },
  { seg: '.aws', title: 'AWS 凭证', what: '云服务访问密钥。', advice: '绝不能删，也不能外传。', safe: 'never' },
  { seg: '.kube', title: 'Kubernetes 配置', what: '集群访问凭证。', advice: '删掉会失去对集群的控制权。', safe: 'never' },
  { seg: '.codescope', title: 'CodeScope 自身数据', what: '这个面板的安装、日志、备份。', advice: '由 CodeScope 自己管理；手动删会破坏面板。', safe: 'never' },
  { seg: 'markdown-vault', title: '你的笔记库', what: '知识库正文（Markdown）。', advice: '这是你的内容资产，任何自动清理都不许碰。', safe: 'never' },
  { seg: '.git', title: 'Git 版本库元数据', what: '提交历史、分支、远端配置。', advice: '删掉会丢失全部历史；要清理请用 git 命令而不是删目录。', safe: 'never' },

  // ── macOS 系统本体 ──
  { prefix: ['/System'], title: 'macOS 系统本体', what: '操作系统自身的文件，受系统完整性保护（SIP）。', advice: '只读；改不动也不该动。', safe: 'never' },
  { prefix: ['/Library'], title: '系统级资源库', what: '全机器共享的字体、偏好、启动项、框架。', advice: '除非在卸载某个软件，否则不要动。', safe: 'never' },
  { prefix: ['/usr', '/bin', '/sbin'], title: 'Unix 系统命令', what: '系统自带的可执行程序与库。', advice: '只读；删任何一个都可能让系统无法启动。', safe: 'never' },
  { prefix: ['/etc'], title: '系统配置', what: '主机名、网络、服务等配置（macOS 上是 /private/etc 的链接）。', advice: '只读；改配置要用系统工具。', safe: 'never' },
  { prefix: ['/private/var/db', '/private/var/vm'], title: '系统数据库与虚拟内存', what: '系统索引、交换文件。', advice: '只读；删除会造成系统异常。', safe: 'never' },
  { prefix: ['/Applications'], title: '已安装的应用', what: '你装的 macOS 应用（.app 包）。', advice: '想卸载请把应用拖到废纸篓，不要在这里批量删。', safe: 'ask' },
  { prefix: ['/cores'], title: '崩溃核心转储', what: '程序崩溃时写下的内存快照。', advice: '可以删，通常只占空间没有用途。', safe: 'yes' },

  // ── macOS 用户资源库 ──
  { prefix: ['~/Library/Caches'], title: '应用缓存', what: '各应用存的临时数据：能重新下载，删了只是第一次打开慢一点。', advice: '可清理；正在运行的应用的缓存最好先退出再清。', safe: 'yes' },
  { prefix: ['~/Library/Logs'], title: '应用日志', what: '应用运行记录，排障用。', advice: '可清理；排障期间先留着。', safe: 'yes' },
  { prefix: ['~/Library/Application Support'], title: '应用数据', what: '应用的数据库、配置、账号状态：**不是缓存**。', advice: '删了相当于把该应用的设置与数据清空，务必确认。', safe: 'ask' },
  { prefix: ['~/Library/Containers', '~/Library/Group Containers'], title: '沙盒应用容器', what: '沙盒应用的文档与数据，往往含你的实际内容。', advice: '不要手动清理，容易丢数据。', safe: 'ask' },
  { prefix: ['~/Library/Preferences'], title: '应用偏好设置', what: '每个应用的 plist 配置。', advice: '删了应用会回到出厂设置。', safe: 'ask' },
  { prefix: ['~/Library/Keychains'], title: '钥匙串', what: '密码、证书、密钥。', advice: '绝不能删。', safe: 'never' },
  { prefix: ['~/Library/Mobile Documents'], title: 'iCloud 同步区', what: 'iCloud Drive 在本地的镜像，你的文档与笔记常在这里。', advice: '文件由 iCloud 管理；本地删除会同步删掉云端，绝不能自动清理。', safe: 'never' },
  { prefix: ['~/Library/Developer/Xcode/DerivedData'], title: 'Xcode 构建产物', what: '编译中间件与索引。', advice: '可清理，下次编译会重新生成（首次编译变慢）。', safe: 'yes' },
  { prefix: ['~/Library/Developer'], title: '开发者工具数据', what: '模拟器、工具链、设备支持文件。', advice: '删了要重新下载，谨慎。', safe: 'ask' },

  // ── Linux ──
  { prefix: ['/var/cache'], platform: ['linux'], title: '系统包缓存', what: 'apt/dnf 下载的软件包。', advice: '可清理，需要时会重新下载。', safe: 'yes' },
  { prefix: ['/var/log'], platform: ['linux'], title: '系统日志', what: '内核与服务日志。', advice: '可清理旧日志（用 journalctl/logrotate），别整体删。', safe: 'yes' },
  { prefix: ['/var/lib'], platform: ['linux'], title: '系统服务状态数据', what: 'Docker、数据库等服务的真实数据。', advice: '删了服务数据就没了，绝不要动。', safe: 'never' },
  { prefix: ['/opt', '/snap'], platform: ['linux'], title: '第三方应用', what: '额外安装的应用与服务。', advice: '用包管理器卸载，不要手删。', safe: 'ask' },
  { prefix: ['/boot'], platform: ['linux'], title: '内核与引导', what: '启动所需的内核与引导装载程序。', advice: '删了系统无法启动。', safe: 'never' },

  // ── Windows ──
  { prefix: ['c:/windows'], platform: ['win32'], title: 'Windows 系统本体', what: '操作系统文件。', advice: '只读；不要动。', safe: 'never' },
  { prefix: ['c:/program files', 'c:/program files (x86)'], platform: ['win32'], title: '已安装的程序', what: '你安装的软件。', advice: '用"应用和功能"卸载，不要手删目录。', safe: 'ask' },
  { prefix: ['c:/programdata'], platform: ['win32'], title: '程序共享数据', what: '所有用户共用的程序数据与配置。', advice: '删了软件会失去配置。', safe: 'ask' },
  { appdata: true, platform: ['win32'], title: '应用数据目录', what: '各应用的配置、缓存与数据。', advice: '缓存部分可清，Local 下的数据目录要谨慎。', safe: 'ask' },

  // ── 通吃的缓存/临时/构建产物 ──
  { seg: 'node_modules', title: 'Node 依赖目录', what: 'npm/pnpm 安装的第三方包，体积常常几百 MB 到几 GB。', advice: '可清理：删掉后在项目里重新 npm install 即可恢复。', safe: 'yes' },
  { seg: ['.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache'], title: 'Python 环境与缓存', what: '虚拟环境或字节码缓存。', advice: '可清理；虚拟环境删了要重新装依赖。', safe: 'yes' },
  { seg: ['.gradle', '.m2', '.cargo', '.npm', '.pnpm-store', '.yarn'], title: '构建工具缓存', what: '依赖包与构建中间产物。', advice: '可清理，下次构建会重新下载（耗时）。', safe: 'yes' },
  { seg: ['target', 'dist', 'build', '.next', '.nuxt', '.output', '.turbo', 'DerivedData'], title: '构建产物', what: '编译输出目录，可由源码重新生成。', advice: '可清理；删后需重新构建。', safe: 'yes' },
  { prefix: ['/tmp', '/private/tmp', '/private/var/tmp', '/var/tmp'], title: '临时目录', what: '程序运行期间的临时文件，重启后多半无用。', advice: '可清理；正在运行的程序正在用的临时文件应跳过。', safe: 'yes' },
  { prefix: ['~/.Trash'], title: '废纸篓', what: '你之前删掉但还没真正删除的文件。', advice: '清空即永久删除，请先确认里面没有还要的东西。', safe: 'ask' },
  { prefix: ['~/Downloads'], title: '下载目录', what: '浏览器与各种工具下载的文件。', advice: '通常可以按时间清理旧文件，但里面也可能有你要留的安装包。', safe: 'ask' },
  { prefix: ['~/Desktop', '~/Documents', '~/Pictures', '~/Movies', '~/Music'], title: '你的个人内容', what: '桌面、文档、图片、影片、音乐：你的资产本体。', advice: '只在你自己决定时才动；任何自动清理都不许碰。', safe: 'never' },
  { prefix: ['~/.cache'], title: '用户缓存', what: '各种命令行工具与应用的缓存。', advice: '可清理。', safe: 'yes' },
  { name: /^\.DS_Store$/, title: 'macOS 目录元数据', what: 'Finder 记录图标位置等信息的隐藏文件。', advice: '可以删；Finder 会再生成。', safe: 'yes' },
  { name: /^Thumbs\.db$/, title: 'Windows 缩略图缓存', what: '资源管理器的缩略图数据库。', advice: '可以删。', safe: 'yes' },
  { name: /sync-conflict/i, title: '同步冲突副本', what: '同步软件发现两边都改了，保留的另一份。', advice: '里面可能是你唯一的内容，必须先人工比对再处理。', safe: 'never' },
  { extClass: '安装包', title: '安装包', what: '软件安装文件（.dmg/.pkg/.exe/…）。', advice: '装完通常可以删；但重装时还得再下载。', safe: 'ask' },
  { extClass: '日志', title: '日志文件', what: '运行记录。', advice: '可清理。', safe: 'yes' },
  { extClass: '压缩包', title: '压缩包', what: '打包的文件（可能是备份）。', advice: '删前确认里面内容已解压保留。', safe: 'ask' },
];

function normalize(value) {
  return String(value == null ? '' : value).replace(/\\/g, '/');
}

function matchRule(rule, target, platform, home) {
  if (rule.platform && !rule.platform.includes(platform)) return false;
  const homeKey = normalize(home || require('os').homedir()).toLowerCase();
  const path = normalize(target).toLowerCase();
  const segments = path.split('/').filter(Boolean);
  const base = segments.length ? segments[segments.length - 1] : '';
  if (rule.seg) {
    const wanted = Array.isArray(rule.seg) ? rule.seg : [rule.seg];
    if (!wanted.some((item) => segments.includes(String(item).toLowerCase()))) return false;
  }
  if (rule.prefix) {
    const list = Array.isArray(rule.prefix) ? rule.prefix : [rule.prefix];
    const hit = list.some((item) => {
      /* 规则里的 ~ 必须按调用方给的 home 展开，否则 ~/Library/... 这类规则永远不命中。 */
      let prefix = normalize(item).toLowerCase();
      if (prefix === '~') prefix = homeKey;
      else if (prefix.startsWith('~/')) prefix = homeKey + prefix.slice(1);
      return path === prefix || path.startsWith(prefix + '/');
    });
    if (!hit) return false;
  }
  if (rule.appdata) {
    if (!/\/appdata\/(local|roaming|locallow)(\/|$)/.test(path)) return false;
  }
  if (rule.name && !rule.name.test(base)) return false;
  if (rule.extClass && kindOf(target) !== rule.extClass) return false;
  return true;
}

/**
 * 给出一个路径的解释说明。
 * @returns {{title:string, what:string, advice:string, safe:'never'|'ask'|'yes', kind:string, matched:boolean}}
 */
function explainPath(target, options = {}) {
  const platform = options.platform || process.platform;
  const home = options.home || require('os').homedir();
  /* 规则里大量使用 ~/… ：匹配前必须把 ~ 展开，否则所有家目录规则都会失效。 */
  const raw = normalize(target).trim();
  const expanded = raw === '~' ? normalize(home) : (raw.startsWith('~/') ? normalize(home) + raw.slice(1) : raw);
  const kind = kindOf(expanded);
  for (const rule of RULES) {
    if (!matchRule(rule, expanded, platform, home)) continue;
    return { title: rule.title, what: rule.what, advice: rule.advice, safe: rule.safe, kind, matched: true };
  }
  const fallback = {
    never: { what: '这个位置属于系统或你的个人内容。', advice: '不在自动清理范围内。', safe: 'never' },
    ask: { what: '应用或用户相关文件。', advice: '要动它请先确认用途。', safe: 'ask' },
    yes: { what: '属于可再生或临时文件。', advice: '通常可清理。', safe: 'yes' },
  };
  const tier = options.tier || '';
  const safe = tier === 'L2-cache' || tier === 'L3-temp' ? 'yes' : (tier === 'L1-app' ? 'ask' : 'never');
  return {
    title: kind === '其它' ? '普通文件' : kind + '文件',
    what: fallback[safe].what,
    advice: fallback[safe].advice,
    safe,
    kind,
    matched: false,
  };
}

/** 给目录用的批量说明（按层级查阅时，每层挂一句解释）。 */
function explainMany(targets, options = {}) {
  return (Array.isArray(targets) ? targets : []).map((target) => Object.assign({ path: target }, explainPath(target, options)));
}

module.exports = {
  explainPath,
  explainMany,
  kindOf,
  extOf,
  KIND_BY_EXT,
  KIND_IDS: ['视频', '图片', '音频', '文档', '表格', '演示', '代码', '压缩包', '安装包', '字体', '数据库', '日志', '虚拟磁盘', '模型', '邮件', '其它'],
  RULES,
  _internal: { matchRule, EXT_TO_KIND, normalize },
};
