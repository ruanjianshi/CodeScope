#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readProviderManifest } = require('../lib/office-engine');

const root = path.resolve(__dirname, '..');
const requiredPackages = ['mammoth', '@turbodocx/html-to-docx', 'docx-preview', 'xlsx', 'pptx-preview', 'jszip'];
const missing = requiredPackages.filter((name) => !fs.existsSync(path.join(root, 'node_modules', ...name.split('/'), 'package.json')));
if (missing.length) {
  console.error('Office 内置运行时不完整：' + missing.join('、'));
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
  console.log('Office 打包检查通过：内置运行时 + ' + manifest.id + ' ' + manifest.version);
} else {
  console.log('Office 打包检查通过：内置离线运行时；未附加可选高保真侧车');
}
