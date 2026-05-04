(async function () {
  'use strict';

  /* ── load config ── */
  let config;
  try {
    const res = await fetch('config.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    config = await res.json();
  } catch (err) {
    showFatalError(err);
    return;
  }

  const LEGACY_SCHED_KEY = config.storageKeys.schedule;
  const LEGACY_TITLE_KEY = config.storageKeys.title;
  const THEME_KEY        = config.storageKeys.theme;
  const SECTION_KEY      = config.storageKeys.section;
  const SCHED_PREFIX     = config.storageKeys.schedulePrefix;
  const TITLE_PREFIX     = config.storageKeys.titlePrefix;
  const PRESETS_KEY      = config.storageKeys.presets;
  const DAYS             = config.days;
  const DEFAULT_TITLE    = config.defaultScheduleTitle;
  const DEFAULT_THEME    = config.defaultTheme;
  const DEFAULT_SECTION  = config.defaultSection || (config.sections?.[0]?.id) || 'vocal';
  const THEMES           = config.themes;
  const SECTIONS         = config.sections || [];
  const CATEGORIES       = config.categories;
  const MONTHS           = config.monthsGenitive;

  /* ── one-time migration: legacy keys → vocal section ── */
  migrateLegacy();

  /* ── state ── */
  let currentSection = loadCurrentSection();
  let schedule       = loadSchedule(currentSection);
  let selectedDay    = todayIso();
  let lastTouchedId  = null;
  const modalState   = { editingId: null, day: todayIso() };

  /* ── DOM refs ── */
  const $ = id => document.getElementById(id);

  const themePicker   = $('theme-picker');
  const dayChips      = $('day-chips');
  const form          = $('add-form');
  const timeInput     = $('time');
  const activityInput = $('activity');
  const daysContainer = $('days-container');
  const downloadBtn   = $('download-btn');
  const clearBtn      = $('clear-btn');
  const libraryBtn    = $('library-btn');
  const titleEl       = $('schedule-title');
  const weekRangeEl   = $('schedule-week-range');
  const footerEl      = $('schedule-footer');
  const toastEl       = $('toast');
  const appBody       = $('app-body');

  // Modal refs
  const modalOverlay  = $('modal-overlay');
  const modalForm     = $('modal-form');
  const modalTitle    = $('modal-title');
  const modalDayChips = $('modal-day-chips');
  const modalTime     = $('modal-time');
  const modalActivity = $('modal-activity');
  const modalDeleteBtn= $('modal-delete-btn');
  const modalCancelBtn= $('modal-cancel-btn');
  const modalCloseBtn = $('modal-close-btn');

  // Library modal refs
  const libraryOverlay   = $('library-overlay');
  const libraryCloseBtn  = $('library-close-btn');
  const libraryList      = $('library-list');
  const libraryEmpty     = $('library-empty');
  const presetNameInput  = $('preset-name-input');
  const presetSaveBtn    = $('preset-save-btn');

  // Export preview modal refs
  const exportOverlay    = $('export-overlay');
  const exportCloseBtn   = $('export-close-btn');
  const exportPreviewImg = $('export-preview-img');
  const exportDownloadLink = $('export-download-link');
  const exportShareBtn   = $('export-share-btn');
  let exportObjectURL    = null;
  let exportShareFile    = null;

  // section / datalist host
  const sectionSwitcher = $('section-switcher');
  const datalistsHost   = $('datalists-host');

  /* ── init UI ── */
  buildThemePicker();
  if (sectionSwitcher && SECTIONS.length > 1) buildSectionSwitcher();
  buildDatalists();
  refreshDatalistAttr();
  buildDayChips(dayChips, () => selectedDay, v => { selectedDay = v; });
  buildDayChips(modalDayChips, () => modalState.day, v => { modalState.day = v; refreshChips(modalDayChips, modalState.day); });
  applyTheme(loadTheme());

  /* ── title (per section) ── */
  refreshTitle();
  titleEl.addEventListener('input', () => {
    localStorage.setItem(getTitleKey(currentSection), titleEl.textContent.trim() || sectionDefaultTitle());
  });
  titleEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
  });
  titleEl.addEventListener('blur', () => {
    if (!titleEl.textContent.trim()) titleEl.textContent = sectionDefaultTitle();
  });
  titleEl.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text').slice(0, 200);
    document.execCommand('insertText', false, text);
  });

  /* ══════════════════════════════════════
     HELPERS
  ══════════════════════════════════════ */
  function getSchedKey(s)  { return `${SCHED_PREFIX}${s}`; }
  function getTitleKey(s)  { return `${TITLE_PREFIX}${s}`; }
  function sanitizeItem(x) {
    if (!x || typeof x !== 'object') return null;
    const day = parseInt(x.day, 10);
    if (!Number.isInteger(day) || day < 1 || day > 7) return null;
    const time = typeof x.time === 'string' && /^\d{2}:\d{2}$/.test(x.time) ? x.time : null;
    if (!time) return null;
    const activity = typeof x.activity === 'string' ? x.activity.slice(0, 200) : '';
    if (!activity.trim()) return null;
    const id = typeof x.id === 'string' && x.id.length <= 64 ? x.id : uid();
    return { id, day, time, activity };
  }
  function sanitizeScheduleArray(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const x of arr) {
      const item = sanitizeItem(x);
      if (item) out.push(item);
    }
    return out;
  }
  function loadSchedule(section) {
    try {
      const raw = localStorage.getItem(getSchedKey(section));
      if (!raw) return [];
      return sanitizeScheduleArray(JSON.parse(raw));
    } catch { return []; }
  }
  function save() { localStorage.setItem(getSchedKey(currentSection), JSON.stringify(schedule)); }

  /* ── section helpers ── */
  function loadCurrentSection() {
    const s = localStorage.getItem(SECTION_KEY);
    if (s && SECTIONS.some(x => x.id === s)) return s;
    return DEFAULT_SECTION;
  }
  function getSection(id)        { return SECTIONS.find(s => s.id === id); }
  function sectionDefaultTitle() { return getSection(currentSection)?.defaultTitle || DEFAULT_TITLE; }

  function migrateLegacy() {
    const vocalSchedKey = `${config.storageKeys.schedulePrefix}vocal`;
    if (!localStorage.getItem(vocalSchedKey)) {
      const old = localStorage.getItem(config.storageKeys.schedule);
      if (old) {
        localStorage.setItem(vocalSchedKey, old);
        localStorage.removeItem(config.storageKeys.schedule);
      }
    }
    const vocalTitleKey = `${config.storageKeys.titlePrefix}vocal`;
    if (!localStorage.getItem(vocalTitleKey)) {
      const old = localStorage.getItem(config.storageKeys.title);
      if (old) {
        localStorage.setItem(vocalTitleKey, old);
        localStorage.removeItem(config.storageKeys.title);
      }
    }
  }
  function uid()  { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }
  function todayIso() { const d = new Date().getDay(); return d === 0 ? 7 : d; }

  function loadTheme() {
    const s = localStorage.getItem(THEME_KEY);
    if (s && THEMES.some(t => t.id === s)) return s;
    return DEFAULT_THEME;
  }
  function applyTheme(id) {
    document.documentElement.setAttribute('data-theme', id);
    localStorage.setItem(THEME_KEY, id);
    for (const btn of themePicker.querySelectorAll('.theme-chip')) {
      btn.setAttribute('aria-pressed', btn.dataset.theme === id ? 'true' : 'false');
    }
  }

  function buildThemePicker() {
    themePicker.innerHTML = THEMES
      .map(t => `<button class="theme-chip" type="button" data-theme="${t.id}" aria-pressed="false">${t.icon} ${esc(t.name)}</button>`)
      .join('');
    themePicker.addEventListener('click', e => {
      const btn = e.target.closest('.theme-chip');
      if (btn) applyTheme(btn.dataset.theme);
    });
  }

  /* ── section switcher ── */
  function buildSectionSwitcher() {
    sectionSwitcher.innerHTML = SECTIONS.map(s => `
      <button class="section-tab" type="button" role="tab" data-section="${s.id}" aria-selected="false">
        <span class="tab-icon" aria-hidden="true">${s.icon}</span>
        <span class="tab-name">${esc(s.name)}</span>
      </button>`).join('');
    refreshSectionTabs();
    sectionSwitcher.addEventListener('click', e => {
      const btn = e.target.closest('.section-tab');
      if (!btn) return;
      setSection(btn.dataset.section);
    });
  }
  function refreshSectionTabs() {
    if (!sectionSwitcher) return;
    for (const btn of sectionSwitcher.querySelectorAll('.section-tab')) {
      btn.setAttribute('aria-selected', btn.dataset.section === currentSection ? 'true' : 'false');
    }
  }
  function setSection(id) {
    if (id === currentSection || !getSection(id)) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const apply = () => {
      currentSection = id;
      localStorage.setItem(SECTION_KEY, id);
      schedule = loadSchedule(id);
      refreshSectionTabs();
      refreshTitle();
      refreshDatalistAttr();
      render();
      daysContainer.classList.remove('section-switching');
    };
    if (reduce) { apply(); return; }
    daysContainer.classList.add('section-switching');
    setTimeout(apply, 160);
  }

  /* ── datalists ── */
  function buildDatalists() {
    datalistsHost.innerHTML = SECTIONS.map(s => {
      const opts = (s.subjects || []).map(v => `<option value="${esc(v)}"></option>`).join('');
      return `<datalist id="subjects-${s.id}">${opts}</datalist>`;
    }).join('');
  }
  function refreshDatalistAttr() {
    const subs = getSection(currentSection)?.subjects || [];
    if (subs.length > 0) {
      activityInput.setAttribute('list', `subjects-${currentSection}`);
      modalActivity.setAttribute('list', `subjects-${currentSection}`);
    } else {
      activityInput.removeAttribute('list');
      modalActivity.removeAttribute('list');
    }
  }

  /* ── title ── */
  function refreshTitle() {
    const saved = localStorage.getItem(getTitleKey(currentSection));
    titleEl.textContent = saved && saved.trim() ? saved : sectionDefaultTitle();
  }

  /* ── Day chips builder (reusable) ── */
  function buildDayChips(container, get, set) {
    const today = todayIso();
    container.innerHTML = DAYS
      .map(d => `<button class="day-chip day-${d.id}${d.id === today ? ' is-today' : ''}" type="button" data-day="${d.id}" aria-pressed="false" title="${d.long}">${d.short}</button>`)
      .join('');
    refreshChips(container, get());
    container.addEventListener('click', e => {
      const btn = e.target.closest('.day-chip');
      if (!btn) return;
      const dayId = parseInt(btn.dataset.day, 10);
      set(dayId);
      refreshChips(container, dayId);
    });
  }
  function refreshChips(container, current) {
    for (const btn of container.querySelectorAll('.day-chip')) {
      btn.setAttribute('aria-pressed', parseInt(btn.dataset.day, 10) === current ? 'true' : 'false');
    }
  }

  /* ── week helpers ── */
  function getWeekRange(base = new Date()) {
    const d = new Date(base);
    d.setHours(0, 0, 0, 0);
    const iso = d.getDay() || 7;
    const mon = new Date(d);
    mon.setDate(d.getDate() - (iso - 1));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { monday: mon, sunday: sun };
  }
  function formatWeekRange({ monday, sunday }) {
    if (monday.getMonth() === sunday.getMonth())
      return `${monday.getDate()}–${sunday.getDate()} ${MONTHS[monday.getMonth()]}`;
    return `${monday.getDate()} ${MONTHS[monday.getMonth()]} – ${sunday.getDate()} ${MONTHS[sunday.getMonth()]}`;
  }
  function dateForDay(monday, dayId) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + (dayId - 1));
    return d;
  }
  function shortDate(d) { return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }

  /* ── category emoji ── */
  function detectEmoji(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return '';
    for (const cat of CATEGORIES)
      for (const kw of cat.keywords)
        if (t.includes(kw)) return cat.emoji;
    return '';
  }

  /* ══════════════════════════════════════
     RENDER — weekly timetable
  ══════════════════════════════════════ */
  function render() {
    const { monday, sunday } = getWeekRange();
    const today = todayIso();

    weekRangeEl.textContent = formatWeekRange({ monday, sunday });

    // Collect unique time slots across all schedule items
    const timesSet = new Set(schedule.map(i => i.time));
    const times = [...timesSet].sort();

    if (times.length === 0) {
      daysContainer.innerHTML = `
        <div class="empty-state">
          <strong>📋 Расписание пустое</strong>
          Добавь первый урок через форму выше<br>или начни заполнять таблицу
        </div>`;
      updateFooter();
      return;
    }

    // grid: time → dayId → items[]
    const grid = {};
    for (const t of times) {
      grid[t] = {};
      for (const d of DAYS) grid[t][d.id] = [];
    }
    for (const item of schedule) {
      if (grid[item.time]?.[item.day] !== undefined)
        grid[item.time][item.day].push(item);
    }

    let html = '<table class="schedule-table" role="grid">';

    // colgroup
    html += '<colgroup><col class="col-time">';
    for (const d of DAYS) html += `<col class="col-day">`;
    html += '</colgroup>';

    // thead
    html += '<thead><tr>';
    html += '<th class="th-time" scope="col">Время</th>';
    for (const d of DAYS) {
      const dDate   = dateForDay(monday, d.id);
      const isToday = d.id === today;
      html += `<th class="th-day day-${d.id}${isToday ? ' is-today' : ''}" scope="col">`;
      html += `<div class="th-day-name">${esc(d.short)}</div>`;
      html += `<div class="th-day-date">${shortDate(dDate)}</div>`;
      html += '</th>';
    }
    html += '</tr></thead>';

    // tbody
    html += '<tbody>';
    for (const time of times) {
      html += '<tr>';
      html += `<td class="td-time">${esc(time)}</td>`;
      for (const d of DAYS) {
        const items = grid[time][d.id];
        if (items.length === 0) {
          html += `<td class="td-lesson empty day-${d.id}" data-day="${d.id}" data-time="${esc(time)}" title="Добавить урок"></td>`;
        } else {
          html += `<td class="td-lesson has-lesson day-${d.id}" data-day="${d.id}" data-time="${esc(time)}">`;
          for (const item of items) {
            const emoji = detectEmoji(item.activity);
            const isNew = item.id === lastTouchedId;
            html += `<div class="lesson-cell day-${d.id}${isNew ? ' just-added' : ''}" data-id="${esc(item.id)}" tabindex="0" role="button" aria-label="Редактировать ${esc(item.activity)}">`;
            if (emoji) html += `<span class="lesson-emoji">${emoji}</span>`;
            html += `<span class="lesson-name">${esc(item.activity)}</span>`;
            html += '</div>';
          }
          html += '</td>';
        }
      }
      html += '</tr>';
    }
    html += '</tbody></table>';

    daysContainer.innerHTML = html;
    lastTouchedId = null;
    updateFooter();
  }

  function updateFooter() {
    const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    footerEl.textContent = `Составлено ${date}`;
  }

  /* ══════════════════════════════════════
     QUICK ADD FORM
  ══════════════════════════════════════ */
  form.addEventListener('submit', e => {
    e.preventDefault();
    const activity = activityInput.value.trim();
    if (!activity) return;
    const item = { id: uid(), day: selectedDay, time: timeInput.value, activity };
    schedule.push(item);
    lastTouchedId = item.id;
    save();
    render();
    activityInput.value = '';
    activityInput.focus();
    showToast('Урок добавлен');
  });

  /* ══════════════════════════════════════
     TABLE CLICKS — open modal
  ══════════════════════════════════════ */
  daysContainer.addEventListener('click', e => {
    const lesson = e.target.closest('.lesson-cell[data-id]');
    if (lesson) {
      openEditModal(lesson.dataset.id);
      return;
    }
    const cell = e.target.closest('.td-lesson[data-day][data-time]');
    if (cell && cell.classList.contains('empty')) {
      openAddModal(parseInt(cell.dataset.day, 10), cell.dataset.time);
    }
  });
  daysContainer.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const lesson = e.target.closest('.lesson-cell[data-id]');
      if (lesson) { e.preventDefault(); openEditModal(lesson.dataset.id); }
    }
  });

  /* ══════════════════════════════════════
     MODAL (add / edit)
  ══════════════════════════════════════ */
  function openAddModal(day = todayIso(), time = '08:00') {
    modalState.editingId = null;
    modalState.day = day;
    refreshChips(modalDayChips, day);
    modalTime.value = time;
    modalActivity.value = '';
    modalTitle.textContent = 'Новый урок';
    modalDeleteBtn.hidden = true;
    showModal();
  }

  function openEditModal(id) {
    const item = schedule.find(s => s.id === id);
    if (!item) return;
    modalState.editingId = item.id;
    modalState.day = item.day;
    refreshChips(modalDayChips, item.day);
    modalTime.value = item.time;
    modalActivity.value = item.activity;
    modalTitle.textContent = 'Редактирование';
    modalDeleteBtn.hidden = false;
    showModal();
  }

  let prevFocus = null;
  function showModal() {
    prevFocus = document.activeElement;
    modalOverlay.hidden = false;
    modalOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => modalActivity.focus(), 30);
  }
  function closeModal() {
    modalOverlay.hidden = true;
    modalOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    modalState.editingId = null;
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  }

  modalForm.addEventListener('submit', e => {
    e.preventDefault();
    const activity = modalActivity.value.trim();
    if (!activity) return;
    const time = modalTime.value;
    const day  = modalState.day;
    if (modalState.editingId) {
      const item = schedule.find(s => s.id === modalState.editingId);
      if (item) { item.day = day; item.time = time; item.activity = activity; lastTouchedId = item.id; }
      save(); render(); closeModal();
      showToast('Урок обновлён');
    } else {
      const item = { id: uid(), day, time, activity };
      schedule.push(item);
      lastTouchedId = item.id;
      save(); render(); closeModal();
      showToast('Урок добавлен');
    }
  });

  modalDeleteBtn.addEventListener('click', () => {
    if (!modalState.editingId) return;
    if (!confirm('Удалить этот урок?')) return;
    schedule = schedule.filter(s => s.id !== modalState.editingId);
    save(); render(); closeModal();
    showToast('Удалено');
  });

  modalCancelBtn.addEventListener('click', closeModal);
  modalCloseBtn.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', e => {
    if (e.target === modalOverlay) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!exportOverlay.hidden) { closeExportPreview(); return; }
    if (!libraryOverlay.hidden) { closeLibrary(); return; }
    if (!modalOverlay.hidden) closeModal();
  });

  /* ══════════════════════════════════════
     CLEAR
  ══════════════════════════════════════ */
  clearBtn.addEventListener('click', () => {
    if (schedule.length === 0) { showToast('Расписание уже пустое'); return; }
    if (!confirm('Удалить всё расписание?')) return;
    schedule = [];
    save(); render();
    showToast('Очищено');
  });

  /* ══════════════════════════════════════
     PRESETS LIBRARY
  ══════════════════════════════════════ */
  function loadPresets() {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr
        .filter(p => p && typeof p === 'object')
        .map(p => ({
          id: typeof p.id === 'string' && p.id.length <= 64 ? p.id : uid(),
          name: typeof p.name === 'string' ? p.name.slice(0, 60) : '',
          section: typeof p.section === 'string' ? p.section : '',
          title: typeof p.title === 'string' ? p.title.slice(0, 200) : '',
          schedule: sanitizeScheduleArray(p.schedule),
          createdAt: Number.isFinite(p.createdAt) ? p.createdAt : Date.now(),
        }));
    } catch { return []; }
  }
  function savePresets(arr) {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(arr));
    } catch (e) {
      showToast('Хранилище переполнено');
      throw e;
    }
  }
  function presetSaveCurrent(name) {
    const all = loadPresets();
    const preset = {
      id: uid(),
      name: name.trim().slice(0, 60),
      section: currentSection,
      title: titleEl.textContent.trim() || sectionDefaultTitle(),
      schedule: JSON.parse(JSON.stringify(schedule)),
      createdAt: Date.now(),
    };
    all.unshift(preset);
    savePresets(all);
    return preset;
  }
  function presetDelete(id) {
    savePresets(loadPresets().filter(p => p.id !== id));
  }
  function presetLoad(id) {
    const p = loadPresets().find(x => x.id === id);
    if (!p) return false;
    if (p.section && p.section !== currentSection && getSection(p.section)) {
      currentSection = p.section;
      localStorage.setItem(SECTION_KEY, currentSection);
      refreshSectionTabs();
      refreshDatalistAttr();
    }
    schedule = JSON.parse(JSON.stringify(p.schedule || []));
    save();
    if (p.title) {
      titleEl.textContent = p.title;
      localStorage.setItem(getTitleKey(currentSection), p.title);
    } else {
      refreshTitle();
    }
    render();
    return true;
  }

  function fmtPresetDate(ts) {
    try {
      return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    } catch { return ''; }
  }

  function renderLibrary() {
    const all = loadPresets();
    if (all.length === 0) {
      libraryList.innerHTML = '';
      libraryEmpty.hidden = false;
      return;
    }
    libraryEmpty.hidden = true;
    libraryList.innerHTML = all.map((p, i) => {
      const sec = getSection(p.section);
      const icon = sec?.icon || '📋';
      const count = (p.schedule || []).length;
      const date = fmtPresetDate(p.createdAt);
      return `
        <div class="preset-card" data-id="${esc(p.id)}" style="animation-delay:${i * 30}ms">
          <div class="preset-section" aria-hidden="true">${icon}</div>
          <div class="preset-info">
            <div class="preset-name">${esc(p.name || 'Без названия')}</div>
            <div class="preset-meta">${count} ${pluralLessons(count)} · ${date}</div>
          </div>
          <div class="preset-actions">
            <button class="preset-load-btn" type="button" data-action="load">Открыть</button>
            <button class="preset-delete-btn" type="button" data-action="delete" aria-label="Удалить">×</button>
          </div>
        </div>`;
    }).join('');
  }

  function pluralLessons(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'урок';
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'урока';
    return 'уроков';
  }

  function openLibrary() {
    presetNameInput.value = '';
    renderLibrary();
    libraryOverlay.hidden = false;
    libraryOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => presetNameInput.focus(), 30);
  }
  function closeLibrary() {
    libraryOverlay.hidden = true;
    libraryOverlay.setAttribute('aria-hidden', 'true');
    if (modalOverlay.hidden) document.body.style.overflow = '';
  }

  libraryBtn.addEventListener('click', openLibrary);
  libraryCloseBtn.addEventListener('click', closeLibrary);
  libraryOverlay.addEventListener('click', e => {
    if (e.target === libraryOverlay) closeLibrary();
  });

  presetSaveBtn.addEventListener('click', () => {
    const name = presetNameInput.value.trim();
    if (!name) { presetNameInput.focus(); showToast('Введи название'); return; }
    if (schedule.length === 0) { showToast('Расписание пустое'); return; }
    try {
      presetSaveCurrent(name);
      presetNameInput.value = '';
      renderLibrary();
      showToast('Сохранено ✓');
    } catch {}
  });
  presetNameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); presetSaveBtn.click(); }
  });

  libraryList.addEventListener('click', e => {
    const card = e.target.closest('.preset-card');
    if (!card) return;
    const id = card.dataset.id;
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'load') {
      const preset = loadPresets().find(p => p.id === id);
      const name = preset?.name || 'это расписание';
      if (schedule.length > 0 && !confirm(`Загрузить «${name}»? Текущее расписание будет заменено.`)) return;
      if (presetLoad(id)) {
        closeLibrary();
        showToast('Загружено ✓');
      }
    } else if (action === 'delete') {
      if (!confirm('Удалить это сохранённое расписание?')) return;
      presetDelete(id);
      renderLibrary();
      showToast('Удалено');
    }
  });

  /* ══════════════════════════════════════
     PNG EXPORT
  ══════════════════════════════════════ */
  downloadBtn.addEventListener('click', async () => {
    if (typeof html2canvas !== 'function') {
      showToast('Библиотека ещё грузится, попробуй ещё раз');
      return;
    }

    const card = $('schedule-card');
    const tableWrap = card.querySelector('.table-wrap');
    const table = card.querySelector('.schedule-table');

    downloadBtn.disabled = true;
    const originalHTML = downloadBtn.innerHTML;
    const originalCardWidth = card.style.width;
    const originalCardMaxWidth = card.style.maxWidth;
    const originalWrapOverflow = tableWrap?.style.overflow;

    downloadBtn.innerHTML = '<span>Готовлю…</span>';

    try {
      if (document.fonts?.ready) await document.fonts.ready;
      document.activeElement?.blur?.();
      window.getSelection?.()?.removeAllRanges?.();

      card.classList.add('exporting');

      const exportWidth = Math.ceil(Math.max(
          card.scrollWidth,
          tableWrap?.scrollWidth || 0,
          table?.scrollWidth || 0
      ));

      card.style.width = `${exportWidth}px`;
      card.style.maxWidth = 'none';
      if (tableWrap) tableWrap.style.overflow = 'visible';

      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const exportHeight = Math.ceil(card.scrollHeight);
      const scale = Math.min(3, Math.max(2, window.devicePixelRatio || 1));

      const canvas = await html2canvas(card, {
        scale,
        backgroundColor: '#ffffff',
        useCORS: true,
        allowTaint: true,
        logging: false,
        width: exportWidth,
        height: exportHeight,
        windowWidth: exportWidth,
        windowHeight: exportHeight,
        scrollX: 0,
        scrollY: 0,
      });

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned null')), 'image/png');
      });

      const filename = makeFilename();
      showExportPreview(blob, filename);
      showToast('PNG готов');
    } catch (err) {
      console.error(err);
      showToast('Не получилось, попробуй ещё раз');
    } finally {
      card.classList.remove('exporting');
      card.style.width = originalCardWidth;
      card.style.maxWidth = originalCardMaxWidth;
      if (tableWrap) tableWrap.style.overflow = originalWrapOverflow || '';

      downloadBtn.disabled = false;
      downloadBtn.innerHTML = originalHTML;
    }
  });

  function makeFilename() {
    const t = (titleEl.textContent.trim() || sectionDefaultTitle())
        .replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
    const d   = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${t}-${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}.png`;
  }

  /* ── Export preview modal ── */
  function showExportPreview(blob, filename) {
    if (exportObjectURL) URL.revokeObjectURL(exportObjectURL);
    exportObjectURL = URL.createObjectURL(blob);

    exportPreviewImg.src = exportObjectURL;
    exportDownloadLink.href = exportObjectURL;
    exportDownloadLink.setAttribute('download', filename);

    // Web Share API — best UX on mobile (saves to Photos / sends anywhere)
    exportShareFile = null;
    exportShareBtn.hidden = true;
    try {
      if (navigator.canShare) {
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          exportShareFile = file;
          exportShareBtn.hidden = false;
        }
      }
    } catch {}

    exportOverlay.hidden = false;
    exportOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeExportPreview() {
    exportOverlay.hidden = true;
    exportOverlay.setAttribute('aria-hidden', 'true');
    if (modalOverlay.hidden && libraryOverlay.hidden) document.body.style.overflow = '';
    if (exportObjectURL) {
      // delay revoke so the just-clicked download has time to start
      const u = exportObjectURL;
      exportObjectURL = null;
      setTimeout(() => URL.revokeObjectURL(u), 8000);
    }
    exportPreviewImg.removeAttribute('src');
    exportShareFile = null;
  }

  exportCloseBtn.addEventListener('click', closeExportPreview);
  exportOverlay.addEventListener('click', e => {
    if (e.target === exportOverlay) closeExportPreview();
  });
  exportShareBtn.addEventListener('click', async () => {
    if (!exportShareFile) return;
    try {
      await navigator.share({ files: [exportShareFile], title: 'Расписание' });
    } catch (err) {
      if (err && err.name !== 'AbortError') {
        console.error(err);
        showToast('Не получилось поделиться');
      }
    }
  });

  /* ══════════════════════════════════════
     TOAST
  ══════════════════════════════════════ */
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 2000);
  }

  /* ── fatal error ── */
  function showFatalError(err) {
    const isFile = location.protocol === 'file:';
    const msg = isFile
      ? `<p><b>Не удалось загрузить config.json</b></p>
         <p>Страница открыта как локальный файл (<code>file://</code>).</p>
         <p>Запусти сервер в папке проекта:<br><code>python3 -m http.server 8000</code></p>
         <p>и открой <code>http://localhost:8000</code></p>`
      : `<p><b>Ошибка загрузки конфигурации</b></p>
         <p><code>${String(err?.message || err).replace(/[<>&]/g, '')}</code></p>`;
    const host = document.getElementById('app-body') || document.body;
    host.innerHTML = `<div class="fatal-error">${msg}</div>`;
  }

  /* ── first render ── */
  render();
})();
