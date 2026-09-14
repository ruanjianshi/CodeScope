'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const API_REVISION = 1;

function platformEntry(manifest) {
  const platform = manifest.platforms && manifest.platforms[process.platform];
  if (!platform) return null;
  return platform[process.arch] || platform.default || null;
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function requestHealth(url, timeout = 1200) {
  return new Promise((resolve) => {
    let target;
    try { target = new URL(url); } catch (_) { return resolve(false); }
    const request = http.get(target, { timeout }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(response.statusCode < 400 && /true|ready|ok/i.test(Buffer.concat(chunks).toString('utf8'))));
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

function discoverOfficeProvider(roots) {
  for (const root of roots.filter(Boolean)) {
    const manifestPath = path.join(root, 'manifest.json');
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.apiRevision !== API_REVISION || !manifest.id || !manifest.version) continue;
      const entry = platformEntry(manifest);
      if (!entry || !entry.executable) continue;
      const executable = path.resolve(root, entry.executable);
      if (!fs.statSync(executable).isFile()) continue;
      if (entry.sha256 && sha256(executable) !== String(entry.sha256).toLowerCase()) continue;
      return { root, manifestPath, manifest, entry, executable };
    } catch (_) { /* Try the next packaged provider. */ }
  }
  return null;
}

async function startOfficeSidecar(provider, options = {}) {
  if (!provider) return { process:null, ready:false, provider:null };
  const healthUrl = String(provider.entry.healthUrl || provider.manifest.healthUrl || 'http://127.0.0.1:8088/healthcheck');
  if (await requestHealth(healthUrl)) return { process:null, ready:true, provider, healthUrl, existing:true };
  const child = spawn(provider.executable, provider.entry.args || [], {
    cwd:provider.root,
    env:{ ...process.env, ...(provider.manifest.env || {}), ...(provider.entry.env || {}), CODESCOPE_PARENT_PID:String(process.pid) },
    windowsHide:true, stdio:['ignore', 'pipe', 'pipe'],
  });
  if (options.onOutput) {
    child.stdout && child.stdout.on('data', (chunk) => options.onOutput('stdout', String(chunk)));
    child.stderr && child.stderr.on('data', (chunk) => options.onOutput('stderr', String(chunk)));
  }
  const deadline = Date.now() + Number(provider.entry.startupTimeoutMs || 90000);
  while (Date.now() < deadline && child.exitCode === null) {
    if (await requestHealth(healthUrl, 1800)) return { process:child, ready:true, provider, healthUrl, existing:false };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (child.exitCode === null) child.kill();
  return { process:null, ready:false, provider, healthUrl, error:'Office Provider 未能在限定时间内启动' };
}

module.exports = { API_REVISION, discoverOfficeProvider, requestHealth, startOfficeSidecar };
