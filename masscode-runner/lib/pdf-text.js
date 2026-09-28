'use strict';
/* PDF 文本抽取的**唯一实现**，被两处共用：
   - lib/pdf-text-worker.js：worker 线程里调用（正常路径，不阻塞事件循环）
   - server.js：worker 不可用时的进程内兜底
   pdf.js 的 getTextContent 是纯 CPU 的同步循环，服务端还禁用了它自带的 worker，
   所以这段代码跑在哪个线程上决定了「解析一本大 PDF 时整个服务是否卡住」。 */
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}
async function parsePdfText(file) {
  const fs = require('fs');
  const pdfjs = await loadPdfjs();
  const buffer = await fs.promises.readFile(file);
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true, useSystemFonts: true });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      let text = '', lastY = null;
      for (const item of content.items || []) {
        const y = item.transform && item.transform[5];
        if (lastY != null && y != null && Math.abs(y - lastY) > 4) text += '\n';
        else if (text && !text.endsWith('\n')) text += ' ';
        text += String(item.str || ''); lastY = y;
      }
      pages.push(text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
    }
    return { pages, bytes: buffer.length };
  } finally {
    // 解析中途抛错时也要释放 pdf.js 的文档对象，否则线程会一直占着内存。
    try { await doc.destroy(); } catch (_) {}
  }
}
module.exports = { parsePdfText };
