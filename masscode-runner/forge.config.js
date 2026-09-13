'use strict';

const path = require('path');

const iconFile = process.platform === 'darwin' ? 'icon.icns' : (process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const iconPath = path.join(__dirname, 'desktop', 'icons', iconFile);

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'CodeScope',
    executableName: 'CodeScope',
    icon: iconPath,
    appBundleId: 'com.codescope.desktop',
    appCategoryType: 'public.app-category.developer-tools',
    // ssh2 can optionally use cpu-features as a native accelerator. CodeScope
    // does not require it, and excluding it keeps desktop builds portable and
    // avoids a compiler/toolchain requirement on end-user machines.
    ignore: [/node_modules\/cpu-features(?:\/|$)/],
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
      config: { options: { maintainer: 'CodeScope Contributors', homepage: 'https://github.com/ruanjianshi/massCode' } },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: { options: { homepage: 'https://github.com/ruanjianshi/massCode' } },
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: { repository: { owner: 'ruanjianshi', name: 'massCode' }, prerelease: false, draft: true },
    },
  ],
};
