#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readProviderManifest } = require('../lib/office-engine');

const root = path.resolve(__dirname, '..');
const requiredPackages = ['docx', 'xlsx'];
const missing = requiredPackages.filter((name) => !fs.existsSync(path.join(root, 'node_modules', ...name.split('/'), 'package.json')));
if (missing.length) {
  console.error('Office 文件创建/校验运行时不完整：' + missing.join('、'));
  process.exit(1);
}
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (!serverSource.includes('/api/office/connection') || !serverSource.includes('signOnlyOfficeConfig') || !serverSource.includes('CODESCOPE_ONLYOFFICE_JWT_SECRET')) {
  console.error('ONLYOFFICE 连接、JWT 或持久化配置接口不完整');
  process.exit(1);
}
if (!clientSource.includes('officeConnectionScreen') || !clientSource.includes('连接 ONLYOFFICE Docs') || /if\(!embedded\)await renderOfficeFallback/.test(clientSource)) {
  console.error('Office 客户端没有强制使用 ONLYOFFICE，或仍会自动回退到内置编辑器');
  process.exit(1);
}

const bundle = process.env.CODESCOPE_OFFICE_PROVIDER_BUNDLE || path.join(root, '.office-provider');
const manifestPath = path.join(bundle, 'manifest.json');
const manifest = readProviderManifest(manifestPath);
if (process.env.CODESCOPE_REQUIRE_OFFICE_SIDECAR === '1' && !manifest) {
  console.error('当前构建要求高保真 Office 侧车，但 manifest.json 不存在或 Provider API 版本不兼容：' + manifestPath);
  process.exit(1);
}
if (manifest) {
  const platform = manifest.platforms && manifest.platforms[process.platform];
  const entry = platform && (platform[process.arch] || platform.default);
  if (!entry || !entry.executable) {
    console.error('Office Provider 缺少当前平台产物：' + process.platform + '/' + process.arch);
    process.exit(1);
  }
  const executable = path.resolve(bundle, entry.executable);
  if (!fs.existsSync(executable)) {
    console.error('Office Provider 可执行文件不存在：' + executable);
    process.exit(1);
  }
  if (entry.sha256) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
    if (actual !== String(entry.sha256).toLowerCase()) {
      console.error('Office Provider SHA-256 校验失败：' + executable);
      process.exit(1);
    }
  }
  console.log('ONLYOFFICE 集成检查通过：连接/JWT/保存链路 + 受管侧车 ' + manifest.id + ' ' + manifest.version);
} else {
  console.log('ONLYOFFICE 集成检查通过：连接/JWT/保存链路；Document Server 使用独立部署');
}
