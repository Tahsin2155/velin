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
