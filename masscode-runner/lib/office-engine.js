'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const OFFICE_PROVIDER_API_REVISION = 1;

function normalizedUrl(value, fallback) {
  return String(value || fallback || '').trim().replace(/\/$/, '');
}

function readProviderManifest(file) {
  if (!file) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!manifest || manifest.apiRevision !== OFFICE_PROVIDER_API_REVISION || !manifest.id) return null;
    return { ...manifest, manifestPath:path.resolve(file) };
  } catch (_) { return null; }
}

/* ══════════════════════════════════════════════════════════════════════════
   ★★ ONLYOFFICE JWT：密钥放**应用数据目录**、0600 ✓✓（2026-10-28）
   ══════════════════════════════════════════════════════════════════════════
   痛点 ✗：docker-compose.onlyoffice.yml 里一直是 `JWT_ENABLED: "false"` ✗ ——
     Document Server 于是**接受任何人递来的任意 config** ✓：容器映射在 8088 上 ✓，
     同机任何进程（包括中招的浏览器扩展 ✗）、局域网任何设备 ✓ 都能
     「打开 / 读出 / 覆盖」文档 ✓。它不是「可选加固」，是**没有锁** ✗。
   ⇒ 密钥 = 一份文件 ✓：`<数据目录>/onlyoffice-jwt-secret`（0600 ✓）。
   ⚠️ 为什么不写进仓库 ✗✗：这个仓库整体会被 git / 打包 / 云同步带走 ✓，
      密钥进了仓库就等于**全世界都有** ✓（和把访问码写进 README 一样 ✗）。
      数据目录才是用户私有区 ✓（和 access-code.json / office-connection.json 同一处 ✓）。
   ⚠️ 为什么由**这个文件**负责 ✗：两边**必须**是同一把密钥 ✓ ——
      · scripts/ensure-onlyoffice.js 起容器时传给 Document Server（JWT_SECRET ✓）；
      · server.js 签发 config token 时用它（HS256 ✓）。
      各自写一份「怎么找密钥」的逻辑，必然在第三次改动后漂移 ✗
      （那时的症状是「编辑器白屏 + 容器日志说 token 校验失败」，极难查 ✗）。
   ⚠️ `mode: 0o600` **只在新建时生效** ✗ —— 文件已存在时必须显式 chmod ✓
      （否则一个旧的 0644 文件会一直被当成安全 ✓）。
   ⚠️ 读出来的内容要**校验形状** ✗：一个被编辑器改成空文件/带换行的文件 ✓
      会让 HS256 用一张空密钥 ✓ —— 那等于没开 JWT ✓。 */
const ONLYOFFICE_JWT_SECRET_FILE = 'onlyoffice-jwt-secret';
const ONLYOFFICE_JWT_SECRET_RE = /^[A-Za-z0-9_-]{16,128}$/;

function onlyOfficeJwtSecretFile(dataRoot) {
  return path.join(String(dataRoot || ''), ONLYOFFICE_JWT_SECRET_FILE);
}

/* 只读 ✓：文件不存在 / 内容不像密钥 → 返回 ''（调用方据此走降级 ✓，不抛 ✗）。 */
function readOnlyOfficeJwtSecret(dataRoot) {
  const file = onlyOfficeJwtSecretFile(dataRoot);
  try {
    const secret = fs.readFileSync(file, 'utf8').trim();
    return ONLYOFFICE_JWT_SECRET_RE.test(secret) ? { secret, file, created:false, error:'' } : { secret:'', file, created:false, error:'密钥文件内容不合法（应为 16-128 位 base64url 字符）' };
  } catch (error) {
    return { secret:'', file, created:false, error:error && error.code === 'ENOENT' ? '密钥文件尚不存在' : String(error && error.message || error) };
  }
}

/* 读不到就**生成并落盘** ✓ —— 32 字节 ≈ 43 个 base64url 字符 ✓（HS256 够用 ✓）。
   ⚠️ 失败**不抛** ✗：上层要能降级到「不签名模式」✓（用户至少还能编辑文档 ✓）。 */
function ensureOnlyOfficeJwtSecret(dataRoot) {
  const existing = readOnlyOfficeJwtSecret(dataRoot);
  if (existing.secret) {
    /* ⚠️ 已存在的文件**也要**收紧权限 ✓ —— `mode: 0o600` 只在**新建**时生效 ✗，
       一个从旧版本 / 手工复制过来的 0644 文件会一直裸着 ✓（同机其他用户可读 ✓ = 可伪造 token ✗）。 */
    try { if ((fs.statSync(existing.file).mode & 0o777) !== 0o600) fs.chmodSync(existing.file, 0o600); } catch (_) {}
    return existing;
  }
  const secret = crypto.randomBytes(32).toString('base64url');
  const file = existing.file;
  try {
    fs.mkdirSync(path.dirname(file), { recursive:true });
    fs.writeFileSync(file, secret + '\n', { encoding:'utf8', mode:0o600 });
    try { fs.chmodSync(file, 0o600); } catch (_) {}
    return { secret, file, created:true, error:'' };
  } catch (error) {
    return { secret:'', file, created:false, error:String(error && error.message || error) };
  }
}

function base64UrlOf(value) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/* HS256 签名 ✓ —— 和 ONLYOFFICE 官方的 JWT 约定一致（header.payload.signature ✓）。
   ⚠️ 没有密钥就返回 '' ✗：调用方据此**不加 token** ✓（老容器不签名也能用 ✓ —— 可降级 ✓）。 */
function signOnlyOfficeJwt(payload, secret) {
  const key = String(secret || '');
  if (!key || !payload || typeof payload !== 'object') return '';
  const header = base64UrlOf(JSON.stringify({ alg:'HS256', typ:'JWT' }));
  const body = base64UrlOf(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', key).update(header + '.' + body).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return header + '.' + body + '.' + signature;
}

/* 校验 ✓ —— 只给单元测试 / 自检用（生产链路里是 Document Server 在校验 ✓）。
   定长比较 + 先比长度 ✓（长度不同 timingSafeEqual 会直接 throw ✗）。 */
function verifyOnlyOfficeJwt(token, secret) {
  const key = String(secret || '');
  const parts = String(token || '').split('.');
  if (!key || parts.length !== 3) return false;
  const expected = crypto.createHmac('sha256', key).update(parts[0] + '.' + parts[1]).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const a = Buffer.from(expected), b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try { return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) !== null; }
  catch (_) { return false; }
}

function createOfficeEngine(options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  const onlyOfficeUrl = normalizedUrl(options.onlyOfficeUrl, '');
  const managedManifest = readProviderManifest(options.managedManifest);
  /* ★ JWT 状态由调用方注入 ✓（server.js 知道「容器现在是不是 JWT_ENABLED=true」✓，
     引擎不知道 ✗、也不该去 spawn docker ✓）。
     ⚠️ 用回调而不是快照 ✗：容器可能被重建 / 用户可能在面板里改了连接 ✓，
        快照会立刻过期 ✓（症状：面板说「签名正常」但编辑器一直白屏 ✗）。 */
  const jwtSecret = String(options.jwtSecret || '');
  const jwtStatusOf = typeof options.jwtStatus === 'function' ? options.jwtStatus : () => ({ enabled:!!jwtSecret, configured:!!jwtSecret, source:jwtSecret ? 'connection' : 'none', container:'unknown', degraded:false, warning:'' });

  /* 签发 config token ✓ —— 用的是**同一份**密钥与**同一份**实现 ✓（server.js 调这个 ✓）。 */
  function signConfigToken(payload) { return signOnlyOfficeJwt(payload, jwtSecret); }

  async function probeOnlyOffice(timeoutMs = 1800) {
    if (!onlyOfficeUrl) return { ok:false, configured:false, url:'', error:'尚未配置 ONLYOFFICE Docs 服务地址' };
    try {
      const response = await fetchImpl(onlyOfficeUrl + '/healthcheck', {
        signal:AbortSignal.timeout(timeoutMs), cache:'no-store',
      });
      const body = (await response.text()).trim().toLowerCase();
      const healthy = response.ok && (body === 'true' || body === 'true.' || body.includes('true'));
      if (!healthy) return { ok:false, configured:true, url:onlyOfficeUrl, status:response.status, error:'健康检查未通过（HTTP ' + response.status + '）' };
      const api = await fetchImpl(onlyOfficeUrl + '/web-apps/apps/api/documents/api.js', {
        method:'HEAD', signal:AbortSignal.timeout(timeoutMs), cache:'no-store',
      });
      return {
        ok:api.ok,
        configured:true,
        url:onlyOfficeUrl,
        status:api.status,
        error:api.ok ? '' : '编辑器 API 不可用（HTTP ' + api.status + '）',
      };
    } catch (error) {
      return { ok:false, configured:true, url:onlyOfficeUrl, error:'无法连接 ONLYOFFICE Docs：' + String(error && error.message || error) };
    }
  }

  async function status(options = {}) {
    const highFidelity = options.probe === false ? { ok:false, url:onlyOfficeUrl, deferred:true } : await probeOnlyOffice(options.timeoutMs);
    const providers = [{
      id:'onlyoffice-docs', name:'ONLYOFFICE Docs', kind:'service', bundled:!!managedManifest,
      managed:!!managedManifest, required:true,
      state:highFidelity.ok ? 'ready' : (!onlyOfficeUrl ? 'unconfigured' : (managedManifest ? 'starting' : 'disconnected')),
      available:!!highFidelity.ok, apiRevision:OFFICE_PROVIDER_API_REVISION,
      version:managedManifest && managedManifest.version || '', priority:100,
      url:onlyOfficeUrl, formats:['docx','xlsx','xls','csv','pptx'],
      capabilities:{
        word:{ view:true, edit:true, save:true, review:true },
        sheet:{ view:true, edit:true, save:true, formulas:true },
        slides:{ view:true, edit:true, save:true },
        offline:false, collaboration:true, highFidelity:true,
      },
      error:highFidelity.ok ? '' : (highFidelity.error || '服务未连接'),
      note:managedManifest
        ? '由 CodeScope 桌面端托管；服务启动后直接使用 ONLYOFFICE 编辑。'
        : 'CodeScope 的唯一 Office 编辑内核；需要连接独立的 ONLYOFFICE Document Server。',
    }];
    const active = providers.find((item) => item.available) || null;
    return {
      ok:true, apiRevision:OFFICE_PROVIDER_API_REVISION, active:active && active.id,
      complete:!!active, configured:!!onlyOfficeUrl, providers,
      /* ★ 把 JWT 状态放进 Provider 契约 ✓（/api/office/providers/v1 直接能看到 ✓）——
         「开着 JWT」和「服务可用」是两件事 ✓：可用但没签名 = 裸奔 ✓，必须能分别看见 ✓。 */
      jwt:jwtStatusOf(),
      updateContract:{
        manifestVersion:1, apiRevision:OFFICE_PROVIDER_API_REVISION,
        fields:['id','version','apiRevision','platform','arch','entry','sha256','healthUrl'],
      },
    };
  }

  return { apiRevision:OFFICE_PROVIDER_API_REVISION, onlyOfficeUrl, managedManifest, jwtSecret, signConfigToken, probeOnlyOffice, status };
}

module.exports = {
  OFFICE_PROVIDER_API_REVISION, createOfficeEngine, readProviderManifest,
  ONLYOFFICE_JWT_SECRET_FILE, onlyOfficeJwtSecretFile, readOnlyOfficeJwtSecret, ensureOnlyOfficeJwtSecret,
  signOnlyOfficeJwt, verifyOnlyOfficeJwt,
};
