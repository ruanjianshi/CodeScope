'use strict';

/* ── 表达式引擎（n8n 风格）✓ ────────────────────────────────────────────────
   纯逻辑 ✓：不碰 DOM ✗、不联网 ✗、**不用 eval / new Function** ✗✗。
   自己写「分词 → 递归下降求值」✓，所以：
     · 没有任意代码执行 ✗（工作流是存在磁盘上的文本 ✗，
       要是用 eval 跑，等于谁改一下那个 json 就能在你机器上执行代码 ✗）；
     · 能逐条单测 ✓（`tests/expr.js` ✓）；
     · 前后端**共用同一份** ✓（双栖 ✓，浏览器里挂 window.LW_EXPR ✓）。

   ── 支持什么 ─────────────────────────────────────────────────────────────
   根变量：
     $json              上游节点的输出（合并后 ✓）
     $node["名字"]      任意节点（按**名字**或 id ✓）的输出，再往下点 ✓
     $now / $today      当前时间（毫秒戳 / 当天 00:00 ✓）
     $workflow          { name, id }
     $execution         { id, startedAt }
     $env("NAME")       环境变量（**白名单前缀** ✗，见下 ✓）

   路径：      a.b.c   /   list[0].title   /   obj["带空格 的 key"]
   字面量：    123  1.5  'str'  "str"  true  false  null
   运算：      + - * / %   ==  !=  >  <  >=  <=   &&  ||  !   条件 ? :
   函数：      Math.round / floor / ceil / abs / max / min / pow
               Number() String() Boolean() JSON.stringify() JSON.parse()
               len()  empty()  upper()  lower()  trim()  now()
   方法（白名单 ✓）：
     字符串  .toUpperCase() .toLowerCase() .trim() .slice(a,b) .substring(a,b)
             .split(s) .replace(a,b) .replaceAll(a,b) .includes(x) .startsWith(x)
             .endsWith(x) .indexOf(x) .padStart(n,s) .padEnd(n,s) .repeat(n)
             .charAt(i) .concat(x)
     数组    .join(s) .slice(a,b) .includes(x) .indexOf(x) .concat(x) .reverse() .sort()
     数字    .toFixed(n) .toString()
     通用    .length（属性 ✓）

   ── 怎么用 ───────────────────────────────────────────────────────────────
     const scope = makeScope({ vars, input, now, nodeMeta });
     evaluate('$json.title.toUpperCase()', scope);      // → 'ABC'
     renderTpl('标题是 {{ $json.title }}', scope);      // → '标题是 ABC'

   ⚠️ **向后兼容** ✗：老的 `{{节点id}}` / `{{节点id.字段}}` / `{{input}}` 写法
      仍然要能用 ✓ —— 已有工作流不能因为这次升级就坏掉 ✗。
      实现上：表达式求值失败时，退回「按节点 id 当路径取」✓（见 resolveLegacy ✓）。
   ══════════════════════════════════════════════════════════════════════════ */

/* ── 分词 ✓ ────────────────────────────────────────────────────────────── */
const PUNCT = ['===', '!==', '==', '!=', '>=', '<=', '&&', '||', '+', '-', '*', '/', '%',
  '(', ')', '[', ']', '.', ',', '?', ':', '>', '<', '!'];
/* ★★ 标识符要**认中文** ✗✗ —— 这个应用里节点名是中文（「问 AI」「取价」✓）、
   数据字段也常常是中文（`$json.标题` ✓）。
   不认的话有两个后果 ✗：① `$json.标题` 直接报「看不懂的字符」✗；
   ② 更要紧的是**向后兼容断掉** ✗ —— 老写法 `{{某个中文节点名}}` 本来取不到就返回空串 ✓，
      现在会变成语法错误抛出去 ✗，把用户已有工作流跑挂 ✗。
   → 规则：ASCII 字母/数字/_/$ 照旧 ✓，**码位 > 127 的也算标识符字符** ✓。 */
const isIdStart = (ch) => /[A-Za-z_$]/.test(ch) || ch.charCodeAt(0) > 127;
const isIdPart = (ch) => /[A-Za-z0-9_$]/.test(ch) || ch.charCodeAt(0) > 127;

function tokenize(src) {
  const s = String(src == null ? '' : src);
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    /* 字符串：单双引号都行 ✓，支持 \n \t \\ \' \" 转义 ✓ */
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      let buf = '';
      while (j < s.length && s[j] !== quote) {
        if (s[j] === '\\') {
          const n = s[j + 1];
          buf += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n === undefined ? '' : n;
          j += 2;
        } else { buf += s[j]; j++; }
      }
      if (j >= s.length) throw new Error('字符串没闭合（少了 ' + quote + '）');
      out.push({ k: 'str', v: buf });
      i = j + 1;
      continue;
    }
    /* 数字：含小数 ✓ */
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const raw = s.slice(i, j);
      if ((raw.match(/\./g) || []).length > 1) throw new Error('数字写错了：' + raw);
      out.push({ k: 'num', v: Number(raw) });
      i = j;
      continue;
    }
    /* 标识符 / 根变量（$ 开头 ✓ / 中文 ✓）*/
    if (isIdStart(c)) {
      let j = i;
      while (j < s.length && isIdPart(s[j])) j++;
      out.push({ k: 'id', v: s.slice(i, j) });
      i = j;
      continue;
    }
    /* 标点：长的优先 ✓（不然 === 会被切成 == 和 = ✗）*/
    const p = PUNCT.find((x) => s.startsWith(x, i));
    if (!p) throw new Error('看不懂的字符：' + c);
    out.push({ k: 'p', v: p });
    i += p.length;
  }
  out.push({ k: 'eof', v: '' });
  return out;
}

/* ── 递归下降求值器 ✓ ─────────────────────────────────────────────────────
   直接把「语法树」省掉 ✗：边解析边算 ✓（表达式很短 ✓，不值得建树 ✓）。
   优先级（低 → 高）：条件 ?: → || → && → 比较 → 加减 → 乘除 → 一元 → 后缀 → 原子 ✓ */
const SAFE_METHODS = new Set([
  'toUpperCase', 'toLowerCase', 'trim', 'trimStart', 'trimEnd', 'slice', 'substring',
  'split', 'replace', 'replaceAll', 'includes', 'startsWith', 'endsWith', 'indexOf',
  'lastIndexOf', 'padStart', 'padEnd', 'repeat', 'charAt', 'concat', 'join', 'reverse',
  'sort', 'toFixed', 'toString', 'filter', 'map',
]);
const SAFE_FUNCS = {
  Number, String, Boolean, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  upper: (v) => String(v == null ? '' : v).toUpperCase(),
  lower: (v) => String(v == null ? '' : v).toLowerCase(),
  trim: (v) => String(v == null ? '' : v).trim(),
  len: (v) => (v == null ? 0 : (Array.isArray(v) || typeof v === 'string' ? v.length : Object.keys(v).length)),
  empty: (v) => v == null || v === '' || (Array.isArray(v) && !v.length),
  json: (v) => JSON.stringify(v),
  int: (v) => Math.trunc(Number(v) || 0),
  num: (v) => Number(v) || 0,
  str: (v) => (v == null ? '' : String(v)),
};
const SAFE_MATH = {
  round: Math.round, floor: Math.floor, ceil: Math.ceil, abs: Math.abs,
  max: Math.max, min: Math.min, pow: Math.pow, sqrt: Math.sqrt, trunc: Math.trunc,
  sign: Math.sign, random: Math.random,
};

function makeParser(tokens, scope) {
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];
  const isP = (v) => peek().k === 'p' && peek().v === v;
  const eat = (v) => { if (!isP(v)) throw new Error('这里应该是 ' + v + '（实际是 ' + (peek().v || '末尾') + '）'); p++; };
  const isId = (v) => peek().k === 'id' && peek().v === v;
  const eatId = (v) => { if (!isId(v)) throw new Error('这里应该是 ' + v); p++; };

  /* 解析逗号分隔的参数 ✓ */
  function args() {
    const list = [];
    if (isP(')')) { p++; return list; }
    for (;;) {
      list.push(ternary());
      if (isP(',')) { p++; continue; }
      eat(')');
      return list;
    }
  }

  function ternary() {
    const cond = or();
    if (!isP('?')) return cond;
    p++;
    const a = ternary();
    eat(':');
    const b = ternary();
    return truthy(cond) ? a : b;
  }
  function or() {
    let v = and();
    while (isP('||')) { p++; const r = and(); v = truthy(v) ? v : r; }
    return v;
  }
  function and() {
    let v = equality();
    while (isP('&&')) { p++; const r = equality(); v = truthy(v) ? r : v; }
    return v;
  }
  function equality() {
    let v = relational();
    for (;;) {
      if (isP('==') || isP('===')) { p++; v = looseEq(v, relational()); }
      else if (isP('!=') || isP('!==')) { p++; v = !looseEq(v, relational()); }
      else return v;
    }
  }
  function relational() {
    let v = additive();
    for (;;) {
      if (isP('>')) { p++; v = cmp(v, additive()) > 0; }
      else if (isP('<')) { p++; v = cmp(v, additive()) < 0; }
      else if (isP('>=')) { p++; v = cmp(v, additive()) >= 0; }
      else if (isP('<=')) { p++; v = cmp(v, additive()) <= 0; }
      else return v;
    }
  }
  function additive() {
    let v = multiplicative();
    for (;;) {
      if (isP('+')) { p++; const r = multiplicative(); v = plus(v, r); }
      else if (isP('-')) { p++; v = Number(v) - Number(multiplicative()); }
      else return v;
    }
  }
  function multiplicative() {
    let v = unary();
    for (;;) {
      if (isP('*')) { p++; v = Number(v) * Number(unary()); }
      else if (isP('/')) { p++; const d = Number(unary()); v = d === 0 ? NaN : Number(v) / d; }
      else if (isP('%')) { p++; const d = Number(unary()); v = d === 0 ? NaN : Number(v) % d; }
      else return v;
    }
  }
  function unary() {
    if (isP('!')) { p++; return !truthy(unary()); }
    if (isP('-')) { p++; return -Number(unary()); }
    if (isP('+')) { p++; return Number(unary()); }
    return postfix();
  }
  /* 后缀：`.xxx` / `.xxx(...)` / `[...]` ✓ —— 一层层往左套 ✓ */
  function postfix() {
    let v = primary();
    for (;;) {
      if (isP('.')) {
        p++;
        const t = next();
        if (t.k !== 'id') throw new Error('点号后面要跟属性名');
        if (isP('(')) { p++; const a = args(); v = callMethod(v, t.v, a); }
        else v = prop(v, t.v);
        continue;
      }
      if (isP('[')) {
        p++;
        const k = ternary();
        eat(']');
        v = prop(v, k);
        continue;
      }
      return v;
    }
  }
  function primary() {
    const t = next();
    if (t.k === 'num' || t.k === 'str') return t.v;
    /* lit = 已经算好的值 ✓（$node[...] / $env(...) 折过来的 ✓）*/
    if (t.k === 'lit') return t.v;
    /* ★ 数组字面量 `[1, 2, 3]` ✓ —— n8n 里很常用 ✓
       （写「编辑字段」时想造个小列表，没有这个就只能去接一个 HTTP ✗）。 */
    if (t.k === 'p' && t.v === '[') {
      const list = [];
      if (isP(']')) { p++; return list; }
      for (;;) {
        list.push(ternary());
        if (isP(',')) { p++; continue; }
        eat(']');
        return list;
      }
    }
    if (t.k === 'p' && t.v === '(') { const v = ternary(); eat(')'); return v; }
    if (t.k !== 'id') throw new Error('这里缺一个值（实际是 ' + (t.v || '末尾') + '）');
    if (t.v === 'true') return true;
    if (t.v === 'false') return false;
    if (t.v === 'null') return null;
    if (t.v === 'undefined') return undefined;
    /* 函数调用：Math.round(...) / Number(...) / len(...) ✓ */
    if (isP('(')) {
      p++;
      const a = args();
      if (t.v === 'Math') throw new Error('Math 后面要跟具体函数，比如 Math.round(...)');
      if (t.v === 'JSON') throw new Error('JSON 后面要跟 stringify / parse');
      const fn = SAFE_FUNCS[t.v];
      if (!fn) throw new Error('不认识的函数：' + t.v + '（能用的只有 ' + Object.keys(SAFE_FUNCS).join(' / ') + ' ✓）');
      return fn.apply(null, a);
    }
    /* Math.xxx 和 JSON.xxx：它们自己是个「命名空间」✓ */
    if (t.v === 'Math') return { __ns: 'Math' };
    if (t.v === 'JSON') return { __ns: 'JSON' };
    return resolveRoot(t.v, scope);
  }

  /* Math.xxx / JSON.xxx 走这里 ✓ —— 白名单 ✓，绝不反射到真对象上 ✗ */
  function callMethod(obj, name, a) {
    if (obj && obj.__ns === 'Math') {
      const fn = SAFE_MATH[name];
      if (!fn) throw new Error('Math 里没有 ' + name + ' ✓');
      return fn.apply(null, a);
    }
    if (obj && obj.__ns === 'JSON') {
      if (name === 'stringify') return JSON.stringify(a[0], null, a[1]);
      if (name === 'parse') { try { return JSON.parse(a[0]); } catch (e) { throw new Error('JSON.parse 失败：' + e.message); } }
      throw new Error('JSON 里只有 stringify / parse ✓');
    }
    if (!SAFE_METHODS.has(name)) throw new Error('不允许调用 .' + name + '()（白名单外 ✗）');
    if (obj == null) return undefined;
    if (name === 'filter' || name === 'map') throw new Error('.' + name + '() 要传函数 ✗ —— 工作流里没有函数值，请改用「过滤 / 编辑字段」节点 ✓');
    const fn = obj[name];
    if (typeof fn !== 'function') throw new Error(String(obj) + ' 没有 .' + name + '()');
    return fn.apply(obj, a);
  }
  function prop(obj, key) {
    if (obj == null) return undefined;
    if (obj.__ns === 'Math' || obj.__ns === 'JSON') throw new Error('Math / JSON 后面要跟函数调用，不能直接当值用');
    if (typeof key === 'number' || /^\d+$/.test(String(key))) {
      const idx = Number(key);
      return Array.isArray(obj) || typeof obj === 'string' ? obj[idx] : obj[String(key)];
    }
    return obj[String(key)];
  }

  return { run: () => { const v = ternary(); if (peek().k !== 'eof') throw new Error('表达式后面还有多余的东西：' + peek().v); return v; } };
}

/* ── 运算符语义 ✓（尽量像 JS ✓，但 `+` 更宽容一点 ✓）─────────────────────── */
function truthy(v) { return !(v === false || v == null || v === 0 || v === '' || v === 'false'); }
function looseEq(a, b) {
  if (a == null && b == null) return true;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a) === String(b);
}
function cmp(a, b) {
  if (typeof a === 'number' || typeof b === 'number') return Number(a) - Number(b);
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}
function plus(a, b) {
  /* ★ 两边都「像数字」才做加法 ✓ —— 不然 '1' + '2' 会得到 '12' ✗，
     而用户写 `{{ $json.count + 1 }}` 时心里想的是**加法** ✓。
     ⚠️ 但两个都是字符串、且都不是数字串时，按**拼接** ✓（那才是他想要的 ✓）。 */
  const an = a === '' || a == null ? NaN : Number(a);
  const bn = b === '' || b == null ? NaN : Number(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an + bn;
  return String(a == null ? '' : a) + String(b == null ? '' : b);
}

/* ── 根变量 ✓ ────────────────────────────────────────────────────────────── */
function resolveRoot(name, scope) {
  const s = scope || {};
  if (name === '$json') return s.json;
  if (name === '$input') return s.input;
  if (name === '$now') return s.now;
  if (name === '$today') {
    const d = new Date(Number(s.now) || Date.now());
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (name === '$workflow') return s.workflow || {};
  if (name === '$execution') return s.execution || {};
  if (name === '$env') return { __ns: 'ENV' };      /* 只在 primary 的调用分支里被拦下 ✓ */
  if (name === '$node') return { __ns: 'NODE' };
  if (name === '$vars') return s.vars || {};
  if (Object.prototype.hasOwnProperty.call(s, name)) return s[name];
  /* 最后一个兜底：把裸名字当**上游字段**读 ✓（n8n 里要写 $json.x ✓，
     但用户手一抖写成 {{ title }} 时，能取到比报错好 ✓）。 */
  if (s.json && typeof s.json === 'object' && Object.prototype.hasOwnProperty.call(s.json, name)) return s.json[name];
  throw new Error('不认识的变量：' + name + '（上游字段要写 $json.' + name + ' ✓）');
}

/* $node["名字"] / $env("KEY") 这两类特殊根 ✓ */
function specialRoot(obj, key, scope) {
  if (obj.__ns === 'NODE') {
    const meta = (scope && scope.nodes) || {};
    const id = String(key);
    const hit = (meta.byName && meta.byName[id]) || (meta.byId && meta.byId[id]);
    if (!hit) throw new Error('找不到节点「' + id + '」✗ —— $node["…"] 里要写节点的**名字**或 id ✓');
    return hit;
  }
  if (obj.__ns === 'ENV') {
    const name = String(key);
    /* ⚠️ 环境变量**只放行无前缀风险的几个** ✗ —— 工作流 json 是存在磁盘上的文本 ✗，
       放行任意 process.env 等于把用户的密钥暴露给「任何能改这个文件的东西」✗。 */
    const OK = ['HOME', 'USER', 'SHELL', 'PATH', 'LANG', 'TMPDIR'];
    if (OK.indexOf(name) < 0) throw new Error('$env 只放行 ' + OK.join(' / ') + ' ✓（别的变量不暴露 ✗）');
    return (scope && scope.env ? scope.env : {})[name] || '';
  }
  return undefined;
}

/* ── 对外：求值一个表达式 ✓ ─────────────────────────────────────────────── */
function evaluate(expr, scope) {
  const src = String(expr == null ? '' : expr).trim();
  if (!src) return undefined;
  const tokens = tokenize(src);
  /* $node["x"] / $env("K") 的 key 可能是字符串或表达式 ✓ ——
     这里先把 tokens 里紧跟在 $node / $env 后面的那一段特殊处理掉 ✓，
     换成一个普通的「已解析值」占位 ✓，省得把特例塞进递归下降里 ✗。 */
  const patched = patchSpecialRoots(tokens, scope);
  return makeParser(patched, scope).run();
}

/* 把 `$node["A"]` / `$node.A` / `$env("K")` 折成一个字面量 token ✓ */
function patchSpecialRoots(tokens, scope) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const isSpecial = t.k === 'id' && (t.v === '$node' || t.v === '$env');
    if (!isSpecial) { out.push(t); continue; }
    const a = tokens[i + 1];
    if (!a) throw new Error(t.v + ' 后面要跟 [\"名字\"] 或 (\"名字\")');
    let key = null;
    let consumed = 0;
    if (a.k === 'p' && a.v === '[') {
      const b = tokens[i + 2];
      if (b && (b.k === 'str' || b.k === 'num')) { key = String(b.v); consumed = 4; }
      else {
        /* 允许 [ 表达式 ] ✓ —— 递归求一遍 ✓ */
        let depth = 1; let j = i + 2; const inner = [];
        for (; j < tokens.length; j++) {
          if (tokens[j].k === 'p' && tokens[j].v === '[') depth++;
          if (tokens[j].k === 'p' && tokens[j].v === ']') { depth--; if (!depth) break; }
          inner.push(tokens[j]);
        }
        if (depth) throw new Error('$node[ 的方括号没闭合');
        key = String(evaluateTokens(inner, scope));
        consumed = j - i + 1;              /* 一直到 ] 为止 ✓（含 ✓） */
      }
    } else if (a.k === 'p' && a.v === '(') {
      const b = tokens[i + 2];
      if (b && (b.k === 'str' || b.k === 'num')) key = String(b.v);
      else throw new Error(t.v + '(...) 里要写字符串');
      if (!(tokens[i + 3] && tokens[i + 3].k === 'p' && tokens[i + 3].v === ')')) throw new Error(t.v + '(...) 的括号没闭合');
      consumed = 4;
    } else if (a.k === 'p' && a.v === '.') {
      const b = tokens[i + 2];
      if (!b || b.k !== 'id') throw new Error(t.v + ' 后面要跟名字');
      key = b.v;
      consumed = 3;
    } else {
      throw new Error(t.v + ' 后面要跟 ["名字"] 或 ("名字")');
    }
    const val = specialRoot(t.v === '$node' ? { __ns: 'NODE' } : { __ns: 'ENV' }, key, scope);
    out.push({ k: 'lit', v: val });
    i += consumed - 1;
  }
  return out;
}
/* 让 primary / prop 认识 lit 这个「已经算好的值」✓ */
function evaluateTokens(tokens, scope) {
  return makeParser(tokens.concat([{ k: 'eof', v: '' }]), scope).run();
}

/* ── 对外：把模板里的 {{ }} 全换掉 ✓ ──────────────────────────────────────
   ⚠️ **向后兼容** ✗：老写法 `{{节点id}}` / `{{节点id.字段}}` / `{{input}}` 仍要能用 ✓。
      做法：表达式先按新语法求 ✓，求不出来再按老语法取 ✓。 */
function renderTpl(tpl, scope) {
  const s = scope || {};
  return String(tpl == null ? '' : tpl).replace(/\{\{\s*([\s\S]+?)\s*\}\}/g, (_m, raw) => {
    const expr = String(raw).trim();
    if (expr === 'input') return toText(s.input);
    try {
      const v = evaluate(expr, s);
      return v === undefined ? '' : toText(v);
    } catch (err) {
      const legacy = resolveLegacy(expr, s);
      if (legacy.found) return toText(legacy.value);
      /* ★ 两类错误要分开对待 ✗✗：
         · **取不到**（名字不认识 / 节点不存在 ✓）→ 按**老规矩给空串** ✓ ——
           这是文档里写死的行为 ✓（「取不到只会变成空字符串，不会报错」✓），
           而且用户改一个错别字不该让整条工作流挂掉 ✗；
         · **表达式本身写错**（括号没闭 / 调了白名单外的方法 ✗）→ **抛出去** ✓，
           因为那是真写错了 ✓，静默成空串只会让人查半天 ✗。 */
      const msg = String((err && err.message) || err);
      if (/不认识的变量|找不到节点/.test(msg)) return '';
      throw new Error('表达式 ' + expr + ' 出错：' + msg);
    }
  });
}
/* 老语法 ✓：{{节点id}} / {{节点id.字段}} / {{节点名.字段}} */
function resolveLegacy(expr, s) {
  const vars = s.vars || {};
  if (Object.prototype.hasOwnProperty.call(vars, expr)) return { found: true, value: vars[expr] };
  const dot = expr.indexOf('.');
  const head = dot > 0 ? expr.slice(0, dot) : expr;
  if (Object.prototype.hasOwnProperty.call(vars, head)) {
    const v = dot > 0 ? getPath(vars[head], expr.slice(dot + 1)) : vars[head];
    return { found: true, value: v };
  }
  const nodes = s.nodes || {};
  const byName = nodes.byName || {};
  if (Object.prototype.hasOwnProperty.call(byName, head)) {
    const v = dot > 0 ? getPath(byName[head], expr.slice(dot + 1)) : byName[head];
    return { found: true, value: v };
  }
  return { found: false };
}
function getPath(obj, path) {
  const parts = String(path || '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
  return cur;
}
function toText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v, null, 2); } catch (_) { return String(v); }
}

/* ── 造一个 scope ✓（调用方只需要给这几样 ✓）──────────────────────────── */
function makeScope(o) {
  const opts = o || {};
  const nodes = opts.nodes || [];
  const byId = {};
  const byName = {};
  nodes.forEach((n) => {
    if (!n || !n.id) return;
    const val = (opts.vars || {})[n.id];
    if (val === undefined) return;
    byId[n.id] = val;
    if (n.name) byName[String(n.name)] = val;
  });
  return {
    json: opts.input === undefined ? {} : opts.input,
    input: opts.input === undefined ? {} : opts.input,
    vars: opts.vars || {},
    nodes: { byId, byName },
    now: Number(opts.now) || Date.now(),
    workflow: opts.workflow || {},
    execution: opts.execution || {},
    env: opts.env || {},
  };
}

const API = {
  evaluate, renderTpl, makeScope, tokenize, getPath, toText,
  SAFE_FUNCS, SAFE_METHODS,
};
/* 双栖 ✓（和 lib/en-text.js、lib/srs.js 同一套路 ✓）：
   ⚠️ 顶层 const 名字必须唯一 ✗（两个共享模块都叫 const API 会让第二个脚本整个不执行 ✗）。
   ⚠️ 浏览器里要用 type="module" 加载 ✓（经典脚本的顶层 const 共享全局作用域 ✗）。 */
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.LW_EXPR = API;
