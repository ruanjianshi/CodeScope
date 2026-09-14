'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const output = path.join(__dirname, '..', '.bundled-tools');
fs.mkdirSync(output, { recursive: true });
const targetPlatform = process.env.CODESCOPE_TARGET_PLATFORM || process.platform;
const targetArch = process.env.CODESCOPE_TARGET_ARCH || process.arch;
const goos = { win32:'windows', darwin:'darwin', linux:'linux' }[targetPlatform] || targetPlatform;
const goarch = { x64:'amd64', arm64:'arm64' }[targetArch] || targetArch;
const hostGoos = { win32:'windows', darwin:'darwin', linux:'linux' }[process.platform] || process.platform;
const hostGoarch = { x64:'amd64', arm64:'arm64' }[process.arch] || process.arch;
const filename = goos === 'windows' ? 'gopls.exe' : 'gopls';
const crossCompiling = goos !== hostGoos || goarch !== hostGoarch;
const temporaryGoPath = crossCompiling ? fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-gopls-')) : '';
const buildEnv = { ...process.env, GOOS:goos, GOARCH:goarch, CGO_ENABLED:'0' };
if (crossCompiling) {
  const moduleCache = spawnSync('go', ['env', 'GOMODCACHE'], { encoding:'utf8', windowsHide:true });
  delete buildEnv.GOBIN;
  buildEnv.GOPATH = temporaryGoPath;
  if (moduleCache.status === 0 && moduleCache.stdout.trim()) buildEnv.GOMODCACHE = moduleCache.stdout.trim();
} else {
  buildEnv.GOBIN = output;
}
const result = spawnSync('go', ['install', 'golang.org/x/tools/gopls@v0.23.0'], {
  stdio: 'inherit',
  env: buildEnv,
  windowsHide: true,
});
if (result.status === 0 && crossCompiling) {
  const source = path.join(temporaryGoPath, 'bin', `${goos}_${goarch}`, filename);
  const destination = path.join(output, filename);
  if (!fs.existsSync(source)) {
    console.error('Cross-compiled gopls was not produced at:', source);
    process.exitCode = 1;
  } else {
    fs.copyFileSync(source, destination);
    if (goos !== 'windows') fs.chmodSync(destination, 0o755);
  }
}
if (temporaryGoPath) fs.rmSync(temporaryGoPath, { recursive:true, force:true });
if (result.error) {
  console.error('Cannot build bundled gopls:', result.error.message);
  process.exit(1);
}
if (result.status === 0 && !process.exitCode) console.log(`Bundled gopls v0.23.0 for ${goos}/${goarch}`);
process.exit(process.exitCode || (result.status == null ? 1 : result.status));
