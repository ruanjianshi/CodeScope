#!/usr/bin/env node
'use strict';
/*
 * DSH 残留凭据锁的清理（lib/dsh-service.js 的 clearStaleCredentialLock）
 * ---------------------------------------------------------------------------
 * ⚠️ 背景（2026-10-11 用户报「CodeScope 无法管理 DSH 的开关」）：
 *   `~/.dsh/.credentials.yaml.lock` 被上一次进程**留成死锁** ✓ →
 *   DSH 的 `connection` 插件（必需）等锁超时 ✓ → `startup failed: 1 required plugin did not activate` ✓
 *   → 退出码 1 ✓ → 面板上永远「DSH 已退出（1）」✗，**点多少次启动都没用** ✓。
 *
 * ⚠️⚠️ 这个测试**最重要的不是"能清死锁"** ✓，而是「**绝不能清活锁**」✗✗ ——
 *     清掉活锁 = 两个进程同时写凭据文件 = 真事故 ✓。
 *     所以第 ② 条（活锁不动）比第 ③ 条（死锁能清）更重要 ✓。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { clearStaleCredentialLock } = require('../lib/dsh-service.js');

let pass = 0;
const fails = [];
function ck(name, ok, detail) {
  if (ok) { pass += 1; console.log('  ✅ ' + name); }
  else { fails.push(name + (detail ? '（' + detail + '）' : '')); console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}

/* 造一个假的 home（不碰用户真的 ~/.dsh ✓）*/
function makeHome(pidText) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-dshlock-'));
  const dir = path.join(home, '.dsh');
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, '.credentials.yaml.lock');
  if (pidText !== null) fs.writeFileSync(lock, String(pidText));
  return { home, lock };
}

console.log('\n── DSH 残留凭据锁 ──');

/* ① 没有锁 → 什么都不做 ✓ */
{
  const { home } = makeHome(null);
  ck('没有锁文件 → 返回空（不报错、不做事）', clearStaleCredentialLock(home) === '');
  fs.rmSync(home, { recursive: true, force: true });
}

/* ② ★★ 锁里是**活着的 PID** → 一个字都不能动 ✗✗（这条最重要 ✓） */
{
  const { home, lock } = makeHome(process.pid);   /* 自己就是活着的进程 ✓ */
  const note = clearStaleCredentialLock(home);
  const stillThere = fs.existsSync(lock);
  const content = stillThere ? fs.readFileSync(lock, 'utf8') : '';
  ck('★ 锁里是**活 PID** → 不删（返回空）', note === '', '返回 ' + JSON.stringify(note));
  ck('★★ 而且锁文件**原封不动**（内容没变）', stillThere && content === String(process.pid),
    stillThere ? '内容 ' + JSON.stringify(content) : '文件被删了 ✗✗');
  fs.rmSync(home, { recursive: true, force: true });
}

/* ③ 锁里是**已死的 PID** → 清掉，并返回一句说明 ✓ */
{
  /* 找一个"肯定不存在"的 PID ✓：先 spawn 一个立刻退出的进程，拿它的 PID ✓ */
  const { spawnSync } = require('child_process');
  const probe = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
  const deadPid = probe.pid;
  /* 等它真的退干净（pid 被回收）✓ —— 不然后面 kill(pid,0) 可能还成立 ✓ */
  const t0 = Date.now();
  while (Date.now() - t0 < 2000) {
    try { process.kill(deadPid, 0); } catch (_) { break; }
    spawnSync(process.execPath, ['-e', ''], {});   /* 空转一下 ✓ */
  }
  const { home, lock } = makeHome(deadPid);
  const note = clearStaleCredentialLock(home);
  ck('死 PID 的锁 → 被清掉（返回一句说明）', note.length > 0 && !fs.existsSync(lock),
    '返回 ' + JSON.stringify(note) + '，锁还在？' + fs.existsSync(lock));
  fs.rmSync(home, { recursive: true, force: true });
}

/* ④ 锁里**不是数字**（被写坏 / 别的格式）→ 保守起见不动 ✓ */
{
  const { home, lock } = makeHome('not-a-pid');
  const note = clearStaleCredentialLock(home);
  ck('锁内容不是 PID → **不动**（宁可不清，也不能误删）', note === '' && fs.existsSync(lock),
    '返回 ' + JSON.stringify(note) + '，锁还在？' + fs.existsSync(lock));
  fs.rmSync(home, { recursive: true, force: true });
}

/* ⑤ 空锁文件 → 不动 ✓ */
{
  const { home, lock } = makeHome('');
  const note = clearStaleCredentialLock(home);
  ck('空锁文件 → 不动', note === '' && fs.existsSync(lock));
  fs.rmSync(home, { recursive: true, force: true });
}

/* ⑥ 目录都不存在 → 不抛异常 ✓ */
{
  ck('目录不存在 → 返回空、不抛', clearStaleCredentialLock('/tmp/codescope-绝不存在-' + Date.now()) === '');
}

console.log('');
console.log('DSH 锁清理：' + pass + '/' + (pass + fails.length) + ' 项通过' + (fails.length ? '，失败 ' + fails.length + ' 项' : ''));
if (fails.length) {
  console.log('');
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('\n全部通过 ✅');
