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

  const STORAGE_KEY   = config.storageKeys.schedule;
  const TITLE_KEY     = config.storageKeys.title;
  const THEME_KEY     = config.storageKeys.theme;
  const DAYS          = config.days;
  const DEFAULT_TITLE = config.defaultScheduleTitle;
  const DEFAULT_THEME = config.defaultTheme;
  const THEMES        = config.themes;
  const CATEGORIES    = config.categories;
  const MONTHS        = config.monthsGenitive;

  /* ── state ── */
  let schedule    = loadSchedule();
  let selectedDay = todayIso();
  let lastTouchedId = null;
  const modalState = { editingId: null, day: todayIso() };

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

  /* ── init UI ── */
  buildThemePicker();
  buildDayChips(dayChips, () => selectedDay, v => { selectedDay = v; });
  buildDayChips(modalDayChips, () => modalState.day, v => { modalState.day = v; refreshChips(modalDayChips, modalState.day); });
  applyTheme(loadTheme());

  appBody.hidden = false;
  $('loader').hidden = true;

  /* ── title ── */
  const savedTitle = localStorage.getItem(TITLE_KEY);
  titleEl.textContent = savedTitle && savedTitle.trim() ? savedTitle : DEFAULT_TITLE;
  titleEl.addEventListener('input', () => {
    localStorage.setItem(TITLE_KEY, titleEl.textContent.trim() || DEFAULT_TITLE);
  });
  titleEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
  });
  titleEl.addEventListener('blur', () => {
    if (!titleEl.textContent.trim()) titleEl.textContent = DEFAULT_TITLE;
  });

  /* ══════════════════════════════════════
     HELPERS
  ══════════════════════════════════════ */
  function loadSchedule() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch { return []; }
  }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(schedule)); }
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
    if (e.key === 'Escape' && !modalOverlay.hidden) closeModal();
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
     PNG EXPORT
  ══════════════════════════════════════ */
  downloadBtn.addEventListener('click', async () => {
    if (typeof html2canvas !== 'function') {
      showToast('Библиотека ещё грузится, попробуй ещё раз');
      return;
    }
    const card = $('schedule-card');
    downloadBtn.disabled = true;
    const originalHTML = downloadBtn.innerHTML;
    downloadBtn.innerHTML = '<span>Готовлю…</span>';
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      document.activeElement?.blur?.();
      window.getSelection?.()?.removeAllRanges?.();

      card.classList.add('exporting');
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const dpr   = Math.max(2, window.devicePixelRatio || 1);
      const scale = dpr * 1.6;

      const canvas = await html2canvas(card, {
        scale,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        width:  card.scrollWidth,
        height: card.scrollHeight,
        windowWidth:  card.scrollWidth,
        windowHeight: card.scrollHeight,
      });

      card.classList.remove('exporting');

      const link = document.createElement('a');
      link.download = makeFilename();
      link.href = canvas.toDataURL('image/png');
      document.body.appendChild(link);
      link.click();
      link.remove();

      showToast('Таблица сохранена ✓');
    } catch (err) {
      console.error(err);
      card.classList.remove('exporting');
      showToast('Не получилось, попробуй ещё раз');
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.innerHTML = originalHTML;
    }
  });

  function makeFilename() {
    const t = (titleEl.textContent.trim() || DEFAULT_TITLE)
      .replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
    const d   = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${t}-${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}.png`;
  }

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
    const loader = document.getElementById('loader');
    if (!loader) return;
    const isFile = location.protocol === 'file:';
    loader.className = 'fatal-error';
    loader.innerHTML = isFile
      ? `<p><b>Не удалось загрузить config.json</b></p>
         <p>Страница открыта как локальный файл (<code>file://</code>).</p>
         <p>Запусти сервер в папке проекта:<br><code>python3 -m http.server 8000</code></p>
         <p>и открой <code>http://localhost:8000</code></p>`
      : `<p><b>Ошибка загрузки конфигурации</b></p>
         <p><code>${String(err?.message || err).replace(/[<>&]/g, '')}</code></p>`;
  }

  /* ── first render ── */
  render();
})();
