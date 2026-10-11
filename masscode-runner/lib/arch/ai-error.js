'use strict';
/*
 * 把上游 AI 服务的报错翻译成人话。
 * ---------------------------------------------------------------------------
 * ★ 为什么单独一个文件（2026-10-11）：
 *   用户点「✦ AI 分析」撞到 ModelScope 的 403 ✓，我们当时是这么显示的 ✓：
 *     `AI 分析失败：API 错误 403：{"error":{"message":"For account security,
 *      please complete your profile via email verification. ModelScope
 *      Maiguobis is only available to verified accounts. Please refer to
 *      https://modelscope.cn/my/settings/account?request_id=..."}}`
 *   一坨 JSON 甩给用户 ✗ —— 里面其实有答案（"完成邮箱验证" ✓），
 *   但埋在一堆转义和 request_id 里 ✓，没人会去读 ✓。
 *
 *   拆出来的实质理由：这是「HTTP 状态码 + 上游错误体 → 能照着做的一句话」，
 *   是纯函数 ✓、可单测 ✓、和"架构图"没关系 ✓（谁调 AI 都能用 ✓）。
 *   ⚠️ 放新文件也是棘轮逼的 ✗ —— `lib/arch/ai.js`（191/191）和
 *      `lib/routes/arch.js`（209/209）当时都顶格了 ✓。
 *
 * ── 设计 ──
 *   · 状态码给方向（401 是 key 不对 / 403 是没权限 / 429 是太频繁 ✓）；
 *   · 上游 message 给细节（它通常才是真原因 ✓，比如"完成邮箱验证" ✓）；
 *   · 两者拼起来，别只给一个 ✗ —— 只给状态码用户不知道怎么办 ✓，
 *     只给原文用户看不懂 ✓。
 *   · ⚠️ 上游错误体里可能回显 key ✗ → 一律把 `sk-...` 之类的擦掉 ✓。
 */

/* 按状态码给「能照着做」的方向 ✓
   ⚠️ 别在提示里写 markdown 的 `**` ✗ —— 它显示在**状态栏（纯文本）**里 ✓，
      星号会原样露出来 ✓（第一版就是这样 ✓）。 */
const HINTS = {
  400: '请求被拒（400）：多半是模型名或参数写错了。',
  401: '认证失败（401）：API Key 不对或已失效。',
  403: '服务方拒绝了这次请求（403）：常见原因是账号没完成验证，或者这个模型不对你的账号开放。',
  404: '找不到（404）：API 地址或模型名写错了（注意地址要指到 /v1/chat/completions 这类接口）。',
  408: '上游超时（408）：换一个更快的模型，或稍后重试。',
  413: '内容太长（413）：这个文档的片段太多，先拆小一点。',
  429: '太频繁或额度用尽（429）：等一会儿再试，或者换一个模型。',
  502: '上游网关错误（502）：不是你的配置问题，稍后重试。',
  503: '上游不可用（503）：不是你的配置问题，稍后重试。',
  504: '上游超时（504）：稍后重试，或换一个更快的模型。',
};

/* ⚠️ 上游错误体可能把 key 回显出来 ✗ —— 一律擦掉，别让 key 出现在界面上 ✓ */
function scrub(text) {
  return String(text || '')
    .replace(/\b(sk|xai|ms|hf|dash)-[A-Za-z0-9_\-]{8,}/g, '***')
    .replace(/\b[A-Za-z0-9_\-]{32,}\b/g, '***')
    .replace(/\s+/g, ' ')
    .trim();
}

/* 从上游错误体里尽量抠出一句人能读的 ✓（不同厂商字段名不一样 ✓） */
function pickDetail(bodyText) {
  const raw = String(bodyText || '');
  if (!raw) return '';
  let detail = '';
  try {
    const j = JSON.parse(raw);
    const e = (j && j.error) || j || {};
    detail = (typeof e === 'string' ? e : '')
      || (e && (e.message || e.msg || e.detail || e.code || e.type)) || '';
  } catch (_) {
    detail = raw;                     /* 不是 JSON（比如网关的 HTML）→ 拿原文 ✓ */
  }
  if (typeof detail !== 'string') detail = JSON.stringify(detail);
  return scrub(detail).slice(0, 220);
}

function describeApiError(status, bodyText) {
  const code = Number(status) || 0;
  const hint = HINTS[code]
    || (code >= 500 ? 'AI 服务端出错（' + code + '）：不是你的配置问题，稍后重试。'
      : 'AI 服务返回 ' + code + '。');
  const detail = pickDetail(bodyText);
  return hint + (detail ? '　上游说：' + detail : '');
}

module.exports = { describeApiError, pickDetail, scrub };
