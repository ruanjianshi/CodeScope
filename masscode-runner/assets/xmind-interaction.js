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
    scheduleToolbarState();
    refreshOverlay();
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

  /* ══ 自由导图的分组框：只能自己画 ✗ 引擎的外框只认树节点 ✓
     数据仍然挂在组根上（`outerFrame`），渲染成 #xmind-float-overlay 里的一个盒子 ✓ */
  let overlayBusy = false;

  function renderFreeFrames() {
    const overlay = document.getElementById('xmind-float-overlay');
    const engine = engineEl();
    if (!overlay || !engine) return;
    overlayBusy = true;
    try {
      overlay.querySelectorAll('.cs-free-frame').forEach((el) => el.remove());
      const er = engine.getBoundingClientRect();
      /* 自由导图：把「带同一个 groupId 的节点」聚成一组再画框 ✓ */
      const groups = new Map();
      (xmindDetached() || []).forEach((root) => {
        (function walk(topic, depth) {
          if (!topic) return;
          const groupId = topic.outerFrame && topic.outerFrame.groupId;
          /* ⚠️ depth===0 = 挂在组根上的**旧数据**（上一版把框挂在组根 → 一选就全框）✗
             不再渲染它，避免又冒出一个"整组被框"的框 ✓ */
          if (groupId && depth > 0) {
            if (!groups.has(groupId)) groups.set(groupId, { frame: topic.outerFrame, ids: [] });
            groups.get(groupId).ids.push(String(topic.id));
          }
          (xmindChildren(topic) || []).forEach((child) => walk(child, depth + 1));
        })(root, 0);
      });
      groups.forEach(({ frame, ids }) => {
        const rects = ids
          .map((id) => document.querySelector('.xmind-floating-node[data-topic-id="' + CSS.escape(id) + '"]'))
          .filter(Boolean)
          .map((el) => el.getBoundingClientRect());
        if (!rects.length) return;
        const left = Math.min(...rects.map((r) => r.left)) - er.left - 18;
        const top = Math.min(...rects.map((r) => r.top)) - er.top - 22;
        const right = Math.max(...rects.map((r) => r.right)) - er.left + 18;
        const bottom = Math.max(...rects.map((r) => r.bottom)) - er.top + 18;
        const box = document.createElement('div');
        box.className = 'cs-free-frame';
        box.dataset.groupId = frame.groupId || '';
        box.style.left = left + 'px';
        box.style.top = top + 'px';
        box.style.width = Math.max(48, right - left) + 'px';
        box.style.height = Math.max(36, bottom - top) + 'px';
        const label = document.createElement('span');
        label.className = 'cs-free-frame-label';
        label.textContent = frame.text || '分组';
        label.title = '双击改分组框标题';
        label.ondblclick = async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const next = await askText('分组框标题', frame.text || '', false);
          if (next === null) return;
          setFrameText(frame.groupId, next.trim());
          xmindChanged();
        };
        box.appendChild(label);
        /* ⚠️ 框本身 pointer-events:none（否则会挡住下面的节点）✗
           → 只在**四条边**上放热区：能点中、能拖，框内照常操作节点 ✓ */
        ['t', 'r', 'b', 'l'].forEach((pos) => {
          const edge = document.createElement('div');
          edge.className = 'cs-free-frame-edge ' + pos;
          edge.dataset.groupId = frame.groupId || '';
          box.appendChild(edge);
        });
        overlay.insertBefore(box, overlay.firstChild);
      });
    } finally {
      setTimeout(() => { overlayBusy = false; }, 0);
    }
  }

  /* ══ 拖动分组框 = 整组平移（XMind 的边界也能拖）═══════════════════════════
     ⚠️ 只能拖自由导图的成员 ✗ 树上的节点位置由布局算，拖不动 ✓ */
  let frameDrag = null;

  function membersOfGroup(groupId) {
    const list = [];
    (xmindDetached() || []).forEach((root) => {
      (function walk(topic, depth) {
        if (!topic) return;
        if (topic.outerFrame && topic.outerFrame.groupId === groupId) list.push({ topic, depth, rootId: String(root.id) });
        (xmindChildren(topic) || []).forEach((child) => walk(child, depth + 1));
      })(root, 0);
    });
    return list;
  }

  function bindFrameDrag(overlay, engine) {
    if (!overlay || overlay.dataset.csFrameBound === '1') return;
    overlay.dataset.csFrameBound = '1';
    /* ⚠️ 删除按钮必须用**事件委托** ✗ —— 浮层每次重画都会换掉元素，
       绑在元素上的 onclick 会点空（实测：点了没反应）✓ */
    overlay.addEventListener('click', (event) => {
      const kill = event.target.closest('.cs-free-frame-kill');
      if (!kill) return;
      event.preventDefault();
      event.stopPropagation();
      const groupId = kill.dataset.groupId;
      if (!groupId) return;
      const ids = membersOfGroup(groupId).map((m) => String(m.topic.id));
      deleteGroupFrame(ids);
    }, true);

    overlay.addEventListener('pointerdown', (event) => {
      /* ⚠️ 这里**不能 preventDefault** ✗ —— 它会把后面的 click 一起取消，
         删除按钮就永远收不到 click（实测点了没反应）✓ 只挡冒泡即可 ✓ */
      if (event.target.closest('.cs-free-frame-kill')) { event.stopPropagation(); return; }
      const edge = event.target.closest('.cs-free-frame-edge');
      if (!edge) return;
      const groupId = edge.dataset.groupId;
      if (!groupId) return;
      const members = membersOfGroup(groupId);
      if (!members.length) return;
      event.preventDefault();
      event.stopPropagation();
      setSelection(members.map((m) => String(m.topic.id)), String(members[0].topic.id));
      syncEngineSelection();
      frameDrag = {
        pointerId: event.pointerId,
        groupId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        members: members.map((m) => ({
          topic: m.topic,
          depth: m.depth,
          rootId: m.rootId,
          position: m.topic.position ? { ...m.topic.position } : null,
          offset: m.topic.codescopeOffset ? { ...m.topic.codescopeOffset } : { dx: 0, dy: 0 },
        })),
      };
      try { overlay.setPointerCapture(event.pointerId); } catch (_) {}
      engine.classList.add('dragging-free');
    }, true);

    overlay.addEventListener('pointermove', (event) => {
      const drag = frameDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const scale = XMIND_MAP?.view?.scale || 1;
      const dx = (event.clientX - drag.x) / scale;
      const dy = (event.clientY - drag.y) / scale;
      drag.moved = drag.moved || Math.abs(dx) + Math.abs(dy) > 2;
      const rootIds = new Set(drag.members.filter((m) => m.depth === 0).map((m) => String(m.topic.id)));
      drag.members.forEach((member) => {
        if (member.depth === 0 && member.position) {
          member.topic.position = { x: member.position.x + dx, y: member.position.y + dy };
        } else if (!rootIds.has(member.rootId)) {
          /* ⚠️ 组根也在选中集里时，子节点**跟着根走**就对了 ✗ 再给偏移会走两倍 ✓ */
          member.topic.codescopeOffset = { dx: member.offset.dx + dx, dy: member.offset.dy + dy };
        }
      });
      xmindRenderFloatingTopics();
      renderFreeFrames();
      event.preventDefault();
      event.stopPropagation();
    }, true);

    const finish = (event) => {
      const drag = frameDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      frameDrag = null;
      engine.classList.remove('dragging-free');
      try { overlay.releasePointerCapture(event.pointerId); } catch (_) {}
      if (drag.moved) xmindChanged();
      event.preventDefault();
      event.stopPropagation();
    };
    overlay.addEventListener('pointerup', finish, true);
    overlay.addEventListener('pointercancel', finish, true);
  }

  /* ══ 「选中分组」的视觉：多选时在画布上画一个虚线包围框 ═══════════════════
     用户两次说「缺少分组那种选择」—— XMind 多选时会把整组圈起来，
     我们之前只给每个节点描边，**看不出"这是一组"** ✗ */
  function updateGroupBox() {
    const overlay = document.getElementById('xmind-float-overlay');
    const engine = engineEl();
    if (!overlay || !engine) return;
    let boxEl = document.getElementById('cs-xmind-group-box');
    const ids = [...multi()];
    if (ids.length < 2) { if (boxEl) boxEl.remove(); return; }
    const er = engine.getBoundingClientRect();
    const rects = [];
    ids.forEach((id) => {
      const el = document.querySelector('.xmind-floating-node[data-topic-id="' + CSS.escape(id) + '"]') || xmindSmmNode(id)?.group?.node;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) rects.push(rect);
    });
    if (rects.length < 2) { if (boxEl) boxEl.remove(); return; }
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    if (!boxEl) {
      boxEl = document.createElement('div');
      boxEl.id = 'cs-xmind-group-box';
      overlay.appendChild(boxEl);
    }
    boxEl.style.left = (left - er.left - 12) + 'px';
    boxEl.style.top = (top - er.top - 12) + 'px';
    boxEl.style.width = (right - left + 24) + 'px';
    boxEl.style.height = (bottom - top + 24) + 'px';
  }

  /* ══ 大纲里的多选（Shift 连选 / ⌘ 加减选 / 点分组标题选整组）═════════════ */
  let outlineAnchor = null;

  function outlineRange(fromId, toId) {
    const rows = [...document.querySelectorAll('#xmind-outline .xmind-row')];
    const a = rows.findIndex((row) => row.dataset.id === fromId);
    const b = rows.findIndex((row) => row.dataset.id === toId);
    if (a < 0 || b < 0) return [toId];
    const [start, end] = a <= b ? [a, b] : [b, a];
    return rows.slice(start, end + 1).map((row) => row.dataset.id);
  }

  function bindOutline(outline) {
    if (!outline || outline.dataset.csMultiBound === '1') return;
    outline.dataset.csMultiBound = '1';
    outline.addEventListener('click', (event) => {
      /* ⚠️ 不能一上来就把 textarea 排除掉 ✗ —— 行里的标题就是个 textarea，
         它几乎铺满整行 ✓ → 排除之后 Shift 连选**永远点不到行**（实测：只选中 1 个）✗ */
      if (event.target.closest('input')) return;
      /* 点「自由导图 · N」分组标题 → 选中整组 ✓ */
      const section = event.target.closest('.xmind-outline-section');
      if (section) {
        event.preventDefault();
        event.stopPropagation();
        const ids = [...document.querySelectorAll('#xmind-outline .xmind-row.floating')].map((row) => row.dataset.id);
        if (ids.length) { setSelection(ids, ids[0]); syncEngineSelection(); }
        return;
      }
      const row = event.target.closest('.xmind-row');
      if (!row) return;
      const id = row.dataset.id;
      const additive = event.metaKey || event.ctrlKey;
      const range = event.shiftKey;
      if (!additive && !range) { outlineAnchor = id; return; }   /* 单选交给 app.js 原本的处理 ✓ */
      event.preventDefault();
      event.stopPropagation();
      if (range && outlineAnchor) setSelection(outlineRange(outlineAnchor, id), id);
      else { toggleOne(id); outlineAnchor = id; }
      syncEngineSelection();
    }, true);
  }

  /* ══ 分支线「渐细」（XMind 的「中等 · 线条渐细」）══════════════════════════
     ⚠️ SVG 的 stroke 宽度是**常量** ✗ 没法直接做渐变粗细 ✓
     ⇒ 做法：把引擎画的每条线**采样成多边形**（起点粗、末端细），
        填成实心形状，再把引擎原来的描边藏掉 ✓
     原路径不动（引擎还要用它算布局/命中），我们只在旁边叠一层 ✓ */
  let taperRaf = 0;

  function taperLines() {
    const engine = engineEl();
    if (!engine || !XMIND_MAP || XMIND_VIEW !== 'edit') return;
    const container = engine.querySelector('.smm-line-container');
    if (!container) return;
    /* 只在「XMind 极简」主题下开（别的主题保持原来的等宽线） */
    const on = (document.getElementById('xmind-root')?.dataset.xmindTheme || '') === 'zen';
    let layer = container.querySelector('#cs-taper-layer');
    if (!on) {
      if (layer) layer.remove();
      engine.classList.remove('cs-taper-on');
      return;
    }
    engine.classList.add('cs-taper-on');
    if (!layer) {
      layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      layer.id = 'cs-taper-layer';
      container.appendChild(layer);
    }
    layer.replaceChildren();
    const paths = [...container.querySelectorAll(':scope > path')];
    /* ★ 最终做法：**同一段贝塞尔曲线 + 不同线宽 + dash 切片** ✓
       · 之前的"切成小折线"在高倍放大下会露出**多边形棱角**（曲线变折线）✗
       · 这里每条切片都是**原曲线本身**，只靠 stroke-dasharray 截取其中一段 ✓
         → 曲线永远光滑，宽度逐段递减 ✓ */
    const SEGMENTS = 16;
    paths.forEach((path) => {
      let len = 0;
      try { len = path.getTotalLength(); } catch (_) { return; }
      if (!len || len < 10) return;
      const d = path.getAttribute('d');
      if (!d) return;
      const color = path.getAttribute('stroke') || '#8fa6c9';
      const opacity = path.getAttribute('stroke-opacity') || '1';
      const w0 = 3.0;
      const w1 = 1.2;
      const slice = len / SEGMENTS;
      for (let i = 0; i < SEGMENTS; i += 1) {
        const t = (i + 0.5) / SEGMENTS;
        const width = w0 + (w1 - w0) * t;
        const seg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        seg.setAttribute('d', d);
        seg.setAttribute('fill', 'none');
        seg.setAttribute('stroke', color);
        seg.setAttribute('stroke-width', width.toFixed(2));
        seg.setAttribute('stroke-opacity', opacity);
        seg.setAttribute('stroke-linecap', 'butt');
        /* 只显示 [i*slice, (i+1)*slice] 这一段；多给 0.5px 防止接缝发丝 */
        seg.setAttribute('stroke-dasharray', (slice + 0.5).toFixed(2) + ' ' + (len + 2).toFixed(2));
        seg.setAttribute('stroke-dashoffset', (-(i * slice)).toFixed(2));
        layer.appendChild(seg);
      }
    });
  }

  function scheduleTaper() {
    if (taperRaf) return;
    taperRaf = requestAnimationFrame(() => {
      taperRaf = 0;
      taperLines();
    });
  }

  /* ══ 工具栏的「可用/不可用」状态 ═════════════════════════════════════════
     用户：「有些需要选中才能用的，可以通过这种淡化显示，不可以用，需要选中，就高亮可以用」✓
     —— 和 XMind 一样：没选中就灰掉，选中了就亮起来 ✓ */
  /* ⚠️ 选中状态在一次操作里会**变好几次**（引擎的 node_active 会先清空再设回来）✗
     直接同步算会把中间态留在按钮上 → 去抖 40ms，只认最终态 ✓ */
  let toolbarTimer = 0;
  function scheduleToolbarState() {
    clearTimeout(toolbarTimer);
    toolbarTimer = setTimeout(updateToolbarState, 40);
  }

  function updateToolbarState() {
    const edit = typeof XMIND_VIEW !== 'undefined' && XMIND_VIEW === 'edit' && !!XMIND_MAP;
    const ids = [...multi()];
    const has = edit && ids.length > 0;
    const rootId = String(xmindRootTopic()?.id || '');
    /* ⚠️ 别用 xmindSmmNode ✗（它内部要递归整棵树，节点一多就爆栈）→ 用数据模型判断 ✓ */
    const treeCount = ids.filter((id) => { const hit = xmindFind(id); return !!hit && !hit.isDetached; }).length;
    const set = (id, ok) => {
      const el = document.getElementById(id);
      if (el) el.disabled = !ok;
    };
    set('xmind-add-sibling', has);
    /* 子主题没选中也能用 ✓（会挂到中心主题上，xmindAddChild 里有兜底） */
    set('xmind-add-child', edit);
    set('xmind-delete', has && !(ids.length === 1 && ids[0] === rootId));
    set('xmind-summary', has && treeCount >= 2);
    set('xmind-outer-frame', has);
    set('xmind-marker', has);
    set('xmind-select-branch', has);
    set('xmind-select-siblings', has);
    /* 联系还没做（引擎不渲染关联线）→ 一直灰着，别给假希望 ✓ */
    set('xmind-assoc-line', false);
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

  /* ══ 分组框 / 边界（XMind 的 Boundary）═══════════════════════════════════
     用户：「这选中分组，不应该框框还有可以写对应文字吗那种设计」✓

     引擎其实有 OuterFrame 插件（`ADD_OUTER_FRAME`）：
     把**选中的连续同级主题**框起来，框上带一行可写的标题 ✓ —— 正是 XMind 的边界 ✓
     ⚠️ 它只能框**树节点**（要连续的兄弟），自由导图的浮动主题没有引擎节点 ✗
     ⚠️ 数据是**挂在每个被框住的节点上**（`outerFrame: {text, groupId, …}`）✓
        → 所以改文字要按 groupId 一起改 ✓，删也是 ✓ */
  function frameColor() {
    try {
      const value = getComputedStyle(document.getElementById('xmind-preview') || document.body).getPropertyValue('--xm-accent');
      if (value && value.trim()) return value.trim();
    } catch (_) {}
    return '#78a9ff';
  }

  /* 选中集里所有「能加框」的主题 → 按父级分组，返回 {container, from, to} 列表 */
  function frameRanges(ids) {
    const byParent = new Map();
    (ids || []).forEach((id) => {
      const hit = xmindFind(id);
      if (!hit || !hit.container || hit.isDetached) return;
      const key = hit.parent ? String(hit.parent.id) : '__root__';
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(hit);
    });
    const ranges = [];
    byParent.forEach((hits) => {
      const container = hits[0].container;
      const indexes = hits.map((hit) => container.indexOf(hit.topic)).filter((index) => index >= 0);
      if (!indexes.length) return;
      ranges.push({ container, from: Math.min(...indexes), to: Math.max(...indexes) });
    });
    return ranges;
  }

  function freeRootsOf(ids) {
    const list = ids || [];
    return (xmindDetached() || []).filter((root) => collectSubtree(root, []).some((id) => list.includes(id)));
  }

  function currentFrameGroup(ids) {
    for (const id of ids) {
      const hit = xmindFind(id);
      if (hit?.topic?.outerFrame?.groupId) return hit.topic.outerFrame.groupId;
    }
    for (const root of freeRootsOf(ids)) {
      if (root.outerFrame?.groupId) return root.outerFrame.groupId;
    }
    return null;
  }

  /* ⚠️ 分组框有两个位置：树上的（挂在被框的兄弟节点上）+ 自由导图的（挂在组根上）✗
     → 遍历必须两边都走 ✓ */
  function eachTopic(fn) {
    (function walk(topic) {
      if (!topic) return;
      fn(topic);
      (xmindChildren(topic) || []).forEach(walk);
    })(xmindRootTopic());
    (xmindDetached() || []).forEach((root) => {
      (function walk(topic) {
        if (!topic) return;
        fn(topic);
        (xmindChildren(topic) || []).forEach(walk);
      })(root);
    });
  }

  function setFrameText(groupId, text) {
    let changed = 0;
    eachTopic((topic) => {
      if (topic.outerFrame && topic.outerFrame.groupId === groupId) {
        topic.outerFrame = { ...topic.outerFrame, text };
        changed += 1;
      }
    });
    return changed;
  }

  function removeFrameGroup(groupId) {
    let changed = 0;
    eachTopic((topic) => {
      if (topic.outerFrame && topic.outerFrame.groupId === groupId) {
        delete topic.outerFrame;
        changed += 1;
      }
    });
    return changed;
  }

  let frameBusyAt = 0;

  async function addGroupFrame(ids) {
    /* ⚠️ 防重入：连点两下会建出**两个组**（实测：一个框变成两个，删一个还剩一个）✗ */
    if (Date.now() - frameBusyAt < 700) return;
    frameBusyAt = Date.now();
    const list = ids && ids.length ? ids : [...multi()];
    const ranges = frameRanges(list);
    const freeRoots = freeRootsOf(list);
    if (!ranges.length && !freeRoots.length) {
      if (typeof setDrawStatus === 'function') setDrawStatus('先选中要分组的主题（同级兄弟，或自由导图里的主题）', 'warn');
      return;
    }
    const text = await askText('分组框标题', '分组', false);
    if (text === null) return;
    const color = frameColor();
    const groupId = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const frame = {
      text: String(text || '').trim(),
      groupId,
      radius: 10,
      strokeWidth: 2,
      strokeColor: color,
      strokeDasharray: '6,4',
      fill: 'color-mix(in srgb, ' + color + ' 8%, transparent)',
    };
    ranges.forEach(({ container, from, to }) => {
      for (let index = from; index <= to; index += 1) {
        const topic = container[index];
        if (topic) topic.outerFrame = { ...frame };
      }
    });
    /* ⚠️ 自由导图：框挂在**选中的每一个**上 ✗ 不能挂组根 ✓
       挂组根 = 整组被框住 —— 用户只选了两个节点却全被框了（实测反馈）✗ */
    let freeCount = 0;
    list.forEach((id) => {
      const hit = xmindFind(id);
      if (!hit || !hit.isDetached) return;
      hit.topic.outerFrame = { ...frame, radius: 12 };
      freeCount += 1;
    });
    if (!ranges.length && !freeCount) {
      if (typeof setDrawStatus === 'function') setDrawStatus('先选中要分组的主题', 'warn');
      return;
    }
    xmindChanged();
    if (typeof setDrawStatus === 'function') setDrawStatus('已加分组框：双击框上的标题可以改名', 'ok');
  }

  async function editGroupFrame(ids) {
    const groupId = currentFrameGroup(ids && ids.length ? ids : [...multi()]);
    if (!groupId) { addGroupFrame(ids); return; }
    let current = '';
    (function walk(topic) {
      if (current || !topic) return;
      if (topic.outerFrame && topic.outerFrame.groupId === groupId) current = topic.outerFrame.text || '';
      (xmindChildren(topic) || []).forEach(walk);
    })(xmindRootTopic());
    const text = await askText('分组框标题', current, false);
    if (text === null) return;
    setFrameText(groupId, String(text || '').trim());
    xmindChanged();
  }

  function deleteGroupFrame(ids) {
    const list = ids && ids.length ? ids : [...multi()];
    /* 选中主题上可能挂着不止一个 groupId（历史遗留 / 重复添加）→ 全删 ✓ */
    const groupIds = new Set();
    list.forEach((id) => {
      const hit = xmindFind(id);
      if (hit?.topic?.outerFrame?.groupId) groupIds.add(hit.topic.outerFrame.groupId);
      if (hit?.topic?.summary?.groupId) groupIds.add(hit.topic.summary.groupId);
    });
    for (const root of freeRootsOf(list)) {
      if (root.outerFrame?.groupId) groupIds.add(root.outerFrame.groupId);
    }
    if (!groupIds.size) return false;
    groupIds.forEach((groupId) => removeFrameGroup(groupId));
    xmindChanged();
    refreshOverlay();
    if (typeof setDrawStatus === 'function') setDrawStatus('已删除分组框', 'ok');
    return true;
  }

  /* ══ 概要（Summary）：选中一组同级主题 → 右侧括号 + 概要文字 ═══════════════
     ⚠️ 引擎的 ADD_GENERALIZATION 在这个构建里**不生效**（实测：activeNodeList 有 2 个，
        命令执行了但既没有节点也没有 DOM）✗
     ⇒ 自己画：复用分组框那套数据（挂在成员上 + groupId），只是渲染成**括号** ✓ */
  const SUMMARY_PRESETS = [
    { label: '⭐ 重点', value: 'star' },
    { label: '⚑ 待办', value: 'flag' },
    { label: '✅ 完成', value: 'done' },
    { label: '❓ 疑问', value: 'question' },
    { label: '🔥 紧急', value: 'urgent' },
    { label: '清除标记', value: '' },
  ];

  async function addSummary() {
    const ids = [...multi()];
    if (!ids.length) { if (typeof setDrawStatus === 'function') setDrawStatus('先选中要加概要的主题', 'warn'); return; }
    const ranges = frameRanges(ids);
    if (!ranges.length) { if (typeof setDrawStatus === 'function') setDrawStatus('概要只能加在树上的同级主题上', 'warn'); return; }
    const text = await askText('概要文字', '概要', false);
    if (text === null) return;
    const color = frameColor();
    const groupId = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    ranges.forEach(({ container, from, to }) => {
      for (let index = from; index <= to; index += 1) {
        const topic = container[index];
        if (topic) {
          /* ⚠️ 用独立字段 `summary` ✗ 不能复用 outerFrame ✓
             —— outerFrame 会被引擎画成一个虚线方框，概要要的是**右侧括号** ✓ */
          topic.summary = { text: String(text || '').trim(), groupId, color };
        }
      }
    });
    xmindChanged();
  }

  /* 概要括号：把「同一 groupId 的成员」右侧连起来，画一个 ] 形括号 + 文字 ✓ */
  /* 浮层统一刷新：选中框 / 分组框 / 标记 / 概要括号 ✓ */
  function refreshOverlay() {
    updateGroupBox();
    renderFreeFrames();
    renderMarkers();
    renderSummaryBrackets();
  }

  function renderSummaryBrackets() {
    const overlay = document.getElementById('xmind-float-overlay');
    const engine = engineEl();
    if (!overlay || !engine) return;
    overlay.querySelectorAll('.cs-summary').forEach((el) => el.remove());
    const er = engine.getBoundingClientRect();
    const groups = new Map();
    const collect = (topic) => {
      if (!topic) return;
      const info = topic.summary;
      if (info && info.groupId) {
        if (!groups.has(info.groupId)) groups.set(info.groupId, { info, ids: [] });
        groups.get(info.groupId).ids.push(String(topic.id));
      }
      (xmindChildren(topic) || []).forEach(collect);
    };
    collect(xmindRootTopic());
    (xmindDetached() || []).forEach(collect);
    groups.forEach(({ info, ids }) => {
      const rects = ids.map((id) => document.querySelector('.xmind-floating-node[data-topic-id="' + CSS.escape(id) + '"]') || xmindSmmNode(id)?.group?.node)
        .filter(Boolean).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      if (!rects.length) return;
      const top = Math.min(...rects.map((r) => r.top)) - er.top;
      const bottom = Math.max(...rects.map((r) => r.bottom)) - er.top;
      const right = Math.max(...rects.map((r) => r.right)) - er.left;
      const bracket = document.createElement('div');
      bracket.className = 'cs-summary';
      bracket.style.left = (right + 14) + 'px';
      bracket.style.top = top + 'px';
      bracket.style.height = Math.max(18, bottom - top) + 'px';
      bracket.style.borderColor = info.color || '#78a9ff';
      const label = document.createElement('span');
      label.className = 'cs-summary-label';
      label.textContent = info.text || '概要';
      label.style.color = info.color || '#78a9ff';
      label.title = '双击改概要文字';
      label.ondblclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const next = await askText('概要文字', info.text || '', false);
        if (next === null) return;
        let changed = 0;
        eachTopic((topic) => {
          if (topic.summary && topic.summary.groupId === info.groupId) { topic.summary = { ...topic.summary, text: next.trim() }; changed += 1; }
        });
        if (changed) xmindChanged();
      };
      bracket.appendChild(label);
      overlay.appendChild(bracket);
    });
  }

  /* ══ 标记（Marker）：我们自己画一个小徽章 ✓
     ⚠️ 引擎的 SET_NODE_ICON 能存数据但**渲染不出来**（这个构建没有图标清单）✗ */
  const MARKER_STYLE = {
    star: { glyph: '★', color: '#f5b93a' },
    flag: { glyph: '⚑', color: '#f2705c' },
    done: { glyph: '✓', color: '#3fa46a' },
    question: { glyph: '?', color: '#5b93ff' },
    urgent: { glyph: '!', color: '#e0574f' },
  };

  function renderMarkers() {
    const overlay = document.getElementById('xmind-float-overlay');
    const engine = engineEl();
    if (!overlay || !engine) return;
    overlay.querySelectorAll('.cs-node-marker').forEach((el) => el.remove());
    const er = engine.getBoundingClientRect();
    const place = (topic) => {
      const marker = topic.marker;
      if (!marker || !MARKER_STYLE[marker]) return;
      const el = document.querySelector('.xmind-floating-node[data-topic-id="' + CSS.escape(String(topic.id)) + '"]')
        || xmindSmmNode(topic.id)?.group?.node;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width) return;
      const style = MARKER_STYLE[marker];
      const chip = document.createElement('span');
      chip.className = 'cs-node-marker';
      chip.textContent = style.glyph;
      chip.style.left = (rect.right - er.left - 6) + 'px';
      chip.style.top = (rect.top - er.top - 8) + 'px';
      chip.style.color = style.color;
      overlay.appendChild(chip);
    };
    (function walk(topic) {
      if (!topic) return;
      place(topic);
      (xmindChildren(topic) || []).forEach(walk);
    })(xmindRootTopic());
    (xmindDetached() || []).forEach((root) => {
      (function walk(topic) {
        if (!topic) return;
        place(topic);
        (xmindChildren(topic) || []).forEach(walk);
      })(root);
    });
  }

  async function setMarker(marker) {
    const ids = [...multi()];
    if (!ids.length) return;
    ids.forEach((id) => {
      const hit = xmindFind(id);
      if (!hit) return;
      if (marker) hit.topic.marker = marker;
      else delete hit.topic.marker;
    });
    xmindChanged();
    renderMarkers();
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
      { type: 'separator' },
      { label: '加分组框（外框）…', run: () => addGroupFrame([...multi()]) },
      { label: '加概要（右侧括号）…', run: () => addSummary() },
      { label: '标记 ▸', hint: '★ ⚑ ✓ ? !', run: () => markerMenu(event, id) },
      { label: '改分组框标题…', disabled: !currentFrameGroup([...multi()]), run: () => editGroupFrame([...multi()]) },
      { label: '删除分组框', disabled: !currentFrameGroup([...multi()]), run: () => deleteGroupFrame([...multi()]) },
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

  function markerMenu(event, id) {
    const hit = xmindFind(id);
    const current = hit?.topic?.marker || '';
    if (typeof showContextMenu !== 'function') return;
    showContextMenu(event, SUMMARY_PRESETS.map((preset) => ({
      label: preset.label + (preset.value === current ? '  ✓' : ''),
      run: () => setMarker(preset.value),
    })));
  }

  /* 分组框自己的菜单（右键点框的边）✓ */
  function openFrameMenu(event, groupId) {
    if (typeof showContextMenu !== 'function') return;
    showContextMenu(event, [
      { label: '改分组框标题…', run: () => editGroupFrame([...multi()]) },
      { label: '选中组内主题', run: () => {
        const members = membersOfGroup(groupId);
        if (members.length) { setSelection(members.map((m) => String(m.topic.id)), String(members[0].topic.id)); syncEngineSelection(); }
      } },
      { type: 'separator' },
      { label: '删除分组框', danger: true, run: () => deleteGroupFrame([...multi()]) },
    ]);
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

    /* ⚠️ 浮层是 app.js 第一次渲染自由主题时才创建的 ✗ → 这里先建好，才能挂 MutationObserver ✓ */
    let floatOverlay = document.getElementById('xmind-float-overlay');
    if (!floatOverlay && engine.parentElement) {
      floatOverlay = document.createElement('div');
      floatOverlay.id = 'xmind-float-overlay';
      engine.parentElement.appendChild(floatOverlay);
    }
    bindFrameDrag(floatOverlay, engine);
    if (floatOverlay) {
      try {
        new MutationObserver(() => {
          if (overlayBusy) return;
          requestAnimationFrame(() => { renderFreeFrames(); renderMarkers(); renderSummaryBrackets(); });
        }).observe(floatOverlay, { childList: true });
      } catch (_) {}
    }

    /* 一次性迁移：上一版把分组框挂在**自由导图组根**上（导致"选两个框全组"）✗
       → 这里直接清掉，别让它留在文件里 ✓ */
    setTimeout(() => {
      let cleaned = 0;
      (xmindDetached() || []).forEach((root) => {
        if (root.outerFrame) { delete root.outerFrame; cleaned += 1; }
      });
      if (cleaned) xmindChanged();
    }, 600);

    bindOutline(document.getElementById('xmind-outline'));
    setTimeout(() => { updateToolbarState(); scheduleTaper(); }, 0);
    map.on('scale', () => { refreshOverlay(); updateToolbarState(); scheduleTaper(); });
    map.on('translate', () => { refreshOverlay(); updateToolbarState(); scheduleTaper(); });
    /* ★ 概要/标记要跟着节点走 ✓ 拖节点时引擎只发 node_dragging，不会动浮层 ✗ */
    map.on('node_dragging', () => { requestAnimationFrame(() => { renderSummaryBrackets(); renderMarkers(); }); });
    map.on('node_dragend', () => { refreshOverlay(); scheduleTaper(); });
    map.on('node_tree_render_end', () => { scheduleTaper(); requestAnimationFrame(renderSummaryBrackets); });
    map.on('data_change', () => scheduleTaper());

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
      /* 右键点分组框的边 → 弹「分组框菜单」（改标题 / 删除）✓
         ⚠️ 必须放在 startPan 之前 ✗ 否则右键被当成平移吃掉（实测：框删不掉）✓ */
      const frameEdge = event.button === 2 ? event.target.closest('.cs-free-frame') : null;
      const frameGroupId = frameEdge ? (frameEdge.dataset.groupId || frameEdge.querySelector('.cs-free-frame-edge')?.dataset.groupId) : null;
      if (frameEdge && frameGroupId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const members = membersOfGroup(frameGroupId);
        if (members.length) {
          setSelection(members.map((m) => String(m.topic.id)), String(members[0].topic.id));
          syncEngineSelection();
        }
        openFrameMenu(event, frameGroupId);
        return;
      }
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

      /* 分组框的四条边自己处理拖动 ✓ 别当成空白去框选 */
      if (event.target.closest('.cs-free-frame-edge')) return;

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

      /* ⚠️ 带修饰键的快捷键必须放在 `hit.isDetached` **之前** ✗✗
         那个分支处理完就 return ✓ —— 选中自由主题时，Ctrl+Z / Ctrl+A / 缩放全都走不到 ✓（实测） */
      if (withMod && key === 'a') { event.preventDefault(); event.stopImmediatePropagation(); selectAllTopics(); return; }
      if (withMod && key === 'z') { event.preventDefault(); event.stopImmediatePropagation(); xmindUndo(event.shiftKey ? 1 : -1); return; }
      if (withMod && (key === '+' || key === '=' || key === '-' || key === '0')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (key === '+' || key === '=') xmindZoom(0.12);
        else if (key === '-') xmindZoom(-0.12);
        else xmindResetZoom();
        return;
      }

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
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); clearSelection(); return; }
      if (event.key === 'F2' && XMIND_MAP.renderer?.activeNodeList?.[0]) {
        event.preventDefault();
        event.stopImmediatePropagation();
        xmindBeginEngineEdit(XMIND_MAP.renderer.activeNodeList[0]);
      }
    }, true);
  }

  /* 选「XMind 极简」时顺手把连线风格切成**曲线** ✓
     参考图（用户给的 XMind 截图）就是平滑曲线，折线版永远不像 ✓
     ⚠️ 只是**切一次**，用户之后在「外观 → 连线风格」里改回折线不会再被覆盖 ✓ */
  (function wrapTheme() {
    const original = typeof window.setXmindTheme === 'function' ? window.setXmindTheme : null;
    if (!original) return;
    window.setXmindTheme = function (id) {
      const result = original.apply(this, arguments);
      if (id === 'zen') {
        const select = document.getElementById('xmind-line-style');
        if (select && select.value !== 'curve') {
          select.value = 'curve';
          select.dispatchEvent(new Event('change'));
        }
      }
      return result;
    };
  })();

  /* app.js 与其它模块的入口 */
  window.__csXmindInteraction = { bind, setSelection, paintSelection, deleteSelection };
  window.__csXmindSel = (id) => multi().has(String(id || ''));
  window.__csXmindMulti = () => [...multi()];
  window.__csXmindDeleteMulti = () => deleteSelection();
  window.__csXmindClearSelection = () => clearSelection();
  window.__csXmindMerging = () => Date.now() < mergeUntil;
  window.__csXmindToolbarState = () => scheduleToolbarState();
  window.__csXmindTaper = () => scheduleTaper();
  window.__csXmindSelectBranch = (id) => selectBranch(id || XMIND_SELECTED);
  window.__csXmindSelectSiblings = (id) => selectSiblings(id || XMIND_SELECTED);
  window.__csXmindSelectAll = () => selectAllTopics();
  window.__csXmindAddFrame = () => addGroupFrame([...multi()]);
  window.__csXmindAddSummary = () => addSummary();
  window.__csXmindSetMarker = (m) => setMarker(m);
  window.__csXmindMarkerMenu = (e, id) => markerMenu(e, id);
  window.__csXmindFrameMenu = (e, gid) => openFrameMenu(e, gid);
  window.__csXmindEditFrame = () => editGroupFrame([...multi()]);
  window.__csXmindMenu = (event, id) => openNodeMenu(event, id);
  window.__csXmindRepaintSelection = () => paintSelection();
})();
