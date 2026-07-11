<<<<<<< HEAD
# velin

A customizable start page built with plain HTML, CSS, and JavaScript.

The app provides draggable widgets, editable backgrounds, free-form text notes, bookmark management, export/import, and local persistence without any build step.

## Project status

Completed and ready to use.

What is included:
- Theme system (dark, light, glass, black/white)
- View/Edit mode workflow
- Background system (solid, gradient, image upload)
- Image adjustments (brightness and blur)
- Widget engine with drag + resize
- Widgets: clock, bookmark tile, todo, note (markdown), pomodoro
- Free text notes with size/rotation/style controls
- Bookmarks panel with favicon loading + cache
- Export/import of settings JSON
- LocalStorage persistence with quota fallback behavior

## Quick start

1. Open index.html in any modern browser.
2. Use the top toolbar to add widgets and open panels.
3. Customize layout and background.
4. Your setup is saved automatically.

No npm, no bundler, no install required.

## File structure

- index.html: Main document shell and UI markup
- styles.css: Application styles
- script.js: Application logic
- README.md: Project documentation

## Core features

### 1. Themes
- Switch via the color dots in the toolbar.
- Themes update CSS variables for background, surface, borders, and text.

### 2. View/Edit mode
- Toggle from the top-right mode button.
- Keyboard shortcut: E
- View mode hides editing UI and emphasizes presentation.

### 3. Background customization
- Solid: preset swatches + custom color picker
- Gradient: presets + custom two-color direction controls
- Image: local upload with controls:
	- Brightness: 0% to 200%
	- Blur: 0px to 20px

### 4. Widgets
- Add from toolbar.
- Drag by header, resize from bottom-right handle.
- Widget types:
	- Clock: digital/analog toggle on click
	- Bookmark tile: icon + label + open link
	- Todo: add/check/delete/clear-done
	- Note: markdown editor + preview mode
	- Pomodoro: focus/break modes + session tracking

### 5. Free text notes
- Toggle text mode from toolbar.
- Click canvas to place a note.
- Supports:
	- Font size
	- Rotation
	- Bold toggle
	- Color
	- Manual resize

### 6. Bookmarks panel
- Save reusable bookmarks.
- Add bookmark widgets directly from panel items.
- Favicon resolution uses a small in-browser cache to reduce repeated requests.

### 7. Data persistence
- Main state key: sp3
- Favicon cache key: sp3_fav_cache_v1
- Debounced writes reduce storage churn while dragging/typing.
- If image payload exceeds storage quota, app safely falls back to a solid background and shows warning toast.

### 8. Export / import
- Export downloads a JSON snapshot of current state.
- Import merges valid JSON settings and reloads to apply changes.
- Import is limited to 5 MB file size for safety.

## Controls reference

- E: toggle View/Edit mode
- Escape: exit text placement mode and close free-text style context

## Browser support

Designed for modern Chromium/Firefox/Safari versions with support for:
- CSS variables
- backdrop-filter
- localStorage
- Notification API (optional, for pomodoro alerts)

If notifications are blocked, pomodoro still works without system alerts.

## Performance notes

- Clock rendering aligns to second boundaries to reduce timer drift.
- Widget resize for clock uses requestAnimationFrame throttling.
- Favicon fetches are cached and bounded with LRU-style eviction.

## Security notes

- Imported JSON is merged with prototype-pollution key guards.
- Markdown links are sanitized to allow only http/https targets.

## Known limitations

- App state is browser-local. Data does not sync between devices.
- Large uploaded images may exceed localStorage limits.
- Data is persisted in localStorage and can grow if image backgrounds are used.

## Maintenance checklist

When updating the app:
1. Keep CSS variable contrast readable in all themes.
2. Preserve view-mode behavior for non-editing presentation.
3. Validate import/export compatibility with existing state shape.
4. Keep cleanup handlers for widgets/listeners to prevent leaks.

## License

No license file is currently included.
Add one if you plan to distribute publicly.
=======
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
>>>>>>> e972411 (notes widget now renders tables(md))
