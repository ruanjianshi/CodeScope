#!/usr/bin/env node
'use strict';
/**
 * 代码运行功能专项测试（/api/run 与 /api/check）
 *
 * 覆盖维度：
 *   A 多语言基础执行（含多文件工程编译链接）
 *   B 标准输入（stdin）注入与 EOF 行为
 *   C 错误与退出码（运行异常 / 编译错误 / 语法检查）
 *   D 超时与进程回收（无限循环）
 *   E 接口契约（404 / 400 / 不支持语言 / 未保存代码优先 / 空代码）
 *   F 安全与健壮性（路径穿越 / shell 元字符 / 特殊文件名 / 文件名冲突）
 *   G 并发隔离
 *   H 幂等与临时目录回收
 *
 * 运行：npm run test:run      单个用例失败不影响其它用例执行。
 */
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-run-test-'));
const vault = path.join(tempRoot, 'vault');
const codeRoot = path.join(vault, 'code');
fs.mkdirSync(path.join(codeRoot, 'run'), { recursive: true });

let child;
let base = '';
let idSeq = 100;

const results = [];
const stats = { pass: 0, fail: 0, skip: 0, warn: 0 };

function hasCommand(cmd) {
  try { execFileSync('sh', ['-c', 'command -v ' + cmd], { stdio: 'ignore' }); return true; }
  catch (_) { return false; }
}

function ok(group, name, detail) {
  stats.pass++; results.push({ group, name, status: 'pass' });
  console.log('  ✅ ' + name + (detail ? '  · ' + detail : ''));
}
function bad(group, name, detail) {
  stats.fail++; results.push({ group, name, status: 'fail', detail });
  console.log('  ❌ ' + name + '\n       ' + String(detail).replace(/\n/g, '\n       ').slice(0, 600));
}
function skipped(group, name, why) {
  stats.skip++; results.push({ group, name, status: 'skip', detail: why });
  console.log('  ⏭  ' + name + '（' + why + '）');
}
function warn(group, name, detail) {
  stats.warn++; results.push({ group, name, status: 'warn', detail });
  console.log('  ⚠️  ' + name + (detail ? '  · ' + detail : ''));
}
function check(group, name, condition, detail) {
  condition ? ok(group, name) : bad(group, name, detail || '断言失败');
}

/** 生成一个片段文件：frags = [{label, language, code}] */
function writeSnippet(name, frags) {
  const contents = frags.map((f) => '  - id: ' + (idSeq++) + '\n    label: ' + f.label + '\n    language: ' + f.language).join('\n');
  const body = frags.map((f) => '## Fragment: ' + f.label + '\n```' + f.language + '\n' + f.code + '\n```').join('\n\n');
  const file = path.join(codeRoot, 'run', name + '.md');
  fs.writeFileSync(file, '---\ncontents:\n' + contents + '\nname: ' + name + '\nisDeleted: 0\n---\n\n' + body + '\n', 'utf8');
  return file;
}

async function post(pathname, body) {
  const response = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  return { status: response.status, data };
}

const run = (file, fragment, code, input) => post('/api/run', { file, fragment, code, input });
const checkCode = (file, fragment, code) => post('/api/check', { file, fragment, code });

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function startServer() {
  const port = await freePort();
  base = 'http://127.0.0.1:' + port;
  const output = [];
  child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, CODESCOPE_HOST: '127.0.0.1', CODESCOPE_PORT: String(port), CODESCOPE_VAULT: vault, CODESCOPE_DATA_HOME: path.join(tempRoot, 'data'), CODESCOPE_TMP_TTL_MS: '3000', CODESCOPE_DSH_AUTOSTART:'0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => output.push(String(c)));
  child.stderr.on('data', (c) => output.push(String(c)));
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(base + '/api/rev');
      if (r.ok) return;
    } catch (_) {}
    if (child.exitCode !== null) throw new Error('服务提前退出：\n' + output.join(''));
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('等待服务启动超时：\n' + output.join(''));
}

/* ------------------------------------------------------------------ 测试组 ---- */

async function groupBasic() {
  const G = 'A 基础执行';
  console.log('\n' + G);

  let f = writeSnippet('basic_python', [{ label: 'main.py', language: 'python', code: 'print("你好 CodeScope")' }]);
  let r = await run(f, 0);
  check(G, 'Python 输出中文', r.data.ok && (r.data.stdout || '').includes('你好 CodeScope'), JSON.stringify(r.data).slice(0, 200));
  check(G, 'Python 退出码为 0', r.data.code === 0, 'code=' + r.data.code);

  f = writeSnippet('basic_js', [{ label: 'main.mjs', language: 'javascript', code: 'console.log("js-ok", 1 + 2);' }]);
  r = await run(f, 0);
  check(G, 'JavaScript 运行', r.data.ok && (r.data.stdout || '').includes('js-ok 3'), JSON.stringify(r.data).slice(0, 200));

  f = writeSnippet('basic_ts', [{ label: 'main.ts', language: 'typescript', code: 'const x: number = 41;\nconsole.log("ts", x + 1);' }]);
  r = await run(f, 0);
  check(G, 'TypeScript 运行（Node 直跑）', r.data.ok && (r.data.stdout || '').includes('ts 42'), JSON.stringify(r.data).slice(0, 200));

  f = writeSnippet('basic_bash', [{ label: 'main.sh', language: 'bash', code: 'echo "bash-$((6 * 7))"' }]);
  r = await run(f, 0);
  check(G, 'Bash 运行与算术展开', r.data.ok && (r.data.stdout || '').includes('bash-42'), JSON.stringify(r.data).slice(0, 200));

  if (hasCommand('gcc')) {
    f = writeSnippet('basic_c', [{ label: 'main.c', language: 'c', code: '#include <stdio.h>\nint main(void){ puts("c-ok"); return 0; }' }]);
    r = await run(f, 0);
    check(G, 'C 编译并运行', r.data.ok && (r.data.stdout || '').includes('c-ok'), JSON.stringify(r.data).slice(0, 200));
  } else skipped(G, 'C 编译并运行', '本机无 gcc');

  if (hasCommand('g++')) {
    // 多文件工程：main.cpp 依赖 util.hpp（两个片段一起写入同一临时目录）
    f = writeSnippet('multi_cpp', [
      { label: 'main.cpp', language: 'c_cpp', code: '#include "util.hpp"\n#include <cstdio>\nint main(){ printf("multi-%d\\n", add(40, 2)); }' },
      { label: 'util.hpp', language: 'c_cpp', code: '#pragma once\ninline int add(int a, int b){ return a + b; }' },
    ]);
    r = await run(f, 0);
    check(G, 'C++ 多文件（.cpp + .hpp）编译链接', r.data.ok && (r.data.stdout || '').includes('multi-42'), JSON.stringify(r.data).slice(0, 240));

    // 多文件：以非入口片段运行（当前选中 util.hpp）→ 应给出明确结果而非崩溃
    r = await run(f, 1);
    check(G, '多文件时以非入口片段运行为结构化结果', typeof r.data.ok === 'boolean' && r.status === 200, JSON.stringify(r.data).slice(0, 200));
  } else skipped(G, 'C++ 多文件编译链接', '本机无 g++');

  if (hasCommand('javac') && hasCommand('java')) {
    f = writeSnippet('basic_java', [{ label: 'Hello.java', language: 'java', code: 'public class Hello { public static void main(String[] a) { System.out.println("java-ok"); } }' }]);
    r = await run(f, 0);
    check(G, 'Java 单文件源码运行', r.data.ok && (r.data.stdout || '').includes('java-ok'), JSON.stringify(r.data).slice(0, 240));
  } else skipped(G, 'Java 运行', '本机无 javac/java');

  if (hasCommand('ruby')) {
    f = writeSnippet('basic_ruby', [{ label: 'main.rb', language: 'ruby', code: 'puts "ruby-#{6 * 7}"' }]);
    r = await run(f, 0);
    check(G, 'Ruby 运行', r.data.ok && (r.data.stdout || '').includes('ruby-42'), JSON.stringify(r.data).slice(0, 200));
  } else skipped(G, 'Ruby 运行', '本机无 ruby');

  if (hasCommand('go')) {
    f = writeSnippet('basic_go', [{ label: 'main.go', language: 'go', code: 'package main\nimport "fmt"\nfunc main(){ fmt.Println("go-ok") }' }]);
    r = await run(f, 0);
    check(G, 'Go 运行', r.data.ok && (r.data.stdout || '').includes('go-ok'), JSON.stringify(r.data).slice(0, 240));
  } else skipped(G, 'Go 运行', '本机无 go');

  if (hasCommand('swift')) {
    f = writeSnippet('basic_swift', [{ label: 'main.swift', language: 'swift', code: 'print("swift-ok")' }]);
    r = await run(f, 0);
    check(G, 'Swift 运行', r.data.ok && (r.data.stdout || '').includes('swift-ok'), JSON.stringify(r.data).slice(0, 240));
  } else skipped(G, 'Swift 运行', '本机无 swift');

  // JSON / HTML 属于「非执行型」语言：应返回可读提示而不是报错
  f = writeSnippet('basic_json', [{ label: 'data.json', language: 'json', code: '{"a": 1}' }]);
  r = await run(f, 0);
  check(G, 'JSON 语言返回说明而非报错', r.status === 200 && r.data.ok === true && String(r.data.stdout || '').length > 0, JSON.stringify(r.data).slice(0, 200));

  f = writeSnippet('basic_html', [{ label: 'index.html', language: 'html', code: '<h1>hi</h1>' }]);
  r = await run(f, 0);
  check(G, 'HTML 语言返回说明而非报错', r.status === 200 && r.data.ok === true && String(r.data.stdout || '').length > 0, JSON.stringify(r.data).slice(0, 200));
}

async function groupStdin() {
  const G = 'B 标准输入';
  console.log('\n' + G);

  let f = writeSnippet('stdin_python', [{ label: 'main.py', language: 'python', code: 'name = input()\nprint("hello", name)' }]);
  let r = await run(f, 0, null, '世界');
  check(G, 'Python input() 收到注入内容', r.data.ok && (r.data.stdout || '').includes('hello 世界'), JSON.stringify(r.data).slice(0, 200));

  f = writeSnippet('stdin_python_multi', [{ label: 'main.py', language: 'python', code: 'a = input()\nb = input()\nprint(int(a) + int(b))' }]);
  r = await run(f, 0, null, '40\n2\n');
  check(G, 'Python 多行输入按行读取', r.data.ok && (r.data.stdout || '').trim().endsWith('42'), JSON.stringify(r.data).slice(0, 200));

  f = writeSnippet('stdin_bash', [{ label: 'main.sh', language: 'bash', code: 'read -r line\necho "got:$line"' }]);
  r = await run(f, 0, null, 'bash-input\n');
  check(G, 'Bash read 收到注入内容', r.data.ok && (r.data.stdout || '').includes('got:bash-input'), JSON.stringify(r.data).slice(0, 200));

  // 无输入时 stdin 必须立即 EOF，而不是挂起等待（否则运行按钮会长时间卡住）
  f = writeSnippet('stdin_eof', [{ label: 'main.py', language: 'python', code: 'import sys\ndata = sys.stdin.read()\nprint("eof-len", len(data))' }]);
  const t0 = Date.now();
  r = await run(f, 0, null, '');
  const cost = Date.now() - t0;
  check(G, '无输入时立即 EOF（不挂起）', r.data.ok && (r.data.stdout || '').includes('eof-len 0') && cost < 5000, 'cost=' + cost + 'ms ' + JSON.stringify(r.data).slice(0, 160));

  if (hasCommand('g++')) {
    f = writeSnippet('stdin_cpp', [{ label: 'main.cpp', language: 'c_cpp', code: '#include <iostream>\nint main(){ int x; std::cin >> x; std::cout << "cin-" << x * 2 << std::endl; }' }]);
    r = await run(f, 0, null, '21\n');
    check(G, 'C++ cin 收到注入内容', r.data.ok && (r.data.stdout || '').includes('cin-42'), JSON.stringify(r.data).slice(0, 240));
  } else skipped(G, 'C++ cin', '本机无 g++');

  if (hasCommand('java')) {
    f = writeSnippet('stdin_java', [{ label: 'Scan.java', language: 'java', code: 'import java.util.Scanner;\npublic class Scan { public static void main(String[] a){ Scanner s = new Scanner(System.in); System.out.println("java-in-" + s.nextInt()); } }' }]);
    r = await run(f, 0, null, '42\n');
    check(G, 'Java Scanner 收到注入内容', r.data.ok && (r.data.stdout || '').includes('java-in-42'), JSON.stringify(r.data).slice(0, 240));
  } else skipped(G, 'Java Scanner', '本机无 java');
}

async function groupErrors() {
  const G = 'C 错误与退出码';
  console.log('\n' + G);

  let f = writeSnippet('err_exit', [{ label: 'main.py', language: 'python', code: 'import sys\nsys.exit(3)' }]);
  let r = await run(f, 0);
  check(G, '非零退出码透传（sys.exit(3)）', r.data.ok === false && r.data.code === 3, JSON.stringify(r.data).slice(0, 200));

  f = writeSnippet('err_trace', [{ label: 'main.py', language: 'python', code: 'print(1 / 0)' }]);
  r = await run(f, 0);
  check(G, '运行时异常进入 stderr', r.data.ok === false && /ZeroDivisionError/.test(r.data.stderr || ''), JSON.stringify(r.data).slice(0, 200));

  if (hasCommand('g++')) {
    f = writeSnippet('err_compile', [{ label: 'main.cpp', language: 'c_cpp', code: 'int main(){ return 0 }' }]);
    r = await run(f, 0);
    check(G, '编译错误归一化为失败 + 编译输出', r.data.ok === false && /error/i.test((r.data.stderr || '') + (r.data.stdout || '')), JSON.stringify(r.data).slice(0, 240));
  } else skipped(G, '编译错误', '本机无 g++');

  f = writeSnippet('check_py', [{ label: 'main.py', language: 'python', code: 'def f(:\n  pass' }]);
  let c = await checkCode(f, 0);
  check(G, '语法检查：非法 Python 返回失败', c.data.ok === false && String(c.data.stderr || '').length > 0, JSON.stringify(c.data).slice(0, 200));

  f = writeSnippet('check_py_ok', [{ label: 'main.py', language: 'python', code: 'def f():\n  return 42' }]);
  c = await checkCode(f, 0);
  check(G, '语法检查：合法 Python 返回成功', c.data.ok === true, JSON.stringify(c.data).slice(0, 200));

  f = writeSnippet('check_json', [{ label: 'data.json', language: 'json', code: '{bad json}' }]);
  c = await checkCode(f, 0);
  check(G, '语法检查：非法 JSON 返回失败', c.data.ok === false, JSON.stringify(c.data).slice(0, 200));
}

async function groupTimeout() {
  const G = 'D 超时与进程回收';
  console.log('\n' + G);

  // Node 运行器 timeoutMs = 10000
  const f = writeSnippet('timeout_js', [{ label: 'main.mjs', language: 'javascript', code: 'while (true) {}' }]);
  const t0 = Date.now();
  let r = await run(f, 0);
  const cost = Date.now() - t0;
  check(G, '无限循环被超时终止', r.data.timedOut === true || r.data.ok === false, JSON.stringify(r.data).slice(0, 200));
  check(G, '超时在阈值 + 5 秒内返回', cost < 15000, 'cost=' + cost + 'ms');
  check(G, '超时结果带 timedOut 标记', r.data.timedOut === true, JSON.stringify(r.data).slice(0, 160));

  // 超时后服务必须仍然可用（进程组被杀干净、服务事件循环未被阻塞）
  const f2 = writeSnippet('timeout_after', [{ label: 'main.py', language: 'python', code: 'print("still-alive")' }]);
  r = await run(f2, 0);
  check(G, '超时后服务仍可正常执行下一段代码', r.data.ok && (r.data.stdout || '').includes('still-alive'), JSON.stringify(r.data).slice(0, 200));

  // 超时的子进程不应残留（以 Python 为例：脚本自身写 pid，超时后该 pid 必须已不存在）
  const pidFile = path.join(tempRoot, 'pid.txt');
  const f3 = writeSnippet('timeout_pid', [{ label: 'main.py', language: 'python', code: 'import os, time\nopen(' + JSON.stringify(pidFile) + ', "w").write(str(os.getpid()))\ntime.sleep(60)' }]);
  await run(f3, 0);
  await new Promise((res) => setTimeout(res, 500));
  let alive = false;
  try {
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (pid > 0) {
      try { process.kill(pid, 0); alive = true; } catch (_) { alive = false; }
    }
  } catch (_) {}
  check(G, '超时后被终止的进程组无残留进程', alive === false, '残留 pid=' + (() => { try { return fs.readFileSync(pidFile, 'utf8'); } catch (_) { return '?'; } })());
}

async function groupContract() {
  const G = 'E 接口契约';
  console.log('\n' + G);

  let r = await run(path.join(codeRoot, 'run', 'not-exist.md'), 0);
  check(G, '文件不存在返回 404', r.status === 404 && r.data.ok === false, 'status=' + r.status + ' ' + JSON.stringify(r.data).slice(0, 120));

  const f = writeSnippet('contract_py', [{ label: 'main.py', language: 'python', code: 'print("only-one")' }]);
  r = await run(f, 9);
  check(G, '片段索引越界返回 400', r.status === 400 && r.data.ok === false, 'status=' + r.status + ' ' + JSON.stringify(r.data).slice(0, 120));

  const plain = writeSnippet('contract_plain', [{ label: 'note.txt', language: 'plain_text', code: 'just text' }]);
  r = await run(plain, 0);
  check(G, '不支持的语言返回 unsupported + 原因', r.data.unsupported === true && String(r.data.reason || '').length > 0, JSON.stringify(r.data).slice(0, 200));

  // 未保存的编辑内容必须优先于磁盘内容（编辑器里直接点运行）
  const f2 = writeSnippet('contract_unsaved', [{ label: 'main.py', language: 'python', code: 'print("disk-version")' }]);
  r = await run(f2, 0, 'print("memory-version")');
  check(G, '运行时使用未保存的编辑器内容', r.data.ok && (r.data.stdout || '').includes('memory-version'), JSON.stringify(r.data).slice(0, 200));

  const f3 = writeSnippet('contract_empty', [{ label: 'main.py', language: 'python', code: '' }]);
  r = await run(f3, 0);
  check(G, '空代码返回结构化结果（不崩溃）', r.status === 200 && typeof r.data.ok === 'boolean', JSON.stringify(r.data).slice(0, 160));
}

async function groupSafety() {
  const G = 'F 安全与健壮性';
  console.log('\n' + G);

  // 1) 片段名（label）参与文件名生成：带扩展名的 label 会被直接当作文件名使用
  //    临时目录位于 os.tmpdir() 下，向上两级都可能落盘，全部探测
  const probeName = 'codescope-escape-probe.py';
  const escapeCandidates = [
    path.join(os.tmpdir(), probeName),
    path.resolve(os.tmpdir(), '..', probeName),
    path.resolve(os.tmpdir(), '..', '..', probeName),
    path.join('/tmp', probeName),
  ];
  for (const c of escapeCandidates) { try { fs.rmSync(c, { force: true }); } catch (_) {} }
  const evil = writeSnippet('safety_traversal', [{ label: '../../' + probeName, language: 'python', code: 'print("escaped")' }]);
  await run(evil, 0);
  const escapedTo = escapeCandidates.filter((c) => fs.existsSync(c));
  check(G, '片段名不得造成路径穿越（写出临时目录）', escapedTo.length === 0, '临时目录外被写入：' + escapedTo.join(' , '));
  for (const c of escapeCandidates) { try { fs.rmSync(c, { force: true }); } catch (_) {} }

  // 2) 代码内容中的 shell 元字符不得被解释为命令（spawn shell:false）
  const marker = path.join(tempRoot, 'injection-marker');
  fs.writeFileSync(marker, 'safe');
  const inj = writeSnippet('safety_inject', [{ label: 'main.py', language: 'python', code: 'print("ok") ; rm -rf ' + marker }]);
  await run(inj, 0);
  check(G, '代码中的 shell 元字符不被解释执行', fs.existsSync(marker), '注入标记文件被删除，说明存在命令注入');

  // 3) 片段名含空格/中文（无扩展名）→ 使用默认 main.<ext>，仍可正常运行
  const cn = writeSnippet('safety_cn_name', [{ label: '我的 脚本', language: 'python', code: 'print("cn-name-ok")' }]);
  let r = await run(cn, 0);
  check(G, '片段名含空格与中文仍可运行', r.data.ok && (r.data.stdout || '').includes('cn-name-ok'), JSON.stringify(r.data).slice(0, 200));

  // 4) 两个片段解析为同名文件（重名 label）→ 不得让服务崩溃或返回非结构化结果
  const dup = writeSnippet('safety_dup', [
    { label: 'dup.cpp', language: 'c_cpp', code: '#include <cstdio>\nint main(){ printf("first\\n"); }' },
    { label: 'dup.cpp', language: 'c_cpp', code: '#include <cstdio>\nint main(){ printf("second\\n"); }' },
  ]);
  r = await run(dup, 0);
  check(G, '重名片段返回结构化结果（不崩溃）', r.status === 200 && typeof r.data.ok === 'boolean', JSON.stringify(r.data).slice(0, 200));

  // 5) 大输出：1 MB 正常返回；超过 2 MB 上限时截断并明确标记（防止打印海量内容吃满服务内存）
  const big = writeSnippet('safety_bigout', [{ label: 'main.py', language: 'python', code: 'print("x" * 1000000)' }]);
  const t0 = Date.now();
  r = await run(big, 0);
  const cost = Date.now() - t0;
  check(G, '1 MB 输出可正常返回且不截断', r.data.ok && (r.data.stdout || '').length >= 1000000 && !r.data.truncated, 'len=' + String((r.data.stdout || '').length) + ' cost=' + cost + 'ms');

  const huge = writeSnippet('safety_hugeout', [{ label: 'main.py', language: 'python', code: 'import sys\nfor _ in range(4):\n    sys.stdout.write("z" * 1000000 + "\\n")' }]);
  const t1 = Date.now();
  r = await run(huge, 0);
  const hugeCost = Date.now() - t1;
  const hugeLen = (r.data.stdout || '').length;
  check(G, '超过上限的输出被截断到 2 MB 并提示', r.data.truncated === true && hugeLen <= 2 * 1024 * 1024 + 200 && /已截断/.test(r.data.stdout || ''), 'len=' + hugeLen + ' truncated=' + r.data.truncated + ' cost=' + hugeCost + 'ms');
}

async function groupConcurrency() {
  const G = 'G 并发隔离';
  console.log('\n' + G);

  const files = [];
  for (let i = 0; i < 5; i++) {
    files.push({ i, file: writeSnippet('conc_py_' + i, [{ label: 'main.py', language: 'python', code: 'import time\ntime.sleep(0.3)\nprint("worker-' + i + '")' }]) });
  }
  const rs = await Promise.all(files.map((x) => run(x.file, 0)));
  const allOk = rs.every((r, idx) => r.data.ok && (r.data.stdout || '').includes('worker-' + idx));
  check(G, '5 个并发运行互不串扰', allOk, JSON.stringify(rs.map((r) => (r.data.stdout || '').trim())).slice(0, 240));

  const mix = await Promise.all([
    (async () => run(writeSnippet('conc_mix_py', [{ label: 'main.py', language: 'python', code: 'print("mix-py")' }]), 0))(),
    (async () => run(writeSnippet('conc_mix_js', [{ label: 'main.mjs', language: 'javascript', code: 'console.log("mix-js")' }]), 0))(),
    (async () => run(writeSnippet('conc_mix_sh', [{ label: 'main.sh', language: 'bash', code: 'echo mix-sh' }]), 0))(),
  ]);
  check(G, '不同语言并发执行正确', mix.every((r) => r.data.ok) && (mix[0].data.stdout || '').includes('mix-py') && (mix[1].data.stdout || '').includes('mix-js') && (mix[2].data.stdout || '').includes('mix-sh'), JSON.stringify(mix.map((r) => (r.data.stdout || '').trim())).slice(0, 200));
}

async function groupIdempotent() {
  const G = 'H 幂等与临时目录';
  console.log('\n' + G);

  const f = writeSnippet('idem_py', [{ label: 'main.py', language: 'python', code: 'import sys\nprint("stable", sys.version_info.major)' }]);
  const r1 = await run(f, 0);
  const r2 = await run(f, 0);
  check(G, '同代码重复运行结果一致', r1.data.ok === r2.data.ok && (r1.data.stdout || '') === (r2.data.stdout || '') && r1.data.code === r2.data.code, JSON.stringify([r1.data.stdout, r2.data.stdout]).slice(0, 160));

  // 临时目录回收：测试服务 TTL 设为 3 秒，运行后应被自动回收（不再长期堆积）
  const listTmp = () => { try { return new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('mscr-'))); } catch (_) { return new Set(); } };
  const before = listTmp();
  const f2 = writeSnippet('tmp_reclaim', [{ label: 'main.py', language: 'python', code: 'print("tmp")' }]);
  await run(f2, 0);
  const createdNow = [...listTmp()].filter((n) => !before.has(n));
  check(G, '运行会创建独立的临时目录', createdNow.length >= 1, '新增目录数=' + createdNow.length);
  await new Promise((res) => setTimeout(res, 6000));
  const stillThere = createdNow.filter((n) => listTmp().has(n));
  check(G, '临时目录到期后自动回收（TTL）', stillThere.length === 0, '仍残留：' + stillThere.join(' , '));
}

/* -------------------------------------------------------------------- main ---- */

async function main() {
  console.log('CodeScope 代码运行测试（/api/run · /api/check）');
  console.log('临时 vault: ' + vault);
  await startServer();
  console.log('测试服务已启动：' + base);

  await groupBasic();
  await groupStdin();
  await groupErrors();
  await groupTimeout();
  await groupContract();
  await groupSafety();
  await groupConcurrency();
  await groupIdempotent();

  console.log('\n──────────────── 汇总 ────────────────');
  const byGroup = new Map();
  for (const r of results) {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group).push(r);
  }
  for (const [g, list] of byGroup) {
    const p = list.filter((x) => x.status === 'pass').length;
    const f = list.filter((x) => x.status === 'fail').length;
    const s = list.filter((x) => x.status === 'skip').length;
    const w = list.filter((x) => x.status === 'warn').length;
    console.log(g + '：通过 ' + p + ' / 失败 ' + f + (s ? ' / 跳过 ' + s : '') + (w ? ' / 警告 ' + w : ''));
  }
  console.log('\n合计：通过 ' + stats.pass + ' · 失败 ' + stats.fail + ' · 跳过 ' + stats.skip + ' · 警告 ' + stats.warn);

  const failures = results.filter((r) => r.status === 'fail');
  if (failures.length) {
    console.log('\n失败详情：');
    for (const f of failures) console.log('  ❌ [' + f.group + '] ' + f.name + '\n     ' + String(f.detail || '').replace(/\n/g, '\n     ').slice(0, 500));
  }
  const warns = results.filter((r) => r.status === 'warn');
  if (warns.length) {
    console.log('\n设计层面提醒（非断言失败）：');
    for (const w of warns) console.log('  ⚠️  [' + w.group + '] ' + w.name + '\n     ' + String(w.detail || '').slice(0, 400));
  }
  if (stats.fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
}).finally(() => {
  if (child && child.exitCode === null) child.kill();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
