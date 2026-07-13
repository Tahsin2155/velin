// ══════════════════════════════
//  STATE
// ══════════════════════════════
const DEF = {
  theme: 'dark',
  viewMode: false,
  blurMode: 'auto',   // 'auto' | 'on' | 'off'
  bg: { type: 'solid', value: '#0d0d0f' },
  widgets: [],
  ftNotes: [],
  bookmarks: []
};

// FIX: dMerge with recursion depth cap to prevent stack overflow on deep nested imports
function dMerge(t, s, _depth = 0) {
  if (_depth > 20) return; // cap recursion depth
  for (const k in s) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) {
      t[k] = t[k] || {};
      dMerge(t[k], s[k], _depth + 1);
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

// ══════════════════════════════
//  STORAGE  (VelinStore — see storage.js)
//  S stays as the in-memory working copy widgets/UI code reads and mutates
//  directly, same as before. save()/saveWidgets() now write only the
//  specific record(s) that changed into normalized IndexedDB stores,
//  instead of re-serializing the entire app state on every call.
// ══════════════════════════════

// Generic "something changed, persist relevant meta" — covers theme,
// blurMode, viewMode, bg (the non-widget/bookmark/ftNote state on S).
function save(flush = false) {
  VelinStore.setMeta('theme', S.theme, flush);
  VelinStore.setMeta('blurMode', S.blurMode, flush);
  VelinStore.setMeta('viewMode', S.viewMode, flush);
  VelinStore.setMeta('bg', S.bg, flush);
}

function saveNow() { save(true); }

// ══════════════════════════════
//  BACKGROUND IMAGE SIZE GUARD
//  Generous now that images are stored as Blobs (not base64 in JSON) —
//  the old 500KB base64 ceiling was a symptom of the old storage design,
//  not a real IndexedDB limitation.
// ══════════════════════════════
const IMG_SIZE_WARN_BYTES = 8 * 1024 * 1024; // 8 MB

// ══════════════════════════════
//  BOOTSTRAP  (async IDB load → then render)
// ══════════════════════════════
let _appBooted = false;
let _currentBgObjectUrl = null; // object URL for the active bg image Blob; revoked when replaced

// Hydrate persisted state from normalized stores and render the app once storage is ready.
async function bootApp() {
  if (_appBooted) return;
  _appBooted = true;

  try {
    await VelinStore.openDB();
    await VelinStore.migrateLegacyIfNeeded();
    VelinStore.requestPersistence();

    const [meta, widgets, bookmarks, ftNotes] = await Promise.all([
      VelinStore.getAllMeta(),
      VelinStore.getAllWidgets(),
      VelinStore.getAllBookmarks(),
      VelinStore.getAllFtNotes()
    ]);

    if (meta.theme) S.theme = meta.theme;
    if (meta.blurMode) S.blurMode = meta.blurMode;
    if (typeof meta.viewMode === 'boolean') S.viewMode = meta.viewMode;
    if (meta.bg) S.bg = meta.bg;

    S.widgets = Array.isArray(widgets) ? widgets : [];
    if (S.widgets.length > 50) {
      console.warn(`Clamping widget count from ${S.widgets.length} to 50`);
      S.widgets = S.widgets.slice(-50);
    }
    S.bookmarks = Array.isArray(bookmarks) ? bookmarks : [];
    S.ftNotes = Array.isArray(ftNotes) ? ftNotes : [];

    await loadPersistedFaviconCache();

  } catch (e) {
    console.error('VelinStore boot failed, starting with defaults:', e);
    S.widgets = []; S.bookmarks = []; S.ftNotes = [];
  }

  viewMode = S.viewMode || false;

  applyTheme(S.theme);
  applyBlurMode(S.blurMode || 'auto');
  applyMode();
  await applyBg();
  renderBmSaved();
  renderFT();
  S.widgets.forEach(cfg => makeWidget(cfg));

  checkStorageQuota();
  setInterval(checkStorageQuota, 5 * 60 * 1000); // recheck every 5 min while the tab is open
}

// ══════════════════════════════
//  QUOTA MONITORING
//  Uses the real browser-reported quota (navigator.storage.estimate) rather
//  than guessing from a fixed localStorage ceiling — IndexedDB quotas are
//  typically a large share of available disk space, not a hardcoded 5MB.
// ══════════════════════════════
let _lastQuotaWarnAt = 0;
async function checkStorageQuota() {
  const { percent, supported } = await VelinStore.getQuotaInfo();
  if (!supported) return;
  if (percent >= 85) {
    const now = Date.now();
    if (now - _lastQuotaWarnAt > 30 * 60 * 1000) { // don't nag more than once per 30 min
      _lastQuotaWarnAt = now;
      showNotification('Storage getting full', { body: `~${percent}% of available storage used. Consider exporting your settings or removing large backgrounds.` });
    }
  }
}

function showImgWarn() {
  const w = document.getElementById('img-warn');
  w.classList.add('show');
  setTimeout(() => w.classList.remove('show'), 4000);
}

function snap(v) { return Math.round(v / 20) * 20; }
function pad(n) { return String(n).padStart(2, '0'); }

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function normalizeHttpUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  // Keep bookmark targets on http(s) only; reject explicit non-web schemes.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return '';
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
}

function getHostname(url) {
  // Used for favicon lookup and a readable fallback label.
  try { return new URL(normalizeHttpUrl(url)).hostname; }
  catch (e) { return (url || '').trim(); }
}

// Markdown renderer
function renderMD(md) {
  // Convert a tiny markdown subset to sanitized HTML for note previews.
  function sanitizeHref(href) {
    try {
      const url = new URL(href, location.href);
      if (url.protocol === 'http:' || url.protocol === 'https:') return href;
    } catch (e) { }
    return '#';
  }
  let out = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  out = out
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^---$/gm, '<hr>');
  out = out
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, (_, text, href) => `<a href="${sanitizeHref(href)}">${text}</a>`);

  // ── TABLES ──
  // Parse simple GFM pipe tables as one block before the paragraph fallback.
  function isSeparatorRow(line) {
    return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && /-/.test(line);
  }
  function splitCells(line) {
    let text = line.trim();
    if (text.startsWith('|')) text = text.slice(1);
    if (text.endsWith('|')) text = text.slice(0, -1);
    return text.split('|').map(cell => cell.trim());
  }
  function alignFromSeparatorCell(cell) {
    const text = cell.trim();
    const left = text.startsWith(':'), right = text.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  }

  const rawLines = out.split('\n');
  const lines = [];
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i], next = rawLines[i + 1];
    const looksLikeBlockTag = value => /^<[hup\/]|^<hr|^<ul|^<li/.test(value);
    if (line !== undefined && next !== undefined && /\|/.test(line) && isSeparatorRow(next) && !looksLikeBlockTag(line)) {
      const headerCells = splitCells(line);
      const aligns = splitCells(next).map(alignFromSeparatorCell);
      const bodyRows = [];
      let j = i + 2;
      while (j < rawLines.length && /\|/.test(rawLines[j] || '') && rawLines[j].trim() !== '' && !looksLikeBlockTag(rawLines[j])) {
        bodyRows.push(splitCells(rawLines[j]));
        j++;
      }

      const alignStyle = idx => aligns[idx] ? ` style="text-align:${aligns[idx]}"` : '';
      let tableHtml = '<table><thead><tr>';
      headerCells.forEach((cell, idx) => { tableHtml += `<th${alignStyle(idx)}>${cell}</th>`; });
      tableHtml += '</tr></thead><tbody>';
      bodyRows.forEach(row => {
        tableHtml += '<tr>';
        headerCells.forEach((_, idx) => { tableHtml += `<td${alignStyle(idx)}>${row[idx] !== undefined ? row[idx] : ''}</td>`; });
        tableHtml += '</tr>';
      });
      tableHtml += '</tbody></table>';
      lines.push(tableHtml);
      i = j;
    } else {
      lines.push(line);
      i++;
    }
  }
  const result = [];
  let inList = false;
  for (const line of lines) {
    const liMatch = line.match(/^- (.+)$/);
    if (liMatch) {
      if (!inList) { result.push('<ul>'); inList = true; }
      result.push('<li>' + liMatch[1] + '</li>');
    } else {
      if (inList) { result.push('</ul>'); inList = false; }
      if (line && !/^<[hup\/]|^<hr|^<ul|^<li|^<table/.test(line)) {
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
// ══════════════════════════════

// FIX: Single custom event for mode changes so note widgets don't need
// individual MutationObservers on document.body
function emitModeChange() {
  document.dispatchEvent(new CustomEvent('velinmodechange', { detail: { viewMode } }));
}

function applyTheme(t) {
  document.body.className = document.body.className
    .split(' ').filter(c => !c.startsWith('t-') && c !== '').join(' ');
  document.body.classList.add('t-' + t);
  document.querySelectorAll('.theme-dot').forEach(d => d.classList.toggle('active', d.dataset.theme === t));
  S.theme = t; save();
}
document.querySelectorAll('.theme-dot').forEach(d => d.addEventListener('click', () => applyTheme(d.dataset.theme)));
applyTheme(S.theme);

// ══════════════════════════════
//  BLUR MODE  (auto | on | off)
//  auto = detect low-spec → disable; fast hardware → enable
//  Cycles: auto → on → off → auto  (toolbar button or cycleBlurMode())
//  Persisted in S.blurMode
// ══════════════════════════════
const BLUR_MODES = ['auto', 'on', 'off'];

function detectLowSpec() {
  const cores  = navigator.hardwareConcurrency || 0;  // available everywhere
  const mem    = navigator.deviceMemory        || 0;  // Chrome/Edge only; 0 on Firefox/Safari
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Vote system: 2+ signals → low-spec
  let lowVotes = 0;
  if (cores > 0 && cores <= 4)  lowVotes++;
  if (mem   > 0 && mem   <= 4)  lowVotes++;
  if (motion)                    lowVotes++;

  // No reliable data (Firefox/Safari hide both) → assume capable, keep blur ON
  const hasData = cores > 0 || mem > 0 || motion;
  if (!hasData) return false;

  return lowVotes >= 2;
}

function applyBlurMode(mode) {
  const isLowSpec = detectLowSpec();
  const blurOn = mode === 'on' || (mode === 'auto' && !isLowSpec);

  // Single class toggle on body — CSS handles all blur surfaces at once
  document.body.classList.toggle('no-blur', !blurOn);

  const btn = document.getElementById('blur-toggle-btn');
  if (btn) {
    const autoLabel = isLowSpec ? 'blur: auto (off)' : 'blur: auto (on)';
    const labels = { auto: autoLabel, on: 'blur: on', off: 'blur: off' };
    btn.textContent = labels[mode] || autoLabel;
    btn.dataset.blurMode = mode;
    btn.classList.toggle('active', blurOn);
  }

  S.blurMode = mode;
  save();
}

function cycleBlurMode() {
  const current = S.blurMode || 'auto';
  const next = BLUR_MODES[(BLUR_MODES.indexOf(current) + 1) % BLUR_MODES.length];
  applyBlurMode(next);
}

// Apply persisted/default blur mode at startup (before paint)
applyBlurMode(S.blurMode || 'auto');

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
  emitModeChange(); // FIX: broadcast instead of per-widget MutationObserver
  if (typeof updateClockSize === 'function') {
    Object.values(wRefs).forEach(r => { if (r.cfg.type === 'clock') updateClockSize(r.cfg.id); });
  }
}

document.getElementById('mode-toggle').addEventListener('click', () => { viewMode = !viewMode; applyMode(); });
const _blurBtn = document.getElementById('blur-toggle-btn');
if (_blurBtn) _blurBtn.addEventListener('click', cycleBlurMode);
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
//  Images are stored as Blobs in IndexedDB (via VelinStore), referenced
//  from S.bg by imageId. Rendering converts the Blob to a short-lived
//  object URL, which is revoked whenever it's replaced to avoid leaking
//  memory across background changes.
// ══════════════════════════════
const bgLayer = document.getElementById('bg-layer');
const bgImgLayer = document.getElementById('bg-img-layer');
let imgBrightness = (S.bg && S.bg.brightness) || 100;
let imgBlur = (S.bg && S.bg.blur) || 0;

async function applyBg() {
  const bg = S.bg;
  if (!bg) return;
  if (bg.type === 'solid') {
    bgLayer.style.background = bg.value || '#0d0d0f';
    bgImgLayer.style.opacity = 0;
    releaseCurrentBgObjectUrl();
  } else if (bg.type === 'gradient') {
    bgLayer.style.background = bg.value;
    bgImgLayer.style.opacity = 0;
    releaseCurrentBgObjectUrl();
  } else if (bg.type === 'image' && bg.imageId) {
    bgLayer.style.background = 'transparent';
    const brightness = bg.brightness || 100;
    const blur = bg.blur || 0;
    bgImgLayer.style.filter = `brightness(${brightness}%) blur(${blur}px)`;
    try {
      const blob = await VelinStore.getImageBlob(bg.imageId);
      if (blob) {
        releaseCurrentBgObjectUrl();
        _currentBgObjectUrl = URL.createObjectURL(blob);
        bgImgLayer.style.backgroundImage = `url(${_currentBgObjectUrl})`;
        bgImgLayer.style.opacity = 1;
      } else {
        // Referenced image missing (e.g. cleared elsewhere) — fall back to solid.
        S.bg = { type: 'solid', value: '#0d0d0f' }; save(); applyBg();
      }
    } catch (e) {
      console.error('Failed to load background image blob:', e);
    }
  }
}

function releaseCurrentBgObjectUrl() {
  if (_currentBgObjectUrl) { URL.revokeObjectURL(_currentBgObjectUrl); _currentBgObjectUrl = null; }
}

const bgPanel = document.getElementById('bg-panel');
document.getElementById('bg-toggle-btn').addEventListener('click', () => bgPanel.classList.toggle('open'));
document.getElementById('bg-close-btn').addEventListener('click', () => bgPanel.classList.remove('open'));

document.querySelectorAll('.bg-tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.bg-tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  ['solid', 'gradient', 'image'].forEach(n => document.getElementById('bg-' + n + '-panel').classList.toggle('show', n === t.dataset.bgtab));
}));

// Switching away from an image background to solid/gradient drops the old
// blob so storage doesn't accumulate orphaned images.
async function clearOldBgImageIfAny() {
  const prev = S.bg;
  if (prev && prev.type === 'image' && prev.imageId) {
    await VelinStore.deleteImageBlob(prev.imageId).catch(() => {});
  }
}

document.querySelectorAll('.color-swatch').forEach(sw => sw.addEventListener('click', async () => {
  document.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('active'));
  sw.classList.add('active');
  await clearOldBgImageIfAny();
  S.bg = { type: 'solid', value: sw.dataset.color }; save(true); applyBg();
}));

document.getElementById('solid-color-picker').addEventListener('input', async e => {
  document.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('active'));
  await clearOldBgImageIfAny();
  S.bg = { type: 'solid', value: e.target.value }; save(true); applyBg();
});

document.querySelectorAll('.grad-preset').forEach(gp => gp.addEventListener('click', async () => {
  document.querySelectorAll('.grad-preset').forEach(x => x.classList.remove('active'));
  gp.classList.add('active');
  await clearOldBgImageIfAny();
  S.bg = { type: 'gradient', value: gp.dataset.grad }; save(true); applyBg();
}));

async function buildCustomGrad() {
  const c1 = document.getElementById('grad-c1').value;
  const c2 = document.getElementById('grad-c2').value;
  const dir = document.getElementById('grad-dir').value;
  await clearOldBgImageIfAny();
  S.bg = { type: 'gradient', value: `linear-gradient(${dir},${c1},${c2})` };
  save(true); applyBg();
}
['grad-c1', 'grad-c2', 'grad-dir'].forEach(id => document.getElementById(id).addEventListener('input', buildCustomGrad));

document.getElementById('img-upload').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > IMG_SIZE_WARN_BYTES) { showImgWarn(); return; }

  try {
    const imageId = 'bg_' + Date.now();
    await VelinStore.saveImageBlob(imageId, file);
    // Drop any previously stored bg image blob — only one is kept at a time.
    await VelinStore.deleteAllImagesExcept(imageId);
    S.bg = { type: 'image', imageId, brightness: imgBrightness, blur: imgBlur };
    save(true);
    await applyBg();
  } catch (err) {
    console.error('Background image save failed:', err);
    showImgWarn();
  }
});

const brightSlider = document.getElementById('img-brightness');
brightSlider.value = imgBrightness;
brightSlider.addEventListener('input', e => {
  imgBrightness = +e.target.value;
  document.getElementById('brightness-val').textContent = imgBrightness + '%';
  if (S.bg.type === 'image') {
    S.bg.brightness = imgBrightness; save();
    bgImgLayer.style.filter = `brightness(${imgBrightness}%) blur(${S.bg.blur || 0}px)`;
  }
});

const blurSlider = document.getElementById('img-blur');
blurSlider.value = imgBlur;
blurSlider.addEventListener('input', e => {
  imgBlur = +e.target.value;
  document.getElementById('blur-val').textContent = imgBlur + 'px';
  if (S.bg.type === 'image') {
    S.bg.blur = imgBlur; save();
    bgImgLayer.style.filter = `brightness(${S.bg.brightness || 100}%) blur(${imgBlur}px)`;
  }
});

// ══════════════════════════════
//  FAVICON HELPER
//  In-memory Map for fast synchronous lookups, backed by VelinStore's
//  normalized faviconCache store (each hostname is its own record, so
//  caching thousands of favicons never risks a single oversized blob).
// ══════════════════════════════
const _favCache = new Map();
const _favPending = new Map();
const FAV_CACHE_LIMIT = 500;

function loadCachedFaviconEntry(hostname) {
  if (!_favCache.has(hostname)) return undefined;
  const entry = _favCache.get(hostname);
  _favCache.delete(hostname);
  _favCache.set(hostname, { url: entry.url, ts: Date.now() });
  return entry.url;
}

function getCachedFavicon(hostname) { return loadCachedFaviconEntry(hostname); }

function setCachedFavicon(hostname, value) {
  if (_favCache.has(hostname)) _favCache.delete(hostname);
  _favCache.set(hostname, { url: value ?? null, ts: Date.now() });
  if (_favCache.size > FAV_CACHE_LIMIT) { _favCache.delete(_favCache.keys().next().value); }
  VelinStore.setFaviconCache(hostname, value ?? null);
}

function removeCachedFavicon(hostname) {
  if (!hostname) return;
  _favCache.delete(hostname);
  _favPending.delete(hostname);
  VelinStore.deleteFaviconCache(hostname).catch(() => {});
}

// FIX: Null out onload/onerror inside the timeout callback so a late-arriving
// image cannot trigger a redundant setCachedFavicon after the timeout fires.
function _testImg(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    const t = setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      rej();
    }, 2000);
    img.onload = function () {
      clearTimeout(t);
      (this.naturalWidth > 1 && this.naturalHeight > 1) ? res(url) : rej();
    };
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
    const origin = 'https://' + hostname;
    const candidates = [
      `https://icons.duckduckgo.com/ip3/${hostname}.ico`,
      origin + '/favicon.ico'
    ];
    for (const candidate of candidates) {
      const url = await _testImg(candidate).catch(() => null);
      if (url) { setCachedFavicon(hostname, url); return url; }
    }
    setCachedFavicon(hostname, null);
    return null;
  })();

  _favPending.set(hostname, pending);
  return pending.finally(() => { _favPending.delete(hostname); });
}

function loadFavicon(fav, fallbackEl, hostname) {
  if (!hostname) { fallbackEl.style.display = 'flex'; fav.style.display = 'none'; fav.removeAttribute('src'); return; }
  fallbackEl.style.display = 'flex'; fav.style.display = 'none'; fav.removeAttribute('src');
  resolveFaviconUrl(hostname).then(url => {
    if (!url) return;
    fav.onload = () => { fallbackEl.style.display = 'none'; fav.style.display = 'block'; };
    fav.onerror = () => {
      setCachedFavicon(hostname, null);
      fallbackEl.style.display = 'flex'; fav.style.display = 'none'; fav.removeAttribute('src');
    };
    fav.src = url;
  }).catch(() => {
    fallbackEl.style.display = 'flex'; fav.style.display = 'none'; fav.removeAttribute('src');
  });
}

// Favicon cache is hydrated lazily inside bootApp() (see below) since it now
// lives in IndexedDB and reading it is async.
async function loadPersistedFaviconCache() {
  try {
    const rows = await VelinStore.getFaviconCacheAll();
    rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    rows.forEach(row => { _favCache.set(row.hostname, { url: row.url, ts: row.ts || Date.now() }); });
    while (_favCache.size > FAV_CACHE_LIMIT) { _favCache.delete(_favCache.keys().next().value); }
    VelinStore.pruneFaviconCache(FAV_CACHE_LIMIT).catch(() => {});
  } catch (e) { /* non-fatal — favicon lookups just re-resolve from network */ }
}

// ══════════════════════════════
//  WIDGET ENGINE
// ══════════════════════════════
const canvas = document.getElementById('canvas');

function makeWidget(cfg) {
  const id = cfg.id || ('w' + Date.now()); cfg.id = id;
  const el = document.createElement('div');
  el.className = 'wp'; el.id = 'wp-' + id;
  el.dataset.type = cfg.type;
  el.style.cssText = `left:${cfg.x || 80}px;top:${cfg.y || 80}px;width:${cfg.w || 280}px;${cfg.h ? 'height:' + cfg.h + 'px;' : ''}z-index:${++zTop};`;
  if (cfg.rot) el.style.transform = `rotate(${cfg.rot}deg)`;

  const hdr = document.createElement('div'); hdr.className = 'wp-header';
  hdr.innerHTML = `<span class="wp-title"></span><div class="wp-actions"><button class="wp-btn wp-close" title="close">✕</button></div>`;
  hdr.querySelector('.wp-title').textContent = cfg.type || '';
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

// FIX: mousemove/mouseup listeners are attached only during an active drag and
// removed immediately on mouseup — prevents accumulation of N*2 document
// listeners for N widgets sitting idle.
function makeDraggable(el, handle, id) {
  let ox = 0, oy = 0;

  const onMove = e => {
    el.style.left = snap(e.clientX - ox) + 'px';
    el.style.top = snap(e.clientY - oy) + 'px';
  };

  const onUp = () => {
    el.classList.remove('dragging');
    if (wRefs[id]) { wRefs[id].cfg.x = el.offsetLeft; wRefs[id].cfg.y = el.offsetTop; }
    saveWidgets(id);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  const onHandleMouseDown = e => {
    if (viewMode || e.target.classList.contains('wp-btn')) return;
    ox = e.clientX - el.offsetLeft;
    oy = e.clientY - el.offsetTop;
    el.classList.add('dragging');
    e.preventDefault();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  handle.addEventListener('mousedown', onHandleMouseDown);

  // Cleanup only needs to remove the handle listener; move/up are self-removing.
  ensureCleanups(id).push(() => {
    handle.removeEventListener('mousedown', onHandleMouseDown);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  });
}

// FIX: Same attach-on-start / detach-on-end pattern for resize.
// Also batches offsetWidth/offsetHeight reads into a single rAF to avoid
// forced layout reflows on every pixel of drag movement.
function makeResizable(el, handle, id) {
  let sx = 0, sy = 0, sw = 0, sh = 0;
  let resizeRaf = 0;
  let pendingW = 0, pendingH = 0;

  const onMove = e => {
    pendingW = snap(Math.max(160, sw + (e.clientX - sx)));
    pendingH = snap(Math.max(60, sh + (e.clientY - sy)));
    if (!resizeRaf) {
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        el.style.width = pendingW + 'px';
        el.style.height = pendingH + 'px';
        if (wRefs[id]) { wRefs[id].cfg.w = pendingW; wRefs[id].cfg.h = pendingH; }
        if (wRefs[id] && wRefs[id].cfg.type === 'clock') updateClockSize(id);
      });
    }
  };

  const onUp = () => {
    el.classList.remove('resizing');
    saveWidgets(id);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = 0; }
  };

  const onHandleMouseDown = e => {
    if (viewMode) return;
    sx = e.clientX; sy = e.clientY;
    sw = el.offsetWidth; sh = el.offsetHeight;
    el.classList.add('resizing');
    e.preventDefault(); e.stopPropagation();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  handle.addEventListener('mousedown', onHandleMouseDown);

  ensureCleanups(id).push(() => {
    handle.removeEventListener('mousedown', onHandleMouseDown);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = 0; }
  });
}

// Rebuild the persisted widget array from live widget refs and debounce a save.
// Persist widget configs. Each widget is written as its own IndexedDB record
// (VelinStore debounces per-widget-id independently), so editing one widget's
// text/todos never touches or re-serializes any other widget's data.
// Pass a specific id when only one widget changed (preferred, cheaper);
// omitting it falls back to writing every live widget (safe, still cheap
// since each is independently debounced and no-op puts are near-free).
function saveWidgets(onlyId) {
  S.widgets = Object.values(wRefs).map(r => r.cfg);
  if (onlyId && wRefs[onlyId]) {
    VelinStore.saveWidget(wRefs[onlyId].cfg, false);
    return;
  }
  Object.values(wRefs).forEach(r => VelinStore.saveWidget(r.cfg, false));
}

// ══════════════════════════════
//  WIDGET BODIES
// ══════════════════════════════
function buildWidgetBody(type, body, cfg, id) {
  // Single dispatch point for all widget types.
  if (type === 'clock') buildClock(body, cfg, id);
  else if (type === 'bookmark') buildBookmarkWidget(body, cfg, id);
  else if (type === 'todo') buildTodo(body, cfg, id);
  else if (type === 'note') buildNote(body, cfg, id);
  else if (type === 'pomodoro') buildPomodoro(body, cfg, id);
}

// ── CLOCK ──
// FIX: updateClockSize caches dimensions and only reads offsetWidth when
// called from resize (where dimensions actually changed), not every tick.
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
  // Cache so tick doesn't need to re-read layout
  r._cachedW = ww; r._cachedH = wh;
}

function buildClock(body, cfg, id) {
  // Clock keeps a second-level timer and switches between digital and analog
  // modes without repainting hidden or off-screen canvases.
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
    if (persist) saveWidgets(id);
  }

  dig.addEventListener('click', () => { if (!viewMode) setMode('analog', true); });
  ana.addEventListener('click', () => { if (!viewMode) setMode('digital', true); });
  setMode(cfg.clockMode, false);
  updateClockSize(id);

  let tickTimer = null;
  let lastSecond = -1;
  let lastMinute = -1;

  function scheduleNextTick() {
    const delay = Math.max(100, 1000 - new Date().getMilliseconds());
    tickTimer = setTimeout(tick, delay);
  }

  function tick() {
    if (!document.getElementById('wp-' + id)) { tickTimer = null; return; }
    if (document.hidden) { scheduleNextTick(); return; }

    const d = new Date(), h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
    if (s === lastSecond) { scheduleNextTick(); return; }
    lastSecond = s;

    // FIX: Only call updateClockSize in analog mode tick (canvas needs dimensions);
    // digital mode reads cached values to avoid a layout reflow every second.
    const r = wRefs[id];
    if (cfg.clockMode === 'analog') {
      updateClockSize(id);
    }

    dig.innerHTML = `<span>${pad(h)}:${pad(m)}</span><span style="font-size:.42em;color:var(--text2);vertical-align:middle;margin-left:2px;">:${pad(s)}</span>`;
    if (m !== lastMinute) {
      dateEl.textContent = DAY_NAMES[d.getDay()] + ', ' + MONTH_NAMES[d.getMonth()] + ' ' + d.getDate();
      lastMinute = m;
    }

    // FIX: Skip canvas draw entirely when widget is hidden (IntersectionObserver)
    if (cfg.clockMode === 'analog' && ana.style.display !== 'none' && r && r._isVisible !== false) {
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
        ctx.strokeStyle = isM ? 'rgba(180,175,165,1)' : 'rgba(128,128,128,1)';
        ctx.lineWidth = isM ? 2 : 3; ctx.stroke();
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

  // FIX: IntersectionObserver skips canvas paint when widget is off-screen
  const visObs = new IntersectionObserver(entries => {
    const r = wRefs[id];
    if (r) r._isVisible = entries[0].isIntersecting;
  }, { threshold: 0 });
  const wpEl = document.getElementById('wp-' + id);
  if (wpEl) visObs.observe(wpEl);

  const onVisibilityChange = () => {
    if (document.hidden) return;
    lastSecond = -1;
    if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
    tick();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);

  tick();

  wRefs[id]._cleanups = wRefs[id]._cleanups || [];
  wRefs[id]._cleanups.push(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
    visObs.disconnect();
  });
}

// ── BOOKMARK WIDGET ──
function buildBookmarkWidget(body, cfg, id) {
  // Bookmark widgets are a normalized URL, favicon, and label.
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
  // Todo widgets keep task state in cfg.todos and rerender after each change.
  if (!cfg.todos) cfg.todos = [];
  const list = document.createElement('div'); list.className = 'todo-list-wrap';

  function renderTodos() {
    list.innerHTML = '';
    cfg.todos.forEach((t, i) => {
      const row = document.createElement('div'); row.className = 'ti' + (t.done ? ' done' : '');
      const chk = document.createElement('div'); chk.className = 'ti-chk' + (t.done ? ' on' : '');
      chk.addEventListener('click', () => { cfg.todos[i].done = !cfg.todos[i].done; saveWidgets(id); renderTodos(); });
      const txt = document.createElement('span'); txt.className = 'ti-text'; txt.textContent = t.text;
      const del = document.createElement('span'); del.className = 'ti-del'; del.textContent = '×';
      del.addEventListener('click', () => { cfg.todos.splice(i, 1); saveWidgets(id); renderTodos(); });
      row.appendChild(chk); row.appendChild(txt); row.appendChild(del); list.appendChild(row);
    });
  }
  renderTodos();

  const row = document.createElement('div'); row.className = 'todo-input-row';
  row.innerHTML = `<input class="mini-input" placeholder="Add a task…"><button class="add-btn">add</button>`;

  function addTodo() {
    const inp = row.querySelector('input'), v = inp.value.trim();
    if (!v) return;
    cfg.todos.push({ text: v, done: false }); saveWidgets(id); renderTodos(); inp.value = '';
  }
  row.querySelector('.add-btn').addEventListener('click', addTodo);
  row.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });

  const wp = document.getElementById('wp-' + id);
  if (wp) {
    const acts = wp.querySelector('.wp-actions');
    const cb = document.createElement('button'); cb.className = 'wp-btn todo-clear-btn'; cb.title = 'clear done'; cb.textContent = '✓×';
    cb.addEventListener('click', () => { cfg.todos = cfg.todos.filter(t => !t.done); saveWidgets(id); renderTodos(); });
    acts.insertBefore(cb, acts.firstChild);
  }

  body.appendChild(list); body.appendChild(row);
}

// ── NOTE ──
function buildNote(body, cfg, id) {
  // Notes combine a small editor with a preview mode and quick formatting.
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
  ta.addEventListener('input', () => { cfg.noteContent = ta.value; saveWidgets(id); });

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
    cfg.noteContent = ta.value; saveWidgets(id); ta.focus();
  }
  function insertLine(prefix) {
    const s = ta.selectionStart;
    ta.setRangeText('\n' + prefix, s, s, 'end');
    cfg.noteContent = ta.value; saveWidgets(id); ta.focus();
  }

  const wp = document.getElementById('wp-' + id);
  if (wp) {
    const acts = wp.querySelector('.wp-actions');
    const cb = document.createElement('button'); cb.className = 'wp-btn'; cb.title = 'clear'; cb.textContent = '⌫';
    cb.addEventListener('click', () => { ta.value = ''; cfg.noteContent = ''; saveWidgets(id); prev.innerHTML = ''; });
    acts.insertBefore(cb, acts.firstChild);
  }

  // FIX: Use single custom event from applyMode() instead of a MutationObserver
  // per note widget. Multiple open notes previously each observed document.body.
  function syncViewMode() {
    if (viewMode) {
      prev.innerHTML = renderMD(cfg.noteContent);
      prev.style.display = 'block';
      ta.style.display = 'none';
    }
  }

  const onModeChange = () => syncViewMode();
  document.addEventListener('velinmodechange', onModeChange);

  wRefs[id]._cleanups = wRefs[id]._cleanups || [];
  wRefs[id]._cleanups.push(() => document.removeEventListener('velinmodechange', onModeChange));

  body.style.overflow = 'hidden';
  body.appendChild(toolbar); body.appendChild(ta); body.appendChild(prev);
  syncViewMode();
}

// ── POMODORO ──
function buildPomodoro(body, cfg, id) {
  // Pomodoro state is versioned so multiple tabs can converge safely.
  const MODES = { focus: 25 * 60, shortBreak: 5 * 60, longBreak: 15 * 60 };
  const STATE_VERSION = 1;
  const STORAGE_SYNC_INTERVAL_MS = 10000;
  const TAB_ID = (window.__velinTabId = window.__velinTabId || (Date.now().toString(36) + Math.random().toString(36).slice(2)));
  const LOCK_NAME = 'pomo_' + id;
  const LOCK_TTL_MS = 15000;
  const LOCK_RENEW_INTERVAL_MS = 5000;
  let uiTimer = null;
  let lastStorageSyncAt = 0;
  let lastLockRenewAt = 0;

  function getDefaultState() {
    return {
      mode: 'focus', status: 'idle', startedAt: null, endsAt: null,
      sessionsCompleted: Number(cfg.pomoSessions || 0),
      version: STATE_VERSION, updatedAt: 0, writerId: ''
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
    startedAt: null, endsAt: null,
    sessionsCompleted: Number(cfg.pomoSessions || 0),
    version: STATE_VERSION, updatedAt: 0, writerId: ''
  });

  // Pomodoro persists frequently (every state transition, cross-tab sync).
  // Write only this widget's own record — critical since a running timer
  // would otherwise re-serialize every other widget once a second.
  function saveWidgetsImmediate() {
    S.widgets = Object.values(wRefs).map(r => r.cfg);
    VelinStore.saveWidget(cfg, true);
  }

  // Locking delegates to VelinStore's shared cross-tab lock (localStorage-backed,
  // synchronous, tiny payload — appropriate for a lock, unlike bulk app data).
  function isLockOwnedByMe() {
    const lock = VelinStore.readLock(LOCK_NAME);
    return !!(lock && lock.ownerId === TAB_ID && lock.expiresAt > Date.now());
  }

  function tryAcquireLock(force = false) {
    const now = Date.now();
    const lock = VelinStore.readLock(LOCK_NAME);
    const canAcquire = force || !lock || lock.expiresAt <= now || lock.ownerId === TAB_ID;
    if (!canAcquire) return false;
    const ok = VelinStore.writeLock(LOCK_NAME, TAB_ID, now + LOCK_TTL_MS);
    if (ok) lastLockRenewAt = now;
    return ok;
  }

  function renewLockIfNeeded() {
    if (!isLockOwnedByMe()) return false;
    const now = Date.now();
    if ((now - lastLockRenewAt) < LOCK_RENEW_INTERVAL_MS) return true;
    const ok = VelinStore.writeLock(LOCK_NAME, TAB_ID, now + LOCK_TTL_MS);
    if (ok) lastLockRenewAt = now;
    return ok;
  }

  function releaseLock() { VelinStore.releaseLock(LOCK_NAME, TAB_ID); }

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

  // FIX (v2): reads this widget's own normalized IDB record directly instead
  // of parsing a whole-app JSON blob that no longer exists in the new storage
  // design. Throttled to avoid event-storm stalls on rapid focus/visibility
  // changes; still async since IDB reads are async, so callers await it.
  const SYNC_MIN_INTERVAL_MS = 300;
  let lastSyncCallAt = 0;
  let _syncInFlight = null;

  async function syncStateFromStorage(force = false) {
    const now = Date.now();
    if (!force) {
      if (document.hidden) return;
      if ((now - lastStorageSyncAt) < STORAGE_SYNC_INTERVAL_MS) return;
    }
    if ((now - lastSyncCallAt) < SYNC_MIN_INTERVAL_MS) return;
    lastSyncCallAt = now;
    lastStorageSyncAt = now;

    // Coalesce overlapping calls into a single in-flight read.
    if (_syncInFlight) return _syncInFlight;

    _syncInFlight = (async () => {
      try {
        const remoteCfg = await VelinStore.getAllWidgets().then(all => all.find(w => w && w.id === cfg.id));
        if (!remoteCfg || !remoteCfg.pomoState) return;
        const remoteState = normalizeState(remoteCfg.pomoState);
        if (remoteState.version === state.version) {
          state = mergeEqualVersion(remoteState, state);
        } else if (isRemoteFresher(remoteState, state)) {
          state = remoteState;
        }
      } catch (e) { /* non-fatal — next tick will retry */ }
    })();

    try { await _syncInFlight; } finally { _syncInFlight = null; }
  }

  function persistState() {
    if (!isLockOwnedByMe() && !tryAcquireLock(true)) return;
    state.version += 1;
    state.updatedAt = Date.now();
    state.writerId = TAB_ID;
    cfg.pomoState = {
      mode: state.mode, status: state.status, startedAt: state.startedAt,
      endsAt: state.endsAt, sessionsCompleted: state.sessionsCompleted,
      version: state.version, updatedAt: state.updatedAt, writerId: state.writerId
    };
    cfg.pomoSessions = state.sessionsCompleted;
    saveWidgetsImmediate();
  }

  function getPhaseDurationMs(mode) { return MODES[mode] * 1000; }

  function getRemainingMs(nowMs) {
    if (state.status === 'running' && typeof state.endsAt === 'number') return Math.max(0, state.endsAt - nowMs);
    if (state.status === 'paused' && typeof state.endsAt === 'number') return Math.max(0, state.endsAt);
    return getPhaseDurationMs(state.mode);
  }

  function setIdleAtWork() { state.mode = 'focus'; state.status = 'idle'; state.startedAt = null; state.endsAt = null; }
  function setRunningForCurrentMode(nowMs, durationMs) { state.status = 'running'; state.startedAt = nowMs; state.endsAt = nowMs + durationMs; }

  function applyCatchUp() {
    if (!isLockOwnedByMe() && !tryAcquireLock(false)) return false;
    renewLockIfNeeded();
    if (state.status !== 'running' || typeof state.endsAt !== 'number') return false;
    const now = Date.now();
    let changed = false;
    while (state.status === 'running' && typeof state.endsAt === 'number' && now >= state.endsAt) {
      if (state.mode === 'focus') {
        state.sessionsCompleted += 1;
        state.mode = (state.sessionsCompleted % 4 === 0) ? 'longBreak' : 'shortBreak';
        const nextStart = state.endsAt;
        state.status = 'running'; state.startedAt = nextStart;
        state.endsAt = nextStart + getPhaseDurationMs(state.mode);
      } else {
        setIdleAtWork();
      }
      changed = true;
      if (state.mode === 'focus' && state.status === 'idle') break;
    }
    if (changed) persistState();
    return changed;
  }

  function notifySessionComplete(completedMode) {
    const titles = {
      focus: '🎯 Focus session done!',
      shortBreak: '☕ Short break over',
      longBreak: '🏆 Long break complete'
    };
    const bodies = {
      focus: 'Time for a break',
      shortBreak: 'Back to focus',
      longBreak: `${state.sessionsCompleted} sessions total`
    };
    showNotification(titles[completedMode] || 'Session complete', { 
      body: bodies[completedMode] || '',
      tag: 'pomodoro-' + id 
    });
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

  async function upd() {
    await syncStateFromStorage(false);
    const prevMode = state.mode;
    const prevStatus = state.status;
    applyCatchUp();
    
    // Notify when session just finished (status changed from running → paused/idle)
    if (prevStatus === 'running' && (state.status === 'paused' || state.status === 'idle')) {
      notifySessionComplete(prevMode);
    }

    if (state.status !== 'running' && isLockOwnedByMe()) releaseLock();
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

  document.getElementById('ps-' + id).addEventListener('click', async () => {
    const now = Date.now();
    tryAcquireLock(true); await syncStateFromStorage(true); applyCatchUp();
    if (state.status === 'running') {
      const remainingMs = getRemainingMs(now);
      state.status = 'paused'; state.startedAt = null; state.endsAt = remainingMs;
      persistState(); releaseLock();
    } else {
      const durationMs = (state.status === 'paused')
        ? Math.max(1000, typeof state.endsAt === 'number' ? state.endsAt : getPhaseDurationMs(state.mode))
        : getPhaseDurationMs(state.mode);
      setRunningForCurrentMode(now, durationMs);
      persistState(); renewLockIfNeeded();
    }
    upd();
  });

  document.getElementById('pr-' + id).addEventListener('click', () => {
    tryAcquireLock(true); state.status = 'idle'; state.startedAt = null; state.endsAt = null;
    persistState(); releaseLock(); upd();
  });

  body.querySelectorAll('.pomo-mode').forEach(mb => mb.addEventListener('click', () => {
    const nextMode = mb.dataset.m;
    if (!MODES[nextMode]) return;
    tryAcquireLock(true); state.mode = nextMode; state.status = 'idle';
    state.startedAt = null; state.endsAt = null;
    persistState(); releaseLock(); upd();
  }));

  // Both focus and visibilitychange trigger a resync; syncStateFromStorage's
  // internal throttle prevents event-storm stalls on rapid tab switching.
  async function onWindowResume() { await syncStateFromStorage(true); applyCatchUp(); upd(); }
  function onStorageSync(e) {
    // Cross-tab ping is a single small key now (see VelinStore), not a
    // whole-app-blob key — any ping means "something changed, re-check".
    if (!e.key || (!e.key.startsWith('velin_sync_ping') && !e.key.startsWith('velin_lock_pomo_' + id))) return;
    upd();
  }
  function onBeforeUnload() { releaseLock(); }

  window.addEventListener('focus', onWindowResume);
  document.addEventListener('visibilitychange', onWindowResume);
  window.addEventListener('storage', onStorageSync);
  window.addEventListener('beforeunload', onBeforeUnload);

  uiTimer = setInterval(upd, 1000);

  wRefs[id]._cleanups = wRefs[id]._cleanups || [];
  wRefs[id]._cleanups.push(() => {
    if (uiTimer) { clearInterval(uiTimer); uiTimer = null; }
    window.removeEventListener('focus', onWindowResume);
    document.removeEventListener('visibilitychange', onWindowResume);
    window.removeEventListener('storage', onStorageSync);
    window.removeEventListener('beforeunload', onBeforeUnload);
    releaseLock();
  });

  syncStateFromStorage(true).then(upd);
}

// ══════════════════════════════
//  WIDGET CLOSE — with cleanup
// ══════════════════════════════
function closeWidget(id) {
  // Run widget cleanup before removing DOM nodes and state references.
  const ref = wRefs[id]; if (!ref) return;
  if (Array.isArray(ref._cleanups)) ref._cleanups.forEach(fn => { try { fn(); } catch (e) { } });
  ref.el.remove();
  delete wRefs[id];
  S.widgets = S.widgets.filter(w => w.id !== id);
  VelinStore.deleteWidget(id);
}

canvas.addEventListener('click', e => {
  const closeBtn = e.target.closest('.wp-close'); if (!closeBtn) return;
  const wp = closeBtn.closest('.wp'); if (!wp) return;
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
  S.widgets.push(cfg); makeWidget(cfg); saveWidgets(cfg.id);
}));

// ══════════════════════════════
//  BOOKMARKS PANEL
// ══════════════════════════════
if (!S.bookmarks) S.bookmarks = [];
const bmPanel = document.getElementById('bm-panel');

function renderBmSaved() {
  // Rebuild the bookmark panel from S.bookmarks and wire each item to spawn
  // a widget instance on click.
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
        VelinStore.deleteBookmark(bm.id);
      }
      renderBmSaved();
    });

    favWrap.appendChild(fav); favWrap.appendChild(ltr);
    item.appendChild(favWrap); item.appendChild(nm); item.appendChild(del);

    item.addEventListener('click', () => {
      const sz = defSizes.bookmark;
      const cfg = { id: 'w' + Date.now(), type: 'bookmark', bmUrl: bm.url, bmName: bm.name, x: snap(100 + Math.random() * 300), y: snap(100 + Math.random() * 200), w: sz.w, h: sz.h };
      S.widgets.push(cfg); makeWidget(cfg); saveWidgets(cfg.id);
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
  if (!url) { showNotification('Invalid URL', { body: 'Only http and https URLs are allowed.' }); return; }
  const bm = { id: 'bm_' + Date.now(), name: name || url, url };
  S.bookmarks.push(bm);
  VelinStore.saveBookmark(bm, true);
  renderBmSaved();
  document.getElementById('bm-name-inp').value = ''; document.getElementById('bm-url-inp').value = '';
});

document.getElementById('bm-url-inp').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('bm-add-btn').click(); });

// ══════════════════════════════
//  PANEL OUTSIDE-CLICK HANDLING
// ══════════════════════════════
let _dragMoved = false;
let _dragStarted = false;

document.addEventListener('mousedown', () => { _dragStarted = true; _dragMoved = false; });
document.addEventListener('mousemove', e => { if (_dragStarted && e.buttons === 1) _dragMoved = true; });
document.addEventListener('mouseup', () => { _dragStarted = false; });

document.addEventListener('click', e => {
  if (_dragMoved) { _dragMoved = false; return; }
  _dragMoved = false;
  if (!e.target.closest('#bm-panel') && !e.target.closest('#bm-launcher-btn')) bmPanel.classList.remove('open');
  if (!e.target.closest('#bg-panel') && !e.target.closest('#bg-toggle-btn')) bgPanel.classList.remove('open');
});

// ══════════════════════════════
//  FREE TEXT
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
  noteObj.size = size; noteObj.weight = weight;
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
  if (!activeFT) { ftStyleBar.classList.remove('show'); return; }
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
  ftSizeRead.textContent = activeFT.noteObj.size + 'px'; VelinStore.saveFtNote(activeFT.noteObj); activeFT.ta.focus();
});
ftSizeIncBtn.addEventListener('click', () => {
  if (!activeFT) return;
  activeFT.noteObj.size = clampFtSize((activeFT.noteObj.size || 14) + 1);
  applyFTStyles(activeFT.ta, activeFT.noteObj);
  ftSizeRead.textContent = activeFT.noteObj.size + 'px'; VelinStore.saveFtNote(activeFT.noteObj); activeFT.ta.focus();
});
ftRotDecBtn.addEventListener('click', () => {
  if (!activeFT) return;
  activeFT.noteObj.rot = normalizeRotation((activeFT.noteObj.rot || 0) - 5);
  applyFTRotation(activeFT.wrap, activeFT.noteObj);
  ftRotRead.textContent = activeFT.noteObj.rot + '°'; positionFtStylebar(); VelinStore.saveFtNote(activeFT.noteObj); activeFT.ta.focus();
});
ftRotIncBtn.addEventListener('click', () => {
  if (!activeFT) return;
  activeFT.noteObj.rot = normalizeRotation((activeFT.noteObj.rot || 0) + 5);
  applyFTRotation(activeFT.wrap, activeFT.noteObj);
  ftRotRead.textContent = activeFT.noteObj.rot + '°'; positionFtStylebar(); VelinStore.saveFtNote(activeFT.noteObj); activeFT.ta.focus();
});
ftBoldBtn.addEventListener('click', () => {
  if (!activeFT) return;
  activeFT.noteObj.weight = activeFT.noteObj.weight === 600 ? 400 : 600;
  applyFTStyles(activeFT.ta, activeFT.noteObj);
  ftBoldBtn.classList.toggle('active', activeFT.noteObj.weight === 600); VelinStore.saveFtNote(activeFT.noteObj); activeFT.ta.focus();
});
ftColorInp.addEventListener('input', () => {
  if (!activeFT) return;
  activeFT.noteObj.color = ftColorInp.value;
  applyFTStyles(activeFT.ta, activeFT.noteObj); VelinStore.saveFtNote(activeFT.noteObj);
});
ftDeleteBtn.addEventListener('click', () => {
  if (!activeFT) return;
  const idx = S.ftNotes.indexOf(activeFT.noteObj);
  if (idx !== -1) S.ftNotes.splice(idx, 1);
  VelinStore.deleteFtNote(activeFT.noteObj.id);
  activeFT.wrap.remove(); setActiveFT(null);
});
window.addEventListener('resize', positionFtStylebar);

function makeFTNote(noteObj) {
  // Free-text notes are independent absolutely positioned editors with drag,
  // resize, rotation, and formatting state stored alongside the text.
  if (!noteObj.id) noteObj.id = 'ft_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
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

  const rz = document.createElement('div'); rz.className = 'ft-resize';
  rz.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M9 1L1 9M9 5L5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  const ta = document.createElement('textarea'); ta.className = 'ft-note';
  ta.value = noteObj.text || ''; ta.placeholder = 'type…';
  ta.style.cssText = `width:${noteObj.w}px;${noteObj.h > 0 ? 'height:' + noteObj.h + 'px;overflow-y:auto;' : ''}`;
  applyFTStyles(ta, noteObj);

  ta.addEventListener('input', () => {
    if (noteObj.h > 0) { ta.style.overflowY = 'auto'; } else { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
    noteObj.text = ta.value; VelinStore.saveFtNote(noteObj); positionFtStylebar();
  });
  ta.addEventListener('focus', () => setActiveFT({ noteObj, ta, wrap }));
  ta.addEventListener('click', () => setActiveFT({ noteObj, ta, wrap }));
  ta.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== ta) setActiveFT(null); }, 120); });

  // Drag: attach to document only during active drag, remove on mouseup
  let dr2 = false, ox2 = 0, oy2 = 0;
  let rs2 = false, rsx = 0, rsy = 0, rsw = 0, rsh = 0;

  const onMove = e => {
    if (!dr2) return;
    wrap.style.left = (e.clientX - ox2) + 'px';
    wrap.style.top = (e.clientY - oy2) + 'px';
    if (activeFT && activeFT.noteObj === noteObj) positionFtStylebar();
  };
  const onUp = () => {
    if (!dr2) return;
    dr2 = false;
    noteObj.x = wrap.offsetLeft; noteObj.y = wrap.offsetTop; VelinStore.saveFtNote(noteObj, true);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (activeFT && activeFT.noteObj === noteObj) positionFtStylebar();
  };

  const onResizeMove = e => {
    if (!rs2) return;
    noteObj.w = Math.round(Math.max(90, rsw + (e.clientX - rsx)));
    noteObj.h = Math.round(Math.max(24, rsh + (e.clientY - rsy)));
    ta.style.width = noteObj.w + 'px'; ta.style.height = noteObj.h + 'px'; ta.style.overflowY = 'auto';
    if (activeFT && activeFT.noteObj === noteObj) positionFtStylebar();
  };
  const onResizeUp = () => {
    if (!rs2) return;
    rs2 = false;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeUp);
    VelinStore.saveFtNote(noteObj, true);
  };

  wrap.addEventListener('mousedown', e => {
    if (viewMode || (e.target === ta && document.activeElement === ta) || e.target === del || e.target.closest('.ft-resize')) return;
    dr2 = true; ox2 = e.clientX - wrap.offsetLeft; oy2 = e.clientY - wrap.offsetTop; e.preventDefault();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  rz.addEventListener('mousedown', e => {
    if (viewMode) return;
    e.preventDefault(); e.stopPropagation();
    rs2 = true; rsx = e.clientX; rsy = e.clientY; rsw = ta.offsetWidth; rsh = ta.offsetHeight;
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeUp);
  });

  del.addEventListener('click', () => {
    if (activeFT && activeFT.noteObj === noteObj) setActiveFT(null);
    const i = S.ftNotes.indexOf(noteObj);
    if (i !== -1) S.ftNotes.splice(i, 1);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeUp);
    VelinStore.deleteFtNote(noteObj.id); wrap.remove();
  });

  wrap.appendChild(del); wrap.appendChild(rz); wrap.appendChild(ta); canvas.appendChild(wrap);
  setTimeout(() => {
    if (noteObj.h > 0) { ta.style.height = noteObj.h + 'px'; ta.style.overflowY = 'auto'; }
    else { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  }, 0);
}

function renderFT() {
  // Rebuild all free-text notes from the persisted array.
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
  const note = { id: 'ft_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), x: e.clientX, y: e.clientY, text: '', w: 140, h: 0, size: 14, weight: 400, color: '', rot: 0 };
  S.ftNotes.push(note);
  VelinStore.saveFtNote(note, true);
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
//  Exports every normalized store (meta, widgets, bookmarks, ftNotes) plus
//  the background image Blob (inlined as base64 only for this portable
//  file — normal runtime storage never touches base64).
// ══════════════════════════════
async function exportSettings() {
  try {
    const data = await VelinStore.exportAll();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `velin-settings-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    showNotification('Settings exported', { body: 'Your Velin settings have been saved.' });
  } catch (e) {
    console.error('Export failed:', e);
    showNotification('Export failed', { body: 'Could not read settings from storage.' });
  }
}

function importSettings(file) {
  // Validate, then hand off to VelinStore.importAll which wipes and
  // repopulates the normalized stores (including converting any exported
  // base64 images back to Blobs) before reloading.
  if (!file || file.size > 20 * 1024 * 1024) { showNotification('Import failed', { body: 'File is missing or too large.' }); return; }
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!imported || typeof imported !== 'object' || Array.isArray(imported)) throw new Error('Invalid root object');
      await VelinStore.importAll(imported);
      showNotification('Settings imported', { body: 'Reloading with new settings...' });
      setTimeout(() => location.reload(), 500);
    } catch (e) {
      showNotification('Import failed', { body: 'Invalid file or corrupted data.' });
      console.error('Import error:', e);
    }
  };
  reader.readAsText(file);
}

document.getElementById('export-btn').addEventListener('click', exportSettings);
document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', e => {
  if (e.target.files[0]) { importSettings(e.target.files[0]); e.target.value = ''; }
});

// ══════════════════════════════
//  BOOT
// ══════════════════════════════
// applyTheme / applyBlurMode / applyMode / applyBg are called synchronously
// above for initial paint with DEF values. bootApp() then loads persisted
// state async and re-applies + renders widgets once IDB resolves.
applyTheme(S.theme);
applyBlurMode(S.blurMode || 'auto');
applyMode();
applyBg();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp, { once: true });
} else {
  bootApp();
}
