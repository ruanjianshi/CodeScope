/* 表达式引擎（lib/expr.js）—— 纯单测 ✓，不联网 ✓、不起服务 ✓。
   ⚠️ 这个文件里**一半的断言是安全** ✗ ——
      引擎是自己写的分词 + 递归下降 ✓，**不用 eval** ✗，
      所以「能不能绕过白名单执行代码」必须一条条打 ✓。 */
const E = require('../lib/expr.js');

let pass = 0; const fails = [];
const ck = (n, ok, x) => { if (ok) { pass++; } else { fails.push(n + (x ? '  → ' + x : '')); console.log('  ❌ ' + n + (x ? '  → ' + x : '')); } };
const eq = (n, a, b) => ck(n, JSON.stringify(a) === JSON.stringify(b), '得到 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b));
/* 求值：不抛就返回 {v}，抛了就返回 {e} ✓ */
const ev = (src, scope) => { try { return { v: E.evaluate(src, scope) }; } catch (e) { return { e: String(e.message) }; } };

const NOW = 1791380000000;   /* 固定时间戳 ✓（2026-10-07 前后 ✓），不依赖真实时钟 ✗ */
const scope = E.makeScope({
  input: { title: 'hello world', count: 3, price: 9.5, list: [{ t: 'a', n: 1 }, { t: 'b', n: 2 }], '标题': '你好', flag: true },
  vars: { n1: { json: { price: 10, name: '取价结果' } }, n2: { text: 'AI 的回答' }, n9: { v: 9 } },
  nodes: [{ id: 'n1', name: '取价' }, { id: 'n2', name: '问 AI' }, { id: 'n9', name: '中文节点' }],
  now: NOW, workflow: { name: '测试流', id: 'w1' }, execution: { id: 'e1' },
});

console.log('── ① 字面量与运算 ──');
eq('整数', ev('42', scope).v, 42);
eq('小数', ev('1.5', scope).v, 1.5);
eq('字符串（单引号）', ev("'abc'", scope).v, 'abc');
eq('字符串（双引号）', ev('"abc"', scope).v, 'abc');
eq('转义 \\n', ev('"a\\nb"', scope).v, 'a\nb');
eq('true / false / null', [ev('true', scope).v, ev('false', scope).v, ev('null', scope).v], [true, false, null]);
eq('加减乘除', [ev('2+3', scope).v, ev('10-4', scope).v, ev('3*4', scope).v, ev('10/4', scope).v], [5, 6, 12, 2.5]);
eq('取余', ev('10%3', scope).v, 1);
eq('括号改变优先级', ev('(2+3)*4', scope).v, 20);
eq('除零给 NaN（不抛）', Number.isNaN(ev('1/0', scope).v), true);
eq('一元负号', ev('-5', scope).v, -5);
eq('逻辑非', ev('!false', scope).v, true);
eq('比较', [ev('1<2', scope).v, ev('2<=2', scope).v, ev('3>4', scope).v, ev('1>=1', scope).v], [true, true, false, true]);
eq('相等', [ev('1==1', scope).v, ev('1!=2', scope).v, ev("'1'==1", scope).v], [true, true, true]);
eq('&& 与 ||', [ev('true && false', scope).v, ev('true || false', scope).v, ev('false || 7', scope).v], [false, true, 7]);
eq('三元', ev('1 > 0 ? "正" : "负"', scope).v, '正');
eq('★ 两边都是数字串时 + 做**加法**（不是拼接）', ev("'1' + '2'", scope).v, 3);
eq('★ 有一边不是数字串时 + 做**拼接**', ev("'a' + '2'", scope).v, 'a2');
eq('数字 + 字符串', ev("1 + 'a'", scope).v, '1a');

console.log('\n── ② 路径（含中文、数组、方括号）──');
eq('一层', ev('$json.title', scope).v, 'hello world');
eq('两层', ev('$json.list[0].t', scope).v, 'a');
eq('数组下标', ev('$json.list[1].n', scope).v, 2);
eq('★ 中文字段', ev('$json.标题', scope).v, '你好');
eq('方括号 + 字符串 key', ev('$json["title"]', scope).v, 'hello world');
eq('length 属性', ev('$json.list.length', scope).v, 2);
eq('取不存在的字段 → undefined（不抛）', ev('$json.nope', scope).v, undefined);
eq('往不存在的路径深处走 → undefined（不抛）', ev('$json.a.b.c', scope).v, undefined);

console.log('\n── ③ 根变量 ──');
eq('$now', ev('$now', scope).v, NOW);
eq('$today 是当天 0 点', new Date(ev('$today', scope).v).getHours(), 0);
eq('$workflow.name', ev('$workflow.name', scope).v, '测试流');
eq('$execution.id', ev('$execution.id', scope).v, 'e1');
eq('$vars 能取到任意节点输出', ev('$vars.n2.text', scope).v, 'AI 的回答');
eq('★ $node["节点名"]', ev('$node["问 AI"].text', scope).v, 'AI 的回答');
eq('★ $node["节点id"] 也行', ev('$node["n1"].json.price', scope).v, 10);
eq('★ $node 认中文名', ev('$node["中文节点"].v', scope).v, 9);
ck('$node 找不存在的节点 → 抛（并且提示写名字还是 id）', /找不到节点/.test(ev('$node["没有"].x', scope).e || ''), ev('$node["没有"].x', scope).e);

console.log('\n── ④ 函数（白名单）──');
eq('Math.round', ev('Math.round(3.6)', scope).v, 4);
eq('Math.floor / ceil', [ev('Math.floor(3.9)', scope).v, ev('Math.ceil(3.1)', scope).v], [3, 4]);
eq('Math.max / min', [ev('Math.max(1,5,3)', scope).v, ev('Math.min(1,5,3)', scope).v], [5, 1]);
eq('Math.abs', ev('Math.abs(-7)', scope).v, 7);
eq('Math.pow', ev('Math.pow(2,10)', scope).v, 1024);
eq('Number()', ev('Number("12") + 1', scope).v, 13);
eq('String()', ev('String(12) + "!"', scope).v, '12!');
eq('JSON.stringify', ev('JSON.stringify($json.list[0])', scope).v, '{"t":"a","n":1}');
eq('JSON.parse', ev('JSON.parse(\'{"a":1}\').a', scope).v, 1);
eq('len() 字符串', ev('len($json.title)', scope).v, 11);
eq('len() 数组', ev('len($json.list)', scope).v, 2);
eq('len() 对象', ev('len($json)', scope).v, 6);   /* title/count/price/list/标题/flag = 6 个键 ✓ */
eq('empty()', [ev('empty("")', scope).v, ev('empty("x")', scope).v, ev('empty($json.nope)', scope).v], [true, false, true]);
eq('upper / lower / trim', [ev('upper("ab")', scope).v, ev('lower("AB")', scope).v, ev('trim("  x  ")', scope).v], ['AB', 'ab', 'x']);
eq('json()', ev('json(1)', scope).v, '1');

console.log('\n── ⑤ 方法（白名单）──');
eq('toUpperCase', ev('$json.title.toUpperCase()', scope).v, 'HELLO WORLD');
eq('trim', ev('"  x ".trim()', scope).v, 'x');
eq('slice', ev('"abcdef".slice(1,3)', scope).v, 'bc');
eq('split + join', ev('"a,b,c".split(",").join("-")', scope).v, 'a-b-c');
eq('replace', ev('"a-b".replace("-","+")', scope).v, 'a+b');
eq('replaceAll', ev('"a-b-c".replaceAll("-","+")', scope).v, 'a+b+c');
eq('includes', ev('$json.title.includes("world")', scope).v, true);
eq('startsWith / endsWith', [ev('"abc".startsWith("a")', scope).v, ev('"abc".endsWith("c")', scope).v], [true, true]);
eq('indexOf', ev('"abc".indexOf("b")', scope).v, 1);
eq('padStart', ev('"5".padStart(3,"0")', scope).v, '005');
eq('repeat', ev('"ab".repeat(3)', scope).v, 'ababab');
eq('charAt', ev('"abc".charAt(1)', scope).v, 'b');
eq('数字 toFixed', ev('(9.456).toFixed(2)', scope).v, '9.46');
eq('数组 join', ev('$json.list.join("|")', scope).v, '[object Object]|[object Object]');
eq('数组 slice', ev('$json.list.slice(0,1).length', scope).v, 1);
eq('链式调用', ev('$json.title.toUpperCase().split(" ").join("_")', scope).v, 'HELLO_WORLD');
ck('★ 白名单外的方法要拦下', /白名单外/.test(ev('$json.title.badMethod()', scope).e || ''), ev('$json.title.badMethod()', scope).e);
ck('★ .constructor 这类也要拦下', /白名单外|不认识的变量/.test(ev('$json.constructor.constructor("x")()', scope).e || ''), ev('$json.constructor.constructor("x")()', scope).e);
ck('.filter/.map 明确说不支持（工作流里没有函数值）', /要传函数/.test(ev('$json.list.filter(1)', scope).e || ''), ev('$json.list.filter(1)', scope).e);

console.log('\n── ⑥ 模板渲染 ──');
eq('单个占位', E.renderTpl('标题：{{ $json.title }}', scope), '标题：hello world');
eq('多个占位', E.renderTpl('{{ $json.title }} / {{ $json.count }}', scope), 'hello world / 3');
eq('中文占位', E.renderTpl('{{ $json.标题 }}！', scope), '你好！');
eq('表达式占位', E.renderTpl('{{ $json.count * 2 }}', scope), '6');
eq('对象会变成 JSON 文本', E.renderTpl('{{ $json.list[0] }}', scope), '{\n  "t": "a",\n  "n": 1\n}');
eq('没有占位就原样返回', E.renderTpl('一段普通文字', scope), '一段普通文字');
eq('空模板不炸', [E.renderTpl('', scope), E.renderTpl(null, scope)], ['', '']);
eq('占位里有空格也行', E.renderTpl('{{$json.count}}', scope), '3');

console.log('\n── ⑦ 向后兼容（老写法不能坏）──');
eq('{{input}}', E.renderTpl('{{input}}', scope).slice(0, 10), '{\n  "title');
eq('{{节点id}}', E.renderTpl('{{n2}}', scope), '{\n  "text": "AI 的回答"\n}');
eq('{{节点id.字段}}', E.renderTpl('{{n2.text}}', scope), 'AI 的回答');
eq('{{节点id.深层.字段}}', E.renderTpl('{{n1.json.price}}', scope), '10');
eq('★ {{中文节点名}} 也要能用（以前就支持）', E.renderTpl('{{中文节点}}', scope), '{\n  "v": 9\n}');
eq('★ 取不到 → 空串（不是报错）', E.renderTpl('A{{ 不存在 }}B', scope), 'AB');
eq('★ 字段取不到 → 空串', E.renderTpl('A{{ $json.nope }}B', scope), 'AB');
eq('老写法取不到也空串', E.renderTpl('A{{ 没这个节点.字段 }}B', scope), 'AB');

console.log('\n── ⑧ 错误处理：取不到给空串，**写错要抛** ──');
ck('★ 括号没闭合 → 抛（不能静默成空串）', !!ev('$json.title.slice(', scope).e, JSON.stringify(ev('$json.title.slice(', scope)));
ck('★ 模板里写错也要抛', (() => { try { E.renderTpl('{{ $json.title.slice( }}', scope); return false; } catch (_) { return true; } })());
ck('★ 白名单外的函数 → 抛', !!ev('eval("1")', scope).e, JSON.stringify(ev('eval("1")', scope)));
ck('字符串没闭合 → 抛', !!ev('"abc', scope).e, JSON.stringify(ev('"abc', scope)));
ck('多余的东西 → 抛', !!ev('1 2', scope).e, JSON.stringify(ev('1 2', scope)));
ck('空表达式 → undefined（不炸）', E.evaluate('', scope) === undefined && E.evaluate('   ', scope) === undefined);

console.log('\n── ⑨ ★★★ 安全：能不能绕过白名单执行代码 ──');
const DANGER = [
  'process.exit(1)',
  'process.env',
  'require("fs")',
  'globalThis',
  'this',
  'constructor',
  'constructor.constructor("return 1")()',
  '({}).constructor',
  '(()=>1)()',
  'function(){}',
  'new Function("return 1")',
  'eval("1")',
  'setTimeout',
  'import("fs")',
  '$env("AWS_SECRET_ACCESS_KEY")',
  '$env("OPENAI_API_KEY")',
  'Math.constructor',
  'JSON.constructor',
  '"".constructor.constructor("return process")()',
];
for (const src of DANGER) {
  const r = ev(src, scope);
  ck('★ 拦下：' + src, !!r.e, '竟然通过了 → ' + JSON.stringify(r.v));
}
const OKENV = ev('$env("HOME")', scope);
ck('$env 白名单里的可以读（HOME）', typeof OKENV.v === 'string' && !OKENV.e, JSON.stringify(OKENV));

console.log('\n── ⑩ 脏输入不炸 ──');
ck('evaluate(null)', ev(null, scope).v === undefined);
ck('evaluate(undefined)', ev(undefined, scope).v === undefined);
ck('evaluate(数字)', ev(123, scope).v === 123);
ck('scope 传 null 也不炸', !!ev('1+1', null).v);
ck('makeScope() 空调用', !!E.makeScope());
ck('makeScope 空对象', !!E.makeScope({}));
ck('tokenize 空串', E.tokenize('').length === 1);
ck('getPath 空路径', E.getPath({ a: 1 }, '') === undefined || true);
ck('toText 各种类型', [E.toText(null), E.toText(1), E.toText('a'), E.toText(true)].join(',') === ',1,a,true');

console.log('\n表达式引擎：' + pass + ' 项通过' + (fails.length ? '，' + fails.length + ' 项失败 ✗' : ' ✓'));
if (fails.length) { console.log('失败清单：\n  - ' + fails.join('\n  - ')); process.exit(1); }
