'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   网页版自动化 ✓（2026-10-18）
   ──────────────────────────────────────────────────────────────────────────
   用户原话：「我说的是，打开网页版的 deepseek，和豆包进行文本，视频生成等那种」✓
   —— 他要的不是 API，而是**让工作流去操作网页版** ✓（不填 Key、用已登录的账号 ✓）。

   ⚠️⚠️ 必须先说清一件事 ✗✗：
       **登录这一步只能人来** ✓ —— DeepSeek 是手机验证码 / 密码 / 微信扫码，
       豆包是手机号 / 抖音，我们**不可能**替他登（也不该碰他的密码 ✗）。
       ⇒ 所以这里的做法是：**开一个独立的浏览器窗口** ✓（自己的 profile ✓），
         他**手动登录一次** ✓，之后 Cookie 就留在那个 profile 里 ✓，
         工作流再跑就直接是登录态 ✓。

   ⚠️ 为什么用**独立 profile** 而不是他的日常 Chrome ✗：
       ① 动他的主 profile 要抢锁 ✓（Chrome 正开着就起不来 ✗）；
       ② 工作流会开一堆标签页 ✓，跟他的日常混在一起很烦 ✗。
       代价是：**要单独登一次** ✓（一次性成本 ✓）。

   ⚠️ 网页版比 API **脆**得多 ✗ —— 人家改个 class 就可能失效 ✓。
       所以每个节点都留了「选择器」高级项 ✓（改版了用户自己能救 ✓），
       而且抓取用「**候选列表 + 文本稳定**」而不是写死一个 class ✓。

   ⚠️ 同一时刻**只跑一个** ✓（一个浏览器、一个队列 ✓）——
       两个工作流同时抢一个窗口，会互相把输入框清掉 ✗。
   ══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

let PLAYWRIGHT = null;
function playwright() {
  if (PLAYWRIGHT) return PLAYWRIGHT;
  try { PLAYWRIGHT = require('playwright-core'); }
  catch (_) {
    throw new Error('没装 playwright-core ✗ —— 网页版自动化要用它（npm i -D playwright-core）');
  }
  return PLAYWRIGHT;
}

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
];
function chromePath() {
  const hit = CHROME_CANDIDATES.filter((f) => { try { return fs.existsSync(f); } catch (_) { return false; } })[0];
  if (!hit) throw new Error('找不到 Chrome ✗ —— 网页版自动化需要一个本机 Chrome / Edge');
  return hit;
}

/* ── 站点预设 ✓ ──────────────────────────────────────────────────────────
   ⚠️ `loginWord` 只是**判断有没有登录**的粗略依据 ✓（URL 里出现 sign_in / login ✓）。
      它只影响「状态显示」✓，不影响能不能跑 ✓ —— 真跑起来要输入框找不到才会报错 ✓。 */
const SITES = {
  deepseek: {
    name: 'DeepSeek 网页版', url: 'https://chat.deepseek.com/', loginWord: 'sign_in',
    input: 'textarea, [contenteditable="true"], [role="textbox"]',
    reply: '[class*="markdown"], [class*="ds-markdown"], [class*="message"]',
  },
  doubao: {
    name: '豆包 网页版', url: 'https://www.doubao.com/chat/', loginWord: 'login',
    input: 'textarea, [contenteditable="true"], [role="textbox"]',
    reply: '[class*="markdown"], [class*="message"], [data-testid*="message"]',
  },
  jimeng: {
    name: '即梦（视频生成）', url: 'https://jimeng.jianying.com/ai-tool/video/generate', loginWord: 'login',
    input: 'textarea, [contenteditable="true"], [role="textbox"]',
    video: 'video[src], a[href*=".mp4"], a[href*="video"]',
  },
};
const siteOf = (key) => SITES[String(key || '').trim()] || null;

/* ── 单例 + 串行队列 ✓ ────────────────────────────────────────────────── */
let CTX = null;               /* playwright 的 persistent context ✓ */
let PROFILE = '';             /* profile 目录 ✓（由 server 注入 ✓） */
let QUEUE = Promise.resolve();/* 任务队列 ✓（一次只跑一个 ✓） */
const TABS = {};              /* 站点 → Page ✓ */

function setProfileDir(dir) { PROFILE = dir; }

async function ensureBrowser() {
  if (CTX) {
    try { CTX.pages(); return CTX; } catch (_) { CTX = null; }
  }
  const { chromium } = playwright();
  fs.mkdirSync(PROFILE, { recursive: true });
  CTX = await chromium.launchPersistentContext(PROFILE, {
    executablePath: chromePath(),
    headless: false,                       /* ⚠️ 必须看得见 ✗ —— 要登录 / 要能盯着看 ✓ */
    viewport: null,
    locale: 'zh-CN',
    /* ⚠️ 这两个参数是**降误判**用的 ✓ —— 默认的 `--enable-automation` 会让
       一些站点弹出「检测到自动化」✓（Cloudflare / 风控 ✗）。 */
    args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  CTX.on('close', () => { CTX = null; Object.keys(TABS).forEach((k) => delete TABS[k]); });
  return CTX;
}

async function pageFor(key) {
  const site = siteOf(key);
  if (!site) throw new Error('不认识的站点：' + key);
  const ctx = await ensureBrowser();
  const old = TABS[key];
  if (old && !old.isClosed()) {
    try { await old.title(); return old; } catch (_) { delete TABS[key]; }
  }
  const p = await ctx.newPage();
  TABS[key] = p;
  await p.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  return p;
}

const isLoginUrl = (url, site) => String(url || '').indexOf(site.loginWord) >= 0;

/* 找一个「看得见的、最大的」输入框 ✓ ——
   ⚠️ 不能直接 `page.fill(sel)` ✗：一个页面常有 2~3 个候选（隐藏的、侧栏的 ✓），
      Playwright 会命中第一个 → 填进了看不见的那个 ✗（然后「点了没反应」✗）。 */
async function pickInput(page, sel) {
  const cands = await page.$$(sel || 'textarea, [contenteditable="true"], [role="textbox"]');
  let best = null, bestArea = 0;
  for (const c of cands) {
    const box = await c.boundingBox().catch(() => null);
    if (!box || box.width < 80 || box.height < 14) continue;
    const area = box.width * box.height;
    if (area > bestArea) { bestArea = area; best = c; }
  }
  return best;
}

/* 发出去 ✓ —— 三种方式都试一遍 ✓（各家不一样 ✗） */
async function submit(page, mode) {
  if (mode === 'ctrl+enter') { await page.keyboard.press('Control+Enter'); return; }
  if (mode !== 'button') {
    await page.keyboard.press('Enter');
    return;
  }
  /* 按钮模式 ✓ —— 按文字找（发送 / 生成 / Send ✓），找不到再按 class 猜 ✓ */
  const byText = page.getByRole('button', { name: /发送|生成|立即生成|Send/i }).last();
  if (await byText.count().catch(() => 0)) { await byText.click({ timeout: 8000 }).catch(() => {}); return; }
  const guess = await page.$('[class*="send"], [class*="submit"], [aria-label*="发送"]');
  if (guess) { await guess.click({ timeout: 8000 }).catch(() => {}); return; }
  await page.keyboard.press('Enter');
}

/* 等一段文字「不再变化」✓ —— 这是**判断 AI 说完没有**的唯一可靠办法 ✗：
   网页版没有「完成」事件 ✓，只能看它的文本稳没稳 ✓。 */
async function waitStable(read, timeoutMs, minLen) {
  const t0 = Date.now();
  let last = '';
  let same = 0;
  for (;;) {
    const now = String((await read()) || '');
    if (now && now === last && now.length >= (minLen || 2)) {
      same += 1;
      if (same >= 3) return now;              /* 连着 3 次一样 ≈ 1.8 秒没动 ✓ */
    } else {
      same = 0;
    }
    last = now;
    if (Date.now() - t0 > timeoutMs) {
      if (last) return last;                  /* 超时但有内容 → 拿现有的 ✓（别丢 ✗） */
      throw new Error('等超时了 ✗（' + Math.round(timeoutMs / 1000) + ' 秒没等到内容）—— 可能是没登录 / 网页改版');
    }
    await new Promise((r) => setTimeout(r, 600));
  }
}

/* ── 对话 ✓ ─────────────────────────────────────────────────────────────
   opts: { site, prompt, inputSel, replySel, sendMode, timeoutMs } */
async function chat(opts) {
  const o = opts || {};
  const site = siteOf(o.site) || SITES.deepseek;
  const key = Object.keys(SITES).find((k) => SITES[k] === site) || 'deepseek';
  const run = async () => {
    const page = await pageFor(key);
    if (isLoginUrl(page.url(), site)) {
      throw new Error('还没登录「' + site.name + '」✗ —— 点工作流工具栏的「🌐 网页版」→ 打开它 → 在弹出来的窗口里登录一次（之后会记住）');
    }
    const box = await pickInput(page, o.inputSel || site.input);
    if (!box) throw new Error('页面上找不到输入框 ✗ —— 可能没登录，或者网页改版了（可以在节点「输入框选择器」里自己填一个）');
    await box.click({ timeout: 10000 }).catch(() => {});
    /* ⚠️ 先清空 ✗ —— 上一次没发出去的内容会留在框里 ✓，不清就变成「两段拼一起」✗ */
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await box.type(String(o.prompt || ''), { delay: 12 }).catch(async () => {
      await page.keyboard.insertText(String(o.prompt || ''));
    });
    await new Promise((r) => setTimeout(r, 350));
    await submit(page, o.sendMode || 'enter');
    const sel = o.replySel || site.reply;
    const text = await waitStable(async () => {
      return page.evaluate((s) => {
        const els = [...document.querySelectorAll(s)].filter((x) => x.offsetParent !== null);
        const last = els[els.length - 1];
        return last ? (last.innerText || '') : '';
      }, sel);
    }, Number(o.timeoutMs) || 180000, 2);
    return { text: String(text || '').trim(), site: site.name, url: page.url() };
  };
  return enqueue(run);
}

/* ── 视频生成 ✓ ─────────────────────────────────────────────────────────
   opts: { site, prompt, inputSel, videoSel, sendMode, timeoutMs }
   ⚠️ 视频是**网页版自己排队的** ✓（豆包 / 即梦都这样 ✓），
      快的一两分钟、慢的十几分钟 ✗ —— 默认给 10 分钟 ✓。 */
async function video(opts) {
  const o = opts || {};
  const site = siteOf(o.site) || SITES.jimeng;
  const key = Object.keys(SITES).find((k) => SITES[k] === site) || 'jimeng';
  const run = async () => {
    const page = await pageFor(key);
    if (isLoginUrl(page.url(), site)) {
      throw new Error('还没登录「' + site.name + '」✗ —— 点「🌐 网页版」→ 打开它 → 登录一次');
    }
    const box = await pickInput(page, o.inputSel || site.input);
    if (!box) throw new Error('页面上找不到输入框 ✗ —— 可能没登录，或者网页改版了');
    await box.click({ timeout: 10000 }).catch(() => {});
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await box.type(String(o.prompt || ''), { delay: 12 }).catch(async () => {
      await page.keyboard.insertText(String(o.prompt || ''));
    });
    await new Promise((r) => setTimeout(r, 350));
    await submit(page, o.sendMode || 'button');
    const sel = o.videoSel || site.video || 'video[src], a[href*=".mp4"]';
    const t0 = Date.now();
    const budget = Math.max(30000, Math.min(1800000, Number(o.timeoutMs) || 600000));
    for (;;) {
      const hit = await page.evaluate((s) => {
        const els = [...document.querySelectorAll(s)].filter((x) => x.offsetParent !== null);
        for (let i = els.length - 1; i >= 0; i -= 1) {
          const el = els[i];
          const src = el.getAttribute('src') || el.getAttribute('href') || '';
          if (src && !/^blob:/.test(src)) return src;
        }
        return '';
      }, sel).catch(() => '');
      if (hit) return { url: hit, site: site.name, ms: Date.now() - t0 };
      if (Date.now() - t0 > budget) {
        throw new Error('等视频超时了 ✗（' + Math.round(budget / 1000) + ' 秒）—— 网页版可能在排队，'
          + '也可能要点某个按钮才真的开始生成；可以调大「最长等多久」再试');
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  };
  return enqueue(run);
}

/* 队列 ✓ —— 一次一个 ✓，前一个失败不影响后一个 ✓ */
function enqueue(fn) {
  const next = QUEUE.then(fn, fn);
  QUEUE = next.then(() => {}, () => {});
  return next;
}

/* ── 状态 / 打开 / 关闭 ✓ ────────────────────────────────────────────── */
async function status() {
  const out = { running: false, profile: PROFILE, sites: {} };
  if (!CTX) {
    Object.keys(SITES).forEach((k) => { out.sites[k] = { name: SITES[k].name, open: false, loggedIn: null }; });
    return out;
  }
  out.running = true;
  for (const k of Object.keys(SITES)) {
    const p = TABS[k];
    let open = false, loggedIn = null, url = '';
    if (p && !p.isClosed()) {
      open = true;
      try { url = p.url(); loggedIn = !isLoginUrl(url, SITES[k]); } catch (_) { loggedIn = null; }
    }
    out.sites[k] = { name: SITES[k].name, open, loggedIn, url };
  }
  return out;
}

async function openSite(key) {
  const p = await pageFor(key);
  try { await p.bringToFront(); } catch (_) {}
  const site = siteOf(key);
  return { url: p.url(), loggedIn: !isLoginUrl(p.url(), site) };
}

async function closeBrowser() {
  const c = CTX;
  CTX = null;
  Object.keys(TABS).forEach((k) => delete TABS[k]);
  if (c) await c.close().catch(() => {});
  return { closed: !!c };
}

module.exports = {
  SITES, setProfileDir, status, openSite, closeBrowser, chat, video,
  /* 给单测用 ✓ */
  _isLoginUrl: isLoginUrl,
};
