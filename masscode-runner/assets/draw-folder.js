/* 绘图文件夹的右键菜单（含重命名 / 删除）
   ⚠️ 为什么单独一个文件：app.js 有「代码行数只准变小」的棘轮 ✓，
      这段逻辑塞进去会顶破上限 ✓（和 cs-icons.js / lib/*.js 同一个理由 ✓）。
   app.js 只留一行调用，把内部函数（showContextMenu / rowOpenItem / openConfirm…）当参数传进来 ✓。 */
(function () {
  const api = (path, body) => fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  }).then((r) => r.json());

  window.__drawFolderMenu = function (event, folder, deps) {
    const dir = folder.dataset.path || '';
    const name = (folder.querySelector('.draw-fname') || {}).textContent || dir.split('/').pop();
    const refresh = () => (deps.renderDrawList ? deps.renderDrawList() : Promise.resolve());

    deps.showContextMenu(event, [
      deps.rowOpenItem(folder),
      { icon: '＋', label: '在此新建绘图', run: () => { window.__DRAW_ND_CUR = dir; deps.openDrawNewDialog('drawing'); } },
      { icon: '▣', label: '在此新建文件夹', run: () => { window.__DRAW_ND_CUR = dir; deps.openDrawNewDialog('folder'); } },
      { icon: '✎', label: '重命名文件夹', run: () => deps.openConfirm({
        title: '重命名文件夹',
        message: '重命名「' + name + '」（只改名字，里面的绘图会一起跟过来）',
        inputValue: name,
        inputPlaceholder: '新的文件夹名',
        okLabel: '重命名',
        onOk: async () => {
          const next = String((document.getElementById('cd-input') || {}).value || '').trim();
          if (!next || next === name) return;
          const r = await api('/api/drawings/folder-rename', { name: dir, newName: next });
          if (!r.ok) return deps.setStatus('err', '重命名失败：' + (r.error || ''));
          await refresh();
          deps.setStatus('ok', '文件夹已重命名：' + next);
        },
      }) },
      { icon: '×', label: '删除文件夹', danger: true, run: () => deps.openConfirm({
        title: '删除文件夹',
        message: '确定删除文件夹「' + name + '」吗？\n里面的绘图会一并删除，不可恢复。',
        requireInput: name,
        onOk: async () => {
          const r = await api('/api/drawings/folder-delete', { name: dir });
          if (!r.ok) return deps.setStatus('err', '删除失败：' + (r.error || ''));
          await refresh();
          deps.setStatus('ok', '文件夹已删除：' + name);
        },
      }) },
    ]);
  };
})();
