#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const root = __dirname;
const packageJson = require(path.join(root, 'package.json'));
const quiet = process.argv.includes('--quiet');
const json = process.argv.includes('--json');
const errors = [];
const warnings = [];

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function writableDirectory(label, directory, create) {
  try {
    if (create) fs.mkdirSync(directory, { recursive:true });
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    if (!fs.statSync(directory).isDirectory()) throw new Error('不是目录');
    return true;
  } catch (error) {
    fail(label + '不可读写：' + directory + '（' + String(error.message || error) + '）');
    return false;
  }
}

const major = Number(process.versions.node.split('.')[0]);
if (!Number.isInteger(major) || major < 18) fail('Node.js 版本过低：当前 ' + process.version + '，需要 18 或更高版本');

const port = Number(process.env.CODESCOPE_PORT || process.env.MASSCODE_RUNNER_PORT || 4877);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail('端口无效：' + String(port) + '，应为 1–65535');
const host = String(process.env.CODESCOPE_HOST || process.env.MASSCODE_RUNNER_HOST || '127.0.0.1').trim();
if (!host) fail('监听地址不能为空');
if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') warn('服务将监听 ' + host + '；仅应在可信网络中使用');

const vault = path.resolve(process.env.CODESCOPE_VAULT || process.env.MASSCODE_VAULT || path.join(root, '..', 'markdown-vault'));
writableDirectory('Vault', vault, true);
writableDirectory('系统临时目录', os.tmpdir(), false);

const missingDependencies = [];
for (const name of Object.keys(packageJson.dependencies || {})) {
  if (!fs.existsSync(path.join(root, 'node_modules', ...name.split('/'), 'package.json'))) missingDependencies.push(name);
}
if (missingDependencies.length) fail('运行依赖不完整：' + missingDependencies.join('、'));

const result = {
  ok:errors.length === 0,
  name:'码境 CodeScope', version:packageJson.version, node:process.version,
  platform:process.platform, arch:process.arch, host, port, vault,
  dependencies:{ total:Object.keys(packageJson.dependencies || {}).length, missing:missingDependencies },
  warnings, errors,
};

if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
else if (!quiet || errors.length || warnings.length) {
  process.stdout.write('码境 CodeScope v' + result.version + ' · ' + process.platform + '/' + process.arch + ' · Node ' + process.version + '\n');
  for (const message of warnings) process.stdout.write('[提示] ' + message + '\n');
  for (const message of errors) process.stderr.write('[错误] ' + message + '\n');
  if (result.ok) process.stdout.write('环境预检通过：' + vault + '\n');
}
process.exitCode = result.ok ? 0 : 1;
