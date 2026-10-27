#!/usr/bin/env bash
# 构建无限画布的 bundle
#   用法：cd tools/tldraw-canvas && npm i && bash build.sh
#   产物：assets/vendor/tldraw.bundle.js（+ 同名 .css，tldraw 会一并输出）
set -euo pipefail
cd "$(dirname "$0")"
OUT="../../assets/vendor/tldraw.bundle.js"
npx esbuild entry.jsx \
  --bundle --format=iife --outfile="$OUT" \
  --loader:.jsx=jsx --jsx=automatic \
  --define:process.env.NODE_ENV='"production"' \
  --minify --legal-comments=none
echo "已生成：$OUT"
ls -lh "$OUT" | awk '{print "体积：" $5}'
