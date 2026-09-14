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
  const onlyOfficeUrl = normalizedUrl(options.onlyOfficeUrl, 'http://127.0.0.1:8088');
  const managedManifest = readProviderManifest(options.managedManifest);

  async function probeOnlyOffice(timeoutMs = 1800) {
    try {
      const response = await fetchImpl(onlyOfficeUrl + '/healthcheck', {
        signal:AbortSignal.timeout(timeoutMs), cache:'no-store',
      });
      const body = (await response.text()).trim().toLowerCase();
      return {
        ok:response.ok && (body === 'true' || body === 'true.' || body.includes('true')),
        url:onlyOfficeUrl,
        status:response.status,
      };
    } catch (error) {
      return { ok:false, url:onlyOfficeUrl, error:String(error && error.message || error) };
    }
  }

  function builtinProvider() {
    return {
      id:'codescope-local', name:'CodeScope 内置 Office', kind:'embedded', bundled:true,
      state:'ready', available:true, apiRevision:OFFICE_PROVIDER_API_REVISION,
      version:options.appVersion || 'development', priority:10,
      formats:['docx','xlsx','xls','csv','pptx'],
      capabilities:{
        word:{ view:true, edit:true, save:true, print:true },
        sheet:{ view:true, edit:true, save:true, formulas:true },
        slides:{ view:true, edit:false, save:false },
        offline:true, collaboration:false, highFidelity:false,
      },
      note:'随桌面安装包与 Web 服务提供，无需安装额外环境。复杂排版可切换高保真 Provider。',
    };
  }

  async function status(options = {}) {
    const highFidelity = options.probe === false ? { ok:false, url:onlyOfficeUrl, deferred:true } : await probeOnlyOffice(options.timeoutMs);
    const providers = [builtinProvider(), {
      id:'onlyoffice-docs', name:'ONLYOFFICE Docs', kind:'service', bundled:!!managedManifest,
      managed:!!managedManifest, state:highFidelity.ok ? 'ready' : (managedManifest ? 'starting' : 'disconnected'),
      available:!!highFidelity.ok, apiRevision:OFFICE_PROVIDER_API_REVISION,
      version:managedManifest && managedManifest.version || '', priority:100,
      url:onlyOfficeUrl, formats:['docx','xlsx','xls','csv','pptx'],
      capabilities:{
        word:{ view:true, edit:true, save:true, review:true },
        sheet:{ view:true, edit:true, save:true, formulas:true },
        slides:{ view:true, edit:true, save:true },
        offline:!!managedManifest, collaboration:true, highFidelity:true,
      },
      error:highFidelity.ok ? '' : (highFidelity.error || '服务未连接'),
      note:managedManifest
        ? '由 CodeScope 桌面端托管；服务启动后自动切换。'
        : '可选的高保真与协作 Provider；未连接不影响内置离线编辑器。',
    }];
    const active = providers.find((item) => item.id === 'onlyoffice-docs' && item.available) || providers[0];
    return {
      ok:true, apiRevision:OFFICE_PROVIDER_API_REVISION, active:active.id,
      complete:active.id === 'onlyoffice-docs', providers,
      updateContract:{
        manifestVersion:1, apiRevision:OFFICE_PROVIDER_API_REVISION,
        fields:['id','version','apiRevision','platform','arch','entry','sha256','healthUrl'],
      },
    };
  }

  return { apiRevision:OFFICE_PROVIDER_API_REVISION, onlyOfficeUrl, managedManifest, probeOnlyOffice, status };
}

module.exports = { OFFICE_PROVIDER_API_REVISION, createOfficeEngine, readProviderManifest };
