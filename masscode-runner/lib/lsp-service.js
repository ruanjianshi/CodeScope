'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');
const { languageServer } = require('./tool-runtime');

const SERVER_LANGUAGES = ['c', 'c_cpp', 'python', 'javascript', 'typescript', 'go'];

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function safeFilename(value, fallback) {
  const clean = String(value || '').replace(/\\/g, '/').split('/').filter((part) => part && part !== '.' && part !== '..').join('/');
  return clean && !clean.startsWith('.') ? clean : fallback;
}

function languageId(language, filename) {
  if (language === 'c_cpp') return /\.(?:h|hh|hpp|hxx)$/i.test(filename) ? 'cpp' : 'cpp';
  return ({ c: 'c', python: 'python', javascript: 'javascript', typescript: 'typescript', go: 'go' })[language] || language;
}

function hoverText(contents) {
  if (!contents) return '';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join('\n\n');
  if (typeof contents.value === 'string') return contents.value;
  if (typeof contents.language === 'string' && typeof contents.value === 'string') return '```' + contents.language + '\n' + contents.value + '\n```';
  return '';
}

function markupText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.value === 'string') return value.value;
  return '';
}

function completionKind(kind) {
  return ({
    1:'text', 2:'method', 3:'function', 4:'constructor', 5:'field', 6:'var',
    7:'class', 8:'interface', 9:'module', 10:'property', 11:'unit', 12:'value',
    13:'enum', 14:'keyword', 15:'snippet', 16:'color', 17:'file', 18:'reference',
    19:'folder', 20:'enum', 21:'constant', 22:'struct', 23:'event', 24:'operator',
    25:'typeParameter',
  })[Number(kind)] || 'text';
}

/* ★ 二期（2026-10-28）：把 semantic tokens 从 relative 解码成绝对坐标 ✓。
   textDocument/semanticTokens/full 返回 data: number[]，每 5 个一组 ——
     [deltaLine, deltaStart, length, tokenType, tokenModifiers]
   ⚠️ 最容易写错的一步 ✗：deltaLine > 0（换了行）时 start 要**重置**为 deltaStart ✓；
      deltaLine === 0（同一行）时才是 start += deltaStart ✓。
      写成无脑累加 ⇒ 第 2 行之后所有 token 的列号一路往后飘 ✓，
      界面上是「颜色块错位到行尾」✓（不报错，最难查的那种 ✓）。
   ⚠️ 为什么在**服务端**解、而不是让前端解 ✗：
      前端要按 legend 名字做下标重映射，本来就得遍历一遍数组 ✓；
      两边各写一份 delta 解码 = 同一个循环两处维护 ✓，错的概率翻倍 ✗。
   ⚠️ length <= 0 的项直接丢 ✓，但**坐标必须先推进再丢** ✗ ——
      否则丢一项就会让后面所有 token 的列号错位 ✓。 */
function decodeSemanticTokens(data) {
  const values = Array.isArray(data) ? data : [];
  const tokens = [];
  let line = 0, start = 0;
  for (let index = 0; index + 4 < values.length; index += 5) {
    const deltaLine = Number(values[index]) || 0;
    const deltaStart = Number(values[index + 1]) || 0;
    const length = Number(values[index + 2]) || 0;
    if (deltaLine > 0) { line += deltaLine; start = deltaStart; }
    else start += deltaStart;
    if (length <= 0) continue;
    tokens.push({
      line,
      start,
      length,
      type: Math.max(0, Number(values[index + 3]) || 0),
      modifiers: Math.max(0, Number(values[index + 4]) || 0),
    });
  }
  return tokens;
}

class LspSession {
  constructor(config, root) {
    this.config = config;
    this.root = root;
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;
    this.ready = null;
    this.openDocs = new Map();
    this.diagnostics = new Map();
    /* ★ 诊断「第几次推送」的计数器 ✓（2026-10-20）——
       clangd 的 publishDiagnostics 是**异步**的 ✓：didOpen/didChange 发出去之后，
       它要过一会儿才推第一版诊断 ✓。原来这里发完 sync 就立刻读 `this.diagnostics` ✗ →
       **新内容必然读到空数组** ✓ → 界面上就是「刚敲完错误，一个都不报」✓。
       计数器 + 等待者：谁在等，就等「这个 uri 又推了一次」再返回 ✓。 */
    this.diagStamp = new Map();
    this.diagWaiters = [];
    /* ★ 二期（2026-10-28）：initialize 的**结果**必须留下来 ✓。
       语义高亮靠 legend（tokenTypes/tokenModifiers 的**名字与下标**）——
       Monaco 要求我们编码用的下标和 legend 完全一致 ✓，而 legend 只出现在
       initialize 响应的 capabilities.semanticTokensProvider 里 ✓。
       原来 .then(() => …) 直接把 result 丢掉 ✗ → 服务端就算支持语义高亮，
       我们也编不出合法下标 ✓（只能猜）✓。 */
    this.capabilities = null;
    this.lastUsed = Date.now();
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      if (!this.config || !this.config.command) return reject(new Error('语言服务器不可用'));
      const child = spawn(this.config.command, this.config.args, {
        cwd: this.root,
        env: this.config.env || process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.child = child;
      child.stdout.on('data', (chunk) => this.onData(chunk));
      child.stderr.on('data', () => {});
      child.once('error', reject);
      child.once('exit', () => this.failAll(new Error(this.config.id + ' 已退出')));
      this.request('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(this.root).href,
        workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: 'CodeScope' }],
        capabilities: {
          textDocument: {
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: { linkSupport: true },
            publishDiagnostics: { relatedInformation: true },
            completion: { completionItem: { documentationFormat: ['markdown', 'plaintext'], snippetSupport: true } },
            signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true } } },
            rename: { prepareSupport: true },
            codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor', 'source'] } } },
            documentHighlight: { dynamicRegistration: false },
            /* ★ 二期（2026-10-28）：声明**消费**语义高亮 ✓。
               ⚠️ tokenTypes/tokenModifiers 留空数组是**故意的** ✓：
                  规范里「客户端上报自己认识的类型」只对「客户端想过滤」有意义 ✓，
                  服务器始终按**自己的** legend 返回下标 ✓；真正的名字映射在
                  assets/semantic-tokens.js 里做 ✓（各服务器 legend 不同 ✓）。
               ⚠️ formats 只给 ['relative'] —— 这是规范里唯一被广泛实现的形式 ✓；
                  解码在服务端 (decodeSemanticTokens) 做 ✓，前端拿绝对坐标 ✓。
               ⚠️ delta:false —— 不做增量 ✓：增量要维护 resultId 与推送顺序，
                  对「片段级、几百行」的体量没有收益 ✓，反而多一条容易错的路径 ✗。 */
            semanticTokens: {
              requests: { full: { delta: false }, range: false },
              tokenTypes: [],
              tokenModifiers: [],
              formats: ['relative'],
              overlappingTokenSupport: false,
              multilineTokenSupport: false,
            },
          },
          workspace: { workspaceFolders: true, applyEdit: true, workspaceEdit: { documentChanges: true } },
        },
        clientInfo: { name: 'CodeScope', version: '1.2.0' },
        initializationOptions: this.config.initializationOptions || {},
      }, 12000).then((result) => {
        /* ★ 二期（2026-10-28）：留住 initialize 的 capabilities ✓ ——
           语义高亮的 legend 只在这里出现一次 ✓（见构造函数里的说明）。
           ⚠️ 缺字段一律兜成 null ✓：后面的 action 用 capabilities.semanticTokensProvider
              判定「服务器支不支持」✓，undefined 与 null 要一视同仁 ✓。 */
        this.capabilities = (result && result.capabilities) || null;
        this.notify('initialized', {});
        resolve(this);
      }, reject);
    });
    return this.ready;
  }

  send(message) {
    if (!this.child || !this.child.stdin.writable) throw new Error('语言服务器未运行');
    const json = JSON.stringify(message);
    this.child.stdin.write('Content-Length: ' + Buffer.byteLength(json) + '\r\n\r\n' + json);
  }

  request(method, params, timeout = 8000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' 请求超时')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ jsonrpc: '2.0', id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      const split = this.buffer.indexOf('\r\n\r\n');
      if (split < 0) return;
      const header = this.buffer.subarray(0, split).toString('ascii');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) { this.buffer = this.buffer.subarray(split + 4); continue; }
      const length = Number(match[1]), start = split + 4;
      if (this.buffer.length < start + length) return;
      const raw = this.buffer.subarray(start, start + length).toString('utf8');
      this.buffer = this.buffer.subarray(start + length);
      let message; try { message = JSON.parse(raw); } catch (_) { continue; }
      if (message.id != null && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message || 'LSP 请求失败'));
        else pending.resolve(message.result);
      } else if (message.method === 'textDocument/publishDiagnostics' && message.params) {
        this.diagnostics.set(message.params.uri, message.params.diagnostics || []);
        this.diagStamp.set(message.params.uri, (this.diagStamp.get(message.params.uri) || 0) + 1);
        /* 叫醒所有等待者 ✓ —— 它们自己会判断「是不是我要的那个 uri、有没有新版本」✓ */
        if (this.diagWaiters.length) for (const waiter of this.diagWaiters.slice()) { try { waiter(); } catch (_) {} }
      }
    }
  }

  failAll(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.child = null; this.ready = null; this.openDocs.clear();
  }

  /* 返回「有没有真的发出去改动」✓ —— 没变就别等诊断（clangd 不会重推，白等到超时）✓ */
  sync(uri, language, text) {
    const previous = this.openDocs.get(uri);
    if (!previous) {
      this.openDocs.set(uri, { version: 1, text });
      this.notify('textDocument/didOpen', { textDocument: { uri, languageId: language, version: 1, text } });
      this.lastUsed = Date.now();
      return true;
    }
    if (previous.text !== text) {
      const version = previous.version + 1; this.openDocs.set(uri, { version, text });
      this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] });
      this.lastUsed = Date.now();
      return true;
    }
    this.lastUsed = Date.now();
    return false;
  }

  /* 等这个 uri 的**下一版**诊断 ✓（或超时）——
     ⚠️ 必须按 uri 计数 ✗：一次 didChange 可能让 clangd 连推好几个文件的诊断（头文件被包含）✓，
        只等「任意一次推送」会在**别的文件**推过来时就返回 ✓，拿到的还是这个文件的旧结论 ✗。 */
  waitDiagnostics(uri, ms) {
    const before = this.diagStamp.get(uri) || 0;
    if (!this.child) return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.diagWaiters = this.diagWaiters.filter((w) => w !== wake);
        resolve(ok);
      };
      const wake = () => { if ((this.diagStamp.get(uri) || 0) > before) finish(true); };
      const timer = setTimeout(() => finish(false), Math.max(200, Number(ms) || 1500));
      this.diagWaiters.push(wake);
    });
  }

  close() {
    try { this.notify('exit', null); } catch (_) {}
    try { if (this.child) this.child.kill(); } catch (_) {}
    this.failAll(new Error('语言服务器会话已关闭'));
  }
}

function createLspService(options = {}) {
  const base = options.tempRoot || path.join(os.tmpdir(), 'CodeScope', 'lsp');
  const sessions = new Map();

  function status() {
    const byCommand = {};
    for (const language of SERVER_LANGUAGES) {
      const config = languageServer(language);
      const id = config ? config.id : ({ c:'clangd', c_cpp:'clangd', python:'pyright-langserver', javascript:'typescript-language-server', typescript:'typescript-language-server', go:'gopls' })[language];
      if (!byCommand[id]) byCommand[id] = { command:id, path:config ? config.path : '', languages:[], bundled:!!(config && config.bundled), version:config ? config.version : '' };
      byCommand[id].languages.push(language);
    }
    return { ok: true, servers: Object.values(byCommand).map((item) => ({ ...item, available: !!item.path })) };
  }

  function materialize(snippet, selectedIndex, selectedCode) {
    const key = shortHash(snippet.file || snippet.name || 'snippet');
    const root = path.join(base, key); fs.mkdirSync(root, { recursive: true });
    const files = [];
    (snippet.fragments || []).forEach((fragment, index) => {
      const fallback = 'file' + (index + 1) + '.' + ({ c: 'c', c_cpp: 'cpp', python: 'py', javascript: 'js', typescript: 'ts', go: 'go' }[fragment.language] || 'txt');
      const filename = safeFilename(fragment.filename || fragment.label, fallback);
      const full = path.resolve(root, filename);
      if (!full.startsWith(root + path.sep)) return;
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const code = index === selectedIndex && typeof selectedCode === 'string' ? selectedCode : String(fragment.code || '');
      fs.writeFileSync(full, code, 'utf8');
      files.push({ index, filename, full, uri: pathToFileURL(full).href, code, language: fragment.language });
    });
    const hasCpp = files.some((file) => file.language === 'c_cpp');
    const hasC = files.some((file) => file.language === 'c');
    const flags = hasCpp
      ? ['-xc++', '-std=c++17', '-I.']
      : hasC ? ['-xc', '-std=c11', '-I.'] : ['-I.'];
    fs.writeFileSync(path.join(root, 'compile_flags.txt'), flags.join('\n') + '\n', 'utf8');
    const signature = shortHash(files.map((file) => file.code).join('\u0000'));
    return { key, root, files, signature, selected: files.find((file) => file.index === selectedIndex) };
  }

  function mapLocation(location, workspace) {
    if (!location) return null;
    const uri = location.uri || location.targetUri;
    const range = location.range || location.targetSelectionRange || location.targetRange;
    if (!uri || !range) return null;
    let full = ''; try { full = fileURLToPath(uri); } catch (_) { return null; }
    const canonical = (value) => { try { return fs.realpathSync(value); } catch (_) { return path.resolve(value); } };
    const wanted = canonical(full), found = workspace.files.find((file) => canonical(file.full) === wanted);
    return { uri, file: found ? found.filename : path.basename(full), fragment: found ? found.index : -1, line: range.start.line + 1, column: range.start.character + 1 };
  }

  function mapWorkspaceEdit(edit, workspace) {
    const rows = [];
    const append = (uri, edits) => {
      const found = workspace.files.find((file) => file.uri === uri);
      if (!found) return;
      for (const item of Array.isArray(edits) ? edits : []) {
        if (!item || !item.range) continue;
        rows.push({
          fragment: found.index,
          file: found.filename,
          start: item.range.start,
          end: item.range.end,
          newText: String(item.newText == null ? '' : item.newText),
        });
      }
    };
    if (edit && edit.changes) for (const [uri, edits] of Object.entries(edit.changes)) append(uri, edits);
    for (const change of (edit && Array.isArray(edit.documentChanges) ? edit.documentChanges : [])) {
      if (change && change.textDocument) append(change.textDocument.uri, change.edits);
    }
    return rows;
  }

  async function query(input) {
    const language = String(input.language || '').toLowerCase();
    if (!SERVER_LANGUAGES.includes(language)) return { ok: false, available: false, error: '当前语言尚未配置 LSP' };
    const config = languageServer(language);
    if (!config) {
      const server = ({ c:'clangd', c_cpp:'clangd', python:'pyright-langserver', javascript:'typescript-language-server', typescript:'typescript-language-server', go:'gopls' })[language];
      return { ok:false, available:false, server, error:'语言服务器不可用：' + server };
    }
    const workspace = materialize(input.snippet, Number(input.fragment) || 0, input.code);
    if (!workspace.selected) return { ok: false, available: true, error: '片段文件不存在' };
    const sessionKey = config.id + '|' + workspace.root;
    let session = sessions.get(sessionKey);
    // 会话内容变化后 clangd 可能停留在旧翻译单元（头文件改动等），导致陈旧/误报诊断。
    // 请求诊断时若物化内容签名不一致，丢弃旧会话，用当前内容重建一个全新 clangd 会话。
    if (session && String(input.action || 'hover') === 'diagnostics' && session.signature !== workspace.signature) {
      session.close(); sessions.delete(sessionKey); session = null;
    }
    if (!session) { session = new LspSession(config, workspace.root); session.signature = workspace.signature; sessions.set(sessionKey, session); }
    try {
      await session.start();
      let synced = false;
      for (const file of workspace.files) {
        if (session.sync(file.uri, languageId(file.language, file.filename), file.code)) synced = true;
      }
      const position = { line: Math.max(0, Number(input.line) - 1 || 0), character: Math.max(0, Number(input.column) - 1 || 0) };
      const params = { textDocument: { uri: workspace.selected.uri }, position };
      const action = String(input.action || 'hover');
      if (action === 'hover') {
        const result = await session.request('textDocument/hover', params);
        return { ok: true, available: true, server: config.id, hover: result ? { markdown: hoverText(result.contents), range: result.range || null } : null };
      }
      if (action === 'definition' || action === 'references') {
        const method = action === 'definition' ? 'textDocument/definition' : 'textDocument/references';
        const result = await session.request(method, action === 'references' ? { ...params, context: { includeDeclaration: true } } : params);
        const rows = (Array.isArray(result) ? result : result ? [result] : []).map((item) => mapLocation(item, workspace)).filter(Boolean);
        return { ok: true, available: true, server: config.id, locations: rows };
      }
      if (action === 'completion') {
        const result = await session.request('textDocument/completion', { ...params, context: { triggerKind: Number(input.triggerKind) || 1, ...(input.triggerCharacter ? { triggerCharacter:String(input.triggerCharacter) } : {}) } });
        const list = Array.isArray(result) ? result : result && Array.isArray(result.items) ? result.items : [];
        const items = list.slice(0, 120).map((item) => ({
          label: String(item.label || ''),
          kind: completionKind(item.kind),
          detail: String(item.detail || ''),
          documentation: markupText(item.documentation),
          insertText: String((item.textEdit && item.textEdit.newText) || item.insertText || item.label || ''),
          insertTextFormat: Number(item.insertTextFormat) || 1,
          sortText: String(item.sortText || item.label || ''),
          filterText: String(item.filterText || item.label || ''),
        })).filter((item) => item.label);
        return { ok:true, available:true, server:config.id, incomplete:!!(result && result.isIncomplete), items };
      }
      if (action === 'signature') {
        const result = await session.request('textDocument/signatureHelp', { ...params, context: { triggerKind:1, isRetrigger:false } });
        return { ok:true, available:true, server:config.id, signature: result ? {
          activeSignature:Number(result.activeSignature)||0,
          activeParameter:Number(result.activeParameter)||0,
          signatures:(result.signatures||[]).map((item)=>({ label:String(item.label||''), documentation:markupText(item.documentation), parameters:(item.parameters||[]).map((parameter)=>({label:parameter.label,documentation:markupText(parameter.documentation)})) })),
        } : null };
      }
      if (action === 'highlights') {
        const result = await session.request('textDocument/documentHighlight', params);
        return { ok:true, available:true, server:config.id, highlights:(Array.isArray(result)?result:[]).map((item)=>({range:item.range,kind:Number(item.kind)||1})) };
      }
      if (action === 'rename') {
        const newName = String(input.newName || '').trim();
        if (!newName) return { ok:false, available:true, error:'新名称不能为空' };
        try { await session.request('textDocument/prepareRename', params, 5000); } catch (_) {}
        const result = await session.request('textDocument/rename', { ...params, newName }, 12000);
        return { ok:true, available:true, server:config.id, edits:mapWorkspaceEdit(result, workspace) };
      }
      if (action === 'codeAction') {
        const line = position.line, character = position.character;
        const diagnostics = session.diagnostics.get(workspace.selected.uri) || [];
        const result = await session.request('textDocument/codeAction', {
          textDocument:params.textDocument,
          range:input.range || { start:{line,character}, end:{line,character} },
          context:{ diagnostics, only:Array.isArray(input.only)?input.only:undefined },
        }, 10000);
        const actions = (Array.isArray(result)?result:[]).slice(0,40).map((item)=>({
          title:String(item.title || (item.command && item.command.title) || '代码操作'),
          kind:String(item.kind||''), preferred:!!item.isPreferred,
          disabled:item.disabled && String(item.disabled.reason||''),
          edits:mapWorkspaceEdit(item.edit, workspace),
          command:item.command ? { title:String(item.command.title||''), command:String(item.command.command||'') } : null,
        }));
        return { ok:true, available:true, server:config.id, actions };
      }
      /* ★ 二期（2026-10-28）：语义高亮 ✓。
         ⚠️ 「服务器没这个能力」回 available:false，不抛错 ✗：
            前端把它当「继续用词法着色」✓（Monaco 就是这么降级的 ✓），
            报错会让每次输入都在控制台刷一条错误 ✗。
         ⚠️ **空 tokens 是成功** ✓：clangd 还在建索引时 full 会合法地回空数组 ✓，
            判成「不支持」会让前端永久性关掉语义高亮 ✗。
         ⚠️ 超时给 12s（比其他 action 宽）✓：首次 didOpen 之后 clangd 要先解析整份
            翻译单元 + 头文件 ✓，索引期实测能到好几秒 ✓。 */
      if (action === 'semanticTokens') {
        const provider = session.capabilities && session.capabilities.semanticTokensProvider;
        if (!provider) return { ok: true, available: false, server: config.id, reason: '该语言服务器不支持语义高亮' };
        const result = await session.request('textDocument/semanticTokens/full', { textDocument: { uri: workspace.selected.uri } }, 12000);
        const legend = (provider && typeof provider === 'object' && provider.legend) || {};
        const tokenTypes = Array.isArray(legend.tokenTypes) ? legend.tokenTypes.map(String) : [];
        const tokenModifiers = Array.isArray(legend.tokenModifiers) ? legend.tokenModifiers.map(String) : [];
        return {
          ok: true,
          available: true,
          server: config.id,
          legend: { tokenTypes, tokenModifiers },
          tokens: decodeSemanticTokens(result && result.data),
        };
      }
      if (action === 'diagnostics') {
        /* ⚠️⚠️ 原来是 `await sleep(220)` —— 固定猜 220ms ✗（2026-10-20）
           实测：**内容一变，第一版诊断必然读成空数组** ✓ ——
           会话刚重建 / didChange 刚发出，clangd 还在解析 ✓，220ms 远远不够 ✓ →
           界面表现为「刚敲出来的错误一个都不报」✓，而且下一次请求又因为内容没变、
           不再重推诊断，于是**永远补不回来** ✓。
           改成等「这个 uri 的下一版诊断」✓：快就快回、慢最多等 1.6s ✓。 */
        if (synced) await session.waitDiagnostics(workspace.selected.uri, 1600);
        return { ok: true, available: true, server: config.id, diagnostics: session.diagnostics.get(workspace.selected.uri) || [] };
      }
      return { ok: false, available: true, error: '不支持的 LSP 操作' };
    } catch (error) {
      sessions.delete(sessionKey); session.close();
      return { ok: false, available: true, server: config.id, error: String(error.message || error).slice(0, 500) };
    }
  }

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, session] of sessions) if (now - session.lastUsed > 10 * 60 * 1000) { session.close(); sessions.delete(key); }
  }, 60000);
  cleanup.unref();

  return { status, query, close: () => { clearInterval(cleanup); for (const session of sessions.values()) session.close(); sessions.clear(); } };
}

module.exports = { createLspService };
