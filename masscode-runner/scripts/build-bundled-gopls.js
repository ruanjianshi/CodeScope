'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const output = path.join(__dirname, '..', '.bundled-tools');
fs.mkdirSync(output, { recursive: true });
const targetPlatform = process.env.CODESCOPE_TARGET_PLATFORM || process.platform;
const targetArch = process.env.CODESCOPE_TARGET_ARCH || process.arch;
const goos = { win32:'windows', darwin:'darwin', linux:'linux' }[targetPlatform] || targetPlatform;
const goarch = { x64:'amd64', arm64:'arm64' }[targetArch] || targetArch;
const result = spawnSync('go', ['install', 'golang.org/x/tools/gopls@v0.23.0'], {
  stdio: 'inherit',
  env: { ...process.env, GOBIN: output, GOOS:goos, GOARCH:goarch, CGO_ENABLED:'0' },
  windowsHide: true,
});
if (result.error) {
  console.error('Cannot build bundled gopls:', result.error.message);
  process.exit(1);
}
if (result.status === 0) console.log(`Bundled gopls v0.23.0 for ${goos}/${goarch}`);
process.exit(result.status == null ? 1 : result.status);
