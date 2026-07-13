// ════════════════════════════════════════════════════════════════
//  VELIN STORAGE ENGINE  (v2 — normalized IndexedDB)
//
//  Replaces the old single-JSON-blob system. Design goals:
//   1. Every entity (widget, bookmark, ft-note, image) is its own
//      IndexedDB record — editing one thing never rewrites everything else.
//   2. Background images are stored as raw Blobs, not base64 strings —
//      no JSON bloat, no ~33% base64 size tax, no giant string parsing.
//   3. localStorage is used ONLY for tiny cross-tab signaling (pomodoro
//      lock + a "something changed" ping) — never for bulk app data.
//   4. Per-record debounced writes: rapid typing in one note doesn't
//      block or delay saves to other widgets.
//   5. Real quota awareness via navigator.storage.estimate(), with
//      navigator.storage.persist() requested so the browser is less
//      likely to evict data under pressure.
//   6. Works identically in the browser extension (MV3 page context)
//      and the standalone PWA/web page — pure IndexedDB, no chrome.* API.
// ════════════════════════════════════════════════════════════════

const VelinStore = (() => {

  const DB_NAME = 'velin_db';
  const DB_VERSION = 2;

  const STORES = {
    meta: 'meta',                 // key -> value  (theme, blurMode, viewMode, bgMeta)
    widgets: 'widgets',           // id  -> widget cfg
    bookmarks: 'bookmarks',       // id  -> {id, name, url}
    ftNotes: 'ftNotes',           // id  -> ft-note object
    images: 'images',             // id  -> {id, blob}
    faviconCache: 'faviconCache'  // hostname -> {hostname, url, ts}
  };

  const LS_PING_KEY = 'velin_sync_ping';       // tiny cross-tab "something changed" signal
  const LS_LOCK_PREFIX = 'velin_lock_';        // per-resource cross-tab locks (e.g. pomodoro)

  let _db = null;
  let _openPromise = null;
  let _persistRequested = false;

  // ── OPEN / MIGRATE ──
  function openDB() {
    if (_db) return Promise.resolve(_db);
    if (_openPromise) return _openPromise;

    _openPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = e => {
        const db = e.target.result;
        const oldVersion = e.oldVersion || 0;

        if (!db.objectStoreNames.contains(STORES.meta)) {
          db.createObjectStore(STORES.meta, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORES.widgets)) {
          db.createObjectStore(STORES.widgets, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.bookmarks)) {
          db.createObjectStore(STORES.bookmarks, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.ftNotes)) {
          db.createObjectStore(STORES.ftNotes, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.images)) {
          db.createObjectStore(STORES.images, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.faviconCache)) {
          db.createObjectStore(STORES.faviconCache, { keyPath: 'hostname' });
        }

        // Migration hook: if upgrading from the old v1 single-blob DB,
        // the legacy store (if present) is handled separately by
        // migrateLegacyIfNeeded() after open, since it needs the old
        // 'state' store's keyPath ('id') which differs from v2's stores.
        if (oldVersion === 1 && db.objectStoreNames.contains('state')) {
          // leave the legacy store in place; migration reads from it
          // post-open, then it's safe to ignore (harmless leftover).
        }
      };

      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
      req.onblocked = () => console.warn('VelinStore: DB open blocked by another tab');
    });

    return _openPromise;
  }

  function tx(storeNames, mode = 'readonly') {
    return openDB().then(db => db.transaction(storeNames, mode));
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ── GENERIC STORE HELPERS ──
  async function put(storeName, value) {
    const t = await tx([storeName], 'readwrite');
    const p = reqToPromise(t.objectStore(storeName).put(value));
    return p;
  }

  async function get(storeName, key) {
    const t = await tx([storeName]);
    return reqToPromise(t.objectStore(storeName).get(key));
  }

  async function del(storeName, key) {
    const t = await tx([storeName], 'readwrite');
    return reqToPromise(t.objectStore(storeName).delete(key));
  }

  async function getAll(storeName) {
    const t = await tx([storeName]);
    return reqToPromise(t.objectStore(storeName).getAll());
  }

  async function clear(storeName) {
    const t = await tx([storeName], 'readwrite');
    return reqToPromise(t.objectStore(storeName).clear());
  }

  // ── PER-RECORD DEBOUNCED WRITE QUEUE ──
  // Each entity id gets its own debounce timer, so typing in note A never
  // delays or batches with a drag update happening on widget B.
  const DEBOUNCE_MS = 150;
  const _pendingWrites = new Map(); // `${store}:${id}` -> {timer, value}

  function queueWrite(storeName, value, flush = false) {
    const key = value.key !== undefined ? value.key : value.id;
    const mapKey = storeName + ':' + key;

    if (flush) {
      const existing = _pendingWrites.get(mapKey);
      if (existing) { clearTimeout(existing.timer); _pendingWrites.delete(mapKey); }
      pingOtherTabs();
      return put(storeName, value);
    }

    const existing = _pendingWrites.get(mapKey);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      _pendingWrites.delete(mapKey);
      put(storeName, value).then(pingOtherTabs).catch(e => console.error('VelinStore write failed:', storeName, key, e));
    }, DEBOUNCE_MS);

    _pendingWrites.set(mapKey, { timer, value });
    return Promise.resolve(); // fire-and-forget for debounced path
  }

  // Flush every pending debounced write immediately (used on unload / explicit flush).
  async function flushAll() {
    const entries = Array.from(_pendingWrites.entries());
    _pendingWrites.clear();
    await Promise.all(entries.map(([mapKey, { timer, value }]) => {
      clearTimeout(timer);
      const storeName = mapKey.slice(0, mapKey.indexOf(':'));
      return put(storeName, value).catch(e => console.error('VelinStore flush failed:', mapKey, e));
    }));
  }

  // ── CROSS-TAB PING (localStorage, tiny payload only) ──
  function pingOtherTabs() {
    try { localStorage.setItem(LS_PING_KEY, String(Date.now())); } catch (e) { /* non-fatal */ }
  }

  function onRemoteChange(callback) {
    window.addEventListener('storage', e => {
      if (e.key === LS_PING_KEY) callback();
    });
  }

  // ── QUOTA ──
  async function getQuotaInfo() {
    if (!navigator.storage || !navigator.storage.estimate) {
      return { usage: 0, quota: 0, percent: 0, supported: false };
    }
    try {
      const { usage, quota } = await navigator.storage.estimate();
      const percent = quota ? Math.round((usage / quota) * 100) : 0;
      return { usage, quota, percent, supported: true };
    } catch (e) {
      return { usage: 0, quota: 0, percent: 0, supported: false };
    }
  }

  async function requestPersistence() {
    if (_persistRequested) return;
    _persistRequested = true;
    if (navigator.storage && navigator.storage.persist) {
      try { await navigator.storage.persist(); } catch (e) { /* non-fatal */ }
    }
  }

  // ── PUBLIC API: META (theme, blurMode, viewMode, bg settings) ──
  async function getMeta(key, fallback = null) {
    const row = await get(STORES.meta, key).catch(() => null);
    return row ? row.value : fallback;
  }

  function setMeta(key, value, flush = false) {
    return queueWrite(STORES.meta, { key, value }, flush);
  }

  async function getAllMeta() {
    const rows = await getAll(STORES.meta).catch(() => []);
    const out = {};
    rows.forEach(r => { out[r.key] = r.value; });
    return out;
  }

  // ── PUBLIC API: WIDGETS ──
  async function getAllWidgets() {
    return getAll(STORES.widgets).catch(() => []);
  }

  function saveWidget(cfg, flush = false) {
    return queueWrite(STORES.widgets, cfg, flush);
  }

  function deleteWidget(id) {
    const mapKey = STORES.widgets + ':' + id;
    const pending = _pendingWrites.get(mapKey);
    if (pending) { clearTimeout(pending.timer); _pendingWrites.delete(mapKey); }
    return del(STORES.widgets, id).then(pingOtherTabs);
  }

  // ── PUBLIC API: BOOKMARKS ──
  async function getAllBookmarks() {
    return getAll(STORES.bookmarks).catch(() => []);
  }

  function saveBookmark(bm, flush = true) {
    // Bookmarks are added/removed rarely — always flush immediately, no debounce needed.
    return queueWrite(STORES.bookmarks, bm, flush);
  }

  function deleteBookmark(id) {
    return del(STORES.bookmarks, id).then(pingOtherTabs);
  }

  // ── PUBLIC API: FREE-TEXT NOTES ──
  async function getAllFtNotes() {
    return getAll(STORES.ftNotes).catch(() => []);
  }

  function saveFtNote(note, flush = false) {
    return queueWrite(STORES.ftNotes, note, flush);
  }

  function deleteFtNote(id) {
    const mapKey = STORES.ftNotes + ':' + id;
    const pending = _pendingWrites.get(mapKey);
    if (pending) { clearTimeout(pending.timer); _pendingWrites.delete(mapKey); }
    return del(STORES.ftNotes, id).then(pingOtherTabs);
  }

  // ── PUBLIC API: IMAGES (Blobs — used for background images) ──
  // Only one background image is kept at a time; old ones are deleted to
  // avoid orphaned blobs accumulating in storage.
  async function saveImageBlob(id, blob) {
    await put(STORES.images, { id, blob });
    pingOtherTabs();
  }

  async function getImageBlob(id) {
    const row = await get(STORES.images, id).catch(() => null);
    return row ? row.blob : null;
  }

  async function deleteImageBlob(id) {
    if (!id) return;
    await del(STORES.images, id).catch(() => {});
  }

  async function deleteAllImagesExcept(keepId) {
    const rows = await getAll(STORES.images).catch(() => []);
    await Promise.all(rows.filter(r => r.id !== keepId).map(r => del(STORES.images, r.id).catch(() => {})));
  }

  // ── PUBLIC API: FAVICON CACHE ──
  async function getFaviconCacheAll() {
    return getAll(STORES.faviconCache).catch(() => []);
  }

  function setFaviconCache(hostname, url) {
    // Favicon cache writes are frequent but low-value individually — debounce lightly.
    return queueWrite(STORES.faviconCache, { hostname, url, ts: Date.now() }, false);
  }

  async function deleteFaviconCache(hostname) {
    const mapKey = STORES.faviconCache + ':' + hostname;
    const pending = _pendingWrites.get(mapKey);
    if (pending) { clearTimeout(pending.timer); _pendingWrites.delete(mapKey); }
    return del(STORES.faviconCache, hostname);
  }

  async function pruneFaviconCache(limit) {
    const rows = await getAll(STORES.faviconCache).catch(() => []);
    if (rows.length <= limit) return;
    rows.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const toDelete = rows.slice(0, rows.length - limit);
    await Promise.all(toDelete.map(r => del(STORES.faviconCache, r.hostname).catch(() => {})));
  }

  // ── CROSS-TAB LOCKS (localStorage — tiny, synchronous, fine for this) ──
  function readLock(name) {
    try {
      const raw = localStorage.getItem(LS_LOCK_PREFIX + name);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.ownerId !== 'string' || !Number.isFinite(+parsed.expiresAt)) return null;
      return { ownerId: parsed.ownerId, expiresAt: Math.floor(+parsed.expiresAt) };
    } catch (e) { return null; }
  }

  function writeLock(name, ownerId, expiresAt) {
    try { localStorage.setItem(LS_LOCK_PREFIX + name, JSON.stringify({ ownerId, expiresAt })); return true; }
    catch (e) { return false; }
  }

  function releaseLock(name, ownerId) {
    try {
      const lock = readLock(name);
      if (lock && lock.ownerId === ownerId) localStorage.removeItem(LS_LOCK_PREFIX + name);
    } catch (e) { /* non-fatal */ }
  }

  // ── FULL EXPORT / IMPORT (for the export/import settings buttons) ──
  // Exports everything as one portable JSON document. Images are inlined
  // as base64 ONLY at export time (portability), never during normal storage.
  async function exportAll() {
    const [meta, widgets, bookmarks, ftNotes, images] = await Promise.all([
      getAllMeta(), getAllWidgets(), getAllBookmarks(), getAllFtNotes(), getAll(STORES.images).catch(() => [])
    ]);

    const imagesB64 = await Promise.all(images.map(row => blobToBase64(row.blob).then(b64 => ({ id: row.id, b64 }))));

    return {
      version: 2,
      exportedAt: Date.now(),
      meta, widgets, bookmarks, ftNotes,
      images: imagesB64
    };
  }

  async function importAll(data) {
    if (!data || typeof data !== 'object') throw new Error('Invalid import data');

    // Wipe existing normalized stores before importing fresh data.
    await Promise.all([
      clear(STORES.meta), clear(STORES.widgets), clear(STORES.bookmarks),
      clear(STORES.ftNotes), clear(STORES.images)
    ]);

    const meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
    const widgets = Array.isArray(data.widgets) ? data.widgets : [];
    const bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
    const ftNotes = Array.isArray(data.ftNotes) ? data.ftNotes : [];
    const images = Array.isArray(data.images) ? data.images : [];

    await Promise.all([
      ...Object.entries(meta).map(([key, value]) => put(STORES.meta, { key, value })),
      ...widgets.filter(w => w && w.id).map(w => put(STORES.widgets, w)),
      ...bookmarks.filter(b => b && b.id).map(b => put(STORES.bookmarks, b)),
      ...ftNotes.filter(n => n && n.id).map(n => put(STORES.ftNotes, n)),
      ...images.filter(im => im && im.id && im.b64).map(async im => {
        const blob = await base64ToBlob(im.b64);
        return put(STORES.images, { id: im.id, blob });
      })
    ]);

    pingOtherTabs();
  }

  // ── BLOB <-> BASE64 HELPERS (export/import portability only) ──
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function base64ToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return res.blob();
  }

  // ── LEGACY (v1) MIGRATION ──
  // The old system stored everything as one JSON blob under IndexedDB
  // store 'state' (key 'main') or localStorage keys 'sp3_ls_fallback' / 'sp3'.
  // On first boot under v2, check for legacy data and import it once.
  const LEGACY_LS_KEYS = ['sp3_ls_fallback', 'sp3'];
  const LEGACY_MIGRATION_FLAG = 'velin_v1_migrated';

  async function migrateLegacyIfNeeded() {
    try {
      if (localStorage.getItem(LEGACY_MIGRATION_FLAG)) return false;
    } catch (e) { /* if localStorage is unavailable, just attempt once */ }

    let legacy = null;

    // Try legacy IndexedDB store first.
    try {
      const db = await openDB();
      if (db.objectStoreNames.contains('state')) {
        const t = db.transaction(['state'], 'readonly');
        const row = await reqToPromise(t.objectStore('state').get('main'));
        if (row && row.data) legacy = row.data;
      }
    } catch (e) { /* ignore, fall through to localStorage */ }

    // Fall back to legacy localStorage keys.
    if (!legacy) {
      for (const k of LEGACY_LS_KEYS) {
        try {
          const raw = localStorage.getItem(k);
          if (raw) { legacy = JSON.parse(raw); break; }
        } catch (e) { /* corrupt legacy data, skip */ }
      }
    }

    if (!legacy || typeof legacy !== 'object') {
      try { localStorage.setItem(LEGACY_MIGRATION_FLAG, '1'); } catch (e) {}
      return false;
    }

    console.log('VelinStore: migrating legacy v1 data →', Object.keys(legacy));

    const writes = [];
    if (legacy.theme) writes.push(put(STORES.meta, { key: 'theme', value: legacy.theme }));
    if (legacy.blurMode) writes.push(put(STORES.meta, { key: 'blurMode', value: legacy.blurMode }));
    if (typeof legacy.viewMode === 'boolean') writes.push(put(STORES.meta, { key: 'viewMode', value: legacy.viewMode }));

    if (Array.isArray(legacy.widgets)) {
      legacy.widgets.forEach(w => { if (w && w.id) writes.push(put(STORES.widgets, w)); });
    }
    if (Array.isArray(legacy.bookmarks)) {
      legacy.bookmarks.forEach((b, i) => {
        if (b) writes.push(put(STORES.bookmarks, { id: b.id || ('bm_legacy_' + i), name: b.name, url: b.url }));
      });
    }
    if (Array.isArray(legacy.ftNotes)) {
      legacy.ftNotes.forEach((n, i) => {
        if (n) writes.push(put(STORES.ftNotes, { ...n, id: n.id || ('ft_legacy_' + i) }));
      });
    }

    // Legacy background: convert base64 image -> Blob if present.
    if (legacy.bg && legacy.bg.type === 'image' && legacy.bg.imgData) {
      const imgId = 'bg_legacy_' + Date.now();
      writes.push(
        base64ToBlob(legacy.bg.imgData)
          .then(blob => put(STORES.images, { id: imgId, blob }))
          .then(() => put(STORES.meta, {
            key: 'bg',
            value: { type: 'image', imageId: imgId, brightness: legacy.bg.brightness || 100, blur: legacy.bg.blur || 0 }
          }))
          .catch(e => console.warn('Legacy bg image migration failed:', e))
      );
    } else if (legacy.bg) {
      writes.push(put(STORES.meta, { key: 'bg', value: legacy.bg }));
    }

    await Promise.all(writes);
    try { localStorage.setItem(LEGACY_MIGRATION_FLAG, '1'); } catch (e) {}
    return true;
  }

  // ── UNLOAD FLUSH ──
  window.addEventListener('beforeunload', () => {
    // Best-effort synchronous-ish flush; IDB writes started here may not
    // finish before the page dies, but modern browsers generally give
    // in-flight IDB transactions a brief grace period on unload.
    flushAll();
  });

  return {
    openDB, requestPersistence, getQuotaInfo,
    getMeta, setMeta, getAllMeta,
    getAllWidgets, saveWidget, deleteWidget,
    getAllBookmarks, saveBookmark, deleteBookmark,
    getAllFtNotes, saveFtNote, deleteFtNote,
    saveImageBlob, getImageBlob, deleteImageBlob, deleteAllImagesExcept,
    getFaviconCacheAll, setFaviconCache, deleteFaviconCache, pruneFaviconCache,
    readLock, writeLock, releaseLock,
    exportAll, importAll,
    migrateLegacyIfNeeded,
    flushAll,
    onRemoteChange
  };
})();
