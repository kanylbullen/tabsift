# Tabsift privacy policy

*English · [Svenska](PRIVACY.sv.md)* · Last updated 2026-11-18

Tabsift is a browser extension for finding, cleaning up and organizing open
tabs. This page describes all data it handles. Every statement here can be
checked against the source code in this repository.

## What the extension reads

With the `tabs` permission, Tabsift reads the **title, URL, favicon URL and
last-active time** of your open tabs, plus whether a tab is pinned, active,
playing audio or in a group. It uses this to search tabs, find duplicates,
suggest inactive tabs and group them.

It does **not** read page content, run scripts on web pages, or access your
history, bookmarks, cookies or downloads.

## What is stored, and where

Everything is stored in the browser's local extension storage
(`chrome.storage.local`) on your computer. Nothing is synced to your browser
account.

- **Settings**, including an AI provider API key if you enter one.
- **The latest cleanup** (URL, window and position of each tab closed), so it
  can be undone. It is deleted when you undo it, when a new cleanup replaces it,
  or the first time you open the palette after the ten-minute undo window.

Removing the extension deletes all of it.

## What leaves your computer

**By default, nothing.** Tabsift has no server, no analytics, no telemetry and
no ads.

Data is only sent if **you** turn on an AI provider in the settings for
grouping tabs. Then, when you run grouping:

- The **title** (at most 120 characters) and **domain** of tabs that no
  built-in rule recognizes are sent to the provider you chose — never full URLs
  and never page content. At most the number of tabs you set (80 by default)
  per request.
- The names of your existing tab groups and of Tabsift's built-in categories
  are sent along, so the provider can reuse them.
- "Test connection" in the settings sends three made-up example tabs.

Where it goes depends on your choice:

| Provider | Destination |
|---|---|
| Ollama | Your own Ollama server (by default on your computer) |
| Edge built-in AI | Nowhere — the model runs inside the browser |
| OpenAI-compatible | The address you entered |
| Anthropic | `api.anthropic.com`, with your own API key |

Network access to a provider is an optional permission that the browser asks
you to approve, and only for the provider you picked. What a provider does with
the data is covered by that provider's own privacy policy.

## Sharing and sale

Tabsift does not sell data, share it with third parties, or use it for
advertising or for anything other than the features above.

## Contact

Questions and reports: <https://github.com/kanylbullen/tabsift/issues>
