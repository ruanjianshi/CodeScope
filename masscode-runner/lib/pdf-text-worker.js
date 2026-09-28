'use strict';
/* PDF 解析线程：把唯一实现 lib/pdf-text.js 放到 worker 线程里跑。
   协议：父线程 postMessage({ id, file }) → 本线程回 { id, ok:true, pages, bytes }
   或 { id, ok:false, error }（解析失败，父线程不会再用进程内兜底重试一次）。
   线程由 server.js 复用并在一段空闲后终止，进程退出时也会被终止。 */
const { parentPort } = require('worker_threads');
const { parsePdfText } = require('./pdf-text.js');

parentPort.on('message', (message) => {
  const id = message && message.id;
  Promise.resolve()
    .then(() => parsePdfText(String((message && message.file) || '')))
    .then(
      (result) => parentPort.postMessage({ id, ok: true, pages: result.pages, bytes: result.bytes }),
      (error) => parentPort.postMessage({ id, ok: false, error: String((error && error.message) || error).slice(0, 300) }),
    );
});
