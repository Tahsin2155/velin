# Velin

A new-tab start page. Widgets, notes, bookmarks, backgrounds — all in three files, no build step.

Open `index.html` in a browser and it works.

## Files

```
index.html   page shell, toolbar, panels
script.js    everything else
styles.css   themes and layout
```

There's no `src/`, no bundler config, no `package.json`. If you want to change something, open `script.js` and find the section header (the code is split into commented blocks like `WIDGET ENGINE`, `POMODORO`, `FREE TEXT`).

## Widgets

Click a toolbar button to add one. Drag from the header, resize from the bottom-right corner. Each widget type:

- **Clock** — click the face to switch digital/analog
- **Bookmark** — a saved link with its favicon, or a fallback letter if the favicon lookup fails
- **Todo** — check items off, clear completed ones
- **Note** — markdown editor with a live preview toggle. Supports headings, bold/italic/code, links, bullet lists, horizontal rules, and GFM-style pipe tables (`| a | b |` with a `|---|---|` separator row, including column alignment via `:---`, `:---:`, `---:`)
- **Pomodoro** — focus/break timer; state is shared across tabs, so starting it in one tab keeps it running if you check another

Press `E` to toggle view mode, which hides all the editing chrome for a clean look.

## Storage

State lives in IndexedDB, with localStorage as a fallback for browsers or contexts where IndexedDB isn't available. On boot, whichever copy has the newer save timestamp wins — not whichever has more widgets, since a smaller widget count might just mean you deleted some.

Keys in use:

| Key | Purpose |
|---|---|
| `sp3_ls_fallback` | current localStorage snapshot |
| `sp3_ls_fallback_ts` | when that snapshot was saved |
| `sp3` | legacy key, read once for migration |
| `sp3_fav_cache_v1` | cached favicon URLs, keyed by hostname |
| `sp3_pomo_lock_*` | cross-tab pomodoro coordination, one per widget |

Background images over 500KB get stripped back to a solid color rather than risk blowing the storage quota. If localStorage itself gets close to full, you'll see a notification suggesting you export.

## Export / Import

Export writes the whole state to a JSON file. Import reads one back in, validates the shape, and merges it — bad or malformed files get rejected with a toast rather than corrupting your current setup.

## Bookmark and link safety

Bookmark URLs and markdown links in notes are restricted to `http`/`https`. Anything else (`javascript:`, `data:`, etc.) gets rejected before it's ever set as an `href`.

## Browser support

Needs CSS variables, `backdrop-filter`, localStorage, and IndexedDB — so any recent Chromium, Firefox, or Safari. Notifications are optional; if they're blocked, the pomodoro timer just runs silently.

Blur can be forced on or off from the toolbar, or left on "auto," which guesses based on CPU cores, device memory, and `prefers-reduced-motion`. Safari and Firefox don't expose `deviceMemory`, so auto-detection is weaker there — it falls back to assuming the hardware is capable.

## If you're extending this

A few things that'll bite you if you're not careful:

- Widget cleanup (`_cleanups` array per widget) removes timers and listeners on close. If you add a widget type with its own interval or global listener, register a cleanup for it or it'll leak.
- The pomodoro's cross-tab lock is a plain localStorage read-then-write — good enough for a timer, not a real mutex. Two tabs racing to acquire it at the same instant is possible in theory; the cost of losing that race is just a UI hiccup, not lost data.
- `dMerge` (used for import and IDB/localStorage merging) caps recursion at depth 20 and skips `__proto__`/`constructor`/`prototype` keys, so a malicious import can't pollute the prototype chain.