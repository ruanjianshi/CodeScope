'use strict';

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

function createOfficeEngine(options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  const onlyOfficeUrl = normalizedUrl(options.onlyOfficeUrl, '');
  const managedManifest = readProviderManifest(options.managedManifest);

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
      updateContract:{
        manifestVersion:1, apiRevision:OFFICE_PROVIDER_API_REVISION,
        fields:['id','version','apiRevision','platform','arch','entry','sha256','healthUrl'],
      },
    };
  }

  return { apiRevision:OFFICE_PROVIDER_API_REVISION, onlyOfficeUrl, managedManifest, probeOnlyOffice, status };
}

module.exports = { OFFICE_PROVIDER_API_REVISION, createOfficeEngine, readProviderManifest };
