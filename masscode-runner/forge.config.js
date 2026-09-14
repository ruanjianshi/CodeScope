'use strict';

const path = require('path');
const fs = require('fs');

const iconFile = process.platform === 'darwin' ? 'icon.icns' : (process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const iconPath = path.join(__dirname, 'desktop', 'icons', iconFile);
const macSigningIdentity = process.env.CODESCOPE_MAC_SIGN_IDENTITY || process.env.CSC_NAME || '';
const goplsFilename = process.platform === 'win32' ? 'gopls.exe' : 'gopls';
const bundledGopls = process.env.CODESCOPE_BUNDLED_GOPLS || path.join(__dirname, '.bundled-tools', goplsFilename);
const officeProviderBundle = process.env.CODESCOPE_OFFICE_PROVIDER_BUNDLE || path.join(__dirname, '.office-provider');
const extraResources = [];
if (fs.existsSync(bundledGopls)) extraResources.push(bundledGopls);
if (fs.existsSync(path.join(officeProviderBundle, 'manifest.json'))) extraResources.push(officeProviderBundle);

// Electron's downloaded executable carries only a linker signature.  Without
// signing the complete bundle macOS can register a stale/translocated copy and
// later report that CodeScope is in the Trash.  Developer builds use a complete
// ad-hoc signature; release builders can opt into Developer ID signing by
// providing CODESCOPE_MAC_SIGN_IDENTITY (or CSC_NAME).
const macSignConfig = process.platform === 'darwin' ? {
  identity: macSigningIdentity || '-',
  identityValidation: Boolean(macSigningIdentity),
  continueOnError: false,
  // Hardened runtime enforces Team-ID library validation. An ad-hoc identity
  // has no stable Team ID, while Electron's embedded framework retains its
  // vendor identity, so enabling it would make dyld reject the framework.
  // Developer ID builds keep Forge's secure hardened-runtime defaults.
  ...(macSigningIdentity ? {} : {
    optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' }),
  }),
} : undefined;

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'CodeScope',
    executableName: 'CodeScope',
    icon: iconPath,
    appBundleId: 'com.codescope.desktop',
    appCategoryType: 'public.app-category.developer-tools',
    osxSign: macSignConfig,
    extraResource: extraResources,
    // ssh2 can optionally use cpu-features as a native accelerator. CodeScope
    // does not require it, and excluding it keeps desktop builds portable and
    // avoids a compiler/toolchain requirement on end-user machines.
    ignore: [
      /node_modules\/cpu-features(?:\/|$)/,
      /(?:^|\/)\.bundled-tools(?:\/|$)/,
      /(?:^|\/)\.office-provider(?:\/|$)/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'codescope',
        setupIcon: path.join(__dirname, 'desktop', 'icons', 'icon.ico'),
        authors: 'CodeScope Contributors',
        description: 'CodeScope code, document, research and diagram workbench',
      },
    },
    { name: '@electron-forge/maker-dmg', platforms: ['darwin'], config: { format: 'ULFO' } },
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux'] },
    {
      name: '@electron-forge/maker-deb',
      config: { options: { bin: 'CodeScope', maintainer: 'CodeScope Contributors', homepage: 'https://github.com/ruanjianshi/massCode' } },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: { options: { bin: 'CodeScope', homepage: 'https://github.com/ruanjianshi/massCode' } },
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: { repository: { owner: 'ruanjianshi', name: 'massCode' }, prerelease: false, draft: true },
    },
  ],
};
