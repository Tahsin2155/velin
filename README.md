# Velin

A new-tab start page. Widgets, notes, bookmarks, backgrounds — the app is four files, no build step.

- **Website:** https://newvelintab.netlify.app
- **Guide** (install, use, troubleshooting): https://newvelintab.netlify.app/guide
- **Web version:** https://newvelintab.netlify.app/app
- **Browser extension** (Chrome, Edge, Brave): download `velin-extension.zip` from the [latest release](https://github.com/Tahsin2155/velin/releases/latest) and follow the guide's install steps.

To run it locally, open `app.html` in a browser and it works.

## Files

```
app.html     page shell, toolbar, panels
storage.js   persistence engine (IndexedDB)
script.js    everything else
styles.css   themes and layout
```

See [user-guide.md](user-guide.md) for the full usage guide, including widgets, background settings, keyboard shortcuts, and export/import details.

The rest of the repo is the website and the extension packaging (see below), not the app itself.

There's no `src/`, no bundler config, no `package.json`. `storage.js` must load before `script.js` (it already does, in `app.html`). If you want to change something, open `script.js` and find the section header (the code is split into commented blocks like `WIDGET ENGINE`, `POMODORO`, `FREE TEXT`).

## Website and extension

```
index.html, guide.html, landing.css, landing.js   the website (home page and guide)
_redirects                                        Netlify: /app and /guide without .html
screenshots/                                      images used by the website
manifest.json, icons/                             the Chrome/Edge/Brave extension (Manifest V3)
build_extension.py                                builds dist/velin-extension.zip
.github/workflows/release-extension.yml           builds and publishes the zip when a v* tag is pushed
```

The extension is the same app, not a copy: its manifest overrides the new tab with `app.html`, and `build_extension.py` zips only the files the extension needs. The website is hosted on Netlify. To release the extension, bump `version` in `manifest.json`, push, then push a matching tag (for example `v2.1.1`); the workflow builds and publishes `velin-extension.zip`.

Extension pages can't run inline scripts or inline event handlers (`onclick=...`, `onload=...`), so keep `app.html` free of them.

## Widgets

Click a toolbar button to add one. Drag from the header, resize from the bottom-right corner. Each widget type:

- **Clock** — click the face to switch digital/analog
- **Bookmark** — a saved link with its favicon, or a fallback letter if the favicon lookup fails
- **Todo** — check items off, clear completed ones
- **Note** — markdown editor with a live preview toggle. Supports headings, bold/italic/code, fenced code blocks, links, bullet/numbered/task lists, quotes, horizontal rules, and GFM-style pipe tables (`| a | b |` with a `|---|---|` separator row, including column alignment via `:---`, `:---:`, `---:`)
- **Pomodoro** — focus/break timer; state is shared across tabs, so starting it in one tab keeps it running if you check another

Press `E` to toggle view mode, which hides all the editing chrome for a clean look.

## Storage

State lives entirely in **IndexedDB**, normalized into separate object stores rather than one JSON blob:

| Store | Holds |
|---|---|
| `meta` | theme, blur mode, view mode, background settings |
| `widgets` | one record per widget (clock, todo, note, pomodoro, bookmark instance) |
| `bookmarks` | saved bookmark entries |
| `ftNotes` | free-text canvas notes |
| `images` | background images, stored as raw `Blob`s |
| `faviconCache` | cached favicon URLs, keyed by hostname |

Every entity is its own record with its own key, and writes are debounced per-record. Editing one note's text only ever writes that note's record — it doesn't touch, re-read, or re-save any other widget, bookmark, or note. This also means a background image is stored as an actual binary `Blob`, not a base64 string stuffed into JSON, so there's no ~33% size inflation and no risk of one oversized field bloating unrelated data.

`localStorage` is still used, but only for two small things:

- `velin_sync_ping` — a single key bumped on every change, so other open tabs know to re-check IndexedDB
- `velin_lock_*` — per-widget cross-tab locks (currently just pomodoro), one key per lock

No bulk app data — widgets, notes, bookmarks, images — ever goes into `localStorage`. It's used purely as a lightweight signaling channel, which is what it's actually good at.

Background images have a generous soft ceiling (8MB) before you're warned, since Blob storage doesn't have the same practical pressure base64-in-JSON did. Storage headroom is checked against the browser's real quota (`navigator.storage.estimate()`) every few minutes; if you're getting close to the actual limit, you'll get a notification suggesting you export or trim down. `navigator.storage.persist()` is also requested on load, which makes browsers less likely to evict your data automatically under disk pressure.

### Upgrading from an older version

If your browser still has data from the old single-blob storage system (a v1 IndexedDB store, or legacy `sp3`/`sp3_ls_fallback` localStorage keys), it's detected and migrated into the new normalized stores automatically, once, the first time you load the updated version. Nothing needs to be done manually.

## Export / Import

Export writes every store to one portable JSON file (background images included, inlined as base64 *only* in this exported file — never during normal storage). Import reads that file back in, replacing everything currently stored.

Exported files use a versioned format (`version: 2`) tied to the current normalized storage layout. Files exported from versions prior to this storage rewrite use a different, incompatible shape and won't import correctly — if that ever matters to you, ask and it can be added.

## Bookmark and link safety

Bookmark URLs and markdown links in notes are restricted to `http`/`https`. Anything else (`javascript:`, `data:`, etc.) gets rejected before it's ever set as an `href`.

## Browser support

Needs CSS variables, `backdrop-filter`, and IndexedDB — so any recent Chromium, Firefox, or Safari. `localStorage` is used only for the small cross-tab signals described above. Notifications are optional; if they're blocked, the pomodoro timer just runs silently.

Blur can be forced on or off from the toolbar, or left on "auto," which guesses based on CPU cores, device memory, and `prefers-reduced-motion`. Safari and Firefox don't expose `deviceMemory`, so auto-detection is weaker there — it falls back to assuming the hardware is capable.

## If you're extending this

A few things that'll bite you if you're not careful:

- Widget cleanup (`_cleanups` array per widget) removes timers and listeners on close. If you add a widget type with its own interval or global listener, register a cleanup for it or it'll leak.
- Only touch the pomodoro lock while the timer is actually running. Acquiring and releasing it on every idle tick fires a `storage` event in every other tab, whose own tick does the same, and two tabs end up freezing each other.
- The pomodoro's cross-tab lock (`VelinStore.readLock`/`writeLock`/`releaseLock`, backed by `localStorage`) is good enough for a timer, not a real mutex. Two tabs racing to acquire it at the same instant is possible in theory; the cost of losing that race is just a UI hiccup, not lost data.
- Every entity type (widget, bookmark, ft-note) needs a stable `id` before it's handed to `VelinStore.saveX(...)` — that `id` is the database key. Widgets already carry one; if you add a new persisted entity type, give it an id up front.
- `VelinStore` debounces writes per-key internally, so it's safe to call `saveWidget`/`saveFtNote`/etc. on every keystroke — you don't need to add your own debouncing on top.
- `importAll` wipes the normalized stores before repopulating them, and filters out `__proto__`/`constructor`/`prototype` from imported meta keys as a defensive measure. It doesn't do deep recursive merging the way the old `dMerge` did, since each entity is now a flat, independent record rather than a nested blob.

## Contributing

Bug reports, ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how, and for the terms contributions are accepted under.

## License

Velin has no open-source license: the source is public, but it isn't open source.

Copyright © 2026 [Tahsin](https://tahsin2155.github.io). All rights reserved.

You're welcome to use the app, read the source, and contribute to it (see [CONTRIBUTING.md](CONTRIBUTING.md)). Copying the code into other projects, building your own version from it, or redistributing it isn't permitted without permission.
