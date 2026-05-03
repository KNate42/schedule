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

  const STORAGE_KEY  = config.storageKeys.schedule;
  const TITLE_KEY    = config.storageKeys.title;
  const THEME_KEY    = config.storageKeys.theme;
  const DAYS         = config.days;
  const DEFAULT_TITLE = config.defaultScheduleTitle;
  const DEFAULT_THEME = config.defaultTheme;
  const THEMES       = config.themes;
  const CATEGORIES   = config.categories;
  const MONTHS       = config.monthsGenitive;

  /* ── state ── */
  let schedule    = loadSchedule();
  let selectedDay = todayIso();
  let lastAddedId = null;

  /* ── DOM refs ── */
  const themePicker   = document.getElementById('theme-picker');
  const dayChips      = document.getElementById('day-chips');
  const form          = document.getElementById('add-form');
  const timeInput     = document.getElementById('time');
  const activityInput = document.getElementById('activity');
  const daysContainer = document.getElementById('days-container');
  const downloadBtn   = document.getElementById('download-btn');
  const clearBtn      = document.getElementById('clear-btn');
  const titleEl       = document.getElementById('schedule-title');
  const weekRangeEl   = document.getElementById('schedule-week-range');
  const footerEl      = document.getElementById('schedule-footer');
  const toastEl       = document.getElementById('toast');
  const appBody       = document.getElementById('app-body');

  /* ── init UI ── */
  buildThemePicker();
  buildDayChips();
  applyTheme(loadTheme());

  appBody.hidden = false;
  document.getElementById('loader').hidden = true;

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

  function todayIso() {
    const d = new Date().getDay();
    return d === 0 ? 7 : d;
  }

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

  /* ── theme picker ── */
  function buildThemePicker() {
    themePicker.innerHTML = THEMES
      .map(t => `<button class="theme-chip" type="button" data-theme="${t.id}" aria-pressed="false">${t.icon} ${esc(t.name)}</button>`)
      .join('');
    themePicker.addEventListener('click', e => {
      const btn = e.target.closest('.theme-chip');
      if (btn) applyTheme(btn.dataset.theme);
    });
  }

  /* ── day chips ── */
  function buildDayChips() {
    const today = todayIso();
    dayChips.innerHTML = DAYS
      .map(d => `<button class="day-chip day-${d.id}${d.id === today ? ' is-today' : ''}" type="button" data-day="${d.id}" aria-pressed="false" title="${d.long}">${d.short}</button>`)
      .join('');
    selectDayChip(selectedDay);
    dayChips.addEventListener('click', e => {
      const btn = e.target.closest('.day-chip');
      if (!btn) return;
      selectedDay = parseInt(btn.dataset.day, 10);
      selectDayChip(selectedDay);
    });
  }
  function selectDayChip(id) {
    for (const btn of dayChips.querySelectorAll('.day-chip')) {
      btn.setAttribute('aria-pressed', parseInt(btn.dataset.day, 10) === id ? 'true' : 'false');
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
    if (monday.getMonth() === sunday.getMonth()) {
      return `${monday.getDate()}–${sunday.getDate()} ${MONTHS[monday.getMonth()]}`;
    }
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
    for (const cat of CATEGORIES) {
      for (const kw of cat.keywords) {
        if (t.includes(kw)) return cat.emoji;
      }
    }
    return '';
  }

  /* ══════════════════════════════════════
     RENDER — weekly timetable table
  ══════════════════════════════════════ */
  function render() {
    const { monday, sunday } = getWeekRange();
    const today = todayIso();

    weekRangeEl.textContent = formatWeekRange({ monday, sunday });

    /* group & sort */
    const byDay = {};
    for (const d of DAYS) byDay[d.id] = [];
    for (const item of schedule) {
      if (byDay[item.day]) byDay[item.day].push(item);
    }

    /* collect unique time slots */
    const timesSet = new Set(schedule.map(i => i.time));
    const times = [...timesSet].sort();

    if (times.length === 0) {
      daysContainer.innerHTML = `
        <div class="empty-state">
          <strong>📋 Расписание пустое</strong>
          Выбери день, укажи время и предмет —<br>нажми «Добавить урок»
        </div>`;
      updateFooter();
      return;
    }

    /* build grid: time → dayId → items[] */
    const grid = {};
    for (const t of times) {
      grid[t] = {};
      for (const d of DAYS) grid[t][d.id] = [];
    }
    for (const item of schedule) {
      if (grid[item.time]?.[item.day] !== undefined)
        grid[item.time][item.day].push(item);
    }

    /* ── table HTML ── */
    let html = '<table class="schedule-table" role="grid">';

    /* colgroup */
    html += '<colgroup><col class="col-time">';
    for (const d of DAYS) html += `<col class="col-day day-${d.id}">`;
    html += '</colgroup>';

    /* thead */
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

    /* tbody */
    html += '<tbody>';
    for (const time of times) {
      html += '<tr>';
      html += `<td class="td-time">${esc(time)}</td>`;
      for (const d of DAYS) {
        const items = grid[time][d.id];
        if (items.length === 0) {
          html += `<td class="td-lesson empty day-${d.id}"></td>`;
        } else {
          html += `<td class="td-lesson has-lesson day-${d.id}">`;
          for (const item of items) {
            const emoji = detectEmoji(item.activity);
            const isNew = item.id === lastAddedId;
            html += `<div class="lesson-cell day-${d.id}${isNew ? ' just-added' : ''}">`;
            if (emoji) html += `<span class="lesson-emoji">${emoji}</span>`;
            html += `<span class="lesson-name">${esc(item.activity)}</span>`;
            html += `<button class="delete-btn" data-id="${esc(item.id)}" aria-label="Удалить" type="button">×</button>`;
            html += '</div>';
          }
          html += '</td>';
        }
      }
      html += '</tr>';
    }
    html += '</tbody></table>';

    daysContainer.innerHTML = html;
    lastAddedId = null;
    updateFooter();
  }

  function updateFooter() {
    const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    footerEl.textContent = `Составлено ${date}`;
  }

  /* ══════════════════════════════════════
     FORM
  ══════════════════════════════════════ */
  form.addEventListener('submit', e => {
    e.preventDefault();
    const activity = activityInput.value.trim();
    if (!activity) return;
    const item = { id: uid(), day: selectedDay, time: timeInput.value, activity };
    schedule.push(item);
    lastAddedId = item.id;
    save();
    render();
    activityInput.value = '';
    activityInput.focus();
    showToast('Урок добавлен');
  });

  daysContainer.addEventListener('click', e => {
    const btn = e.target.closest('.delete-btn');
    if (!btn) return;
    schedule = schedule.filter(s => s.id !== btn.dataset.id);
    save();
    render();
    showToast('Урок удалён');
  });

  clearBtn.addEventListener('click', () => {
    if (schedule.length === 0) { showToast('Расписание уже пустое'); return; }
    if (!confirm('Удалить всё расписание?')) return;
    schedule = [];
    save();
    render();
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
    const card = document.getElementById('schedule-card');
    downloadBtn.disabled = true;
    const originalHTML = downloadBtn.innerHTML;
    downloadBtn.textContent = 'Готовлю…';
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      document.activeElement?.blur();
      window.getSelection?.()?.removeAllRanges();

      card.classList.add('exporting');
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const dpr   = Math.max(2, window.devicePixelRatio || 1);
      const scale = dpr * 1.8;

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
    toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 2200);
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
