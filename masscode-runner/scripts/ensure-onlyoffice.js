#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

function run(command, args, quiet = false) {
  const result = spawnSync(command, args, { cwd:root, encoding:'utf8', stdio:quiet ? 'pipe' : 'inherit' });
  return result.status === 0;
}

async function main() {
  const serviceUrl = connectionUrl();
  if (!serviceUrl || !isManagedLocalUrl(serviceUrl) || !fs.existsSync(composeFile)) return;
  if (await healthy(serviceUrl)) {
    console.log('ONLYOFFICE Docs 已运行：' + serviceUrl);
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
  const composeReady = run('docker', ['compose', 'version'], true);
  const composeStarted = composeReady
    ? run('docker', ['compose', '-f', composeFile, 'up', '-d'])
    : commandAvailable('docker-compose') && run('docker-compose', ['-f', composeFile, 'up', '-d']);
  if (!composeStarted) {
    console.warn('⚠ ONLYOFFICE 容器启动失败，CodeScope 其他 Web 功能仍可使用。');
    return;
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await healthy(serviceUrl)) {
      console.log('ONLYOFFICE Docs 已就绪：' + serviceUrl);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.warn('⚠ ONLYOFFICE 初始化超时；可运行 docker logs --tail 120 codescope-onlyoffice 查看原因。');
}

main().catch((error) => {
  console.warn('⚠ 自动恢复 ONLYOFFICE 失败：' + String(error && error.message || error));
});
