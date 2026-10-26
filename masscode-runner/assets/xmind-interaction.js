/* ═══ CodeScope · 思维导图交互层（鼠标 / 键盘 / 框选 / 平移） ═════════════════════
   用户：「还有无法选中，怎么鼠标左边是移动画布，设计不合理，调研成熟的思维导图设计，重构」✓

   ▸ 原来错在哪 ✗
     ① 左键按在**空白处**就 `preventDefault + stopImmediatePropagation` 抢去平移画布 ✓
        → 引擎的框选根本没机会启动 ✓ → 用户「无法选中」（其实是无法框选 / 多选）✓
     ② 框选只能 Shift+拖（引擎默认把框选放在**右键**上，而右键又被我们拿去平移 ✗）
     ③ 自由主题是 DOM 浮层，不在引擎渲染树里 ✗ → 引擎框选永远看不到它们 ✓

   ▸ 成熟产品怎么做的（XMind / ProcessOn / 知犀 / MindMaster 一致）
     左键拖空白 = 框选      ｜ 左键单击 = 单选 ｜ Shift/⌘ 单击 = 加减选
     右键拖 / 中键拖 = 平移 ｜ ✋ 手型工具 = 左键平移 ｜ 双击空白 = 新建自由主题
     滚轮 = 上下平移        ｜ Shift+滚轮 = 左右 ｜ ⌘/Ctrl+滚轮 = 指针处缩放
     ⇒ 一句话：**左键是「选」，右键/中键是「移」**，和所有专业绘图工具一致 ✓

   ▸ 重构做法
     把画布交互**交还给引擎**（`useLeftKeySelectionRightKeyDrag:true` + `isDisableDrag:false`），
     引擎自带框选矩形、Ctrl 多选、右键/中键平移 —— 不再自己造轮子 ✓
     我们只补引擎缺的两块：
       ① 自由主题（DOM 浮层）的单击 / 加减选 / 框选（松手时按矩形相交结算）✓
       ② 手型工具、滚轮平移与 ⌘+滚轮缩放（引擎的滚轮行为固定，不如自己控制得准）✓
   ⚠️ 选中态的**唯一事实来源**是 `XMIND_MULTI`（app.js 的全局 Set），
     引擎的 activeNodeList 只是它的投影 ✓ —— 两套渲染（SVG + 浮层）才有一致的选中 ✓
   ⚠️ 本文件必须在 app.js **之后**加载：所有依赖都是 app.js 的顶层绑定（classic script 共享）✓
*/

(function () {
  'use strict';

  /* 框选状态：只在「空白处按下左键」时开启 ✓ */
  let box = null;
  /* 我们自己改引擎选中态时，屏蔽 node_active 回调，避免自我回环 ✓ */
  let muting = false;
  /* 框选刚结算后的一小段时间内，引擎可能**再补发一次** node_active ✓
     → 这段时间里收到引擎的选中要**合并**而不是替换，否则刚选上的自由主题会被冲掉 ✗（实测） */
  let mergeUntil = 0;
  /* 按住空格 = 临时抓手 ✓ —— 触控板没有中键、右键拖也别扭，
     空格+左键拖是 Figma / PS / ProcessOn 通用的「抓画布」手势 ✓ */
  let spaceHeld = false;
  /* 框选结算那一刻的完整选中 ✓ ——
     ⚠️ 不能指望「引擎补发 node_active 时 multi 还在」✗：
        app.js 自己的 node_active 回调里有个兜底
        `if(XMIND_SELECTED 不在 multi 里) XMIND_MULTI=new Set([XMIND_SELECTED])` ✓
        它会先把浮层那部分**洗掉** ✓，我们再合并就已经晚了 ✗（实测：13 个树节点，浮层 0） */
  let pendingMerge = null;

  const engineEl = () => document.getElementById('xmind-engine');
  const isEdit = () => typeof DRAW_KIND !== 'undefined' && DRAW_KIND === 'xmind' && XMIND_VIEW === 'edit' && !!XMIND_MAP;
  const multi = () => (XMIND_MULTI instanceof Set ? XMIND_MULTI : (XMIND_MULTI = new Set()));
  const mod = (event) => !!(event.shiftKey || event.metaKey || event.ctrlKey);

  function withMute(fn) {
    muting = true;
    try { fn(); } finally { muting = false; }
  }

  /* ── 选中态：一处改，三处（引擎 / 浮层 / 大纲）一起变 ─────────────────── */
  function paintSelection() {
    const set = multi();
    document.querySelectorAll('.xmind-row').forEach((row) => {
      row.classList.toggle('selected', set.has(String(row.dataset.id || '')));
    });
    document.querySelectorAll('.xmind-floating-node').forEach((node) => {
      node.classList.toggle('selected', set.has(String(node.dataset.topicId || '')));
    });
  }

  function setSelection(ids, primary) {
    const next = new Set();
    (ids || []).forEach((id) => { if (id) next.add(String(id)); });
    XMIND_MULTI = next;
    if (primary) XMIND_SELECTED = String(primary);
    /* ⚠️ 空选中必须把 XMIND_SELECTED 也清掉 ✓ ——
       否则点空白「取消选中」之后，Tab 还会往**上一个**主题加子节点 ✗ */
    else XMIND_SELECTED = next.size ? [...next][next.size - 1] : null;
    paintSelection();
    try { xmindUpdateUndo(); } catch (_) {}
  }

  /* 把 XMIND_MULTI 投影回引擎（树节点才需要，浮层不归引擎管）✓ */
  function syncEngineSelection() {
    if (!XMIND_MAP) return;
    const nodes = [...multi()].map((id) => xmindSmmNode(id)).filter(Boolean);
    withMute(() => {
      XMIND_MAP.execCommand('CLEAR_ACTIVE_NODE');
      nodes.forEach((node) => XMIND_MAP.execCommand('SET_NODE_ACTIVE', node, true));
    });
  }

  /* 清空选中：引擎那边也要清 ✓ —— 否则它自己还留着 active 高亮，
     我们只擦了大纲和浮层 → 屏幕上「看着选中了，其实没选」✗ */
  function clearSelection() {
    if (XMIND_MAP) withMute(() => XMIND_MAP.execCommand('CLEAR_ACTIVE_NODE'));
    setSelection([], null);
  }

  function selectOnly(id) {
    setSelection([id], id);
    syncEngineSelection();
  }

  function toggleOne(id) {
    const next = new Set(multi());
    if (next.has(String(id))) next.delete(String(id));
    else next.add(String(id));
    setSelection([...next], id);
    syncEngineSelection();
  }

  /* ── 自由主题浮层：矩形相交 ───────────────────────────────────────────── */
  function floatingIdsInRect(rect) {
    const ids = [];
    document.querySelectorAll('.xmind-floating-node').forEach((node) => {
      const r = node.getBoundingClientRect();
      const hit = !(r.right < rect.left || r.left > rect.right || r.bottom < rect.top || r.top > rect.bottom);
      node.classList.toggle('selected', hit);
      if (hit) ids.push(node.dataset.topicId);
    });
    return ids;
  }

  function rectOfBox(event) {
    const left = Math.min(box.x, event.clientX);
    const top = Math.min(box.y, event.clientY);
    return { left, top, right: Math.max(box.x, event.clientX), bottom: Math.max(box.y, event.clientY) };
  }

  /* ── 平移：手型工具 / 中键（引擎已接管右键与中键，这里只补手型工具）────── */
  function startPan(event, engine) {
    const view = xmindMapTranslation();
    const floating = event.target.closest?.('.xmind-floating-node');
    const treeTopic = floating ? null : xmindEngineTopic(event.target);
    XMIND_CANVAS_PAN = {
      pointerId: event.pointerId,
      x: event.clientX, y: event.clientY,
      tx: view.x, ty: view.y, scale: view.scale,
      moved: false,
      button: event.button,
      /* 右键「点一下不动」= 打开节点菜单 ✓（右键拖动仍然是平移 ✓ 和 XMind 一致） */
      topicId: floating ? floating.dataset.topicId : (treeTopic ? xmindEngineTopicId(treeTopic) : null),
    };
    try { engine.setPointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
    event.stopImmediatePropagation();
    xmindUpdateViewportTools();
  }

  function movePan(event) {
    const pan = XMIND_CANVAS_PAN;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    pan.moved = pan.moved || Math.abs(dx) + Math.abs(dy) > 3;
    xmindApplyViewport(pan.tx + dx, pan.ty + dy, pan.scale);
  }

  /* ── 自由主题拖拽（原有逻辑迁移，补上多选与吸附提示）──────────────────── */
  function startFloatDrag(event, engine, id) {
    const item = xmindFloatingItems().find((entry) => entry.topic.id === id);
    if (!item) return;
    XMIND_SELECTED = id;
    XMIND_FLOAT_DRAG = {
      pointerId: event.pointerId, id,
      x: event.clientX, y: event.clientY,
      ox: item.position.x, oy: item.position.y,
      preview: null, moved: false,
    };
    engine.classList.add('dragging-free');
    try { engine.setPointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function moveFloatDrag(event) {
    const drag = XMIND_FLOAT_DRAG;
    const scale = XMIND_MAP?.view?.scale || 1;
    const dx = (event.clientX - drag.x) / scale;
    const dy = (event.clientY - drag.y) / scale;
    drag.moved = drag.moved || Math.abs(dx) + Math.abs(dy) > 3;
    drag.preview = { x: drag.ox + dx, y: drag.oy + dy };
    xmindRenderFloatingTopics();
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function finishFloatDrag(event, engine) {
    const drag = XMIND_FLOAT_DRAG;
    const moving = document.querySelector('.xmind-floating-node[data-topic-id="' + CSS.escape(drag.id) + '"]');
    if (moving) moving.style.pointerEvents = 'none';
    const under = document.elementFromPoint(event.clientX, event.clientY);
    if (moving) moving.style.pointerEvents = '';
    const freeTarget = under?.closest?.('.xmind-floating-node');
    const treeTarget = xmindEngineTopic(under);
    const targetId = freeTarget?.dataset.topicId || xmindEngineTopicId(treeTarget);
    const finalPosition = drag.preview || { x: drag.ox, y: drag.oy };
    XMIND_FLOAT_DRAG = null;
    engine.classList.remove('dragging-free');
    try { engine.releasePointerCapture(event.pointerId); } catch (_) {}
    if (targetId && targetId !== drag.id && xmindAttachFloating(drag.id, String(targetId))) return;
    if (!drag.moved && drag.collapse) selectOnly(drag.id);
    if (drag.moved) {
      const hit = xmindFind(drag.id);
      if (hit) {
        /* ⚠️ 自由组里的**子主题**要单独处理 ✗✗
           原来走 `xmindDetachFloatingAt` → 拖一下它就「另立门户」变成新的自由导图 ✓
           （实测：拖 新主题L2，它立刻从组里脱出来）—— 用户说的「移动怎么不对」就是这个 ✗
           ⇒ 记**相对父级的偏移** `codescopeOffset`：只挪它自己，组的层级关系不变 ✓ */
        if (hit.isDetached && hit.parent) {
          const prev = hit.topic.codescopeOffset || { dx: 0, dy: 0 };
          hit.topic.codescopeOffset = {
            dx: Number(prev.dx || 0) + (finalPosition.x - drag.ox),
            dy: Number(prev.dy || 0) + (finalPosition.y - drag.oy),
          };
        } else {
          hit.topic.position = finalPosition;
        }
        xmindNormalize();
        xmindRecord();
        xmindMarkSnapshotDirty();
        DRAW_PENDING = { workbook: xmindClone(XMIND_WORKBOOK) };
        scheduleDrawSave();
        renderXmindOutline();
      }
    }
    xmindRenderFloatingTopics();
  }

  /* ── 框选结算：引擎负责树节点，这里把浮层节点并进去 ✓ ─────────────────── */
  function commitBox() {
    if (!box) return;
    const ids = [...(box.engineIds || []), ...(box.floatIds || [])];
    /* 自证信息：回归排查时能直接看出「引擎选中了几个 / 浮层命中几个」✓ */
    window.__lastBox = { engineIds: box.engineIds || [], floatIds: box.floatIds || [] };
    const base = box?.base ? [...box.base] : [];
    const merged = new Set(base);
    ids.forEach((id) => merged.add(String(id)));
    pendingMerge = new Set(merged);
    mergeUntil = Date.now() + 320;
    setSelection([...merged], ids[0] || [...merged][0]);
    box = null;
  }

  /* ── 多选删除：**只改数据模型**，不碰引擎命令 ✓
     ⚠️ 原来走 `execCommand('REMOVE_NODE')` + 手工 splice 浮层 ✗，会留下两条中间历史 ✓ →
        撤销回来的是「树没了但自由主题还在」的半截状态 ✗（实测 4 条历史里 index 2 就是它）✓
     ⇒ 统一在 workbook 上摘掉（attached / detached 都有 container ✓），再 xmindChanged 一次 ✓
        → 只有一条历史 ✓，撤销能完整回来 ✓，引擎那边靠 updateData 重渲染 ✓ */
  function deleteSelection() {
    const ids = [...multi()];
    if (ids.length <= 1) return false;
    const rootId = xmindRootTopic()?.id;
    let removed = 0;
    ids.forEach((id) => {
      if (String(id) === String(rootId)) return;        /* 根主题删不得 ✓ */
      const hit = xmindFind(id);
      if (!hit || !hit.container) return;
      const index = hit.container.indexOf(hit.topic);
      if (index < 0) return;
      hit.container.splice(index, 1);
      removed += 1;
    });
    if (!removed) return false;
    XMIND_SELECTED = rootId || null;
    XMIND_MULTI = new Set();
    xmindChanged();
    return true;
  }

  /* ══ 分组选择（用户：「缺少分组那种选择」）═══════════════════════════════
     XMind 的做法：右键主题 → 选择同级 / 选择分支；Ctrl+A 全选。
     分支选择必须**连子孙一起选**，否则「删除分支」只能删一半 ✓ */
  function collectSubtree(topic, out) {
    if (!topic) return out;
    out.push(String(topic.id));
    (xmindChildren(topic) || []).forEach((child) => collectSubtree(child, out));
    return out;
  }

  function selectBranch(id) {
    const hit = xmindFind(id);
    if (!hit) return;
    setSelection(collectSubtree(hit.topic, []), String(id));
    syncEngineSelection();
  }

  function selectSiblings(id) {
    const hit = xmindFind(id);
    if (!hit || !hit.container) { selectBranch(id); return; }
    setSelection(hit.container.map((topic) => String(topic.id)), String(id));
    syncEngineSelection();
  }

  function selectAllTopics() {
    const root = xmindRootTopic();
    if (!root) return;
    const ids = collectSubtree(root, []);
    (xmindDetached() || []).forEach((topic) => collectSubtree(topic, ids));
    setSelection(ids, ids[0]);
    syncEngineSelection();
  }

  /* ══ 一个够用的输入框（备注 / 超链接 / 标签）══════════════════════════════
     ⚠️ 不用 window.prompt ✗：Electron 里它会把窗口冻住，而且样式完全失控 ✓ */
  function askText(title, value, multiline) {
    return new Promise((resolve) => {
      const mask = document.createElement('div');
      mask.className = 'cs-ask-mask';
      const card = document.createElement('div');
      card.className = 'cs-ask-card';
      const head = document.createElement('div');
      head.className = 'cs-ask-head';
      head.textContent = title;
      const input = document.createElement(multiline ? 'textarea' : 'input');
      input.className = 'cs-ask-input';
      input.value = value || '';
      if (!multiline) input.type = 'text';
      const foot = document.createElement('div');
      foot.className = 'cs-ask-foot';
      const cancel = document.createElement('button');
      cancel.textContent = '取消';
      const okBtn = document.createElement('button');
      okBtn.className = 'primary';
      okBtn.textContent = '确定';
      foot.append(cancel, okBtn);
      card.append(head, input, foot);
      mask.appendChild(card);
      document.body.appendChild(mask);
      const done = (result) => { mask.remove(); resolve(result); };
      cancel.onclick = () => done(null);
      okBtn.onclick = () => done(input.value);
      mask.onclick = (event) => { if (event.target === mask) done(null); };
      input.onkeydown = (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); done(null); }
        if (event.key === 'Enter' && !multiline) { event.preventDefault(); done(input.value); }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); done(input.value); }
      };
      input.focus();
      input.select();
    });
  }

  /* 字段一律**先改数据模型再重渲染** ✓ ——
     引擎的 SET_NODE_NOTE 之类只认树节点 ✗，自由主题没有引擎节点 ✓；
     走模型这条路树节点和自由主题同一套代码 ✓ 而且天然存进 .xmind ✓ */
  function applyField(id, field, value) {
    const hit = xmindFind(id);
    if (!hit) return;
    if (value) hit.topic[field] = value;
    else delete hit.topic[field];
    xmindChanged();
  }

  async function editNote(id) {
    const hit = xmindFind(id);
    if (!hit) return;
    const next = await askText('备注（支持多行）', hit.topic.note || '', true);
    if (next !== null) applyField(id, 'note', next.trim());
  }

  async function editLink(id) {
    const hit = xmindFind(id);
    if (!hit) return;
    const next = await askText('超链接地址', hit.topic.hyperlink || '', false);
    if (next !== null) applyField(id, 'hyperlink', next.trim());
  }

  async function editTags(id) {
    const hit = xmindFind(id);
    if (!hit) return;
    const current = Array.isArray(hit.topic.tag) ? hit.topic.tag.join(', ') : '';
    const next = await askText('标签（用逗号分隔）', current, false);
    if (next === null) return;
    const list = next.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
    applyField(id, 'tag', list.length ? list : null);
  }

  /* ══ 节点右键菜单（XMind 的右键就是主入口）═══════════════════════════════ */
  function openNodeMenu(event, id) {
    const hit = xmindFind(id);
    if (!hit) return;
    const node = hit.isDetached ? null : xmindSmmNode(id);
    const focus = () => setSelection([id], id);
    const items = [
      { label: '编辑主题', hint: 'F2', run: () => { focus(); if (hit.isDetached) xmindBeginFloatingEdit(id); else if (node) xmindBeginEngineEdit(node); } },
      { type: 'separator' },
      { label: '插入子主题', hint: 'Tab', run: () => { focus(); xmindAddChild(); } },
      { label: '插入同级主题', hint: 'Enter', run: () => { focus(); xmindAddSibling(); } },
      { label: '插入父主题', hint: '⌘↵', run: () => { focus(); xmindAddParent(); } },
      { type: 'separator' },
      { label: '选择分支（含子孙）', run: () => selectBranch(id) },
      { label: '选择同级主题', run: () => selectSiblings(id) },
      { label: '全选', hint: '⌘A', run: () => selectAllTopics() },
      { type: 'separator' },
      { label: '上移', hint: '⌥↑', run: () => { focus(); xmindReorder(-1); } },
      { label: '下移', hint: '⌥↓', run: () => { focus(); xmindReorder(1); } },
      { label: XMIND_COLLAPSED.has(id) ? '展开子主题' : '折叠子主题', run: () => { focus(); xmindToggleFold(); } },
      { type: 'separator' },
      { label: hit.topic.note ? '编辑备注…' : '添加备注…', run: () => editNote(id) },
      { label: hit.topic.hyperlink ? '编辑超链接…' : '添加超链接…', run: () => editLink(id) },
      { label: Array.isArray(hit.topic.tag) && hit.topic.tag.length ? '编辑标签…' : '添加标签…', run: () => editTags(id) },
      { type: 'separator' },
      { label: hit.isDetached ? '转为普通主题' : '转为自由主题', run: () => { focus(); if (hit.isDetached) { xmindAttachToRoot(id); } else xmindToFloating(); } },
      { type: 'separator' },
      { label: '删除主题及子主题', hint: 'Del', danger: true, run: () => { focus(); xmindDelete(); } },
      { label: '仅删除当前主题', hint: '⌘Del', danger: true, run: () => { focus(); xmindDeleteSingle(); } },
    ];
    if (typeof showContextMenu === 'function') showContextMenu(event, items);
  }

  /* 自由主题挂回中心主题（右键里「转为普通主题」）✓ */
  function xmindAttachToRoot(id) {
    const root = xmindRootTopic();
    if (!root || !xmindAttachFloating) return;
    xmindAttachFloating(id, String(root.id));
  }

  /* ── 事件绑定 ─────────────────────────────────────────────────────────── */
  function bind(engine, map) {
    if (engine.dataset.csXmindInteraction === '2') return;
    engine.dataset.csXmindInteraction = '2';
    /* ⚠️ 监听必须挂在**共同祖先**上 ✗ 不能挂在 #xmind-engine 上：
       自由主题浮层是 #xmind-preview 的子节点、**不在引擎里** ✓
       → 挂在引擎上，点自由主题的 pointerdown 根本收不到（实测：dbg 为空）✗ */
    const surface = engine.parentElement || engine;

    map.on('node_active', (node, list) => {
      if (muting) return;
      const nodes = Array.isArray(list) && list.length ? list : (node ? [node] : []);
      const ids = nodes.map((item) => xmindEngineTopicId(item)).filter(Boolean);
      /* 框选进行中：先记下引擎选中的树节点，等松手统一结算 ✓ */
      if (box && box.active) { box.engineIds = ids; return; }
      if (Date.now() < mergeUntil) {
        const merged = new Set([...(pendingMerge || multi()), ...ids]);
        pendingMerge = null;
        setSelection([...merged], XMIND_SELECTED);
        return;
      }
      setSelection(ids, ids[0]);
    });

    surface.addEventListener('pointerdown', (event) => {
      if (!isEdit() || event.target.closest('[contenteditable]')) return;
      mergeUntil = 0;                       /* 用户又动手了 → 合并窗口立刻失效 ✓ */
      pendingMerge = null;
      if (event.button === 0 && (XMIND_TOOL_MODE === 'pan' || spaceHeld)) { startPan(event, engine); return; }
      /* ⚠️ 右键 / 中键平移**自己接管** ✗✗
         引擎只在 `#xmind-engine` 上监听 mousedown ✓，而自由主题是预览区的 DIV ✗ →
         从自由主题上按下右键，引擎收不到 → 画布纹丝不动（实测）✓
         ⇒ 右键 / 中键一律走我们的 startPan，全区域一致 ✓ */
      if (event.button === 1 || event.button === 2) { startPan(event, engine); return; }
      if (event.button !== 0) return;

      const floating = event.target.closest('.xmind-floating-node');
      if (floating) {
        const id = floating.dataset.topicId;
        /* ⚠️ 点在「已选中的多个里的一员」上时**先不塌缩** ✓：
           用户可能是要整体拖走这几个 ✓，等松手没拖动才塌缩成单选 ✓（成熟产品都这么做） */
        const collapse = !mod(event) && multi().has(String(id)) && multi().size > 1;
        if (mod(event)) toggleOne(id);
        else if (!multi().has(String(id))) selectOnly(id);
        startFloatDrag(event, engine, id);
        XMIND_FLOAT_DRAG.collapse = collapse;
        return;
      }

      const tree = xmindEngineTopic(event.target);
      if (tree) {
        /* 树节点：单击 / Ctrl 多选交给引擎 ✓；Shift 引擎不认 ✗ 自己补 ✓ */
        if (event.shiftKey) {
          toggleOne(xmindEngineTopicId(tree));
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }

      /* 空白处：不拦 ✓ 引擎左键拖 = 框选 ✓ 我们只记起点，用来补浮层节点 */
      box = {
        active: true, pointerId: event.pointerId,
        x: event.clientX, y: event.clientY,
        moved: false, engineIds: [], floatIds: [],
        base: mod(event) ? new Set(multi()) : null,
      };
    }, true);

    surface.addEventListener('pointermove', (event) => {
      const pan = XMIND_CANVAS_PAN;
      if (pan && pan.pointerId === event.pointerId) { movePan(event); return; }
      const drag = XMIND_FLOAT_DRAG;
      if (drag && drag.pointerId === event.pointerId) { moveFloatDrag(event); return; }
      if (box && box.active && box.pointerId === event.pointerId) {
        const dx = event.clientX - box.x;
        const dy = event.clientY - box.y;
        if (!box.moved && Math.abs(dx) + Math.abs(dy) > 6) box.moved = true;
        if (box.moved) box.floatIds = floatingIdsInRect(rectOfBox(event));
      }
    }, true);

    const finish = (event) => {
      if (XMIND_FLOAT_DRAG && XMIND_FLOAT_DRAG.pointerId === event.pointerId) {
        finishFloatDrag(event, engine);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (XMIND_CANVAS_PAN && XMIND_CANVAS_PAN.pointerId === event.pointerId) {
        const pan = XMIND_CANVAS_PAN;
        XMIND_CANVAS_PAN = null;
        try { engine.releasePointerCapture(event.pointerId); } catch (_) {}
        xmindUpdateViewportTools();
        event.preventDefault();
        event.stopImmediatePropagation();
        /* 右键单击（没拖动）= 节点菜单 ✓ */
        if (pan.button === 2 && !pan.moved && pan.topicId) {
          setSelection([pan.topicId], pan.topicId);
          openNodeMenu(event, pan.topicId);
        }
        return;
      }
      if (box && box.active && box.pointerId === event.pointerId) {
        /* ⚠️ 框选结算必须**推迟一个宏任务** ✗✗
           引擎的框选是在 window 的 mouseup 里才 emit node_active ✓，
           而我们在 #xmind-preview 上的捕获阶段先跑 ✓ →
           立刻结算的话，引擎那份「树节点选中」会晚一步把浮层的选中**冲掉** ✓（实测：floatIds 有 5 个，
           commit 之后 multi 只剩 13 个树节点）✗
           ⇒ 等引擎这轮同步回调跑完再合并 ✓ */
        if (box.moved) setTimeout(commitBox, 0);
        else if (box.base) { setSelection([...box.base], [...box.base][0]); box = null; }
        /* ⚠️ 点空白 = 取消选中 ✓ 必须自己来：引擎的 activeNodeList 本来就空时
           它**不会**再发 node_active ✗ → 大纲会一直留着上一行高亮（实测）✗ */
        else { clearSelection(); box = null; }
      }
    };
    /* 空格松开 / 窗口失焦 → 退出临时抓手 ✓ */
    surface.addEventListener('keyup', (event) => {
      if (event.key !== ' ') return;
      spaceHeld = false;
      engine.classList.remove('space-pan');
    }, true);
    window.addEventListener('blur', () => { spaceHeld = false; engine.classList.remove('space-pan'); });

    surface.addEventListener('pointerup', finish, true);
    surface.addEventListener('pointercancel', finish, true);

    /* 滚轮：平移 / Shift 横向 / ⌘+滚轮缩放（引擎的滚轮行为固定，自己控更准）✓ */
    surface.addEventListener('wheel', (event) => {
      if (!isEdit() || event.target.closest('[contenteditable]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.ctrlKey || event.metaKey) {
        const magnitude = Math.max(0.06, Math.min(0.28, Math.abs(event.deltaY) * 0.002));
        xmindZoomAt(event.deltaY < 0 ? magnitude : -magnitude, event.clientX, event.clientY);
      } else {
        const horizontal = event.shiftKey && Math.abs(event.deltaX) < 1 ? -event.deltaY : -event.deltaX;
        xmindPanBy(horizontal, -event.deltaY);
      }
    }, { capture: true, passive: false });

    /* ⚠️ 面板从「隐藏」变「可见」时要重算一次 ✗✗
       实测路径：编辑自由主题后焦点掉到 body → 后面的 Enter 走了**全局快捷键** →
       直接退出绘图视图 ✓；再进来时面板还没布局（宽高 0）→
       `xmindPlaceAll` 算的是 0×0 视口（内容停在右下角）、
       `xmindRenderFloatingTopics` 拿不到原点（自由主题全不见）✗
       ⇒ 尺寸从 0 变成有值时补一次「适应 + 重画浮层」✓ */
    let lastWidth = 0;
    try {
      const ro = new ResizeObserver(() => {
        if (!engine.clientWidth || !engine.clientHeight) { lastWidth = 0; return; }
        if (lastWidth === 0 && XMIND_MAP) {
          xmindPlaceAll(true);
          xmindRenderFloatingTopics();
        }
        lastWidth = engine.clientWidth;
      });
      ro.observe(engine);
    } catch (_) {}

    /* ⚠️ 右键拖要能平移，就必须先把原生右键菜单吃掉 ✗
       引擎只在 **svg** 上 preventDefault ✓，而自由主题是 #xmind-preview 里的 DIV ✗ →
       从自由主题上按下右键会弹浏览器菜单，平移直接断掉 ✓ */
    surface.addEventListener('contextmenu', (event) => {
      if (!isEdit()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    /* 双击空白：新建自由主题 ✓ */
    surface.addEventListener('dblclick', (event) => {
      if (!isEdit() || event.target.closest('.xmind-floating-node')) return;
      if (xmindEngineTopic(event.target) || event.target.closest('[contenteditable]')) return;
      xmindAddFloatingAt(event.clientX,event.clientY);
    }, true);

    surface.addEventListener('keydown', (event) => {
      if (!isEdit() || event.target.closest('[contenteditable]')) return;
      if (event.key === ' ') {
        /* 空格 = 抓手修饰键（不再「空格进编辑」，编辑交给 F2 / 双击）✓ */
        spaceHeld = true;
        engine.classList.add('space-pan');
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const hit = xmindFind(XMIND_SELECTED);
      const withMod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (hit?.isDetached) {
        if (event.key === 'F2') { event.preventDefault(); event.stopImmediatePropagation(); xmindBeginFloatingEdit(); }
        else if (!withMod && event.key === 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); xmindAddChild(); }
        else if (!withMod && event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); xmindAddSibling(); }
        else if (!withMod && (event.key === 'Delete' || event.key === 'Backspace')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (!deleteSelection()) xmindDelete();
        }
        return;
      }

      if (!withMod && (event.key === 'Delete' || event.key === 'Backspace') && multi().size > 1) {
        event.preventDefault();
        event.stopImmediatePropagation();
        deleteSelection();
        return;
      }
      if (withMod && key === 'a') { event.preventDefault(); event.stopImmediatePropagation(); selectAllTopics(); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); clearSelection(); return; }
      if (withMod && (key === '+' || key === '=' || key === '-' || key === '0')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (key === '+' || key === '=') xmindZoom(0.12);
        else if (key === '-') xmindZoom(-0.12);
        else xmindResetZoom();
        return;
      }
      if (event.key === 'F2' && XMIND_MAP.renderer?.activeNodeList?.[0]) {
        event.preventDefault();
        event.stopImmediatePropagation();
        xmindBeginEngineEdit(XMIND_MAP.renderer.activeNodeList[0]);
      }
    }, true);
  }

  /* app.js 与其它模块的入口 */
  window.__csXmindInteraction = { bind, setSelection, paintSelection, deleteSelection };
  window.__csXmindSel = (id) => multi().has(String(id || ''));
  window.__csXmindMulti = () => [...multi()];
  window.__csXmindDeleteMulti = () => deleteSelection();
  window.__csXmindClearSelection = () => clearSelection();
  window.__csXmindMerging = () => Date.now() < mergeUntil;
  window.__csXmindSelectBranch = (id) => selectBranch(id || XMIND_SELECTED);
  window.__csXmindSelectSiblings = (id) => selectSiblings(id || XMIND_SELECTED);
  window.__csXmindSelectAll = () => selectAllTopics();
  window.__csXmindMenu = (event, id) => openNodeMenu(event, id);
  window.__csXmindRepaintSelection = () => paintSelection();
})();
