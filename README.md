# Tabsift

*English · [Svenska](README.sv.md)*

Tab management for Edge/Chrome that does four things: a fuzzy **tab palette**,
a **duplicate cleanup** with preview and undo, **suggestions for inactive tabs**
to close, and **semantic grouping** where rules go first and AI only gets what
the rules miss.

Built to be reviewable: **no build step, no dependencies**. The code that runs is
the code in this repository.

---

## The address bar

Type **`t`** followed by space or Tab in the address bar, then your search:

```
t oauth        → Switch to the tab "OAuth redirect_uri mismatch"
t github       → also matches on domain
t              → most recently used tabs
```

Enter switches to the tab, whichever window it's in. The keyword is changed in
`manifest.json` under `"omnibox"` — it can't be changed at runtime.

**What still isn't possible:** influencing the browser's *own* suggestions when
you type without the keyword. `chrome.omnibox` only gives an extension the
keystrokes after the keyword, and the built-in "Switch to this tab" ranking has
no API. An extension claiming otherwise does it with an overlay, not through the
address bar.

`Ctrl+Shift+K` opens the same search as a palette with a preview, if you'd
rather see the whole list.

---

## Install

1. Open `edge://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → pick this folder, the one with `manifest.json` directly
   in it (not `src`).
4. The settings page opens automatically on first install.

Change keyboard shortcuts at `edge://extensions/shortcuts`.

---

## Permissions

```json
"permissions": ["tabs", "tabGroups", "storage"],
"optional_host_permissions": [
  "http://localhost/*", "http://127.0.0.1/*",
  "https://api.anthropic.com/*", "https://api.openai.com/*"
]
```

| Permission | Why |
|---|---|
| `tabs` | Read tab titles and URLs. Without it everything else is pointless. |
| `tabGroups` | Create, name and color groups. |
| `storage` | Settings and the undo list, in `chrome.storage.local`. |
| `commands` | Keyboard shortcuts. Implicit via `manifest.json`. |

There are **no** content scripts, no `<all_urls>`, no `webRequest`, no history,
no bookmarks and no telemetry. The host permissions are *optional* — they are
only requested when you pick an AI backend, and only for the endpoint you chose.

Page content is never read. The extension sees tab titles and URLs, nothing more.

---

## AI backends

All four implement the same interface in `src/lib/ai/`. None is on by default —
the rule engine goes a long way.

| Backend | Data leaves the machine | Requires |
|---|---|---|
| **Ollama** | No | Local Ollama server |
| **Edge built-in AI** | No | Edge Canary/Dev + flag + ~5.5 GB VRAM |
| **OpenAI-compatible** | Yes (to your endpoint) | Base URL + key if needed |
| **Anthropic** | Yes | API key |

Only the tabs' **title and domain** are sent — never full URLs, never page
content — and only for tabs no rule recognized.

### The Ollama trap

Ollama blocks the `chrome-extension://` origin via CORS. Start the server like
this (the extension's ID is shown on the settings page):

```sh
OLLAMA_ORIGINS='chrome-extension://<your-extension-id>' ollama serve
```

Use the specific ID, not `chrome-extension://*` — the wildcard lets every
installed extension talk to your local model.

### Edge Prompt API

`LanguageModel` is a developer preview as of August 2026: Canary/Dev only, behind
the *Prompt API for on-device language model* flag in `edge://flags`. Phi-4-mini
needs 5.5 GB VRAM and 20 GB disk; the smaller Aion-1.0-Instruct runs on CPU
behind its own flag. The settings page shows which state your machine is in.

### Anthropic from the browser

The request sends `anthropic-dangerous-direct-browser-access: true` — without
that header CORS blocks it. The key lives in the extension's local storage, not
on a server: **use a separate, revocable key.**

---

## How grouping works

```
all tabs
  ├── pinned/empty      → skipped (pinned tabs can't be in groups)
  ├── already grouped   → left alone (can be turned off)
  ├── domain rule hit   → grouped directly, free and deterministic
  └── the rest          → AI, at most 80 tabs per request
```

AI groups with only one tab are dropped — they're almost always noise. The rules
live in `src/lib/rules.js` as a plain array; add your own domains there. Group
names come from the translation catalog, so they follow the browser language.
Switching the browser language therefore gives new names: groups made in
Swedish ("Kod") aren't reused by English grouping ("Code"), so you get a new
group next to the old one.

## How duplicate cleanup works

Two tabs are duplicates if their *normalized* URLs are identical: `www.`
removed, `http`/`https` treated as equal, tracking parameters (`utm_*`,
`fbclid`, `gclid`, …) removed, query sorted, `#fragment` and trailing slash
ignored. Tracking parameters, `#fragment` and trailing slash each have a
setting; the rest is always on.

Which tab is kept is decided in order by: pinned → active → playing audio →
already grouped → most recently used. **Pinned tabs are never closed.** The
latest cleanup is saved and can be undone from the palette for ten minutes.

## How inactive tabs work

Every tab has a timestamp (`tab.lastAccessed`) for when it was last active in
its window. It exists from Chrome/Edge 121, hence `minimum_chrome_version`.
`Ctrl+I` in the palette lists tabs that haven't been active for more days than
the threshold (7 by default, changed in settings), oldest first. Uncheck what
you want to keep and confirm. Closing can be undone from the palette for ten
minutes, just like a duplicate cleanup.

Pinned, active and audible tabs are never suggested, and tabs in a group only if
you've turned that on. A tab without a timestamp isn't suggested either. There
is no keyboard shortcut that closes directly without a preview.

**Not verified:** whether the timestamp survives a restart with restored tabs.
If it doesn't, every tab looks freshly opened after a restart, and fewer tabs
are suggested than expected. Never more.

## Languages

The extension follows the browser language: Swedish if Edge/Chrome runs in
Swedish, English otherwise. Strings live in `_locales/<lang>/messages.json`. A
new language is a new catalog with the same keys; the tests check that all
catalogs have the same keys and that every key the code uses exists.

## File map

```
manifest.json
_locales/
  en/messages.json       English (default)
  sv/messages.json       Swedish
src/
  background.js          service worker — keyboard commands only
  lib/
    settings.js          storage.local, defaults
    urlkey.js            URL normalization for duplicates
    fuzzy.js             subsequence matching for the palette
    rules.js             domain → category
    tabs.js              query, dedupe plan, inactive tabs, group application, undo
    grouping.js          rules first, then AI
    omnibox.js           address bar search behind the `t` keyword
    i18n.js              _locales lookup, `code` and [[key]] in strings
    ai/
      index.js           interface, prompt, JSON schema
      ollama.js  openai.js  anthropic.js  edge.js
  palette/               popup: search, preview, apply
  options/               settings
test/logic.test.mjs      tests for URL normalization, rules, fuzzy, dedupe, inactive tabs, omnibox, languages
```

The tests run without dependencies and without a browser:

```sh
node test/logic.test.mjs
```

Among other things they verify that pinned tabs never end up in the close list
and that `github.com.evil.se` doesn't match the `github.com` rule.

Titles from web pages are untrusted input and are always set as text nodes,
never via `innerHTML`.

---

## Keyboard shortcuts

| Key | Does |
|---|---|
| `t` + space in the address bar | Search open tabs |
| `Ctrl+Shift+K` | Open the palette |
| `Ctrl+Shift+U` | Clean up duplicates directly (no preview) |
| — | Group directly (no default key) |
| `Ctrl+D` / `Ctrl+G` / `Ctrl+I` | In the palette: preview duplicates / grouping / inactive tabs |
| `Space` | In the inactive-tab list: keep or close the tab |
| `↑` `↓` `Enter` | Navigate and jump to tab |
| `Esc` | Back, then close |
