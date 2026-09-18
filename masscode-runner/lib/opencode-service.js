'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');

const DEFAULT_PORT = 3457;
const LOOPBACK = '127.0.0.1';

function resolveOpc() {
  const candidates = [
    process.env.OPENCODE_BIN || '',
    path.join(os.homedir(), '.opencode', 'bin', 'opencode'),
    'opencode',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { timeout: 3000, stdio: 'pipe' });
      return candidate;
    } catch (_) {}
  }
  return null;
}

function probe(url, timeout = 800) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      res.destroy();
      resolve(true);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

function createOpencodeService(options = {}) {
  const port = Number(options.port) || DEFAULT_PORT;
  const hostname = options.hostname || LOOPBACK;
  const cli = resolveOpc();
  const url = `http://${hostname}:${port}`;
  let child = null;
  let state = cli ? 'stopped' : 'unavailable';
  let message = cli
    ? '等待启动 opencode Web 服务'
    : '未找到 opencode 可执行文件（~/.opencode/bin/opencode 或 PATH）';
  let startPromise = null;

  function status() {
    const running = state === 'running' || state === 'external';
    return {
      key: 'opencode',
      label: 'OpenCode',
      group: 'AI 编码智能体',
      for: 'opencode 的 Web 界面（iframe 内嵌）',
      available: running,
      installed: !!cli,
      managed: !!child,
      state,
      version: '',
      url,
      port,
      message,
      hint: cli ? '由 CodeScope 托管运行；可在顶部「opencode」按钮打开' : '安装 opencode 后重启 CodeScope',
    };
  }

  async function start() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      if (!cli) {
        state = 'unavailable';
        message = '未找到 opencode 可执行文件';
        return status();
      }
      if (child && child.exitCode == null) {
        state = 'running';
        return status();
      }
      if (await probe(url)) {
        state = 'external';
        message = `已连接 ${url} 上现有的 opencode 服务`;
        return status();
      }
      fs.mkdirSync(path.join(os.tmpdir(), 'codescope', 'opencode'), { recursive: true });
      state = 'starting';
      message = '正在启动 opencode…';
      child = spawn(cli, ['serve', '--port', String(port), '--hostname', hostname], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stderr.on('data', () => {});
      child.once('error', (error) => {
        state = 'error';
        message = 'opencode 启动失败：' + (error.message || error);
      });
      child.once('exit', () => {
        child = null;
        if (state === 'running') {
          state = 'stopped';
          message = 'opencode 已退出';
        }
      });
      for (let attempt = 0; attempt < 60; attempt++) {
        if (await probe(url, 400)) {
          state = 'running';
          message = 'opencode 已由 CodeScope 托管运行';
          return status();
        }
        if (!child || child.exitCode != null || state === 'error') break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (state !== 'error') {
        state = 'error';
        message = 'opencode 启动超时，请查看运行环境';
      }
      return status();
    })();
    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  async function stop() {
    if (child && child.exitCode == null) {
      try { child.kill('SIGTERM'); } catch (_) {}
    }
    child = null;
    state = 'stopped';
    message = 'opencode 已停止';
    return status();
  }

  return { status, start, stop };
}

module.exports = { createOpencodeService };
