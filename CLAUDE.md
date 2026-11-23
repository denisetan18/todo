# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A single-page to-do app with deadlines, in plain HTML/CSS/JavaScript. There are no frameworks, no build step, no dependencies, no package manager and no tests or linter. Keep it that way.

## Running

Open `index.html` in a browser, or serve the folder to preview it:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/`. Serving over http is needed for `mockups/mockup.html`, which loads the app in iframes. There is no automated test suite, so changes are verified by hand in the browser.

## Architecture

Everything lives in three files: `index.html` (markup), `style.css`, and `app.js` (one IIFE holding all logic).

- **State and rendering:** a single `tasks` array is the source of truth. Every mutation goes through `commit()`, which saves to localStorage and then calls `render()`. `render()` rebuilds the whole list from the array. Do not patch the DOM incrementally.
- **Order is manual.** There is no sorting. The order of the master `tasks` array is the display order, and drag-and-drop (`attachDrag`, `move`) reorders that array. Filters (status and category) only hide items; they never change order.
- **Categories are a fixed set** (`CATEGORIES`: work, personal, others), used by the add-form select, the edit row, the filter select and the badge CSS classes (`.cat-work` etc.). Adding one means updating `app.js`, `index.html` (two selects) and `style.css`. `load()` migrates older data: a missing category becomes `personal` and an unknown one becomes `others`.
- **Deadlines are date only** (`YYYY-MM-DD`, no time). Parse them as local dates, not with `new Date(str)`, to avoid timezone off-by-one bugs. Overdue and "soon" (within `SOON_DAYS`) styling derives from that.
- **Safe rendering:** task text is set via `textContent` (the `el()` helper). Only the static, trusted SVG icon strings use `innerHTML`.
- **Theme:** CSS variables in `:root` with overrides in `:root[data-theme="dark"]`. A small inline script in `index.html`'s `<head>` sets `data-theme` before first paint to avoid a flash; `applyTheme()` in `app.js` keeps it in sync and saves the choice.

### Storage keys

`todo.tasks.v1` (tasks), `todo.theme` (theme). Changing the task shape means keeping `load()` backwards compatible, or bumping the key.

### Demo mode and mockups

`?demo=light|dark` on the app URL puts it in demo mode: it reads tasks from a separate key (`todo.demo.tasks`) and forces the theme without saving it, so real user data is never touched. `mockups/mockup.html` seeds that key and shows the real app in an iPhone frame (light) and a Samsung Galaxy frame (dark) using iframes. `mockups/mockup-iphone-galaxy.jpg` is a saved screenshot of it, and it is not regenerated automatically.

## Known limitations

- HTML5 drag-and-drop does not work on touch screens, so reordering is mouse-only.
- At 360px width the Add button wraps onto its own row in the add form.
