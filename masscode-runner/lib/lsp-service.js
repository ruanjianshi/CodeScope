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
          },
          workspace: { workspaceFolders: true, applyEdit: true, workspaceEdit: { documentChanges: true } },
        },
        clientInfo: { name: 'CodeScope', version: '1.2.0' },
        initializationOptions: this.config.initializationOptions || {},
      }, 12000).then(() => {
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
      }
    }
  }

  failAll(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.child = null; this.ready = null; this.openDocs.clear();
  }

  sync(uri, language, text) {
    const previous = this.openDocs.get(uri);
    if (!previous) {
      this.openDocs.set(uri, { version: 1, text });
      this.notify('textDocument/didOpen', { textDocument: { uri, languageId: language, version: 1, text } });
    } else if (previous.text !== text) {
      const version = previous.version + 1; this.openDocs.set(uri, { version, text });
      this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] });
    }
    this.lastUsed = Date.now();
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
    return { key, root, files, selected: files.find((file) => file.index === selectedIndex) };
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
    if (!session) { session = new LspSession(config, workspace.root); sessions.set(sessionKey, session); }
    try {
      await session.start();
      for (const file of workspace.files) session.sync(file.uri, languageId(file.language, file.filename), file.code);
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
      if (action === 'diagnostics') {
        await new Promise((resolve) => setTimeout(resolve, 220));
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
