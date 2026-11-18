# Publishing to the stores

What goes into Chrome Web Store and Microsoft Edge Add-ons, in which order, and
the text every form asks for. Steps only the owner can take — accounts, fees,
the **Publish** button — are marked **(owner)**.

Modelled on Tagaro's submission (`tagaro-core/docs/store-listing.md`), which
went through both stores first. Two lessons from it apply here:

- **Chrome rejected Tagaro 0.2.1** under *Spam and Placement*, most likely for
  *Functionality*: its texts said the extension "does nothing" without a
  companion app. Tabsift's texts start with what works the moment it is
  installed — the palette, duplicates and inactive tabs — and present AI as
  optional. Never describe a feature as doing nothing.
- **The stores assign the extension id.** The manifest has no `key`, and
  `scripts/pack.py` refuses one.

## Order

1. **Edge Add-ons.** Free, Partner Center, up to seven business days.
2. **Chrome Web Store.** Developer Dashboard, usually a few days.

Both listings are **public** (searchable), unlike Tagaro's hidden ones.

## The package

```sh
python3 scripts/pack.py      # dist/tabsift-<version>.zip, prints sha256
```

Contents: `manifest.json`, `_locales/`, `src/`, `icons/`. Not tests, scripts,
docs or store images. The script checks that the description fits 132
characters in every language and that every file the manifest names exists.
The zip is reproducible: the same tree gives the same sha256.

Every upload needs a higher `version` than the last; bump it in
`manifest.json` in the same PR as the change.

## Images

```sh
python3 scripts/make-icons.py           # icons/ and store/icon-128.png, store/logo-300.png
python3 scripts/screenshots/shoot.py    # store/screenshots/<lang>-<n>-<view>.png
```

| Image | Chrome | Edge |
|---|---|---|
| Icon | `store/icon-128.png` (96 px mark, 16 px transparent margin, Google's guideline) | — |
| Logo | — | `store/logo-300.png` (300 × 300) |
| Screenshots | 1–5 at 1280 × 800, required | optional, 1280 × 800 |

Screenshots: `en-1-search`, `en-2-dedupe`, `en-3-stale` for the English
listing, `sv-…` for the Swedish one. They are rendered from the real palette
against made-up tabs (`scripts/screenshots/stub.js`), so no real browsing ends
up in a listing. Promo tiles are optional and skipped.

## Listing

**Name:** Tabsift (from the manifest, locked in both forms).

**Summary** (the manifest `description`, per language from `_locales`):

- en: Fuzzy tab palette, duplicate cleanup, inactive-tab suggestions and
  semantic tab grouping. Local AI or your own key. No telemetry.
- sv: Flikpalett, dubblettstädning, förslag på inaktiva flikar och semantisk
  gruppering. Lokal AI eller egen nyckel. Ingen telemetri.

**Description, English** (Edge requires at least 250 characters):

> Tabsift helps you find, clean up and organize open tabs.
>
> • Tab palette: press Ctrl+Shift+K and type a few letters to jump to any open
> tab, in any window. Or type t and a space in the address bar.
> • Duplicates: see which tabs are the same page, even when tracking parameters
> or fragments differ, and close the extra copies. Pinned tabs are never
> closed.
> • Inactive tabs: list tabs you haven't looked at for a week (or whatever you
> choose), oldest first, and close the ones you don't need.
> • Grouping: put tabs into named, colored tab groups. Built-in rules for
> common sites handle most tabs; for the rest you can optionally connect an AI
> provider — a local model via Ollama, Edge's built-in AI, any OpenAI-compatible
> endpoint or Anthropic with your own key.
>
> Every cleanup shows a preview first and can be undone for ten minutes.
>
> Private by design: Tabsift reads tab titles and addresses only, never page
> content. It has no server, no analytics and no telemetry. Nothing leaves your
> computer unless you turn on an AI provider, and then only the titles and
> domains of tabs the rules didn't recognize are sent, to the provider you
> chose.
>
> Open source (MIT): https://github.com/kanylbullen/tabsift
> Available in English and Swedish.

**Description, Swedish** (add as a second language: Chrome *Store listing →
Add language*, Edge *Store listings → Add a language*):

> Tabsift hjälper dig att hitta, städa upp och ordna öppna flikar.
>
> • Flikpalett: tryck Ctrl+Shift+K och skriv några bokstäver för att hoppa
> till vilken öppen flik som helst, i vilket fönster som helst. Eller skriv t
> och mellanslag i adressfältet.
> • Dubbletter: se vilka flikar som är samma sida, även när
> spårningsparametrar eller fragment skiljer sig, och stäng de extra
> kopiorna. Fästa flikar stängs aldrig.
> • Inaktiva flikar: lista flikar du inte tittat på på en vecka (eller den tid
> du väljer), äldst först, och stäng dem du inte behöver.
> • Gruppering: lägg flikar i namngivna, färgade flikgrupper. Inbyggda regler
> för vanliga sajter klarar de flesta flikar; för resten kan du välja att
> koppla in en AI-leverantör — en lokal modell via Ollama, Edges inbyggda AI,
> en OpenAI-kompatibel endpoint eller Anthropic med din egen nyckel.
>
> Varje städning visar en förhandsvisning först och kan ångras i tio minuter.
>
> Integritet från början: Tabsift läser bara flikars rubriker och adresser,
> aldrig sidinnehåll. Det har ingen server, ingen analys och ingen telemetri.
> Inget lämnar din dator om du inte slår på en AI-leverantör, och då skickas
> bara rubrik och domän för flikar reglerna inte kände igen, till den
> leverantör du valt.
>
> Öppen källkod (MIT): https://github.com/kanylbullen/tabsift
> Finns på svenska och engelska.

**Category:** Chrome *Productivity → Tools* (or *Workflow & Planning*). Edge
*Productivity*.
**Website:** https://github.com/kanylbullen/tabsift
**Support:** https://github.com/kanylbullen/tabsift/issues
**Privacy policy:** https://github.com/kanylbullen/tabsift/blob/main/PRIVACY.md
— public only once the repository is public.

## The forms — for the reviewer

Both stores ask the same questions. The answers must match the manifest, the
privacy policy and the code; reviewers compare them.

**Single purpose**

> Tab management: find, clean up and organize the user's open tabs — search
> them, close duplicates and long-unused tabs after a preview, and sort them
> into tab groups.

**Permission justification**

- `tabs` — to read the title, URL and last-active time of open tabs so they
  can be searched, compared for duplicates and suggested as inactive, and to
  switch to, close and reopen tabs. No page content is read; there are no
  content scripts.
- `tabGroups` — to create, name and color tab groups when the user groups
  tabs.
- `storage` — to keep the user's settings and the last cleanup (so it can be
  undone) in local extension storage.
- Optional host permissions `http://localhost/*`, `http://127.0.0.1/*`,
  `https://api.anthropic.com/*`, `https://api.openai.com/*` — requested at
  runtime only if the user picks an AI provider for grouping, and only for
  that provider's address (a local Ollama or LM Studio server, Anthropic or
  OpenAI). Without them the extension makes no network requests.

**Remote code:** No. All code is in the package; AI providers return group
names as JSON data, which is never executed.

**Data usage.** Chrome: tick **Web history** and nothing else — tab titles and
domains can be sent to an AI provider the user chooses. Edge: the matching
box. Description where asked:

> The extension reads the titles and addresses of open tabs to provide its
> features, locally. Nothing is sent anywhere by default. If the user turns on
> an AI provider for grouping, the titles (max 120 characters) and domains of
> tabs no built-in rule recognizes are sent to that provider — the user's own
> local server, or OpenAI-compatible/Anthropic endpoints with the user's own
> key. Not sold, not shared with third parties, not used for advertising.

Certifications (all three): not sold to third parties; not used or transferred
for purposes unrelated to the single purpose; not used to determine
creditworthiness or for lending.

**Test instructions** (Chrome allows at most 500 characters; Edge 2 000 — use
the same text):

> No account or setup needed. Open a few tabs, including two copies of one
> page. Click the toolbar icon (or Ctrl+Shift+K): type to search tabs, Enter
> jumps. Ctrl+D previews duplicates, Ctrl+I lists tabs inactive for 7+ days
> (adjustable in Options), Ctrl+G groups tabs by built-in rules. Every close
> can be undone. AI grouping is optional and needs the reviewer's own provider;
> everything else works without it.

That text is 469 characters. Edge asks whether the reviewer needs credentials
or accounts: **No**.

## Accounts (owner)

- **Edge:** Partner Center, "Microsoft Edge program", free. The account from
  Tagaro (personal Microsoft account, individual, verified 2026-10-29) works.
- **Chrome:** Developer Dashboard (`chrome.google.com/webstore/devconsole`).
  The account from Tagaro works. New publishers may have at most two published
  items; Tagaro is not published in Chrome yet, so Tabsift fits. Tagaro's
  rejection is under appeal — don't let that make this item look like a
  duplicate: different name, different code, different purpose.
- **Publish** is pressed by the owner in both stores.

## Edge Add-ons — page by page

Partner Center → Edge → *Create new extension*:

1. **Packages:** `dist/tabsift-<version>.zip`.
2. **Availability:** Visibility **Public**. Markets: all.
3. **Properties:** Category *Productivity*. Website and support URLs above.
   Mature content: no.
4. **Privacy:** single purpose, permission justifications, *No remote code*,
   data boxes, certifications, privacy policy URL — all under *The forms*.
5. **Store listings:** name and summary come from the manifest. Description
   from *Listing*. Logo `store/logo-300.png`. Screenshots optional; use the
   three for the language. Add Swedish as a second language.
6. **Publish → Notes for certification:** the test instructions. Then
   **Publish (owner)**.

## Chrome Web Store — tab by tab

Developer Dashboard → *Add new item* → the same zip:

1. **Package:** the upload.
2. **Store listing:** description from *Listing*, category, language English,
   then *Add language* → Swedish. Store icon `store/icon-128.png`. Screenshots:
   the three for each language. Homepage and support URLs.
3. **Privacy:** the same answers as Edge, with one justification per optional
   host permission. Data: *Web history*. Certifications. Policy URL.
4. **Distribution:** Visibility **Public**. Regions: all.
5. **Test instructions:** the text above.
6. **Submit for review (owner)**.

## Afterwards

1. Note both ids (Chrome: the item id in the dashboard; Edge: Partner Center →
   Overview). Put the store links in both READMEs.
2. Check that Edge actually serves it — the update service is what browsers
   install from, not the listing page:

   ```sh
   curl -s 'https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=updatecheck&x=id%3D<edge-id>%26v%3D0.0.0%26uc'
   ```

   `status="ok"` with the uploaded version is the receipt.
3. Updates: bump `version`, `python3 scripts/pack.py`, upload the new zip in
   both dashboards. Store texts only change if the features do.
