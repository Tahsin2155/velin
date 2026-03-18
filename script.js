
// ══════════════════════════════
//  STATE
// ══════════════════════════════
const DEF = {
  theme: 'dark',
  viewMode: false,
  bg: { type: 'solid', value: '#0d0d0f' },
  widgets: [],
  ftNotes: [],
  bookmarks: []
};

// FIX 6: dMerge defined BEFORE it is called below
function dMerge(t, s) {
  for (const k in s) {
    // Guard against prototype pollution keys from imported JSON.
  
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) {
      t[k] = t[k] || {};
      dMerge(t[k], s[k]);
    } else {
      t[k] = s[k];
    }
  }
}

// ══════════════════════════════
//  NOTIFICATION SUPPORT
// ══════════════════════════════
let notificationEnabled = false;

function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    notificationEnabled = true;
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(perm => {
      notificationEnabled = (perm === 'granted');
    });
  }
}

function showNotification(title, options = {}) {
  if (notificationEnabled && 'Notification' in window) {
    new Notification(title, { icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="%23c8a96e"/></svg>', ...options });
  }
}

requestNotificationPermission();

let S = JSON.parse(JSON.stringify(DEF));
const STORAGE_KEY = 'sp3';
const SAVE_DEBOUNCE_MS = 120;
let _saveTimer = null;

try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    dMerge(S, parsed);
    if (!Array.isArray(S.widgets)) S.widgets = [];
    if (!Array.isArray(S.ftNotes)) S.ftNotes = [];
    if (!Array.isArray(S.bookmarks)) S.bookmarks = [];
  }
} catch(e) {
  console.warn('Corrupt localStorage, resetting:', e);
  S = JSON.parse(JSON.stringify(DEF));
  localStorage.removeItem(STORAGE_KEY);
}

// Persist immediately with quota guard; if image payload is too large, fall back safely.
function persistNow() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
  } catch(e) {
    // Likely QuotaExceededError — drop the stored image and try again
    if (S.bg && S.bg.type === 'image' && S.bg.imgData) {
      const withoutImg = JSON.parse(JSON.stringify(S));
      withoutImg.bg = { type: 'solid', value: '#0d0d0f' };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(withoutImg));
      } catch(e2) {}
      showImgWarn();
    }
  }
}

// Debounced saves reduce localStorage churn during typing and drag interactions.
function save(immediate = false) {
  if (immediate) {
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
    }
    persistNow();
    return;
  }
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    persistNow();
  }, SAVE_DEBOUNCE_MS);
}

// Flush pending writes when leaving the page to minimize in-flight data loss.
window.addEventListener('beforeunload', () => {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    persistNow();
  }
});

function showImgWarn() {
  const w = document.getElementById('img-warn');
  w.classList.add('show');
  setTimeout(() => w.classList.remove('show'), 4000);
}

function snap(v) { return Math.round(v / 20) * 20; }
function pad(n) { return String(n).padStart(2, '0'); }

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function normalizeHttpUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
}

function getHostname(url) {
  try {
    return new URL(normalizeHttpUrl(url)).hostname;
  } catch(e) {
    return (url || '').trim();
  }
}

// FIX 3 (markdown): Proper multi-line <ul> grouping using a line-by-line pass
function renderMD(md) {
  function sanitizeHref(href) {
    try {
      const url = new URL(href, location.href);
      if (url.protocol === 'http:' || url.protocol === 'https:') return href;
    } catch(e) {}
    return '#';
  }
  // Escape HTML first
  let out = md
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Block-level: headings and hr (operate on lines)
  out = out
    .replace(/^### (.+)$/gm,'<h3>$1</h3>')
    .replace(/^## (.+)$/gm,'<h2>$1</h2>')
    .replace(/^# (.+)$/gm,'<h1>$1</h1>')
    .replace(/^---$/gm,'<hr>');

  // Inline: bold, italic, code, links
  out = out
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`(.+?)`/g,'<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g,(_,text,href)=>`<a href="${sanitizeHref(href)}">${text}</a>`);

  // FIX 3: Build output line by line, grouping consecutive list items into one <ul>
  const lines = out.split('\n');
  const result = [];
  let inList = false;
  for (const line of lines) {
    const liMatch = line.match(/^- (.+)$/);
    if (liMatch) {
      if (!inList) { result.push('<ul>'); inList = true; }
      result.push('<li>' + liMatch[1] + '</li>');
    } else {
      if (inList) { result.push('</ul>'); inList = false; }
      // Wrap non-block lines in <p>
      if (line && !/^<[hup\/]|^<hr|^<ul|^<li/.test(line)) {
        result.push('<p>' + line + '</p>');
      } else {
        result.push(line);
      }
    }
  }
  if (inList) result.push('</ul>');
  return result.join('\n');
}

// ══════════════════════════════
//  THEME
// FIX 5: t-dark CSS class now defined in stylesheet above
// ══════════════════════════════
function applyTheme(t) {
  document.body.className = document.body.className
    .split(' ')
    .filter(c => !c.startsWith('t-') && c !== '')
    .join(' ');
  document.body.classList.add('t-' + t);
  document.querySelectorAll('.theme-dot').forEach(d => d.classList.toggle('active', d.dataset.theme === t));
  S.theme = t; save();
}
document.querySelectorAll('.theme-dot').forEach(d => d.addEventListener('click', () => applyTheme(d.dataset.theme)));
applyTheme(S.theme);

// ══════════════════════════════
//  VIEW / EDIT MODE
// ══════════════════════════════
let zTop = 10;
const wRefs = {};
let viewMode = S.viewMode || false;

function ensureCleanups(id) {
  if (!wRefs[id]) return [];
  wRefs[id]._cleanups = wRefs[id]._cleanups || [];
  return wRefs[id]._cleanups;
}

function applyMode() {
  document.body.classList.toggle('view-mode', viewMode);
  document.getElementById('mode-label').textContent = viewMode ? 'edit' : 'view';
  document.getElementById('mode-icon').textContent = viewMode ? '✎' : '✦';
  S.viewMode = viewMode; save();
  if (typeof updateClockSize === 'function') {
    Object.values(wRefs).forEach(r => { if (r.cfg.type === 'clock') updateClockSize(r.cfg.id); });
  }
}

document.getElementById('mode-toggle').addEventListener('click', () => { viewMode = !viewMode; applyMode(); });
document.addEventListener('keydown', e => {
  if (e.key === 'e' && !e.ctrlKey && !e.metaKey &&
      document.activeElement.tagName !== 'INPUT' &&
      document.activeElement.tagName !== 'TEXTAREA') {
    viewMode = !viewMode; applyMode();
  }
});
applyMode();

// ══════════════════════════════
//  BACKGROUND
// ══════════════════════════════
const bgLayer = document.getElementById('bg-layer');
const bgImgLayer = document.getElementById('bg-img-layer');
let imgBrightness = (S.bg && S.bg.brightness) || 100;
let imgBlur = (S.bg && S.bg.blur) || 0;

function applyBg() {
  const bg = S.bg;
  if (!bg) return; // Guard against undefined bg on first load
  if (bg.type === 'solid') {
    bgLayer.style.background = bg.value || '#0d0d0f';
    bgImgLayer.style.opacity = 0;
  } else if (bg.type === 'gradient') {
    bgLayer.style.background = bg.value;
    bgImgLayer.style.opacity = 0;
  } else if (bg.type === 'image') {
    bgLayer.style.background = 'transparent';
    const brightness = bg.brightness || 100;
    const blur = bg.blur || 0;
    bgImgLayer.style.filter = `brightness(${brightness}%) blur(${blur}px)`;
    bgImgLayer.style.backgroundImage = `url(${bg.imgData})`;
    bgImgLayer.style.opacity = 1;
  }
}
applyBg();

const bgPanel = document.getElementById('bg-panel');
document.getElementById('bg-toggle-btn').addEventListener('click', () => bgPanel.classList.toggle('open'));
document.getElementById('bg-close-btn').addEventListener('click', () => bgPanel.classList.remove('open'));

document.querySelectorAll('.bg-tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.bg-tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  ['solid','gradient','image'].forEach(n => document.getElementById('bg-' + n + '-panel').classList.toggle('show', n === t.dataset.bgtab));
}));

document.querySelectorAll('.color-swatch').forEach(sw => sw.addEventListener('click', () => {
  document.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('active'));
  sw.classList.add('active');
  S.bg = { type: 'solid', value: sw.dataset.color }; save(); applyBg();
}));

document.getElementById('solid-color-picker').addEventListener('input', e => {
  document.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('active'));
  S.bg = { type: 'solid', value: e.target.value }; save(); applyBg();
});

document.querySelectorAll('.grad-preset').forEach(gp => gp.addEventListener('click', () => {
  document.querySelectorAll('.grad-preset').forEach(x => x.classList.remove('active'));
  gp.classList.add('active');
  S.bg = { type: 'gradient', value: gp.dataset.grad }; save(); applyBg();
}));

function buildCustomGrad() {
  const c1 = document.getElementById('grad-c1').value;
  const c2 = document.getElementById('grad-c2').value;
  const dir = document.getElementById('grad-dir').value;
  S.bg = { type: 'gradient', value: `linear-gradient(${dir},${c1},${c2})` };
  save(); applyBg();
}
['grad-c1','grad-c2','grad-dir'].forEach(id => document.getElementById(id).addEventListener('input', buildCustomGrad));

// FIX 7: Image stored in S.bg but save() will handle quota gracefully
document.getElementById('img-upload').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  // FIX 9: Validate image file size before upload (limit to 2MB)
  if (file.size > 2 * 1024 * 1024) {
    showImgWarn();
    return;
  }
  const reader = new FileReader();
  reader.onload = ev => {
    S.bg = { type: 'image', imgData: ev.target.result, brightness: imgBrightness, blur: imgBlur };
    applyBg();
    save(); // save() will warn if quota exceeded
  };
  reader.readAsDataURL(file);
});

const brightSlider = document.getElementById('img-brightness');
brightSlider.value = imgBrightness;
brightSlider.addEventListener('input', e => {
  imgBrightness = +e.target.value;
  document.getElementById('brightness-val').textContent = imgBrightness + '%';
  if (S.bg.type === 'image') { S.bg.brightness = imgBrightness; save(); applyBg(); }
});

const blurSlider = document.getElementById('img-blur');
blurSlider.value = imgBlur;
blurSlider.addEventListener('input', e => {
  imgBlur = +e.target.value;
  document.getElementById('blur-val').textContent = imgBlur + 'px';
  if (S.bg.type === 'image') { S.bg.blur = imgBlur; save(); applyBg(); }
});

// ══════════════════════════════
//  FAVICON HELPER
// ══════════════════════════════
const _favCache = new Map();
const _favPending = new Map();
const FAV_CACHE_LIMIT = 200;
const FAV_CACHE_STORAGE_KEY = 'sp3_fav_cache_v1';
const FAV_CACHE_SAVE_DEBOUNCE_MS = 250;
let _favCacheSaveTimer = null;

function persistFaviconCacheNow() {
  try {
    const out = {};
    for (const [hostname, entry] of _favCache) {
      out[hostname] = { u: entry.url, t: entry.ts };
    }
    localStorage.setItem(FAV_CACHE_STORAGE_KEY, JSON.stringify(out));
  } catch(e) {}
}

function schedulePersistFaviconCache() {
  if (_favCacheSaveTimer) clearTimeout(_favCacheSaveTimer);
  _favCacheSaveTimer = setTimeout(() => {
    _favCacheSaveTimer = null;
    persistFaviconCacheNow();
  }, FAV_CACHE_SAVE_DEBOUNCE_MS);
}

function loadPersistedFaviconCache() {
  try {
    const raw = localStorage.getItem(FAV_CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const entries = Object.entries(parsed)
      .filter(([hostname, entry]) => hostname && entry && typeof entry === 'object')
      .sort((a, b) => (a[1].t || 0) - (b[1].t || 0));

    entries.forEach(([hostname, entry]) => {
      _favCache.set(hostname, { url: entry.u ?? null, ts: entry.t || Date.now() });
    });

    while (_favCache.size > FAV_CACHE_LIMIT) {
      const oldestKey = _favCache.keys().next().value;
      _favCache.delete(oldestKey);
    }
  } catch(e) {}
}

function getCachedFavicon(hostname) {
  if (!_favCache.has(hostname)) return undefined;
  const entry = _favCache.get(hostname);
  // LRU touch
  _favCache.delete(hostname);
  _favCache.set(hostname, { url: entry.url, ts: Date.now() });
  return entry.url;
}

function setCachedFavicon(hostname, value) {
  if (_favCache.has(hostname)) _favCache.delete(hostname);
  _favCache.set(hostname, { url: value ?? null, ts: Date.now() });
  if (_favCache.size > FAV_CACHE_LIMIT) {
    const oldestKey = _favCache.keys().next().value;
    _favCache.delete(oldestKey);
  }
  schedulePersistFaviconCache();
}

function removeCachedFavicon(hostname) {
  if (!hostname) return;
  let changed = false;
  if (_favCache.has(hostname)) {
    _favCache.delete(hostname);
    changed = true;
  }
  if (_favPending.has(hostname)) {
    _favPending.delete(hostname);
    changed = true;
  }
  if (changed) schedulePersistFaviconCache();
}

function _testImg(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    // FIX 10: Reduced favicon timeout from 5s to 2s to avoid page sluggishness
    const t = setTimeout(rej, 2000);
    img.onload = function() { clearTimeout(t); (this.naturalWidth > 1 && this.naturalHeight > 1) ? res(url) : rej(); };
    img.onerror = () => { clearTimeout(t); rej(); };
    img.src = url;
  });
}

async function resolveFaviconUrl(hostname) {
  if (!hostname) return null;

  const cached = getCachedFavicon(hostname);
  if (cached !== undefined) return cached;

  if (_favPending.has(hostname)) return _favPending.get(hostname);

  const pending = (async () => {
    // Provider-first strategy: reliable hosted icon endpoint, then direct site fallback.
    const origin = 'https://' + hostname;

    const candidates = [
      `https://icons.duckduckgo.com/ip3/${hostname}.ico`,
      origin + '/favicon.ico'
    ];

    for (const candidate of candidates) {
      try {
        const url = await _testImg(candidate).catch(() => null);
        if (!url) continue;
        setCachedFavicon(hostname, url);
        return url;
      } catch(e) {}
    }

    // Cache misses too, to avoid repeated expensive retries.
    setCachedFavicon(hostname, null);
    return null;
  })();

  _favPending.set(hostname, pending);
  return pending.finally(() => {
    _favPending.delete(hostname);
  });
}

function loadFavicon(fav, fallbackEl, hostname) {
  if (!hostname) {
    fallbackEl.style.display = 'flex';
    fav.style.display = 'none';
    fav.removeAttribute('src');
    return;
  }

  fallbackEl.style.display = 'flex';
  fav.style.display = 'none';
  fav.removeAttribute('src');

  resolveFaviconUrl(hostname).then(url => {
    if (!url) return;
    fav.onload = () => { fallbackEl.style.display = 'none'; fav.style.display = 'block'; };
    fav.onerror = () => {
      // Mark bad URLs as a miss so future renders use the fast letter fallback.
      setCachedFavicon(hostname, null);
      fallbackEl.style.display = 'flex';
      fav.style.display = 'none';
      fav.removeAttribute('src');
    };
    fav.src = url;
  }).catch(() => {
    fallbackEl.style.display = 'flex';
    fav.style.display = 'none';
    fav.removeAttribute('src');
  });
}

loadPersistedFaviconCache();
window.addEventListener('beforeunload', () => {
  if (_favCacheSaveTimer) {
    clearTimeout(_favCacheSaveTimer);
    _favCacheSaveTimer = null;
    persistFaviconCacheNow();
  }
});

// ══════════════════════════════
//  WIDGET ENGINE
// ══════════════════════════════
const canvas = document.getElementById('canvas');

function makeWidget(cfg) {
  const id = cfg.id || ('w' + Date.now()); cfg.id = id;
  const el = document.createElement('div');
  el.className = 'wp'; el.id = 'wp-' + id;
  el.dataset.type = cfg.type;
  el.style.cssText = `left:${cfg.x||80}px;top:${cfg.y||80}px;width:${cfg.w||280}px;${cfg.h ? 'height:' + cfg.h + 'px;' : ''}z-index:${++zTop};`;
  if (cfg.rot) el.style.transform = `rotate(${cfg.rot}deg)`;

  const hdr = document.createElement('div'); hdr.className = 'wp-header';
  hdr.innerHTML = `<span class="wp-title">${cfg.type}</span><div class="wp-actions"><button class="wp-btn wp-close" title="close">✕</button></div>`;
  el.appendChild(hdr);

  const body = document.createElement('div'); body.className = 'wp-body'; el.appendChild(body);

  const rh = document.createElement('div'); rh.className = 'wp-resize';
  rh.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M9 1L1 9M9 5L5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  el.appendChild(rh);

  canvas.appendChild(el);
  wRefs[id] = { el, cfg, _cleanups: [] };

  buildWidgetBody(cfg.type, body, cfg, id);
  makeDraggable(el, hdr, id);
  makeResizable(el, rh, id);

  el.addEventListener('mousedown', () => { el.style.zIndex = ++zTop; });
  return el;
}

function makeDraggable(el, handle, id) {
  let ox = 0, oy = 0, dr = false;
  const onHandleMouseDown = e => {
    if (viewMode || e.target.classList.contains('wp-btn')) return;
    dr = true; ox = e.clientX - el.offsetLeft; oy = e.clientY - el.offsetTop;
    el.classList.add('dragging'); e.preventDefault();
  };
  const onDocMouseMove = e => {
    if (!dr) return;
    el.style.left = snap(e.clientX - ox) + 'px';
    el.style.top = snap(e.clientY - oy) + 'px';
  };
  const onDocMouseUp = () => {
    if (!dr) return;
    dr = false; el.classList.remove('dragging');
    if (wRefs[id]) { wRefs[id].cfg.x = el.offsetLeft; wRefs[id].cfg.y = el.offsetTop; }
    saveWidgets();
  };

  handle.addEventListener('mousedown', onHandleMouseDown);
  document.addEventListener('mousemove', onDocMouseMove);
  document.addEventListener('mouseup', onDocMouseUp);

  ensureCleanups(id).push(() => {
    handle.removeEventListener('mousedown', onHandleMouseDown);
    document.removeEventListener('mousemove', onDocMouseMove);
    document.removeEventListener('mouseup', onDocMouseUp);
  });
}

function makeResizable(el, handle, id) {
  let rs = false, sx = 0, sy = 0, sw = 0, sh = 0;
  let resizeRaf = 0;
  const onHandleMouseDown = e => {
    if (viewMode) return;
    rs = true; sx = e.clientX; sy = e.clientY; sw = el.offsetWidth; sh = el.offsetHeight;
    el.classList.add('resizing'); e.preventDefault(); e.stopPropagation();
  };
  const onDocMouseMove = e => {
    if (!rs) return;
    el.style.width = snap(Math.max(160, sw + (e.clientX - sx))) + 'px';
    el.style.height = snap(Math.max(60, sh + (e.clientY - sy))) + 'px';
    if (wRefs[id]) { wRefs[id].cfg.w = el.offsetWidth; wRefs[id].cfg.h = el.offsetHeight; }
    if (wRefs[id] && wRefs[id].cfg.type === 'clock' && !resizeRaf) {
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        if (wRefs[id] && wRefs[id].cfg.type === 'clock') updateClockSize(id);
      });
    }
  };
  const onDocMouseUp = () => {
    if (!rs) return;
    rs = false; el.classList.remove('resizing'); saveWidgets();
  };

  handle.addEventListener('mousedown', onHandleMouseDown);
  document.addEventListener('mousemove', onDocMouseMove);
  document.addEventListener('mouseup', onDocMouseUp);

  ensureCleanups(id).push(() => {
    handle.removeEventListener('mousedown', onHandleMouseDown);
    document.removeEventListener('mousemove', onDocMouseMove);
    document.removeEventListener('mouseup', onDocMouseUp);
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
  });
}

function saveWidgets() { S.widgets = Object.values(wRefs).map(r => r.cfg); save(); }

// ══════════════════════════════
//  WIDGET BODIES
// ══════════════════════════════
function buildWidgetBody(type, body, cfg, id) {
  if (type === 'clock') buildClock(body, cfg, id);
  else if (type === 'bookmark') buildBookmarkWidget(body, cfg, id);
  else if (type === 'todo') buildTodo(body, cfg, id);
  else if (type === 'note') buildNote(body, cfg, id);
  else if (type === 'pomodoro') buildPomodoro(body, cfg, id);
}

// ── CLOCK ──
function updateClockSize(id) {
  const r = wRefs[id]; if (!r) return;
  const el = r.el, cfg = r.cfg;
  const dig = el.querySelector('.clock-digital');
  const ana = el.querySelector('.clock-analog');
  if (!dig && !ana) return;
  const ww = el.offsetWidth || cfg.w || 280;
  const wh = el.offsetHeight || cfg.h || 160;
  const sz = Math.min(ww * .7, wh * .5, 150);
  if (dig) dig.style.fontSize = Math.max(28, sz) + 'px';
  const asz = Math.min(ww * .75, wh * .75, 200);
  if (ana) { ana.width = Math.max(100, asz); ana.height = Math.max(100, asz); }
}

function buildClock(body, cfg, id) {
  body.style.alignItems = 'center';
  body.style.justifyContent = 'center';
  body.style.padding = '16px 14px';

  const dig = document.createElement('div'); dig.className = 'clock-digital';
  const ana = document.createElement('canvas'); ana.className = 'clock-analog';
  const dateEl = document.createElement('div'); dateEl.className = 'clock-date';

  body.appendChild(dig); body.appendChild(ana); body.appendChild(dateEl);

  cfg.clockMode = cfg.clockMode || 'digital';

  function setMode(m, persist) {
    cfg.clockMode = m;
    dig.style.display = m === 'digital' ? '' : 'none';
    ana.style.display = m === 'analog' ? 'block' : 'none';
    if (persist) saveWidgets();
  }

  dig.addEventListener('click', () => { if (!viewMode) setMode('analog', true); });
  ana.addEventListener('click', () => { if (!viewMode) setMode('digital', true); });
  setMode(cfg.clockMode, false);
  updateClockSize(id);

  let tickTimer = null;
  let lastSecond = -1;
  let lastMinute = -1;

  function scheduleNextTick() {
    // Align to the next second boundary to reduce timer drift over long sessions.
    const delay = Math.max(100, 1000 - new Date().getMilliseconds());
    tickTimer = setTimeout(tick, delay);
  }

  function tick() {
    if (!document.getElementById('wp-' + id)) {
      tickTimer = null;
      return;
    }

    // Skip rendering while backgrounded; visibility handler resumes accurately.
    if (document.hidden) {
      scheduleNextTick();
      return;
    }

    const d = new Date(), h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();

    if (s === lastSecond) {
      scheduleNextTick();
      return;
    }
    lastSecond = s;

    updateClockSize(id);
    dig.innerHTML = `<span>${pad(h)}:${pad(m)}</span><span style="font-size:.42em;color:var(--text2);vertical-align:middle;margin-left:2px;">:${pad(s)}</span>`;
    if (m !== lastMinute) {
      dateEl.textContent = DAY_NAMES[d.getDay()] + ', ' + MONTH_NAMES[d.getMonth()] + ' ' + d.getDate();
      lastMinute = m;
    }

    if (cfg.clockMode === 'analog' && ana.style.display !== 'none') {
      const W = ana.width, H = ana.height, R = W * .42, cx = W / 2, cy = H / 2;
      const ctx = ana.getContext('2d');
      const isDark = S.theme === 'dark' || S.theme === 'glass';
      ctx.clearRect(0, 0, W, H);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'; ctx.fill();
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1.5; ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2, isM = i % 3 === 0;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (R - (isM ? R * .17 : R * .1)), cy + Math.sin(a) * (R - (isM ? R * .17 : R * .1)));
        ctx.lineTo(cx + Math.cos(a) * (R - R * .05), cy + Math.sin(a) * (R - R * .05));
        ctx.strokeStyle = isM ? 'rgba(180,175,165,0.7)' : 'rgba(128,128,128,0.25)';
        ctx.lineWidth = isM ? 2 : 1; ctx.stroke();
      }
      const hr = h % 12 + m / 60, mn = m + s / 60;
      function dh(ang, len, w, col) {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(0, len * .18); ctx.lineTo(0, -len);
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.stroke(); ctx.restore();
      }
      const handCol = isDark ? '#f0ede8' : '#1a1714';
      const secCol = isDark ? '#e05c5c' : '#c0392b';
      const accCol = isDark ? '#c8a96e' : (S.theme === 'bw' ? '#000' : '#8a6430');
      dh((hr / 12) * Math.PI * 2, R * .52, R * .04, handCol);
      dh((mn / 60) * Math.PI * 2, R * .72, R * .028, handCol);
      dh((s / 60) * Math.PI * 2, R * .78, R * .02, secCol);
      ctx.beginPath(); ctx.arc(cx, cy, R * .055, 0, Math.PI * 2);
      ctx.fillStyle = accCol; ctx.fill();
    }

    scheduleNextTick();
  }

  const onVisibilityChange = () => {
    if (document.hidden) return;
    lastSecond = -1;
    if (tickTimer) {
      clearTimeout(tickTimer);
      tickTimer = null;
    }
    tick();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);

  tick();

  // FIX 4 (cleanup): Clock registers its own _cleanup; other widgets that also need
  // cleanup use _cleanups array so they don't overwrite each other
  wRefs[id]._cleanups = wRefs[id]._cleanups || [];
  wRefs[id]._cleanups.push(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (tickTimer) {
      clearTimeout(tickTimer);
      tickTimer = null;
    }
  });
}

// ── BOOKMARK WIDGET ──
function buildBookmarkWidget(body, cfg, id) {
  body.style.padding = '0';
  const el = document.getElementById('wp-' + id);
  if (el) { el.style.background = 'var(--surface2)'; el.style.minWidth = '80px'; el.style.minHeight = '80px'; }

  const normalizedUrl = normalizeHttpUrl(cfg.bmUrl);
  const a = document.createElement('a'); a.className = 'bm-widget-inner';
  a.href = normalizedUrl || '#';

  const favWrap = document.createElement('div'); favWrap.className = 'bm-favicon-wrap';
  const fav = document.createElement('img'); fav.className = 'bm-widget-favicon';

  const hostname = getHostname(cfg.bmUrl);

  const letter = document.createElement('div'); letter.className = 'bm-favicon-letter';
  letter.textContent = (cfg.bmName || hostname || '?')[0].toUpperCase();
  letter.style.display = 'none';

  loadFavicon(fav, letter, hostname);

  const nm = document.createElement('div'); nm.className = 'bm-widget-name'; nm.textContent = cfg.bmName || hostname || '';
  favWrap.appendChild(fav); favWrap.appendChild(letter);
  a.appendChild(favWrap); a.appendChild(nm); body.appendChild(a);
}

// ── TODO ──
function buildTodo(body, cfg, id) {
  if (!cfg.todos) cfg.todos = [];
  const list = document.createElement('div'); list.className = 'todo-list-wrap';

  function renderTodos() {
    list.innerHTML = '';
    cfg.todos.forEach((t, i) => {
      const row = document.createElement('div'); row.className = 'ti' + (t.done ? ' done' : '');
      const chk = document.createElement('div'); chk.className = 'ti-chk' + (t.done ? ' on' : '');
      chk.addEventListener('click', () => { cfg.todos[i].done = !cfg.todos[i].done; saveWidgets(); renderTodos(); });
      const txt = document.createElement('span'); txt.className = 'ti-text'; txt.textContent = t.text;
      const del = document.createElement('span'); del.className = 'ti-del'; del.textContent = '×';
      del.addEventListener('click', () => { cfg.todos.splice(i, 1); saveWidgets(); renderTodos(); });
      row.appendChild(chk); row.appendChild(txt); row.appendChild(del); list.appendChild(row);
    });
  }
  renderTodos();

  const row = document.createElement('div'); row.className = 'todo-input-row';
  row.innerHTML = `<input class="mini-input" placeholder="Add a task…"><button class="add-btn">add</button>`;

  function addTodo() {
    const inp = row.querySelector('input'), v = inp.value.trim();
    if (!v) return;
    cfg.todos.push({ text: v, done: false }); saveWidgets(); renderTodos(); inp.value = '';
  }
  row.querySelector('.add-btn').addEventListener('click', addTodo);
  row.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });

  const wp = document.getElementById('wp-' + id);
  if (wp) {
    const acts = wp.querySelector('.wp-actions');
    const cb = document.createElement('button'); cb.className = 'wp-btn todo-clear-btn'; cb.title = 'clear done'; cb.textContent = '✓×';
    cb.addEventListener('click', () => { cfg.todos = cfg.todos.filter(t => !t.done); saveWidgets(); renderTodos(); });
    acts.insertBefore(cb, acts.firstChild);
  }

  body.appendChild(list); body.appendChild(row);
}

// ── NOTE ──
function buildNote(body, cfg, id) {
  if (!cfg.noteContent) cfg.noteContent = '';
  let editMode = true;

  const toolbar = document.createElement('div'); toolbar.className = 'note-toolbar';
  const fmts = [
    { l: 'B', a: () => wrap('**', '**') },
    { l: 'I', a: () => wrap('*', '*') },
    { l: '`', a: () => wrap('`', '`') },
    { l: 'H1', a: () => insertLine('# ') },
    { l: 'H2', a: () => insertLine('## ') },
    { l: '—', a: () => insertLine('---') },
    { l: '•', a: () => insertLine('- ') }
  ];
  fmts.forEach(f => {
    const b = document.createElement('button'); b.className = 'note-fmt-btn'; b.textContent = f.l;
    b.addEventListener('click', f.a); toolbar.appendChild(b);
  });
  const tog = document.createElement('button'); tog.className = 'note-fmt-btn note-toggle-btn'; tog.textContent = 'preview'; toolbar.appendChild(tog);

  const ta = document.createElement('textarea'); ta.className = 'note-edit-area';
  ta.placeholder = '**bold** *italic* `code`\n# heading\n- list';
  ta.value = cfg.noteContent;
  ta.addEventListener('input', () => { cfg.noteContent = ta.value; saveWidgets(); });

  const prev = document.createElement('div'); prev.className = 'note-preview-area';

  tog.addEventListener('click', () => {
    editMode = !editMode;
    ta.style.display = editMode ? '' : 'none';
    toolbar.querySelectorAll('.note-fmt-btn:not(.note-toggle-btn)').forEach(b => b.style.display = editMode ? '' : 'none');
    prev.style.display = editMode ? 'none' : 'block';
    tog.textContent = editMode ? 'preview' : 'edit';
    if (!editMode) prev.innerHTML = renderMD(cfg.noteContent);
  });

  function wrap(a, b) {
    const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.substring(s, e);
    ta.setRangeText(a + sel + b, s, e, 'end');
    cfg.noteContent = ta.value; saveWidgets(); ta.focus();
  }
  function insertLine(prefix) {
    const s = ta.selectionStart;
    ta.setRangeText('\n' + prefix, s, s, 'end');
    cfg.noteContent = ta.value; saveWidgets(); ta.focus();
  }

  const wp = document.getElementById('wp-' + id);
  if (wp) {
    const acts = wp.querySelector('.wp-actions');
    const cb = document.createElement('button'); cb.className = 'wp-btn'; cb.title = 'clear'; cb.textContent = '⌫';
    cb.addEventListener('click', () => { ta.value = ''; cfg.noteContent = ''; saveWidgets(); prev.innerHTML = ''; });
    acts.insertBefore(cb, acts.firstChild);
  }

  function syncViewMode() {
    if (viewMode) {
      prev.innerHTML = renderMD(cfg.noteContent);
      prev.style.display = 'block';
      ta.style.display = 'none';
    }
  }

  const obs = new MutationObserver(() => syncViewMode());
  obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // FIX 4: Use _cleanups array instead of overwriting _cleanup
  wRefs[id]._cleanups = wRefs[id]._cleanups || [];
  wRefs[id]._cleanups.push(() => obs.disconnect());

  body.style.overflow = 'hidden';
  body.appendChild(toolbar); body.appendChild(ta); body.appendChild(prev);
  syncViewMode();
}

// ── POMODORO ──
function buildPomodoro(body, cfg, id) {
  const MODES = { focus: 25 * 60, shortBreak: 5 * 60, longBreak: 15 * 60 };
  const STATE_VERSION = 1;
  const STORAGE_SYNC_INTERVAL_MS = 10000;
  const TAB_ID = (window.__sp3TabId = window.__sp3TabId || (Date.now().toString(36) + Math.random().toString(36).slice(2)));
  const LOCK_KEY = 'sp3_pomo_lock_' + id;
  const LOCK_TTL_MS = 15000;
  const LOCK_RENEW_INTERVAL_MS = 5000;
  let uiTimer = null;
  let lastStorageSyncAt = 0;
  let lastLockRenewAt = 0;

  function getDefaultState() {
    return {
      mode: 'focus',
      status: 'idle',
      startedAt: null,
      endsAt: null,
      sessionsCompleted: Number(cfg.pomoSessions || 0),
      version: STATE_VERSION,
      updatedAt: 0,
      writerId: ''
    };
  }

  function normalizeState(raw) {
    const fallback = getDefaultState();
    const out = raw && typeof raw === 'object' ? raw : fallback;
    const mode = (out.mode === 'shortBreak' || out.mode === 'longBreak' || out.mode === 'focus') ? out.mode : 'focus';
    const status = (out.status === 'running' || out.status === 'paused' || out.status === 'idle') ? out.status : 'idle';
    const startedAt = (typeof out.startedAt === 'number' && Number.isFinite(out.startedAt)) ? out.startedAt : null;
    const endsAt = (typeof out.endsAt === 'number' && Number.isFinite(out.endsAt)) ? out.endsAt : null;
    const sessionsCompleted = Math.max(0, Number.isFinite(+out.sessionsCompleted) ? Math.floor(+out.sessionsCompleted) : 0);
    const version = Number.isFinite(+out.version) ? Math.max(1, Math.floor(+out.version)) : STATE_VERSION;
    const updatedAt = Number.isFinite(+out.updatedAt) ? Math.max(0, Math.floor(+out.updatedAt)) : 0;
    const writerId = typeof out.writerId === 'string' ? out.writerId : '';
    return { mode, status, startedAt, endsAt, sessionsCompleted, version, updatedAt, writerId };
  }

  let state = normalizeState(cfg.pomoState || {
    mode: cfg.pomoMode || 'focus',
    status: (cfg.pomoRunning ? 'running' : 'idle'),
    startedAt: null,
    endsAt: null,
    sessionsCompleted: Number(cfg.pomoSessions || 0),
    version: STATE_VERSION,
    updatedAt: 0,
    writerId: ''
  });

  function saveWidgetsImmediate() {
    S.widgets = Object.values(wRefs).map(r => r.cfg);
    save(true);
  }

  function readLock() {
    try {
      const raw = localStorage.getItem(LOCK_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (typeof parsed.ownerId !== 'string') return null;
      if (!Number.isFinite(+parsed.expiresAt)) return null;
      return { ownerId: parsed.ownerId, expiresAt: Math.floor(+parsed.expiresAt) };
    } catch (e) {
      return null;
    }
  }

  function writeLock(ownerId, expiresAt) {
    try {
      localStorage.setItem(LOCK_KEY, JSON.stringify({ ownerId, expiresAt }));
      return true;
    } catch (e) {
      return false;
    }
  }

  function isLockOwnedByMe() {
    const lock = readLock();
    return !!(lock && lock.ownerId === TAB_ID && lock.expiresAt > Date.now());
  }

  function tryAcquireLock(force = false) {
    const now = Date.now();
    const lock = readLock();
    const canAcquire = force || !lock || lock.expiresAt <= now || lock.ownerId === TAB_ID;
    if (!canAcquire) return false;
    const ok = writeLock(TAB_ID, now + LOCK_TTL_MS);
    if (ok) lastLockRenewAt = now;
    return ok;
  }

  function renewLockIfNeeded() {
    if (!isLockOwnedByMe()) return false;
    const now = Date.now();
    if ((now - lastLockRenewAt) < LOCK_RENEW_INTERVAL_MS) return true;
    const ok = writeLock(TAB_ID, now + LOCK_TTL_MS);
    if (ok) lastLockRenewAt = now;
    return ok;
  }

  function releaseLock() {
    try {
      const lock = readLock();
      if (lock && lock.ownerId === TAB_ID) localStorage.removeItem(LOCK_KEY);
    } catch (e) {}
  }

  function isRemoteFresher(remote, local) {
    if (remote.version > local.version) return true;
    if (remote.version < local.version) return false;
    if (remote.updatedAt > local.updatedAt) return true;
    if (remote.updatedAt < local.updatedAt) return false;
    return remote.writerId > local.writerId;
  }

  function mergeEqualVersion(remote, local) {
    const merged = { ...(isRemoteFresher(remote, local) ? remote : local) };
    merged.sessionsCompleted = Math.max(remote.sessionsCompleted, local.sessionsCompleted);
    return merged;
  }

  function syncStateFromStorage(force = false) {
    const now = Date.now();
    if (!force) {
      if (document.hidden) return;
      if ((now - lastStorageSyncAt) < STORAGE_SYNC_INTERVAL_MS) return;
    }
    lastStorageSyncAt = now;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.widgets)) return;
      const remoteCfg = parsed.widgets.find(w => w && w.id === cfg.id);
      if (!remoteCfg || !remoteCfg.pomoState) return;
      const remoteState = normalizeState(remoteCfg.pomoState);
      if (remoteState.version === state.version) {
        state = mergeEqualVersion(remoteState, state);
      } else if (isRemoteFresher(remoteState, state)) {
        state = remoteState;
      }
    } catch (e) {}
  }

  function persistState() {
    if (!isLockOwnedByMe() && !tryAcquireLock(true)) return;
    state.version += 1;
    state.updatedAt = Date.now();
    state.writerId = TAB_ID;
    cfg.pomoState = {
      mode: state.mode,
      status: state.status,
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      sessionsCompleted: state.sessionsCompleted,
      version: state.version,
      updatedAt: state.updatedAt,
      writerId: state.writerId
    };
    // Keep legacy field updated for existing UI/read paths.
    cfg.pomoSessions = state.sessionsCompleted;
    saveWidgetsImmediate();
  }

  function getPhaseDurationMs(mode) {
    return MODES[mode] * 1000;
  }

  function getRemainingMs(nowMs) {
    if (state.status === 'running' && typeof state.endsAt === 'number') {
      return Math.max(0, state.endsAt - nowMs);
    }
    // In paused state we store remaining milliseconds in endsAt.
    if (state.status === 'paused' && typeof state.endsAt === 'number') {
      return Math.max(0, state.endsAt);
    }
    return getPhaseDurationMs(state.mode);
  }

  function setIdleAtWork() {
    state.mode = 'focus';
    state.status = 'idle';
    state.startedAt = null;
    state.endsAt = null;
  }

  function setRunningForCurrentMode(nowMs, durationMs) {
    state.status = 'running';
    state.startedAt = nowMs;
    state.endsAt = nowMs + durationMs;
  }

  function applyCatchUp() {
    if (!isLockOwnedByMe() && !tryAcquireLock(false)) return false;
    renewLockIfNeeded();
    if (state.status !== 'running' || typeof state.endsAt !== 'number') return false;

    const now = Date.now();
    let changed = false;

    // Process overdue running phases until we hit work-idle boundary.
    while (state.status === 'running' && typeof state.endsAt === 'number' && now >= state.endsAt) {
      if (state.mode === 'focus') {
        state.sessionsCompleted += 1;
        state.mode = (state.sessionsCompleted % 4 === 0) ? 'longBreak' : 'shortBreak';
        const nextStart = state.endsAt;
        state.status = 'running';
        state.startedAt = nextStart;
        state.endsAt = nextStart + getPhaseDurationMs(state.mode);
      } else {
        // Break completion transitions to work, but work must not auto-start.
        setIdleAtWork();
      }
      changed = true;

      // Stop catch-up when we land on work and require manual start.
      if (state.mode === 'focus' && state.status === 'idle') break;
    }

    if (changed) persistState();
    return changed;
  }

  body.innerHTML = `
    <div class="pomo-time" id="pt-${id}">25:00</div>
    <div class="pomo-label" id="pl-${id}">focus</div>
    <div class="pomo-track"><div class="pomo-bar" id="pb-${id}" style="width:100%"></div></div>
    <div class="pomo-btns">
      <button class="pomo-btn" id="ps-${id}">start</button>
      <button class="pomo-btn" id="pr-${id}">reset</button>
    </div>
    <div class="pomo-modes">
      <span class="pomo-mode active" data-m="focus">focus</span>
      <span class="pomo-mode" data-m="shortBreak">5m</span>
      <span class="pomo-mode" data-m="longBreak">15m</span>
    </div>
    <div class="pomo-sessions">sessions: <span id="psc-${id}">${state.sessionsCompleted}</span></div>`;

  function upd() {
    syncStateFromStorage(false);
    applyCatchUp();
    if (state.status !== 'running' && isLockOwnedByMe()) {
      releaseLock();
    }
    const now = Date.now();
    const remainingMs = getRemainingMs(now);
    const remainingSec = Math.ceil(remainingMs / 1000);
    const phaseTotalMs = getPhaseDurationMs(state.mode);

    document.getElementById('pt-' + id).textContent = pad(Math.floor(remainingSec / 60)) + ':' + pad(remainingSec % 60);
    document.getElementById('pl-' + id).textContent = state.mode === 'focus' ? 'focus' : state.mode === 'shortBreak' ? 'short break' : 'long break';
    document.getElementById('pb-' + id).style.width = (Math.max(0, Math.min(1, remainingMs / phaseTotalMs)) * 100) + '%';
    document.getElementById('ps-' + id).textContent = state.status === 'running' ? 'pause' : (state.status === 'paused' ? 'resume' : 'start');
    document.getElementById('psc-' + id).textContent = state.sessionsCompleted;
    body.querySelectorAll('.pomo-mode').forEach(m => m.classList.toggle('active', m.dataset.m === state.mode));
  }

  document.getElementById('ps-' + id).addEventListener('click', () => {
    const now = Date.now();
    tryAcquireLock(true);
    syncStateFromStorage(true);
    applyCatchUp();

    if (state.status === 'running') {
      const remainingMs = getRemainingMs(now);
      state.status = 'paused';
      state.startedAt = null;
      state.endsAt = remainingMs;
      persistState();
      releaseLock();
    } else {
      const durationMs = (state.status === 'paused')
        ? Math.max(1000, typeof state.endsAt === 'number' ? state.endsAt : getPhaseDurationMs(state.mode))
        : getPhaseDurationMs(state.mode);
      setRunningForCurrentMode(now, durationMs);
      persistState();
      renewLockIfNeeded();
    }
    upd();
  });

  document.getElementById('pr-' + id).addEventListener('click', () => {
    tryAcquireLock(true);
    state.status = 'idle';
    state.startedAt = null;
    state.endsAt = null;
    persistState();
    releaseLock();
    upd();
  });

  body.querySelectorAll('.pomo-mode').forEach(mb => mb.addEventListener('click', () => {
    const nextMode = mb.dataset.m;
    if (!MODES[nextMode]) return;
    tryAcquireLock(true);
    state.mode = nextMode;
    state.status = 'idle';
    state.startedAt = null;
    state.endsAt = null;
    persistState();
    releaseLock();
    upd();
  }));

  function onWindowResume() {
    syncStateFromStorage(true);
    applyCatchUp();
    upd();
  }

  function onStorageSync(e) {
    if (e.key !== STORAGE_KEY && e.key !== LOCK_KEY) return;
    syncStateFromStorage(true);
    upd();
  }

  function onBeforeUnload() {
    releaseLock();
  }

  window.addEventListener('focus', onWindowResume);
  document.addEventListener('visibilitychange', onWindowResume);
  window.addEventListener('storage', onStorageSync);
  window.addEventListener('beforeunload', onBeforeUnload);

  // Regular UI tick; catch-up also runs here.
  uiTimer = setInterval(upd, 1000);

  // FIX 4: Use _cleanups array
  wRefs[id]._cleanups = wRefs[id]._cleanups || [];
  wRefs[id]._cleanups.push(() => {
    if (uiTimer) {
      clearInterval(uiTimer);
      uiTimer = null;
    }
    window.removeEventListener('focus', onWindowResume);
    document.removeEventListener('visibilitychange', onWindowResume);
    window.removeEventListener('storage', onStorageSync);
    window.removeEventListener('beforeunload', onBeforeUnload);
    releaseLock();
  });

  // Apply catch-up on widget load.
  syncStateFromStorage(true);
  upd();
}

// ══════════════════════════════
//  WIDGET CLOSE — with cleanup
// ══════════════════════════════
function closeWidget(id) {
  const ref = wRefs[id];
  if (!ref) return;
  // FIX 4: Run all cleanups, not just one
  if (Array.isArray(ref._cleanups)) ref._cleanups.forEach(fn => { try { fn(); } catch(e) {} });
  ref.el.remove();
  delete wRefs[id];
  S.widgets = S.widgets.filter(w => w.id !== id);
  save();
}

canvas.addEventListener('click', e => {
  const closeBtn = e.target.closest('.wp-close');
  if (!closeBtn) return;
  const wp = closeBtn.closest('.wp');
  if (!wp) return;
  const id = wp.id.replace('wp-', '');
  closeWidget(id);
});

// ══════════════════════════════
//  ADD WIDGETS
// ══════════════════════════════
const defSizes = { clock: { w: 280, h: 160 }, bookmark: { w: 100, h: 100 }, todo: { w: 280, h: 260 }, note: { w: 320, h: 280 }, pomodoro: { w: 260, h: 230 } };

document.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', () => {
  const type = btn.dataset.add, sz = defSizes[type];
  const cfg = { id: 'w' + Date.now(), type, x: snap(80 + Math.random() * 200), y: snap(80 + Math.random() * 100), w: sz.w, h: sz.h };
  S.widgets.push(cfg); makeWidget(cfg); saveWidgets();
}));

// ══════════════════════════════
//  BOOKMARKS PANEL
// ══════════════════════════════
if (!S.bookmarks) S.bookmarks = [];
const bmPanel = document.getElementById('bm-panel');

function renderBmSaved() {
  const list = document.getElementById('bm-saved-list'); list.innerHTML = '';
  S.bookmarks.forEach((bm) => {
    const item = document.createElement('div'); item.className = 'bm-saved-item';
    const hostname = getHostname(bm.url);

    const favWrap = document.createElement('div'); favWrap.style.cssText = 'width:24px;height:24px;position:relative;flex-shrink:0;';
    const fav = document.createElement('img'); fav.style.cssText = 'width:24px;height:24px;border-radius:6px;display:block;';
    const ltr = document.createElement('div'); ltr.style.cssText = 'width:24px;height:24px;border-radius:6px;background:var(--surface2);display:none;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:var(--text2);';
    ltr.textContent = (bm.name || hostname || '?')[0].toUpperCase();
    loadFavicon(fav, ltr, hostname);

    const nm = document.createElement('span'); nm.textContent = bm.name;

    const del = document.createElement('div'); del.className = 'bm-saved-del'; del.textContent = '×';
    del.addEventListener('click', e => {
      e.stopPropagation();
      const idx = S.bookmarks.indexOf(bm);
      if (idx !== -1) {
        S.bookmarks.splice(idx, 1);
        removeCachedFavicon(getHostname(bm.url));
        save();
      }
      renderBmSaved();
    });

    favWrap.appendChild(fav); favWrap.appendChild(ltr);
    item.appendChild(favWrap); item.appendChild(nm); item.appendChild(del);

    item.addEventListener('click', () => {
      const sz = defSizes.bookmark;
      const cfg = { id: 'w' + Date.now(), type: 'bookmark', bmUrl: bm.url, bmName: bm.name, x: snap(100 + Math.random() * 300), y: snap(100 + Math.random() * 200), w: sz.w, h: sz.h };
      S.widgets.push(cfg); makeWidget(cfg); saveWidgets();
      bmPanel.classList.remove('open');
    });

    list.appendChild(item);
  });
}
renderBmSaved();

document.getElementById('bm-launcher-btn').addEventListener('click', () => bmPanel.classList.toggle('open'));
document.getElementById('bm-panel-close').addEventListener('click', () => bmPanel.classList.remove('open'));

document.getElementById('bm-add-btn').addEventListener('click', () => {
  let url = document.getElementById('bm-url-inp').value.trim();
  const name = document.getElementById('bm-name-inp').value.trim();
  if (!url) return;
  url = normalizeHttpUrl(url);
  S.bookmarks.push({ name: name || url, url }); save(); renderBmSaved();
  document.getElementById('bm-name-inp').value = ''; document.getElementById('bm-url-inp').value = '';
});

document.getElementById('bm-url-inp').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('bm-add-btn').click(); });

// ══════════════════════════════
//  PANEL OUTSIDE-CLICK HANDLING
// FIX 2: Use a clean mousedown-start / mouseup-end drag detection.
//        The click listener checks a flag that is only set when the pointer
//        actually moved while the button was held — preventing false dismissal.
// ══════════════════════════════
let _dragMoved = false;
let _dragStarted = false;

document.addEventListener('mousedown', () => {
  _dragStarted = true;
  _dragMoved = false;
});
document.addEventListener('mousemove', e => {
  if (_dragStarted && e.buttons === 1) _dragMoved = true;
});
document.addEventListener('mouseup', () => {
  _dragStarted = false;
  // _dragMoved intentionally left true until click fires (same event loop tick)
});

document.addEventListener('click', e => {
  // If the pointer moved during this press, it was a drag-release — don't close panels
  if (_dragMoved) { _dragMoved = false; return; }
  _dragMoved = false;
  if (!e.target.closest('#bm-panel') && !e.target.closest('#bm-launcher-btn')) bmPanel.classList.remove('open');
  if (!e.target.closest('#bg-panel') && !e.target.closest('#bg-toggle-btn')) bgPanel.classList.remove('open');
});

// ══════════════════════════════
//  FREE TEXT
// FIX 8: Each FT note's drag listeners are attached to the wrap element,
//        not to document, so they don't accumulate globally.
// ══════════════════════════════
let ftMode = false;
if (!S.ftNotes) S.ftNotes = [];
const ftHint = document.getElementById('ft-hint');
const ftToggle = document.getElementById('ft-toggle-btn');
const ftStyleBar = document.getElementById('ft-stylebar');
const ftSizeDecBtn = document.getElementById('ft-size-dec');
const ftSizeIncBtn = document.getElementById('ft-size-inc');
const ftRotDecBtn = document.getElementById('ft-rot-dec');
const ftRotIncBtn = document.getElementById('ft-rot-inc');
const ftBoldBtn = document.getElementById('ft-bold');
const ftColorInp = document.getElementById('ft-color');
const ftSizeRead = document.getElementById('ft-size-read');
const ftRotRead = document.getElementById('ft-rot-read');
const ftDeleteBtn = document.getElementById('ft-del');
let activeFT = null;

function clampFtSize(v) { return Math.max(10, Math.min(64, v)); }
function normalizeRotation(v) {
  const n = Number(v) || 0;
  const mod = ((n % 360) + 360) % 360;
  return mod > 180 ? mod - 360 : mod;
}

function applyFTStyles(ta, noteObj) {
  const size = clampFtSize(noteObj.size || 14);
  const weight = noteObj.weight === 600 ? 600 : 400;
  ta.style.fontSize = size + 'px';
  ta.style.fontWeight = String(weight);
  ta.style.color = noteObj.color || 'var(--text)';
  noteObj.size = size;
  noteObj.weight = weight;
}

function positionFtStylebar() {
  if (!activeFT || !ftStyleBar.classList.contains('show')) return;
  const r = activeFT.wrap.getBoundingClientRect();
  const x = Math.min(window.innerWidth - ftStyleBar.offsetWidth - 8, Math.max(8, r.left));
  const y = Math.max(8, r.top - ftStyleBar.offsetHeight - 8);
  ftStyleBar.style.left = x + 'px';
  ftStyleBar.style.top = y + 'px';
}

function applyFTRotation(wrap, noteObj) {
  const rot = normalizeRotation(noteObj.rot || 0);
  noteObj.rot = rot;
  wrap.style.transform = rot ? `rotate(${rot}deg)` : '';
}

function setActiveFT(ref) {
  activeFT = (viewMode || !ref) ? null : ref;
  if (!activeFT) {
    ftStyleBar.classList.remove('show');
    return;
  }
  ftBoldBtn.classList.toggle('active', activeFT.noteObj.weight === 600);
  ftColorInp.value = activeFT.noteObj.color || '#f0ede8';
  ftSizeRead.textContent = (activeFT.noteObj.size || 14) + 'px';
  ftRotRead.textContent = (activeFT.noteObj.rot || 0) + '°';
  ftStyleBar.classList.add('show');
  positionFtStylebar();
}

ftStyleBar.addEventListener('mousedown', e => e.preventDefault());
ftSizeDecBtn.addEventListener('click', () => {
  if (!activeFT) return;
  activeFT.noteObj.size = clampFtSize((activeFT.noteObj.size || 14) - 1);
  applyFTStyles(activeFT.ta, activeFT.noteObj);
  ftSizeRead.textContent = activeFT.noteObj.size + 'px';
  save();
  activeFT.ta.focus();
});
ftSizeIncBtn.addEventListener('click', () => {
  if (!activeFT) return;
  activeFT.noteObj.size = clampFtSize((activeFT.noteObj.size || 14) + 1);
  applyFTStyles(activeFT.ta, activeFT.noteObj);
  ftSizeRead.textContent = activeFT.noteObj.size + 'px';
  save();
  activeFT.ta.focus();
});
ftRotDecBtn.addEventListener('click', () => {
  if (!activeFT) return;
  activeFT.noteObj.rot = normalizeRotation((activeFT.noteObj.rot || 0) - 5);
  applyFTRotation(activeFT.wrap, activeFT.noteObj);
  ftRotRead.textContent = activeFT.noteObj.rot + '°';
  positionFtStylebar();
  save();
  activeFT.ta.focus();
});
ftRotIncBtn.addEventListener('click', () => {
  if (!activeFT) return;
  activeFT.noteObj.rot = normalizeRotation((activeFT.noteObj.rot || 0) + 5);
  applyFTRotation(activeFT.wrap, activeFT.noteObj);
  ftRotRead.textContent = activeFT.noteObj.rot + '°';
  positionFtStylebar();
  save();
  activeFT.ta.focus();
});
ftBoldBtn.addEventListener('click', () => {
  if (!activeFT) return;
  activeFT.noteObj.weight = activeFT.noteObj.weight === 600 ? 400 : 600;
  applyFTStyles(activeFT.ta, activeFT.noteObj);
  ftBoldBtn.classList.toggle('active', activeFT.noteObj.weight === 600);
  save();
  activeFT.ta.focus();
});
ftColorInp.addEventListener('input', () => {
  if (!activeFT) return;
  activeFT.noteObj.color = ftColorInp.value;
  applyFTStyles(activeFT.ta, activeFT.noteObj);
  save();
});
ftDeleteBtn.addEventListener('click', () => {
  if (!activeFT) return;
  const idx = S.ftNotes.indexOf(activeFT.noteObj);
  if (idx !== -1) S.ftNotes.splice(idx, 1);
  activeFT.wrap.remove();
  setActiveFT(null);
  save();
});
window.addEventListener('resize', positionFtStylebar);

function makeFTNote(noteObj) {
  if (typeof noteObj.w !== 'number') noteObj.w = 140;
  if (typeof noteObj.h !== 'number') noteObj.h = 0;
  if (typeof noteObj.size !== 'number') noteObj.size = 14;
  if (noteObj.weight !== 600) noteObj.weight = 400;
  if (typeof noteObj.color !== 'string') noteObj.color = '';
  noteObj.rot = normalizeRotation(noteObj.rot || 0);

  const wrap = document.createElement('div'); wrap.className = 'ft-wrapper';
  wrap.style.cssText = `left:${noteObj.x}px;top:${noteObj.y}px;position:absolute;z-index:${++zTop};`;
  applyFTRotation(wrap, noteObj);

  const del = document.createElement('button'); del.className = 'ft-del-btn'; del.textContent = '×';
  del.addEventListener('click', () => {
    const i = S.ftNotes.indexOf(noteObj);
    if (i !== -1) S.ftNotes.splice(i, 1);
    save(); wrap.remove();
  });

  const rz = document.createElement('div');
  rz.className = 'ft-resize';
  rz.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M9 1L1 9M9 5L5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  const ta = document.createElement('textarea'); ta.className = 'ft-note';
  ta.value = noteObj.text || ''; ta.placeholder = 'type…';
  ta.style.cssText = `width:${noteObj.w}px;${noteObj.h > 0 ? 'height:' + noteObj.h + 'px;overflow-y:auto;' : ''}`;
  applyFTStyles(ta, noteObj);

  ta.addEventListener('input', () => {
    if (noteObj.h > 0) {
      ta.style.overflowY = 'auto';
    } else {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
    noteObj.text = ta.value; save();
    positionFtStylebar();
  });

  ta.addEventListener('focus', () => setActiveFT({ noteObj, ta, wrap }));
  ta.addEventListener('click', () => setActiveFT({ noteObj, ta, wrap }));
  ta.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement !== ta) setActiveFT(null);
    }, 120);
  });

  // FIX 8: mousemove and mouseup listeners on document, but stored as named
  // functions and removed when the drag ends (or when the note is deleted).
  let dr2 = false, ox2 = 0, oy2 = 0;
  let rs2 = false, rsx = 0, rsy = 0, rsw = 0, rsh = 0;

  function onMove(e) {
    if (!dr2) return;
    wrap.style.left = (e.clientX - ox2) + 'px';
    wrap.style.top = (e.clientY - oy2) + 'px';
    if (activeFT && activeFT.noteObj === noteObj) positionFtStylebar();
  }
  function onUp() {
    if (!dr2) return;
    dr2 = false;
    noteObj.x = wrap.offsetLeft; noteObj.y = wrap.offsetTop; save();
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (activeFT && activeFT.noteObj === noteObj) positionFtStylebar();
  }

  function onResizeMove(e) {
    if (!rs2) return;
    const newW = Math.max(90, rsw + (e.clientX - rsx));
    const newH = Math.max(24, rsh + (e.clientY - rsy));
    noteObj.w = Math.round(newW);
    noteObj.h = Math.round(newH);
    ta.style.width = noteObj.w + 'px';
    ta.style.height = noteObj.h + 'px';
    ta.style.overflowY = 'auto';
    if (activeFT && activeFT.noteObj === noteObj) positionFtStylebar();
  }

  function onResizeUp() {
    if (!rs2) return;
    rs2 = false;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeUp);
    save();
  }

  wrap.addEventListener('mousedown', e => {
    if (viewMode || (e.target === ta && document.activeElement === ta) || e.target === del || e.target.closest('.ft-resize')) return;
    dr2 = true; ox2 = e.clientX - wrap.offsetLeft; oy2 = e.clientY - wrap.offsetTop; e.preventDefault();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  rz.addEventListener('mousedown', e => {
    if (viewMode) return;
    e.preventDefault();
    e.stopPropagation();
    rs2 = true;
    rsx = e.clientX;
    rsy = e.clientY;
    rsw = ta.offsetWidth;
    rsh = ta.offsetHeight;
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeUp);
  });

  // Also clean up listeners when note is explicitly deleted
  del.addEventListener('click', () => {
    if (activeFT && activeFT.noteObj === noteObj) setActiveFT(null);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeUp);
  });

  wrap.appendChild(del); wrap.appendChild(rz); wrap.appendChild(ta); canvas.appendChild(wrap);
  setTimeout(() => {
    if (noteObj.h > 0) {
      ta.style.height = noteObj.h + 'px';
      ta.style.overflowY = 'auto';
    } else {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
  }, 0);
}

function renderFT() {
  setActiveFT(null);
  document.querySelectorAll('.ft-wrapper').forEach(e => e.remove());
  S.ftNotes.forEach(n => makeFTNote(n));
}
renderFT();

ftToggle.addEventListener('click', () => {
  ftMode = !ftMode;
  ftToggle.classList.toggle('active', ftMode);
  ftHint.classList.toggle('show', ftMode);
  if (ftMode) setTimeout(() => ftHint.classList.remove('show'), 4000);
});

canvas.addEventListener('click', e => {
  if (!ftMode) return;
  if (e.target.classList.contains('ft-note') || e.target.classList.contains('ft-del-btn') || e.target.classList.contains('ft-wrapper') || e.target.classList.contains('ft-resize')) return;
  if (e.target.closest('.wp')) return;
  const note = { x: e.clientX, y: e.clientY, text: '', w: 140, h: 0, size: 14, weight: 400, color: '', rot: 0 };
  S.ftNotes.push(note); save();
  makeFTNote(note);
  setTimeout(() => { const all = document.querySelectorAll('.ft-note'); if (all.length) all[all.length - 1].focus(); }, 30);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    setActiveFT(null);
    if (ftMode) { ftMode = false; ftToggle.classList.remove('active'); ftHint.classList.remove('show'); }
  }
});

// ══════════════════════════════
//  EXPORT / IMPORT
// ══════════════════════════════
function exportSettings() {
  const data = JSON.stringify(S, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `startpage-settings-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showNotification('Settings exported', { body: 'Your startpage settings have been saved.' });
}

function importSettings(file) {
  if (!file || file.size > 5 * 1024 * 1024) {
    showNotification('Import failed', { body: 'File is missing or too large.' });
    return;
  }

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!imported || typeof imported !== 'object' || Array.isArray(imported)) {
        throw new Error('Invalid root object');
      }
      dMerge(S, imported);
      if (!Array.isArray(S.widgets)) S.widgets = [];
      if (!Array.isArray(S.ftNotes)) S.ftNotes = [];
      if (!Array.isArray(S.bookmarks)) S.bookmarks = [];
      save();
      
      // Reload page to apply all settings
      showNotification('Settings imported', { body: 'Reloading with new settings...' });
      setTimeout(() => location.reload(), 500);
    } catch(e) {
      showNotification('Import failed', { body: 'Invalid file or corrupted data.' });
      console.error('Import error:', e);
    }
  };
  reader.readAsText(file);
}

document.getElementById('export-btn').addEventListener('click', exportSettings);
document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', e => {
  if (e.target.files[0]) {
    importSettings(e.target.files[0]);
    e.target.value = '';
  }
});

// ══════════════════════════════
//  RESTORE SAVED WIDGETS
// ══════════════════════════════
S.widgets.forEach(cfg => makeWidget(cfg));


