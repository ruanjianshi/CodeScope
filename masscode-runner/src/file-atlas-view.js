'use strict';
/**
 * 文件全景视图（只做 UI）。数据来自 GET /api/system-panel/atlas[?mode=fast|deep]。
 *
 * 本视图**不会删除、移动、改名任何文件**：它只显示分级汇总、大文件清单、"这目录是什么"、
 * 目录下钻和"清理预演"。真正的清理动作留给后续版本，并且必然要走
 * "先预演 → 人工确认 → 可取消执行"的通道。
 *
 * 两段式扫描（快扫 / 深扫）和落盘缓存都在服务端做，这里只负责选模式、显示模式与缓存年龄。
 */
function createAtlasView(host) {
  const { api, el, esc, fmtBytes, toast } = host;
  const S = {
    data: null, loading: false, error: null, root: null, mounted: false,
    mode: 'fast',          /* 上次用的扫描模式，重绘时沿用 */
    topMode: 'actionable', /* 大文件榜：默认只看**动得了的**（见下面注释） */
    planAll: false,        /* 清理预演：是否展开全部 */
    expand: {},            /* 目录下钻：path -> true */
  };

  const TIER_TONE = {
    'L0-system': 'danger',
    'L1-app': 'warn',
    'L2-cache': 'ok',
    'L3-temp': 'ok',
    'L4-user': 'neutral',
  };
  const RISK_LABEL = { none: '不可动', confirm: '需确认', 'preview-only': '可清理（仅预演）' };
  /* 「能动的」= 缓存 / 临时 / 用户自己的。L0 系统级和 L1 应用级用户动不了 ✗，
     列在「最占空间的文件」里纯属噪音 ✗（实测这台机器 Top10 全是 swapfile ✗）。 */
  const ACTIONABLE = { 'L2-cache': 1, 'L3-temp': 1, 'L4-user': 1 };

  function injectStyle() {
    if (document.getElementById('atlas-view-style')) return;
    const style = document.createElement('style');
    style.id = 'atlas-view-style';
    /* 面板约定：每条规则都以 #system-workspace 前缀开头，避免污染其他视图。
       ⚠️ 下面这段在一个模板字符串里，注释里**不能出现反引号**。 */
    style.textContent = `
#system-workspace .atlas-wrap{display:flex;flex-direction:column;gap:14px;padding:2px 2px 22px}
#system-workspace .atlas-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
#system-workspace .atlas-bar .atlas-sub{flex:1;min-width:220px}
#system-workspace .atlas-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
#system-workspace .atlas-card{border:1px solid var(--sp-hair);border-radius:var(--sp-r);padding:11px 12px;background:var(--sp-tint);display:flex;flex-direction:column;gap:6px}
#system-workspace .atlas-card h4{margin:0;font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}
#system-workspace .atlas-big{font-size:19px;font-weight:650;letter-spacing:-.01em}
#system-workspace .atlas-sub{font-size:11.5px;color:var(--dim)}
#system-workspace .atlas-pill{font-size:10.5px;padding:1px 7px;border-radius:999px;border:1px solid var(--sp-hair);white-space:nowrap}
#system-workspace .atlas-pill.danger{color:var(--sp-danger);border-color:color-mix(in srgb, var(--sp-danger) 45%, transparent)}
#system-workspace .atlas-pill.warn{color:var(--sp-warn);border-color:color-mix(in srgb, var(--sp-warn) 45%, transparent)}
#system-workspace .atlas-pill.ok{color:var(--ok);border-color:color-mix(in srgb, var(--ok) 45%, transparent)}
#system-workspace .atlas-pill.neutral{color:var(--dim)}
#system-workspace .atlas-band{border:1px solid var(--sp-hair);border-radius:var(--sp-r);padding:12px 13px}
#system-workspace .atlas-band h3{margin:0 0 8px;font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#system-workspace .atlas-band h3 .atlas-seg{margin-left:auto;display:flex;gap:4px}
#system-workspace .atlas-seg button{font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid var(--sp-hair);background:transparent;color:var(--dim);cursor:pointer}
#system-workspace .atlas-seg button.on{color:var(--text);border-color:var(--sp-hair-strong);background:var(--sp-tint)}
#system-workspace .atlas-row{display:flex;align-items:center;gap:10px;padding:5px 0;border-top:1px dashed var(--sp-hair);font-size:12px}
#system-workspace .atlas-row:first-of-type{border-top:0}
#system-workspace .atlas-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Menlo,monospace;font-size:11.5px}
#system-workspace .atlas-size{font-variant-numeric:tabular-nums;color:var(--dim);font-size:11.5px;white-space:nowrap}
#system-workspace .atlas-safe{font-size:11.5px;color:var(--dim);line-height:1.6}
#system-workspace .atlas-expand{font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid var(--sp-hair);background:transparent;color:var(--dim);cursor:pointer}
#system-workspace .atlas-expand:hover{color:var(--text);border-color:var(--sp-hair-strong)}
#system-workspace .atlas-child{padding-left:22px;border-left:2px solid var(--sp-hair);margin-left:6px}
#system-workspace .atlas-more{font-size:11px;color:var(--dim);padding:7px 0 0;cursor:pointer;text-decoration:underline}
`;
    document.head.appendChild(style);
  }

  function bar() {
    const wrap = el('div', 'atlas-bar');
    const title = el('div', 'atlas-sub');
    if (S.loading) {
      title.textContent = S.mode === 'deep'
        ? '正在深度扫描（约 25 秒，这次跑完会缓存 6 小时，之后秒开）…'
        : '正在扫描（快扫，约几秒；结果会缓存 10 分钟）…';
    } else if (S.error) {
      title.textContent = '读取失败：' + S.error;
    } else if (S.data) {
      const st = S.data.stats || {};
      const roots = st.rootsScanned || 0;
      const skipped = (st.skippedRoots || []).length;
      const age = S.data.cached ? (' · 缓存 ' + ago(S.data.cacheAgeMs || 0)) : '';
      title.textContent = '扫描 ' + S.data.elapsedMs + 'ms · ' + st.files + ' 个文件 · ' + st.bytesLabel +
        ' · 覆盖 ' + roots + ' 个根目录' + (skipped ? '（跳过 ' + skipped + ' 个）' : '') +
        (st.truncated ? ' · 部分根目录到达单根上限或时限，已如实截断' : '') +
        ' · 共枚举 ' + st.entries + ' 项' + age;
    }
    wrap.appendChild(title);

    const badge = el('span', 'atlas-pill ' + (S.mode === 'deep' ? 'ok' : 'neutral'), S.mode === 'deep' ? '深度扫描' : '快速扫描');
    badge.title = S.mode === 'deep'
      ? '深度扫描：覆盖高得多（这台机器实测 25 秒 / 141 GB），缓存 6 小时'
      : '快速扫描：几秒出结果，覆盖较浅（实测约 35 GB），缓存 10 分钟';
    wrap.appendChild(badge);

    const quick = el('button', 'sp-btn', S.loading && S.mode === 'fast' ? '扫描中…' : '快速扫描');
    quick.type = 'button';
    quick.disabled = S.loading;
    quick.onclick = () => load('fast', true);
    wrap.appendChild(quick);

    const deep = el('button', 'sp-btn', S.loading && S.mode === 'deep' ? '深扫中…' : '深度扫描');
    deep.type = 'button';
    deep.disabled = S.loading;
    deep.title = '约 25 秒（比快扫准得多）。只在你想看全的时候点，平时用快扫。';
    deep.onclick = () => {
      if (!window.confirm('深度扫描约 25 秒（快扫只要几秒）。\n\n它会缓存 6 小时，之后打开就是秒开。现在跑吗？')) return;
      load('deep', true);
    };
    wrap.appendChild(deep);
    return wrap;
  }

  function ago(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return s + ' 秒前';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' 分钟前';
    return Math.round(m / 60) + ' 小时前';
  }

  function render() {
    const wrap = S.root;
    if (!wrap) return;
    wrap.innerHTML = '';
    wrap.appendChild(bar());
    if (!S.data) return;
    const D = S.data;

    /* ① 五级卡片 */
    const cards = el('div', 'atlas-cards');
    for (const id of D.tierOrder || []) {
      const tier = (D.tiers && D.tiers[id]) || {};
      const meta = (D.tierMeta && D.tierMeta[id]) || {};
      const card = el('div', 'atlas-card');
      const head = el('h4');
      head.appendChild(document.createTextNode(String(meta.label || tier.label || id)));
      head.appendChild(el('span', 'atlas-pill ' + (TIER_TONE[id] || 'neutral'), RISK_LABEL[meta.deleteRisk] || meta.deleteRisk || ''));
      card.appendChild(head);
      card.appendChild(el('div', 'atlas-big', fmtBytes(tier.bytes || 0)));
      card.appendChild(el('div', 'atlas-sub', (tier.files || 0) + ' 个文件 · ' + id));
      if (meta.note) card.appendChild(el('div', 'atlas-safe', String(meta.note)));
      cards.appendChild(card);
    }
    wrap.appendChild(cards);

    /* ② 最占空间的文件 —— 默认**只看动得了的**
       ⚠️ 不这么做的话，实测 Top10 全是 /System/Volumes/VM/swapfile0…9（各 1 GB），
          用户看完的信息量是零（那是虚拟内存，动不了也不该动）。 */
    const top = el('div', 'atlas-band');
    const topHead = el('h3', null, '最占空间的文件');
    const seg = el('span', 'atlas-seg');
    const mk = (key, label, why) => {
      const btn = el('button', S.topMode === key ? 'on' : '', label);
      btn.type = 'button';
      btn.title = why;
      btn.onclick = () => { S.topMode = key; render(); };
      return btn;
    };
    seg.appendChild(mk('actionable', '只看能动的', '排除系统级和应用级（你动不了，看了也没用）'));
    seg.appendChild(mk('all', '全部', '含系统级：能看到 swapfile、系统镜像这些'));
    topHead.appendChild(seg);
    top.appendChild(topHead);
    const src = S.topMode === 'all' ? (D.topFiles || []) : (D.topActionable || D.topFiles || []);
    if (!src.length) top.appendChild(el('div', 'atlas-safe', '没有可显示的条目。'));
    for (const file of src.slice(0, 15)) {
      const row = el('div', 'atlas-row');
      row.appendChild(el('span', 'atlas-size', fmtBytes(file.bytes)));
      const path = el('span', 'atlas-path', file.path);
      path.title = (file.explanation && file.explanation.title ? file.explanation.title + ' — ' : '') + file.path;
      row.appendChild(path);
      row.appendChild(el('span', 'atlas-pill ' + (TIER_TONE[file.tier] || 'neutral'), String(file.tier)));
      top.appendChild(row);
    }
    if (src.length > 15) top.appendChild(el('div', 'atlas-safe', '…… 还有 ' + (src.length - 15) + ' 条，接口里返回的是前 ' + src.length + ' 条'));
    wrap.appendChild(top);

    /* ③ 这都是什么（固定解释） */
    const glossary = D.glossary || [];
    if (glossary.length) {
      const band = el('div', 'atlas-band');
      band.appendChild(el('h3', null, '这都是什么？（常用位置的解释）'));
      for (const item of glossary) {
        const row = el('div', 'atlas-row');
        const safe = item.safe === 'never' ? 'danger' : item.safe === 'ask' ? 'warn' : 'ok';
        row.appendChild(el('span', 'atlas-pill ' + safe, item.safe === 'never' ? '不可动' : item.safe === 'ask' ? '要确认' : '可清理'));
        const path = el('span', 'atlas-path', item.path);
        path.title = item.path;
        row.appendChild(path);
        const text = el('span', 'atlas-sub', item.title + ' — ' + item.what + ' ' + item.advice);
        text.style.flex = '2';
        row.appendChild(text);
        band.appendChild(row);
      }
      wrap.appendChild(band);
    }

    /* ④ 按层级看 + 目录下钻（数据里的 tree 就是给这个用的） */
    const dirs = D.byDir || [];
    if (dirs.length) {
      const band = el('div', 'atlas-band');
      band.appendChild(el('h3', null, '按层级看：最占空间的目录（Top 12）· 点「展开」看下一层'));
      for (const item of dirs.slice(0, 12)) {
        const row = el('div', 'atlas-row');
        row.appendChild(el('span', 'atlas-size', item.bytesLabel || fmtBytes(item.bytes)));
        const path = el('span', 'atlas-path', item.path);
        path.title = item.path;
        row.appendChild(path);
        const safe = (item.explanation && item.explanation.safe) || 'never';
        row.appendChild(el('span', 'atlas-pill ' + (safe === 'never' ? 'danger' : safe === 'ask' ? 'warn' : 'ok'), (item.explanation && item.explanation.title) || ''));
        row.appendChild(el('span', 'atlas-size', item.files + ' 个文件'));
        const kids = (D.tree && D.tree[item.path]) || null;
        if (kids && kids.length) {
          const btn = el('button', 'atlas-expand', S.expand[item.path] ? '收起' : '展开 ' + kids.length);
          btn.type = 'button';
          btn.onclick = () => { S.expand[item.path] = !S.expand[item.path]; render(); };
          row.appendChild(btn);
        }
        band.appendChild(row);
        if (S.expand[item.path] && kids) {
          const box = el('div', 'atlas-child');
          for (const kid of kids) {
            const kr = el('div', 'atlas-row');
            kr.appendChild(el('span', 'atlas-size', kid.bytesLabel || fmtBytes(kid.bytes)));
            const kp = el('span', 'atlas-path', (kid.isDir ? '📁 ' : '· ') + String(kid.path).replace(item.path, ''));
            kp.title = kid.path;
            kr.appendChild(kp);
            if (kid.dominantTier) kr.appendChild(el('span', 'atlas-pill ' + (TIER_TONE[kid.dominantTier] || 'neutral'), kid.dominantTier));
            kr.appendChild(el('span', 'atlas-size', kid.files + ' 个'));
            box.appendChild(kr);
          }
          band.appendChild(box);
        }
      }
      wrap.appendChild(band);
    }

    /* ⑤ 按类型看 */
    const kinds = D.byKind || [];
    if (kinds.length) {
      const band = el('div', 'atlas-band');
      band.appendChild(el('h3', null, '按类型看：文件都是些什么'));
      for (const item of kinds) {
        const row = el('div', 'atlas-row');
        row.appendChild(el('span', 'atlas-size', item.bytesLabel || fmtBytes(item.bytes)));
        row.appendChild(el('span', 'atlas-path', String(item.kind)));
        row.appendChild(el('span', 'atlas-size', item.files + ' 个文件'));
        band.appendChild(row);
      }
      wrap.appendChild(band);
    }

    /* ⑥ 清理预演 */
    const plan = D.plan || {};
    const band = el('div', 'atlas-band');
    band.appendChild(el('h3', null, '清理预演（不会删除任何文件）'));
    band.appendChild(el('div', 'atlas-big', (plan.count || 0) + ' 项 · 可回收 ' + (plan.bytesLabel || fmtBytes(plan.bytes || 0))));
    const skipped = plan.skipped || {};
    band.appendChild(el('div', 'atlas-sub',
      '被安全规则挡下 ' + ((skipped.protectedPath || 0) + (skipped.notCleanableTier || 0)) + ' 项' +
      '（受保护路径 ' + (skipped.protectedPath || 0) + ' · 非可清理级别 ' + (skipped.notCleanableTier || 0) + '）'));
    const items = plan.items || [];
    const LIMIT = 12;
    const shown = S.planAll ? items : items.slice(0, LIMIT);
    for (const item of shown) {
      const row = el('div', 'atlas-row');
      row.appendChild(el('span', 'atlas-size', item.bytesLabel || fmtBytes(item.bytes)));
      const path = el('span', 'atlas-path', item.path);
      path.title = item.path;
      row.appendChild(path);
      row.appendChild(el('span', 'atlas-pill ok', String(item.tier)));
      band.appendChild(row);
    }
    if (items.length > LIMIT) {
      const more = el('div', 'atlas-more', S.planAll
        ? '收起'
        : '展开全部 ' + items.length + ' 条' + (D.planTruncated ? '（接口最多给 200 条，实际共 ' + plan.count + ' 项）' : ''));
      more.onclick = () => { S.planAll = !S.planAll; render(); };
      band.appendChild(more);
    }
    band.appendChild(el('div', 'atlas-safe',
      '安全边界：系统级（L0）与应用级（L1）永不可动；用户内容（L4）永不自动删；' +
      '~/.ssh、~/.codescope、iCloud 同步区、笔记库 markdown-vault、同步冲突副本、.git 元数据一律受保护。' +
      '本视图只读，后续版本的实际清理也必须先经过这里的预演与人工确认。'));
    wrap.appendChild(band);

    const errs = D.errors || [];
    if (errs.length) {
      const eb = el('div', 'atlas-band');
      eb.appendChild(el('h3', null, '扫描时遇到的问题（' + errs.length + '）'));
      for (const e of errs.slice(0, 8)) eb.appendChild(el('div', 'atlas-safe', typeof e === 'string' ? e : JSON.stringify(e)));
      wrap.appendChild(eb);
    }
  }

  async function load(mode, force) {
    const useMode = mode || S.mode || 'fast';
    S.mode = useMode;
    S.loading = true;
    S.error = null;
    render();
    try {
      const query = '/atlas?mode=' + useMode + (force ? '&refresh=1' : '');
      const data = await api(query);
      if (!data || data.ok !== true) throw new Error((data && data.error) || '接口返回异常');
      S.data = data;
      S.expand = {};            /* 换了一批数据，展开状态就作废 */
    } catch (error) {
      S.error = String((error && error.message) || error);
      if (toast) toast('文件全景读取失败：' + S.error);
    }
    S.loading = false;
    render();
  }

  function mount(container) {
    injectStyle();
    /* ★★ 必须**先清空容器** ✗✗ ——
       setView() 会先往 #system-body 里塞一排**加载骨架**（4 张空卡片），
       然后才调 mount()。原来这里只 append 不清空 ✗，
       于是骨架永远留在顶上 ✗（实测：截图里那 4 个空白框就是它 ✗），
       用户以为界面坏了 ✗。对齐 system-files-view.js 的做法：先清再挂。 */
    container.innerHTML = '';
    if (!S.root) S.root = el('div', 'atlas-wrap');
    container.appendChild(S.root);
    if (!S.data && !S.loading) load(S.mode, false);
    else render();
  }

  return {
    mount,
    isAtlasView: (tab) => tab === 'atlas',
    reload: () => load(S.mode, true),
    get data() { return S.data; },
  };
}

module.exports = { createAtlasView };
