const esbuild = require('esbuild')
const path = require('path')

const root = path.resolve(__dirname, '..')

esbuild.build({
  entryPoints: [path.join(root, 'src', 'reading-block-editor.js')],
  outfile: path.join(root, 'assets', 'reading-block-editor.js'),
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'iife',
  target: ['chrome110', 'firefox115', 'safari16'],
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
