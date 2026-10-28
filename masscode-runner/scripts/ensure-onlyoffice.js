#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
/* ★ 密钥逻辑**只此一份** ✓（2026-10-28）—— server.js 签发 token 用的是同一个模块 ✓，
   两处各写一套「密钥在哪、怎么生成」必然漂移 ✗（症状：编辑器白屏 + 容器日志说 token 校验失败 ✗）。 */
const { ensureOnlyOfficeJwtSecret, onlyOfficeJwtSecretFile } = require('../lib/office-engine');

const root = path.resolve(__dirname, '..');
const composeFile = path.join(root, 'docker-compose.onlyoffice.yml');

function dataRoot() {
  if (process.env.CODESCOPE_DATA_HOME) return path.resolve(process.env.CODESCOPE_DATA_HOME);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Application Support', 'CodeScope');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'CodeScope');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'CodeScope');
}

function connectionUrl() {
  if (process.env.CODESCOPE_ONLYOFFICE_URL) return process.env.CODESCOPE_ONLYOFFICE_URL;
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(dataRoot(), 'office-connection.json'), 'utf8'));
    return saved.publicUrl || '';
  } catch (_) {
    return '';
  }
}

function isManagedLocalUrl(value) {
  try {
    const url = new URL(value);
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname) && Number(url.port || 80) === 8088;
  } catch (_) {
    return false;
  }
}

function healthy(base, timeoutMs = 2200) {
  return new Promise((resolve) => {
    let target;
    try { target = new URL('/healthcheck', base); } catch (_) { resolve(false); return; }
    const client = target.protocol === 'https:' ? https : http;
    const request = client.get(target, { timeout:timeoutMs }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(response.statusCode >= 200 && response.statusCode < 300 && body.toLowerCase().includes('true')));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

function commandAvailable(command) {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio:'ignore' }).status === 0;
}

function run(command, args, quiet = false, extraEnv = null) {
  const result = spawnSync(command, args, {
    cwd:root, encoding:'utf8', stdio:quiet ? 'pipe' : 'inherit',
    /* ⚠️ 显式合并 ✓：compose 里的 `${JWT_ENABLED:?...}` / `${JWT_SECRET:?...}` 就是从这里拿的 ✓。
       不合并（只传 extraEnv）会把 PATH 也一起丢掉 ✗ → docker 直接找不到 ✓。 */
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
  return result.status === 0;
}

/* 正在跑的容器是不是**旧配置**（JWT_ENABLED 不是 true）✓ ——
   ⚠️ 为什么要看这一眼 ✗：容器名/镜像都没变 ✓、healthcheck 也过 ✓，
      但它可能是一个月前 `JWT_ENABLED: "false"` 起出来的 ✓ ——
      这时候我们这边开始签名 ✓，Document Server 那边却在**忽略** token ✓，
      用户看到的是「页面能开、但配置校验失败或者能被人乱开」✗。
      这一眼只读 ✓ 不改任何东西 ✓（自动 force-recreate 会打断正在编辑的人 ✗，不做 ✗）。 */
function runningContainerJwt() {
  if (!commandAvailable('docker')) return 'unknown';
  const result = spawnSync('docker', ['inspect', '--format', '{{json .Config.Env}}', 'codescope-onlyoffice'], { cwd:root, encoding:'utf8', stdio:'pipe' });
  if (result.status !== 0) return 'unknown';
  try {
    const env = JSON.parse(String(result.stdout || '[]').trim());
    if (!Array.isArray(env)) return 'unknown';
    const line = env.find((item) => String(item).startsWith('JWT_ENABLED='));
    if (!line) return 'unset';
    return String(line).slice('JWT_ENABLED='.length).toLowerCase() === 'true' ? 'enabled' : 'disabled';
  } catch (_) { return 'unknown'; }
}

// 自带（Docker Compose）托管的本地实例地址：未配置过连接时也按它准备，
// 这样全新机器上也能自动就绪，而不是直接放弃。
const MANAGED_URL = 'http://127.0.0.1:8088';

function saveManagedConnection(url) {
  try {
    const file = path.join(dataRoot(), 'office-connection.json');
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
    if (saved.publicUrl === url) return;
    fs.mkdirSync(dataRoot(), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ publicUrl: url, callbackBase: saved.callbackBase || '', jwtSecret: saved.jwtSecret || '' }, null, 2));
    console.log('已记录 ONLYOFFICE 服务地址：' + url);
  } catch (_) {}
}

async function main() {
  const configured = connectionUrl();
  const serviceUrl = configured || MANAGED_URL;
  // 用户显式配置了外部地址时，只有“本机托管实例”才由我们负责启停
  if (!isManagedLocalUrl(serviceUrl) || !fs.existsSync(composeFile)) return;
  /* ★★ 先把密钥准备好 ✓✓（2026-10-28）—— 不管容器起没起都要有：
     · 容器要起 → 作为 JWT_SECRET 传进去 ✓（compose 里是 `${JWT_SECRET:?}`，不给就报错 ✓）；
     · 容器已在跑 → 只读地看一眼它是不是 JWT_ENABLED=true ✓（旧容器要报警 ✓）。
     ⚠️ 密钥文件是**用户私有**的 ✓（<数据目录>/onlyoffice-jwt-secret，0600 ✓）——
        日志里只打**文件路径** ✓，绝不打密钥本身 ✓（日志会被桌面壳转存 / 用户会贴出来 ✗）。 */
  const jwt = ensureOnlyOfficeJwtSecret(dataRoot());
  if (!jwt.secret) {
    console.warn('⚠ 无法准备 ONLYOFFICE JWT 密钥（' + (jwt.error || '未知原因') + '）：'
      + '密钥文件应在 ' + onlyOfficeJwtSecretFile(dataRoot()) + '。Office 会退回不签名模式（仍可用，但不安全），'
      + 'CodeScope 其他功能不受影响。');
  } else if (jwt.created) {
    console.log('已生成 ONLYOFFICE JWT 密钥：' + jwt.file + '（0600，只在本机，不进仓库）');
  }
  if (await healthy(serviceUrl)) {
    console.log('ONLYOFFICE Docs 已运行：' + serviceUrl);
    if (!configured) saveManagedConnection(serviceUrl);
    /* ⚠️ 「健康」≠「安全」✗ —— 旧容器照旧能过 healthcheck ✓，但它可能在忽略我们签发的 token ✓。
       这里**只警告、不自动重建** ✓：force-recreate 会打断正在编辑的人 ✗，
       而且用户没让我们动他正在用的服务 ✓。文案里直接给命令 ✓（不用去查文档 ✓）。 */
    const state = runningContainerJwt();
    if (state === 'disabled' || state === 'unset') {
      console.warn('⚠ 正在运行的 ONLYOFFICE 容器' + (state === 'disabled' ? '仍是旧配置（JWT_ENABLED 不等于 true）' : '没有设置 JWT_ENABLED')
        + '：签发的 token 会被它忽略，等于没开签名。要启用：'
        + 'docker compose -f docker-compose.onlyoffice.yml up -d --force-recreate（会重建容器，正在编辑的文档会中断）');
    }
    return;
  }

  console.log('正在恢复 Web 端 ONLYOFFICE Docs…');
  if (!commandAvailable('docker')) {
    console.warn('⚠ 未找到 Docker，CodeScope 仍会启动，但 Office 暂不可用。');
    return;
  }
  if (!run('docker', ['info'], true)) {
    if (process.platform !== 'darwin' || !commandAvailable('colima') || !run('colima', ['start'])) {
      console.warn('⚠ Docker 未运行，无法自动恢复 ONLYOFFICE。');
      return;
    }
  }
  /* ⚠️ 没有密钥就**不起容器** ✗（2026-10-28）—— compose 里两个变量都是 `${VAR:?}` ✓，
     硬起必然失败 ✓；更关键的是「不带密钥起来」正是这次要修的东西 ✗。
     降级路径 = 保持现状 + 明确警告 ✓（Office 面板显示「未连接」✓，其他功能照旧 ✓）。 */
  if (!jwt.secret) {
    console.warn('⚠ 不会以不安全的方式启动 ONLYOFFICE（没有 JWT 密钥）。修好密钥文件后重启 CodeScope 即可自动恢复。');
    return;
  }
  const composeEnv = { JWT_ENABLED:'true', JWT_SECRET:jwt.secret };
  const composeReady = run('docker', ['compose', 'version'], true);
  const composeStarted = composeReady
    ? run('docker', ['compose', '-f', composeFile, 'up', '-d'], false, composeEnv)
    : commandAvailable('docker-compose') && run('docker-compose', ['-f', composeFile, 'up', '-d'], false, composeEnv);
  if (!composeStarted) {
    console.warn('⚠ ONLYOFFICE 容器启动失败，CodeScope 其他 Web 功能仍可使用。'
      + '（如果报的是 JWT_SECRET / JWT_ENABLED 缺失，说明 docker compose 版本太旧、不支持 ${VAR:?} 语法，'
      + '请显式 export 这两个变量再试。）');
    return;
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await healthy(serviceUrl)) {
      console.log('ONLYOFFICE Docs 已就绪：' + serviceUrl);
      if (!configured) saveManagedConnection(serviceUrl);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.warn('⚠ ONLYOFFICE 初始化超时；可运行 docker logs --tail 120 codescope-onlyoffice 查看原因。');
}

main().catch((error) => {
  console.warn('⚠ 自动恢复 ONLYOFFICE 失败：' + String(error && error.message || error));
});
