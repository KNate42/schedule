(async function () {
  'use strict';

  let config;
  try {
    const res = await fetch('config.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    config = await res.json();
  } catch (err) {
    showFatalError(err);
    return;
  }

  const STORAGE_KEY = config.storageKeys.schedule;
  const TITLE_KEY = config.storageKeys.title;
  const DAYS = config.days;
  const DEFAULT_TITLE = config.defaultScheduleTitle;

  let schedule = loadSchedule();

  // Build the day <select> options from config
  const daySel = document.getElementById('day');
  daySel.innerHTML = DAYS
    .map(d => `<option value="${d.id}">${d.long}</option>`)
    .join('');

  const form = document.getElementById('add-form');
  const timeInput = document.getElementById('time');
  const activityInput = document.getElementById('activity');
  const daysContainer = document.getElementById('days-container');
  const downloadBtn = document.getElementById('download-btn');
  const clearBtn = document.getElementById('clear-btn');
  const titleEl = document.getElementById('schedule-title');
  const footerEl = document.getElementById('schedule-footer');
  const toastEl = document.getElementById('toast');
  const appBody = document.getElementById('app-body');

  // Show app, hide loader
  appBody.hidden = false;
  document.getElementById('loader').hidden = true;

  // Pre-select today as default day
  const todayJs = new Date().getDay();
  const todayIso = todayJs === 0 ? 7 : todayJs;
  daySel.value = String(todayIso);

  // Restore title from previous session
  const savedTitle = localStorage.getItem(TITLE_KEY);
  titleEl.textContent = savedTitle && savedTitle.trim() ? savedTitle : DEFAULT_TITLE;

  titleEl.addEventListener('input', () => {
    localStorage.setItem(TITLE_KEY, titleEl.textContent.trim() || DEFAULT_TITLE);
  });
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
  });
  titleEl.addEventListener('blur', () => {
    if (!titleEl.textContent.trim()) titleEl.textContent = DEFAULT_TITLE;
  });

  function loadSchedule() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(schedule));
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
  }

  function render() {
    const byDay = Object.fromEntries(DAYS.map(d => [d.id, []]));
    for (const item of schedule) {
      if (byDay[item.day]) byDay[item.day].push(item);
    }
    for (const id of Object.keys(byDay)) {
      byDay[id].sort((a, b) => a.time.localeCompare(b.time));
    }

    let html = '';
    for (const day of DAYS) {
      const items = byDay[day.id];
      html += `<section class="day-section day-${day.id}">`;
      html += `<div class="day-header"><span class="day-name">${day.long}</span><span class="day-short">${day.short}</span></div>`;
      if (items.length === 0) {
        html += `<div class="empty-day">— свободный день —</div>`;
      } else {
        html += `<ul class="items">`;
        for (const item of items) {
          html += `<li class="item">
            <span class="item-time">${item.time}</span>
            <span class="item-text">${escapeHtml(item.activity)}</span>
            <button class="delete-btn" data-id="${item.id}" aria-label="Удалить" type="button">×</button>
          </li>`;
        }
        html += `</ul>`;
      }
      html += `</section>`;
    }
    daysContainer.innerHTML = html;
    updateFooter();
  }

  function updateFooter() {
    const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    footerEl.textContent = `Составлено ${date}`;
  }

  // Add new item
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const activity = activityInput.value.trim();
    if (!activity) return;
    schedule.push({
      id: uid(),
      day: parseInt(daySel.value, 10),
      time: timeInput.value,
      activity
    });
    save();
    render();
    activityInput.value = '';
    activityInput.focus();
  });

  // Delete item (event delegation)
  daysContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.delete-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    schedule = schedule.filter(s => s.id !== id);
    save();
    render();
  });

  // Clear all
  clearBtn.addEventListener('click', () => {
    if (schedule.length === 0) { showToast('Расписание уже пустое'); return; }
    if (!confirm('Удалить все записи?')) return;
    schedule = [];
    save();
    render();
    showToast('Очищено');
  });

  // Download PNG
  downloadBtn.addEventListener('click', async () => {
    if (typeof html2canvas !== 'function') {
      showToast('Библиотека ещё грузится, попробуй ещё раз');
      return;
    }
    const card = document.getElementById('schedule-card');
    downloadBtn.disabled = true;
    const originalLabel = downloadBtn.textContent;
    downloadBtn.textContent = 'Готовлю картинку…';
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      window.getSelection && window.getSelection().removeAllRanges();
      card.classList.add('exporting');
      await new Promise(r => requestAnimationFrame(() => r()));

      const canvas = await html2canvas(card, {
        scale: Math.max(2, window.devicePixelRatio || 1) * 1.5,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false
      });

      card.classList.remove('exporting');

      const link = document.createElement('a');
      link.download = makeFilename();
      link.href = canvas.toDataURL('image/png');
      document.body.appendChild(link);
      link.click();
      link.remove();

      showToast('Картинка сохранена');
    } catch (err) {
      console.error(err);
      card.classList.remove('exporting');
      showToast('Не получилось :( попробуй ещё раз');
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = originalLabel;
    }
  });

  function makeFilename() {
    const t = (titleEl.textContent.trim() || DEFAULT_TITLE)
      .replace(/[\\/:*?"<>|]/g, '')
      .slice(0, 40);
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    return `${t}-${stamp}.png`;
  }

  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 2000);
  }

  function showFatalError(err) {
    const loader = document.getElementById('loader');
    if (!loader) return;
    const isFileProtocol = location.protocol === 'file:';
    loader.className = 'fatal-error';
    loader.innerHTML = isFileProtocol
      ? `<p><b>Не удалось загрузить config.json</b></p>
         <p>Похоже, страница открыта как локальный файл (<code>file://</code>),
         браузеры не разрешают читать <code>config.json</code> в этом режиме.</p>
         <p>Запусти простой сервер в папке проекта:</p>
         <p><code>python3 -m http.server 8000</code></p>
         <p>и открой <code>http://localhost:8000</code>. На GitHub Pages работает без настроек.</p>`
      : `<p><b>Ошибка загрузки конфигурации</b></p>
         <p><code>${escapeHtmlSafe(String(err && err.message || err))}</code></p>`;
  }
  function escapeHtmlSafe(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  }

  // First render
  render();
})();
