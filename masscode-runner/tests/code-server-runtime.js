#!/usr/bin/env node
'use strict';

/* ── code-server 的 Node 版本闸门 + 原生模块完整性检查 ──
   为什么单独一个文件：它的核心是**纯函数**（"22" / ">=22 <23" / "^22.0.0" 这类
   engines.node 声明的解析与判定），纯函数不该被塞进起服务的 smoke 里；而且它在真机上
   还有几条「照实测」的断言（实际跑 code-server 的是哪台 node、原生模块在不在）。
   package.json 的 npm test 由 smoke + platform-sim 组成、这次不动它，所以本文件单独跑：

       node tests/code-server-runtime.js

   记清楚边界：
   ① 「自愈能不能真的把一个起不来的 node 换掉并且 code-server 照常起来」——这里用**场景仿真**
      （把 CODESCOPE_CODE_SERVER_BIN 指向一个「用 node 26 跑」的临时 shim / 指向一个被还原成
      符号链接的入口）来验判定与选路，且会真的探测候选 node；但**没有**去动用户当前正在用的
      那套运行方式（~/.codescope 下的 shim 与 node22-node.sh 一个字节都不改）。
   ② 原生模块缺了只报结论、给建议 —— 「在 Node 22 下重建」这一步是外部动作，本文件不联网、不安装。 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseNodeVersion, parseNodeRange, satisfiesNodeRange, chooseNodePlan,
  readCodeServerEngines, nodeRuntimePlan, nativeModuleCheck, homebrewLibraryFallback, resetProbe,
  createCodeServerService,
} = require('../lib/code-server-service.js');

let pass = 0;
const failures = [];
/* 用例先登记，最后由文件末尾的 main 依序 await 跑。为什么必须串行：这些用例会改进程环境变量
   （CODESCOPE_CODE_SERVER_BIN）并清模块级缓存，并发跑会互相串味（实测过：符号链接那条
   会共用上一条已经在飞的判定，把结论看错）。 */
const cases = [];
function t(name, fn) { cases.push({ name, fn }); }

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-cs-runtime-'));
const savedBin = process.env.CODESCOPE_CODE_SERVER_BIN;

/* ── 1. 版本号解析（纯函数）── */
t('parseNodeVersion：认识 22.22.0 / v26.7.0 / 22，不认识的一律 null', () => {
  assert.deepStrictEqual(parseNodeVersion('22.22.0'), { major: 22, minor: 22, patch: 0, version: '22.22.0' });
  assert.deepStrictEqual(parseNodeVersion('v26.7.0'), { major: 26, minor: 7, patch: 0, version: '26.7.0' });
  assert.deepStrictEqual(parseNodeVersion('22'), { major: 22, minor: 0, patch: 0, version: '22.0.0' });
  for (const bad of ['', 'v', 'node', '22.22.0.1', 'x.y.z', null, undefined]) {
    assert.strictEqual(parseNodeVersion(bad), null, '「' + String(bad) + '」应判为不认识');
  }
});

/* ── 2. 声明解析（纯函数）：认识三种常见写法 ── */
t('parseNodeRange：认识 "22" / ">=22 <23" / "^22.0.0" / "~22.1.0" / "22 || 24"', () => {
  for (const spec of ['22', '>=22 <23', '^22.0.0', '~22.1.0', '22.x', '>=18', '22 || 24']) {
    assert.strictEqual(parseNodeRange(spec).ok, true, spec + ' 应能解析');
  }
  assert.strictEqual(parseNodeRange('22 || 24').groups.length, 2, '"||" 应切成两组');
  assert.strictEqual(parseNodeRange('>=18 <23').groups[0].length, 2, '空格应是 AND（两个子句）');
  assert.strictEqual(parseNodeRange('*').any, true, '"*" 应表示不限制');
});

/* ── 3. 满足性判定（纯函数，任务点名的三条）── */
t('satisfiesNodeRange："22" 对 22.22.0 满足、对 26.7.0 不满足', () => {
  assert.strictEqual(satisfiesNodeRange('22', '22.22.0'), true);
  assert.strictEqual(satisfiesNodeRange('22', '26.7.0'), false);
  assert.strictEqual(satisfiesNodeRange('>=22 <23', '22.22.0'), true);
  assert.strictEqual(satisfiesNodeRange('>=22 <23', '26.7.0'), false);
  assert.strictEqual(satisfiesNodeRange('^22.0.0', '22.22.0'), true);
  assert.strictEqual(satisfiesNodeRange('^22.0.0', '26.7.0'), false);
  assert.strictEqual(satisfiesNodeRange('~22.1.0', '22.1.9'), true);
  assert.strictEqual(satisfiesNodeRange('~22.1.0', '22.2.0'), false);
  assert.strictEqual(satisfiesNodeRange('22.x', '22.22.0'), true);
  assert.strictEqual(satisfiesNodeRange('>=18', '22.22.0'), true);
  assert.strictEqual(satisfiesNodeRange('22 || 24', '24.4.0'), true);
  assert.strictEqual(satisfiesNodeRange('22 || 24', '23.1.0'), false);
});

t('satisfiesNodeRange：无法解析时是「未知」（null），不是 false、更不崩', () => {
  /* 未知与 false 必须分得开：false 会让上层判定「不合规」并乱换 node，未知只能如实说出来。 */
  assert.strictEqual(satisfiesNodeRange('garbage!!', '22.22.0'), null);
  assert.strictEqual(satisfiesNodeRange('>=', '22.22.0'), null);
  assert.strictEqual(satisfiesNodeRange('22.1.2.3.4', '22.22.0'), null);
  assert.strictEqual(satisfiesNodeRange('22', 'not-a-version'), null);
  assert.strictEqual(satisfiesNodeRange('22', ''), null);
  assert.strictEqual(satisfiesNodeRange(null, '22.22.0'), true, '没声明就算不限制');
  assert.notStrictEqual(satisfiesNodeRange('garbage!!', '22.22.0'), false);
});

/* ── 4. 换不换 node 的决策（纯函数）── */
t('chooseNodePlan：合规就保持原样（不换）', () => {
  const plan = chooseNodePlan({ required: '22', current: { path: '/n22', version: '22.22.0' }, candidates: [{ path: '/n22', version: '22.22.0' }] });
  assert.strictEqual(plan.status, 'ok');
  assert.strictEqual(plan.chosen, null);
});

t('chooseNodePlan：不合规时换到第一个合规候选（不是第一个候选）', () => {
  const plan = chooseNodePlan({
    required: '22',
    current: { path: '/n26', version: '26.7.0' },
    candidates: [{ path: '/n26', version: '26.7.0' }, { path: '/opt/homebrew/opt/node@22/bin/node', version: '22.22.0' }],
  });
  assert.strictEqual(plan.status, 'switch');
  assert.strictEqual(plan.chosen.path, '/opt/homebrew/opt/node@22/bin/node');
  assert.strictEqual(plan.chosen.version, '22.22.0');
});

t('chooseNodePlan：不合规且本机没有合规 node 时如实报「不合规」，不自造方案', () => {
  const plan = chooseNodePlan({ required: '22', current: { path: '/n26', version: '26.7.0' }, candidates: [{ path: '/n26', version: '26.7.0' }] });
  assert.strictEqual(plan.status, 'unsatisfied');
  assert.strictEqual(plan.chosen, null);
  assert.ok(/本机也没找到合规的 node/.test(plan.reason), 'reason 应说明本机没有合规 node：' + plan.reason);
});

t('chooseNodePlan：判定不出来时是「未知」，且不换 node（未知 ≠ 不合规）', () => {
  const noCurrent = chooseNodePlan({ required: '22', current: null, candidates: [{ path: '/n22', version: '22.22.0' }] });
  assert.strictEqual(noCurrent.status, 'unknown');
  assert.strictEqual(noCurrent.chosen, null);
  const badSpec = chooseNodePlan({ required: 'huh?', current: { path: '/n26', version: '26.7.0' } });
  assert.strictEqual(badSpec.status, 'unknown');
  assert.strictEqual(badSpec.chosen, null);
  const noSpec = chooseNodePlan({ required: '', current: { path: '/n26', version: '26.7.0' } });
  assert.strictEqual(noSpec.status, 'ok', '没声明要求就不该拦');
  assert.strictEqual(noSpec.chosen, null);
});

/* ── 5. 真机：判据来自 code-server 自己，实测的是真在跑的 node ── */
t('真机：code-server 自己声明 engines.node，判定结论与实际跑它的 node 一致', async () => {
  resetProbe();
  const engines = readCodeServerEngines();
  if (!engines.ok) {
    console.log('    （本机没装 code-server，跳过真机断言：' + engines.reason + '）');
    return;
  }
  assert.strictEqual(engines.required, '22', 'code-server ' + engines.packageVersion + ' 声明的 engines.node 应为 22，实际 ' + engines.required);
  const plan = await nodeRuntimePlan();
  assert.strictEqual(plan.required, '22');
  assert.strictEqual(plan.engines.root, engines.root);
  if (plan.status === 'ok') {
    assert.strictEqual(satisfiesNodeRange(plan.required, plan.current.version), true,
      '判成 ok 就必须真的满足声明：' + plan.current.version);
  } else if (plan.status === 'switch') {
    assert.strictEqual(satisfiesNodeRange(plan.required, plan.current.version), false, '要换 node 说明当前这台确实不合规');
    assert.strictEqual(satisfiesNodeRange(plan.required, plan.chosen.version), true, '换上去的那台必须合规');
  } else {
    assert.ok(['unknown', 'unsatisfied'].includes(plan.status), '不该出现别的状态：' + plan.status);
  }
  console.log('    真机判定：' + plan.status + ' · ' + plan.reason);
});

t('真机：homebrewLibraryFallback + node@22 —— 候选 node 必须真的能跑（dyld 那条路算进去）', async () => {
  const candidate = ['/opt/homebrew/opt/node@22/bin/node', '/opt/homebrew/Cellar/node@22/22.22.0_1/bin/node'].find((item) => {
    try { return fs.statSync(item).isFile(); } catch (_) { return false; }
  });
  if (!candidate) {
    console.log('    （本机没有 node@22，跳过）');
    return;
  }
  const { spawnSync } = require('child_process');
  const plain = spawnSync(candidate, ['-v'], { encoding: 'utf8', timeout: 8000 });
  const fallback = homebrewLibraryFallback();
  if (plain.status === 0) {
    assert.ok(/^v22\./.test(String(plain.stdout).trim()), 'node@22 直接能跑时应报 v22.x，实际 ' + plain.stdout);
    return;
  }
  /* 直接跑不起来（Homebrew 升级 simdjson/simdutf 后就是这条路）→ 补上旧库搜索路径必须能跑。 */
  assert.ok(/dyld|Library not loaded|\.dylib/.test(String(plain.stderr) + String(plain.stdout)), '失败原因应是动态库找不到：' + plain.stderr);
  assert.ok(fallback, 'dyld 失败时必须能算出 Homebrew 旧库兜底路径');
  const retried = spawnSync(candidate, ['-v'], {
    encoding: 'utf8', timeout: 8000,
    env: { ...process.env, DYLD_FALLBACK_LIBRARY_PATH: (process.env.DYLD_FALLBACK_LIBRARY_PATH || '') + ':' + fallback },
  });
  assert.strictEqual(retried.status, 0, '补上 DYLD_FALLBACK_LIBRARY_PATH 后 node@22 应能跑：' + retried.stderr);
  assert.ok(/^v22\./.test(String(retried.stdout).trim()), '应报 v22.x，实际 ' + retried.stdout);
  console.log('    真机：node@22 需要 DYLD_FALLBACK_LIBRARY_PATH（' + fallback.split(':').length + ' 个旧 keg 库目录），补上后 ' + String(retried.stdout).trim());
});

t('真机：原生模块检查 —— 三个必需模块外加 sqlite3 都在且能被 require', async () => {
  resetProbe();
  const natives = await nativeModuleCheck();
  if (!natives.root) {
    console.log('    （本机没装 code-server，跳过）');
    return;
  }
  const names = natives.modules.map((item) => item.name);
  for (const wanted of ['spdlog', 'native-watchdog', 'fs-copyfile']) {
    assert.ok(names.includes(wanted), '检查清单里应有 ' + wanted);
  }
  assert.strictEqual(natives.ok, true, '本机原生模块应齐全，缺：' + JSON.stringify(natives.missing.map((item) => item.name)));
  assert.deepStrictEqual(natives.missing, []);
  assert.deepStrictEqual(natives.unloadable, []);
  for (const item of natives.modules) {
    assert.strictEqual(item.present, true, item.name + ' 的 build/Release 下应有 .node');
    assert.strictEqual(item.loadable, true, item.name + ' 应能被 require（实测在子进程里跑）');
  }
  console.log('    真机：' + natives.modules.map((item) => item.name + '(' + item.binaries.join(',') + ')').join(' '));
});

/* ── 6. 场景仿真：.bin/code-server 被 npm install 还原成符号链接（node 26 跑）── */
t('仿真：入口是符号链接时照样能认出「实际用的是 PATH 上的 node」并选好合规 node', async () => {
  const dir = path.join(tempRoot, 'reverted');
  fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  const link = path.join(dir, 'node_modules', '.bin', 'code-server');
  const entry = path.join(os.homedir(), '.codescope', 'node_modules', 'code-server', 'out', 'node', 'entry.js');
  if (!fs.existsSync(entry)) {
    console.log('    （本机没有 ~/.codescope 的 code-server 入口，跳过）');
    return;
  }
  fs.symlinkSync(entry, link);
  process.env.CODESCOPE_CODE_SERVER_BIN = link;
  resetProbe();
  try {
    const plan = await nodeRuntimePlan();
    assert.ok(plan.current && plan.current.version, '必须能实测出实际会用哪台 node，实际 ' + JSON.stringify(plan.current));
    const verdict = satisfiesNodeRange(plan.required, plan.current.version);
    assert.notStrictEqual(verdict, null, '当前 node 的版本必须能判定，实际 ' + plan.current.version);
    if (verdict === false) {
      assert.strictEqual(plan.status, 'switch', '实测不合规就必须切到合规 node，实际 ' + plan.status);
      assert.strictEqual(satisfiesNodeRange(plan.required, plan.chosen.version), true);
      console.log('    仿真：实测到 Node v' + plan.current.version + '（通过符号链接的 shebang）→ 换到 ' + plan.chosen.path + '（v' + plan.chosen.version + '）');
    } else {
      assert.strictEqual(plan.status, 'ok', 'PATH 上的 node 本身就合规时不该乱换');
      console.log('    仿真：PATH 上的 node v' + plan.current.version + ' 本身合规，保持原样');
    }
  } finally {
    if (savedBin === undefined) delete process.env.CODESCOPE_CODE_SERVER_BIN; else process.env.CODESCOPE_CODE_SERVER_BIN = savedBin;
    resetProbe();
  }
});

/* ── 7. 场景仿真：原生模块缺失 → 结论进 hint（这条正是「源代码管理不可用」那次事故）── */
t('仿真：原生模块缺失时状态里给出明确结论，且不联网、不安装', async () => {
  const root = path.join(tempRoot, 'broken', 'node_modules', 'code-server');
  fs.mkdirSync(path.join(root, 'out', 'node'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'),
    JSON.stringify({ name: 'code-server', version: '9.9.9', engines: { node: '22' } }), 'utf8');
  const entry = path.join(root, 'out', 'node', 'entry.js');
  fs.writeFileSync(entry, '#!/usr/bin/env node\nconsole.log("9.9.9 with Code 1.0.0");\n', 'utf8');
  fs.chmodSync(entry, 0o755);
  process.env.CODESCOPE_CODE_SERVER_BIN = entry;
  resetProbe();
  try {
    const natives = await nativeModuleCheck();
    assert.strictEqual(natives.root, root, '应按用户指定的 code-server 目录判断，实际 ' + natives.root);
    assert.strictEqual(natives.ok, false, '一个原生模块都没有时不该判成齐全');
    assert.deepStrictEqual(natives.missing.map((item) => item.name).sort(), ['fs-copyfile', 'native-watchdog', 'spdlog', 'sqlite3']);
    /* hint 是前端唯一已经在渲染的字段，结论必须落进这里。 */
    const service = createCodeServerService({ port: 4979, dataRoot: path.join(tempRoot, 'data') });
    const status = service.status();
    assert.strictEqual(status.nativeModules.ok, false);
    assert.deepStrictEqual(status.nativeModules.missing.sort(), ['fs-copyfile', 'native-watchdog', 'spdlog', 'sqlite3']);
    assert.ok(/原生模块不完整/.test(status.hint), 'hint 应说明原生模块不完整：' + status.hint);
    assert.ok(/源代码管理/.test(status.hint) && /不会自动联网安装/.test(status.hint), 'hint 应给出后果与「不自动安装」的边界：' + status.hint);
    assert.ok(/spdlog/.test(status.hint), 'hint 应点名缺了哪些：' + status.hint);
    console.log('    仿真 hint：' + status.hint);
  } finally {
    if (savedBin === undefined) delete process.env.CODESCOPE_CODE_SERVER_BIN; else process.env.CODESCOPE_CODE_SERVER_BIN = savedBin;
    resetProbe();
  }
});

/* ── 依序跑完所有用例再结算（串行见上面 cases 的注释）── */
async function main() {
  for (const item of cases) {
    try { await item.fn(); pass += 1; } catch (error) { failures.push(item.name + ' → ' + (error && error.message || error)); }
  }
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (_) { /* 临时目录清不掉不影响结论 */ }
  console.log('');
  if (failures.length) {
    console.log('  ✗ code-server 运行时闸门：' + pass + ' 通过 / ' + failures.length + ' 失败');
    for (const line of failures) console.log('      ' + line);
    process.exit(1);
  }
  console.log('  ✅ code-server 运行时闸门（Node 版本解析/判定/自愈选路 + 原生模块完整性）：' + pass + '/' + pass + ' 通过');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
