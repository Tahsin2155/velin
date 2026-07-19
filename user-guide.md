# Velin — User Guide

Velin is a custom new-tab page: a blank canvas where you drop widgets, write free-floating text, and set your own background. Everything saves automatically to your browser's local storage (IndexedDB) — nothing leaves your machine.

---

## Quick start

1. Open a new tab (or `index.html` if you're running it standalone).
2. Click **✦ view** (top area) to flip into **edit mode** — this unlocks dragging, resizing, and adding widgets.
3. Use the **toolbar** at the bottom to add widgets, change the background, or place text.
4. Flip back to **view mode** when you're done arranging things, so nothing moves by accident.

---

## View mode vs. Edit mode

| Mode | What it does |
|---|---|
| **view** (✦) | Widgets are locked in place. Safe default for everyday use. |
| **edit** (✎) | Widgets can be dragged, resized, and deleted. Free-text placement is also only active in edit mode. |

- Click the mode button (top of screen) to toggle.
- Or just press **`E`** on your keyboard (works anywhere except while typing in a text field).

---

## Widgets

Add widgets from the toolbar: **⊕ clock**, **⊕ bookmarks**, **⊕ todo**, **⊕ note**, **⊕ pomodoro**. Each one drops onto the canvas and can be dragged (by its header) and resized (bottom-right corner handle) while in edit mode. Click ✕ on a widget's header to remove it.

### Clock
- Click the clock face to flip between **digital** and **analog** display.
- Shows the current time, date, and updates live.

### Bookmarks
- Click **⊕ bookmarks** to open the bookmark panel, or add one as a floating widget.
- Add a bookmark with a name + URL; Velin fetches the site's favicon automatically (falls back to a letter icon if it can't).
- Only `http://` and `https://` URLs are accepted.

### Todo
- Type a task and hit **add** (or press Enter).
- Click the checkbox to mark a task done; click **×** next to a task to delete it.
- Use the **✓×** button on the widget header to clear all completed tasks at once.

### Note
- A small markdown editor. Formatting shortcuts in the toolbar: **B** (bold), *I* (italic), `` ` `` (code), **H1**/**H2** (headings), **—** (divider), **•** (bullet list).
- Click **preview** to render the markdown; click **edit** to go back to raw text.
- In view mode, notes always show the rendered preview.
- Use **⌫** on the widget header to clear all its content.

### Pomodoro
- Standard timer: **25 min focus → 5 min short break**, with a **15 min long break** every 4th session.
- Controls: **start**, **reset**, and mode labels you can click directly (`5m` / `15m`) to jump to a break.
- Sends a browser notification when a session ends (allow notifications when prompted, if you want this).
- State stays in sync if you have Velin open in multiple tabs at once.

---

## Free-floating text

Click **✏ text** in the toolbar to enter text-placement mode (edit mode only):

- **Click anywhere** on the canvas to drop a new text box.
- **Click into** a text box to select it — a small style bar appears above it with:
  - **A- / A+** — shrink/grow font size
  - **↺ / ↻** — rotate left/right
  - **B** — toggle bold
  - color swatch — pick text color
  - **✕** — delete this text box
- **Hover** over a text box to reveal its own delete control.
- Press **Esc** to exit text-placement mode.

---

## Background

Click **◑ bg** in the toolbar to open the background panel. Three tabs:

- **Solid** — pick from preset swatches or use the custom color picker.
- **Gradient** — pick a preset gradient, or build your own with a "from" color, "to" color, and direction (↘ ↓ → ↗).
- **Image** — upload your own image (max 8 MB). Adjust:
  - **brightness** (0–200%)
  - **blur** (0–20px)

Only one background image is kept at a time — uploading a new one replaces the old.

---

## Themes

Four toolbar dots switch the overall color theme:

- **dark**
- **light**
- **glass**
- **bw** (black & white)

---

## Backdrop blur

The **◈ blur** button cycles through three modes:

- **auto** — Velin detects your device's specs and enables/disables blur automatically for performance.
- **on** — always on.
- **off** — always off.

---

## Export / Import settings

- **⬇ export** — downloads a JSON file with your entire setup: theme, background, widgets, notes, bookmarks.
- **⬆ import** — pick a previously exported JSON file to restore that setup. This **replaces** your current settings, so export first if you want a backup of what's currently there.

Use this to back up your layout, or move it to another browser/device.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `E` | Toggle view/edit mode |
| `Enter` | Confirm adding a todo item or bookmark (while typing in those inputs) |
| `Esc` | Exit free-text placement mode |

---

## Saving & storage

Everything is saved automatically and continuously — there's no save button to press. Data lives in your browser's IndexedDB, scoped to this page/extension, so:

- Closing the tab or restarting your browser won't lose anything.
- Clearing your browser's site data / IndexedDB **will** erase it — export first if you want a safety copy.
- If storage starts getting full, Velin will show a one-time-per-30-minutes notification suggesting you export your settings or remove a large background image.

---

## Installing as an app (PWA)

If your browser shows an "Install" prompt for Velin (via the address bar or menu), you can install it as a standalone app with its own icon, and it'll keep working offline once loaded.