'use strict';

/* 本机管家前端：零依赖（只用宿主已有的 api/askConfirm），
   所以这里只是常规的 iife 打包 + 压缩，产物固定为 assets/system-panel.js。 */
const esbuild = require('esbuild');
const path = require('path');

const root = path.resolve(__dirname, '..');

esbuild.build({
  entryPoints:[path.join(root, 'src', 'system-panel.js')],
  outfile:path.join(root, 'assets', 'system-panel.js'),
  bundle:true,
  minify:true,
  sourcemap:false,
  format:'iife',
  target:['chrome110', 'firefox115', 'safari16'],
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
