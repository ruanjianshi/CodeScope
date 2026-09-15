'use strict';

const esbuild = require('esbuild');
const path = require('path');

const root = path.resolve(__dirname, '..');

esbuild.build({
  entryPoints:[path.join(root, 'src', 'study-workspace.js')],
  outfile:path.join(root, 'assets', 'study-workspace.js'),
  bundle:true,
  minify:true,
  sourcemap:false,
  format:'iife',
  target:['chrome110', 'firefox115', 'safari16'],
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
