(function () {
  'use strict';

  // Demo mode (?demo=...) is used only by mockups/mockup.html: it reads sample
  // tasks from a separate storage key and never saves the theme, so a mock-up
  // can never touch your real tasks.
  const DEMO = /[?&]demo/.test(location.search);
  const STORAGE_KEY = DEMO ? 'todo.demo.tasks' : 'todo.tasks.v1';
  const THEME_KEY = 'todo.theme';
  const SOON_DAYS = 2;
  const CATEGORIES = [
    { id: 'work', name: 'Work' },
    { id: 'personal', name: 'Personal' },
    { id: 'others', name: 'Others' }
  ];

  let tasks = load();
  let filter = 'all';      // status filter
  let category = 'all';    // all | work | personal | others
  let editingId = null;
  let dragId = null;       // id of the task currently being dragged
  let draft = null;        // unsaved edit-row values, kept across re-renders
  let focusKey = null;     // which control to focus after the next render
  let todayKey = dayKey(); // used to re-render only when the date changes

  function dayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }

  const form = document.getElementById('add-form');
  const textInput = document.getElementById('task-text');
  const dateInput = document.getElementById('task-date');
  const catInput = document.getElementById('task-category');
  const catFilter = document.getElementById('cat-filter');
  const listEl = document.getElementById('task-list');
  const emptyEl = document.getElementById('empty');
  const filterBtns = document.querySelectorAll('.filters button');
  const themeBtn = document.getElementById('theme-toggle');

  // ---------- persistence ----------
  function isKnownCat(id) {
    return CATEGORIES.some(c => c.id === id);
  }
  function catName(id) {
    const c = CATEGORIES.find(c => c.id === id);
    return c ? c.name : 'Others';
  }
  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  // Rebuild every saved entry as a clean object, so bad or legacy data can
  // never break rendering. The array order is the user's manual order.
  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) throw new Error('not an array');
      const seen = new Set();
      const out = [];
      data.forEach(t => {
        if (!t || typeof t !== 'object') return;
        const text = t.text == null ? '' : String(t.text).trim();
        if (!text) return;
        let id = typeof t.id === 'string' && t.id ? t.id : newId();
        while (seen.has(id)) id = newId();
        seen.add(id);
        // Older tasks may have no category, or a custom one that no longer exists.
        const category = t.category == null ? 'personal'
          : isKnownCat(t.category) ? t.category : 'others';
        out.push({
          id: id,
          text: text,
          due: typeof t.due === 'string' && /^\d{4}-\d\d-\d\d$/.test(t.due) ? t.due : '',
          category: category,
          done: !!t.done,
          createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now()
        });
      });
      return out;
    } catch (e) {
      // Unreadable data: keep a copy so the next save doesn't destroy it.
      try { if (raw) localStorage.setItem(STORAGE_KEY + '.backup', raw); } catch (e2) { /* ignore */ }
      return [];
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) { /* storage unavailable; keep working in memory */ }
  }

  // ---------- dates ----------
  // Parse "YYYY-MM-DD" as a LOCAL date, avoiding UTC shifts.
  function parseDue(task) {
    if (!task.due) return null;
    const [y, m, d] = task.due.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
  function daysFromToday(task) {
    const due = parseDue(task);
    const diff = startOfDay(due) - startOfDay(new Date());
    return Math.round(diff / 86400000);
  }
  function isOverdue(task) {
    return !task.done && !!task.due && daysFromToday(task) < 0;
  }
  function isSoon(task) {
    if (task.done || !task.due || isOverdue(task)) return false;
    return daysFromToday(task) <= SOON_DAYS;
  }
  function dueLabel(task) {
    if (!task.due) return 'No deadline';
    const days = daysFromToday(task);
    let rel;
    if (days === 0) rel = 'Due today';
    else if (days === 1) rel = 'Due tomorrow';
    else if (days === -1) rel = '1 day overdue';
    else if (days < 0) rel = Math.abs(days) + ' days overdue';
    else rel = 'Due in ' + days + ' days';
    const nice = parseDue(task).toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
    return rel + ' · ' + nice;
  }

  // ---------- actions ----------
  function addTask(text, due, cat) {
    tasks.push({
      id: newId(),
      text: text,
      due: due || '',
      category: cat,
      done: false,
      createdAt: Date.now()
    });
    commit();
  }
  // Move task `id` before/after task `targetId` in the master list.
  function move(id, targetId, after) {
    if (id === targetId) return;
    const from = tasks.findIndex(t => t.id === id);
    if (from < 0) return;
    const [item] = tasks.splice(from, 1);
    let to = tasks.findIndex(t => t.id === targetId);
    if (to < 0) { tasks.splice(from, 0, item); return; }
    if (after) to++;
    tasks.splice(to, 0, item);
    commit();
  }
  function toggle(id) {
    const t = tasks.find(t => t.id === id);
    if (t) { t.done = !t.done; commit(); }
  }
  function remove(id) {
    tasks = tasks.filter(t => t.id !== id);
    commit();
  }
  // Returns false (and keeps editing) when the text is empty.
  function update(id, fields) {
    if (!fields.text) return false;
    const t = tasks.find(t => t.id === id);
    if (t) Object.assign(t, fields);
    stopEdit(id);
    commit();
    return true;
  }
  // Move a task one step up/down among the tasks currently shown.
  function moveBy(id, dir) {
    const list = visible();
    const i = list.findIndex(t => t.id === id);
    const n = list[i + dir];
    if (i < 0 || !n) return;
    focusKey = (dir < 0 ? 'up:' : 'down:') + id;
    move(id, n.id, dir > 0);
  }
  function startEdit(id) {
    if (editingId && editingId !== id) { focusKey = 'text:' + editingId; render(); return; }
    editingId = id;
    focusKey = 'text:' + id;
    render();
  }
  function stopEdit(id) {
    editingId = null;
    draft = null;
    focusKey = 'edit:' + id;
  }
  function commit() { save(); render(); }

  // ---------- filtering ----------
  function inCategory(t) {
    return category === 'all' || t.category === category;
  }
  function visible() {
    const pool = tasks.filter(inCategory);
    switch (filter) {
      case 'active': return pool.filter(t => !t.done);
      case 'completed': return pool.filter(t => t.done);
      case 'overdue': return pool.filter(isOverdue);
      default: return pool;
    }
  }

  // ---------- rendering ----------
  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    (children || []).forEach(c => node.appendChild(c));
    return node;
  }
  function select(options, value) {
    const s = el('select');
    options.forEach(([v, label]) => s.appendChild(el('option', { value: v, textContent: label })));
    s.value = value;
    return s;
  }

  function renderEditRow(t) {
    const li = el('li', { className: 'task' });
    // Restore unsaved input if the list was re-rendered mid-edit.
    const d = draft && draft.id === t.id ? draft : { text: t.text, due: t.due, category: t.category };
    const text = el('input', { type: 'text', value: d.text, maxLength: 200 });
    const date = el('input', { type: 'date', value: d.due });
    const cat = select(CATEGORIES.map(c => [c.id, c.name]), d.category);
    text.setAttribute('aria-label', 'Task text');
    date.setAttribute('aria-label', 'Deadline date');
    cat.setAttribute('aria-label', 'Category');
    text.dataset.focus = 'text:' + t.id;
    const saveBtn = el('button', { type: 'button', textContent: 'Save' });
    const cancel = el('button', { type: 'button', textContent: 'Cancel' });
    const remember = () => {
      draft = { id: t.id, text: text.value, due: date.value, category: cat.value };
    };
    [text, date, cat].forEach(n => n.addEventListener('input', remember));
    cat.addEventListener('change', remember);
    const doSave = () => {
      const ok = update(t.id, { text: text.value.trim(), due: date.value, category: cat.value });
      if (!ok) { text.setAttribute('aria-invalid', 'true'); text.focus(); }
    };
    const doCancel = () => { stopEdit(t.id); render(); };
    saveBtn.addEventListener('click', doSave);
    cancel.addEventListener('click', doCancel);
    text.addEventListener('keydown', e => {
      if (e.key === 'Enter') doSave();
      if (e.key === 'Escape') doCancel();
    });
    li.appendChild(el('div', { className: 'body' }, [
      el('div', { className: 'edit-fields' }, [text, date, cat])
    ]));
    li.appendChild(el('div', { className: 'actions' }, [saveBtn, cancel]));
    return li;
  }

  // Static, trusted SVG markup (no user data), so innerHTML is safe here.
  const SVG_ATTRS = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const ICON_PENCIL = '<svg ' + SVG_ATTRS + '><path d="M12 20h9"/>' +
    '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const ICON_TRASH = '<svg ' + SVG_ATTRS + '><path d="M3 6h18"/>' +
    '<path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>' +
    '<path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  const ICON_SUN = '<svg ' + SVG_ATTRS + '><circle cx="12" cy="12" r="4"/>' +
    '<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  const ICON_UP = '<svg ' + SVG_ATTRS + '><path d="M18 15l-6-6-6 6"/></svg>';
  const ICON_DOWN = '<svg ' + SVG_ATTRS + '><path d="M6 9l6 6 6-6"/></svg>';
  const ICON_MOON ='<svg ' + SVG_ATTRS + '><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
  function iconButton(label, svg) {
    const b = el('button', { type: 'button', className: 'icon-btn', title: label });
    b.setAttribute('aria-label', label);
    b.innerHTML = svg;
    return b;
  }

  function badge(catId) {
    return el('span', { className: 'badge cat-' + catId, textContent: catName(catId) });
  }

  function renderTask(t, pos) {
    if (t.id === editingId) return renderEditRow(t);

    const cls = ['task'];
    if (t.done) cls.push('done');
    else if (isOverdue(t)) cls.push('overdue');
    else if (isSoon(t)) cls.push('soon');
    const li = el('li', { className: cls.join(' ') });

    const cb = el('input', { type: 'checkbox', checked: t.done });
    cb.setAttribute('aria-label', 'Mark "' + t.text + '" as done');
    cb.addEventListener('change', () => { focusKey = 'cb:' + t.id; toggle(t.id); });

    const body = el('div', { className: 'body' }, [
      el('div', { className: 'text', textContent: t.text }),
      el('div', { className: 'due', textContent: dueLabel(t) }),
      el('div', { className: 'badges' }, [badge(t.category)])
    ]);
    body.addEventListener('dblclick', () => startEdit(t.id));

    const up = iconButton('Move "' + t.text + '" up', ICON_UP);
    const down = iconButton('Move "' + t.text + '" down', ICON_DOWN);
    up.dataset.focus = 'up:' + t.id;
    down.dataset.focus = 'down:' + t.id;
    up.disabled = pos.first;
    down.disabled = pos.last;
    up.addEventListener('click', () => moveBy(t.id, -1));
    down.addEventListener('click', () => moveBy(t.id, 1));
    const edit = iconButton('Edit "' + t.text + '"', ICON_PENCIL);
    edit.dataset.focus = 'edit:' + t.id;
    edit.addEventListener('click', () => startEdit(t.id));
    const del = iconButton('Delete "' + t.text + '"', ICON_TRASH);
    del.addEventListener('click', () => remove(t.id));
    cb.dataset.focus = 'cb:' + t.id;

    li.appendChild(el('span', { className: 'handle', textContent: '⠿', title: 'Drag to reorder' }));
    li.appendChild(cb);
    li.appendChild(body);
    li.appendChild(el('div', { className: 'actions' }, [up, down, edit, del]));
    attachDrag(li, t.id);
    return li;
  }

  // ---------- drag & drop reordering ----------
  function clearIndicators() {
    listEl.querySelectorAll('.drop-before, .drop-after').forEach(n =>
      n.classList.remove('drop-before', 'drop-after'));
  }
  function attachDrag(li, id) {
    li.draggable = true;
    li.addEventListener('dragstart', e => {
      dragId = id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id); // required by Firefox
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => {
      dragId = null;
      li.classList.remove('dragging');
      clearIndicators();
    });
    li.addEventListener('dragover', e => {
      if (!dragId || dragId === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = li.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      clearIndicators();
      li.classList.add(after ? 'drop-after' : 'drop-before');
    });
    li.addEventListener('dragleave', e => {
      if (!li.contains(e.relatedTarget)) li.classList.remove('drop-before', 'drop-after');
    });
    li.addEventListener('drop', e => {
      if (!dragId) return;
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      const moving = dragId;
      dragId = null;
      move(moving, id, after);
    });
  }

  function renderCategoryFilter() {
    const open = c => tasks.filter(t => !t.done && (c === 'all' || t.category === c)).length;
    [...catFilter.options].forEach(o => {
      const name = o.value === 'all' ? 'All' : catName(o.value);
      o.textContent = name + ' (' + open(o.value) + ')';
    });
    catFilter.value = category;
  }

  function render() {
    // Rebuilding the list drops keyboard focus, so remember which control had it.
    const a = document.activeElement;
    if (!focusKey && a && a.dataset && a.dataset.focus && listEl.contains(a)) focusKey = a.dataset.focus;
    listEl.textContent = '';
    const items = visible();
    items.forEach((t, i) => listEl.appendChild(
      renderTask(t, { first: i === 0, last: i === items.length - 1 })));
    emptyEl.hidden = items.length > 0;
    filterBtns.forEach(b => {
      const on = b.dataset.filter === filter;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    renderCategoryFilter();
    if (focusKey) {
      const find = k => listEl.querySelector('[data-focus="' + k + '"]');
      let target = find(focusKey);
      // A move button disables at the end of the list: fall back to its twin.
      if (target && target.disabled) {
        const [role, id] = focusKey.split(':');
        target = find((role === 'up' ? 'down:' : 'up:') + id);
      }
      if (target && !target.disabled) target.focus();
      focusKey = null;
    }
  }

  // ---------- theme ----------
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (!DEMO) {
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
    }
    showThemeIcon();
  }
  // Show the icon of the mode you would switch TO: moon in light, sun in dark.
  function showThemeIcon() {
    const dark = currentTheme() === 'dark';
    themeBtn.innerHTML = dark ? ICON_SUN : ICON_MOON;
    const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    themeBtn.title = label;
    themeBtn.setAttribute('aria-label', label);
  }

  // ---------- events ----------
  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text) return;
    addTask(text, dateInput.value, catInput.value);
    // Keep the chosen category so several tasks can be added in a row.
    const keepCat = catInput.value;
    form.reset();
    catInput.value = keepCat;
    textInput.focus();
  });
  // Changing the view ends any edit in progress (the edited task may be hidden).
  function cancelEditForViewChange() { editingId = null; draft = null; }
  filterBtns.forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    cancelEditForViewChange();
    render();
  }));
  catFilter.addEventListener('change', () => {
    category = catFilter.value;
    cancelEditForViewChange();
    // Preselect the add-form category to match what is being viewed.
    if (category !== 'all') catInput.value = category;
    render();
  });
  themeBtn.addEventListener('click', () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });

  // Deadlines are date-only, so labels and colors change only when the day does.
  function refreshIfNewDay() {
    const k = dayKey();
    if (k !== todayKey) { todayKey = k; render(); }
  }
  setInterval(refreshIfNewDay, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfNewDay(); });

  // Another tab saved: pick up its tasks instead of overwriting them later.
  window.addEventListener('storage', e => {
    if (e.key !== STORAGE_KEY) return;
    tasks = load();
    editingId = null; draft = null;
    render();
  });

  showThemeIcon();
  render();
})();
