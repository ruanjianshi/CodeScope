'use strict';
/*
 * life-index.js —— 「我的工作台」的数据引擎
 * ---------------------------------------------------------------------------
 * 扫本机文件，按**研究方向**归类，产出工作台要的所有数据。
 *
 * 设计取舍：
 *  · 不做全盘扫描（几十万文件又慢又没意义）。只扫「用户真正放东西的那几层」：
 *    家目录下一层 + 几个约定目录（Desktop/Documents/Downloads/iCloud），再往里一层。
 *  · 归类**优先看路径关键词**（用户自己的命名最准），文件类型只作兜底。
 *  · 纯 Node，无依赖，可单测（tests/life-index.js）。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();

/* 扫这一层 + 往下一层（够看清项目结构，又不会失控） */
const SCAN_BASES = [
  { dir: 'Desktop', weight: 3 },
  { dir: 'Documents', weight: 2 },
  { dir: 'Downloads', weight: 1 },
  { dir: path.join('Library/Mobile Documents/com~apple~CloudDocs'), weight: 3, label: 'iCloud 云盘' },
];

/* 这些容器目录要**再往里一层**找项目 —— 用户习惯在它们下面按主题分目录
   （如 iCloud/CodeBase/RL_projects、iCloud/Yanjiu/机器人）。
   只扫一层的话这些真正的项目全漏了（实测踩过）。 */
const CONTAINER_DIRS = new Set(['codebase', 'yanjiu', '研究', '我的项目', 'projects', '工作', 'work', 'mycode', 'mycode_副本', 'code_projects']);

/* 归类规则：按路径/名字里的关键词。顺序即优先级。 */
const TRACKS = [
  {
    id: 'robot', name: '机器人运动控制', icon: '🤖', color: '#4f8cff',
    kw: ['robot', '机器人', 'motion', '运动', '轮腿', '双足', '步态', '跳跃', '走台阶', 'mpc', '观测器', 'observer', 'gait', 'legged', 'bingda', 'nanorobot', 'myrobot', '小车', '平衡'],
  },
  {
    id: 'rl', name: '强化学习 / 智能控制', icon: '🧠', color: '#a371f7',
    kw: ['rl', 'reinforce', 'actor_critic', 'actor-critic', 'ppo', 'sac', 'ddpg', '强化学习', '神经网络', 'policy', 'gym', 'isaac'],
  },
  {
    id: 'embedded', name: '嵌入式开发', icon: '🔌', color: '#3fb950',
    kw: ['embedded', '嵌入式', 'stm32', 'jetson', 'keil', 'firmware', '固件', 'hal', '寄存器', 'uart', 'can', 'spi', 'i2c', 'freertos', 'ros', '单片机', 'nano', 'zhaoming'],
  },
  {
    id: 'paper', name: '论文撰写', icon: '📄', color: '#f0883e',
    kw: ['paper', 'manuscript', '论文', '投稿', 'latex', 'tex', '开题', '摘要', 'abstract', 'reference', '文献', '期刊', '审稿', 'revision', '返修', '汇报ppt'],
  },
  {
    id: 'theory', name: '基础理论 / 学习', icon: '📚', color: '#39c5cf',
    kw: ['基础理论', '理论', '机械', '数学', 'math', '控制', 'control', 'dynamics', '动力学', '运动学', '英语', '复习', '面试', '教程', 'book', '教材', 'notes', '笔记', 'yanjiu', '研究'],
  },
  {
    id: 'tool', name: '工具与工程', icon: '🧰', color: '#d29922',
    kw: ['codebase', 'code_projects', 'mycode', 'script', 'cmd脚本', 'python', 'c++', '项目', 'project', 'tool', '工具', '配置'],
  },
];

const CODE_EXT = new Set(['.c', '.h', '.cpp', '.hpp', '.cc', '.py', '.m', '.js', '.ts', '.java', '.rs', '.go', '.sh', '.cu']);
const DOC_EXT = new Set(['.pdf', '.docx', '.doc', '.tex', '.md', '.txt', '.pptx', '.ppt', '.xlsx', '.xls']);
const MEDIA_EXT = new Set(['.mp4', '.mov', '.png', '.jpg', '.jpeg', '.svg', '.gif', '.aseprite', '.drawio', '.xmind', '.canvas', '.excalidraw']);
const MODEL_EXT = new Set(['.stl', '.step', '.stp', '.igs', '.iges', '.obj', '.f3d', '.sldprt', '.sldasm', '.dxf', '.dwg']);

function classifyByName(name) {
  const low = String(name || '').toLowerCase();
  for (const t of TRACKS) {
    for (const k of t.kw) if (low.includes(k)) return t.id;
  }
  return '';
}
function fileKind(ext) {
  if (CODE_EXT.has(ext)) return 'code';
  if (DOC_EXT.has(ext)) return 'doc';
  if (MODEL_EXT.has(ext)) return 'model';
  if (MEDIA_EXT.has(ext)) return 'media';
  return 'other';
}

/* 递归统计一个目录（限制深度和条目数，避免卡死） */
function walk(dir, opts) {
  const o = opts || {};
  const maxDepth = o.maxDepth == null ? 3 : o.maxDepth;
  const maxFiles = o.maxFiles == null ? 4000 : o.maxFiles;
  const skip = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'build', '__pycache__', '.venv', 'venv', '.cache', 'Library']);
  const out = { files: 0, size: 0, byExt: {}, byKind: {}, newest: 0, dirs: [], recent: [], sample: [] };
  const stack = [{ d: dir, depth: 0 }];
  while (stack.length && out.files < maxFiles) {
    const cur = stack.pop();
    let list = [];
    try { list = fs.readdirSync(cur.d, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of list) {
      if (e.name.startsWith('.') || skip.has(e.name)) continue;
      const full = path.join(cur.d, e.name);
      if (e.isDirectory()) {
        if (cur.depth === 0) out.dirs.push(e.name);
        if (cur.depth + 1 < maxDepth) stack.push({ d: full, depth: cur.depth + 1 });
        continue;
      }
      let st;
      try { st = fs.statSync(full); } catch (_) { continue; }
      const ext = path.extname(e.name).toLowerCase();
      const kind = fileKind(ext);
      out.files++;
      out.size += st.size;
      out.byExt[ext || '(无扩展名)'] = (out.byExt[ext || '(无扩展名)'] || 0) + 1;
      out.byKind[kind] = (out.byKind[kind] || 0) + 1;
      if (st.mtimeMs > out.newest) out.newest = st.mtimeMs;
      const rec = { name: e.name, path: full, ext, kind, size: st.size, mtime: st.mtimeMs };
      out.recent.push(rec);
      if (out.sample.length < 6 && (kind === 'code' || kind === 'doc')) out.sample.push(rec);
      if (out.files >= maxFiles) break;
    }
  }
  out.recent.sort((a, b) => b.mtime - a.mtime);
  out.recent = out.recent.slice(0, 40);
  return out;
}

/* 扫一层目录（只列名字 + 判断是不是目录），用来发现"用户的项目" */
function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => ({ name: e.name, dir: e.isDirectory(), path: path.join(dir, e.name) }));
  } catch (_) { return []; }
}

function fmtBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = Number(n) || 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
}

/*
 * 主入口：扫出「工作台」需要的全部数据。
 * 返回 { ok, scannedAt, tracks, projects, recent, stats, hot }
 */
function buildIndex(opts) {
  const o = opts || {};
  const maxDepth = o.maxDepth == null ? 3 : o.maxDepth;
  const projects = [];
  const recentAll = [];

  for (const base of SCAN_BASES) {
    const root = path.join(HOME, base.dir);
    if (!fs.existsSync(root)) continue;
    for (const child of listDir(root)) {
      if (!child.dir) {
        /* 顶层散文件也算（很多人把论文直接丢在桌面/下载） */
        let st; try { st = fs.statSync(child.path); } catch (_) { continue; }
        const ext = path.extname(child.name).toLowerCase();
        recentAll.push({ name: child.name, path: child.path, ext, kind: fileKind(ext), size: st.size, mtime: st.mtimeMs, base: base.label || base.dir });
        continue;
      }
      const trackId = classifyByName(child.name) || classifyByName(base.dir);
      const info = walk(child.path, { maxDepth: maxDepth - 1 });
      const track = TRACKS.find((t) => t.id === trackId);
      projects.push({
        name: child.name,
        path: child.path,
        base: base.label || base.dir,
        weight: base.weight,
        track: track ? track.id : 'other',
        trackName: track ? track.name : '其他',
        files: info.files,
        size: info.size,
        sizeText: fmtBytes(info.size),
        newest: info.newest,
        dirs: info.dirs.slice(0, 12),
        byKind: info.byKind,
        sample: info.sample,
        recent: info.recent.slice(0, 8),
      });
      recentAll.push(...info.recent.map((r) => ({ ...r, base: base.label || base.dir })));

      /* 容器目录（CodeBase / Yanjiu / …）要再往里一层找真项目，
         否则 RL_projects、Jetson_nano_X1、机器人 这些全被当成一个普通目录埋掉 ✗ */
      if (CONTAINER_DIRS.has(child.name.toLowerCase())) {
        for (const sub of listDir(child.path)) {
          if (!sub.dir) continue;
          const subTrackId = classifyByName(sub.name) || trackId;
          const subInfo = walk(sub.path, { maxDepth: Math.max(1, maxDepth - 2) });
          if (!subInfo.files) continue;
          const subTrack = TRACKS.find((t) => t.id === subTrackId);
          projects.push({
            name: sub.name,
            path: sub.path,
            base: (base.label || base.dir) + ' / ' + child.name,
            weight: base.weight,
            track: subTrack ? subTrack.id : 'other',
            trackName: subTrack ? subTrack.name : '其他',
            files: subInfo.files,
            size: subInfo.size,
            sizeText: fmtBytes(subInfo.size),
            newest: subInfo.newest,
            dirs: subInfo.dirs.slice(0, 12),
            byKind: subInfo.byKind,
            sample: subInfo.sample,
            recent: subInfo.recent.slice(0, 8),
          });
          recentAll.push(...subInfo.recent.map((r) => ({ ...r, base: (base.label || base.dir) + ' / ' + child.name })));
        }
      }
    }
  }

  /* 全局统计 */
  const byKind = {}, byExt = {};
  let totalFiles = 0, totalSize = 0;
  for (const p of projects) {
    totalFiles += p.files; totalSize += p.size;
    for (const k of Object.keys(p.byKind)) byKind[k] = (byKind[k] || 0) + p.byKind[k];
  }
  for (const r of recentAll) byExt[r.ext || '(无)'] = (byExt[r.ext || '(无)'] || 0) + 1;

  /* 按方向聚合 */
  const tracks = TRACKS.map((t) => {
    const ps = projects.filter((p) => p.track === t.id);
    const files = ps.reduce((a, p) => a + p.files, 0);
    const size = ps.reduce((a, p) => a + p.size, 0);
    const newest = ps.reduce((a, p) => Math.max(a, p.newest), 0);
    return { id: t.id, name: t.name, icon: t.icon, color: t.color, projects: ps.length, files, size, sizeText: fmtBytes(size), newest,
      list: ps.sort((a, b) => b.newest - a.newest).slice(0, 8) };
  });

  /* 最近改动（去重 + 排序） */
  const seen = new Set();
  const recent = recentAll
    .filter((r) => { if (seen.has(r.path)) return false; seen.add(r.path); return true; })
    .sort((a, b) => b.mtime - a.mtime).slice(0, 60);

  /* 近 14 天热力（按天统计改动文件数）。
     ⚠️ 必须用**本地日期**算 —— `toISOString()` 是 UTC，在东八区会把凌晨算到前一天，
     导致"今天 0 个改动"但热力图明明有活动（实测踩到）。 */
  const localDay = (ms) => {
    const d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const days = [];
  const now = Date.now();
  for (let i = 13; i >= 0; i--) {
    const d0 = new Date(now - i * 86400000); d0.setHours(0, 0, 0, 0);
    const d1 = new Date(d0.getTime() + 86400000);
    const n = recentAll.filter((r) => r.mtime >= d0.getTime() && r.mtime < d1.getTime()).length;
    days.push({ date: localDay(d0.getTime()), label: (d0.getMonth() + 1) + '/' + d0.getDate(), count: n });
  }

  return {
    ok: true,
    scannedAt: Date.now(),
    home: HOME,
    profile: { role: '研究生', focus: ['机器人运动控制', '嵌入式开发', '论文撰写'] },
    totals: { projects: projects.length, files: totalFiles, size: totalSize, sizeText: fmtBytes(totalSize) },
    tracks: tracks.filter((t) => t.projects > 0).sort((a, b) => b.newest - a.newest),
    projects: projects.sort((a, b) => b.newest - a.newest),
    recent,
    byKind,
    byExt,
    days,
  };
}

module.exports = { buildIndex, walk, classifyByName, fileKind, fmtBytes, TRACKS, SCAN_BASES, HOME };
