#!/usr/bin/env node
'use strict';

const path = require('path');
const { createKnowledgeBase } = require('../lib/knowledge-base');

function defaultVault() {
  if (process.env.CODESCOPE_VAULT) return path.resolve(process.env.CODESCOPE_VAULT);
  return path.resolve(__dirname, '..', '..', 'markdown-vault');
}

function defaultDataRoot() {
  if (process.env.CODESCOPE_DATA_HOME) return path.resolve(process.env.CODESCOPE_DATA_HOME);
  const home=process.env.HOME||process.env.USERPROFILE||process.cwd();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'CodeScope');
  if (process.platform === 'win32') return path.join(process.env.APPDATA||path.join(home,'AppData','Roaming'), 'CodeScope');
  return path.join(process.env.XDG_CONFIG_HOME||path.join(home,'.config'), 'codescope');
}

const knowledge = createKnowledgeBase({
  projectRoot:path.resolve(__dirname, '..'),
  dataRoot:defaultDataRoot(),
  getVaultPath:defaultVault,
});

knowledge.build('cli').then((state) => {
  if (state.phase !== 'ready') {
    console.error(state.error || state.message || '知识库生成失败');
    process.exitCode = 1;
    return;
  }
  console.log(`知识库已生成：${state.pageCount} 篇文档 → ${state.distDir}`);
}).catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
