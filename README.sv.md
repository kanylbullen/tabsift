# Tabsift

*[English](README.md) · Svenska*

Flikhantering för Edge/Chrome som gör fyra saker: en fuzzy **flikpalett**, en
**dubblettstädning** med förhandsvisning och ångra, **förslag på inaktiva flikar**
att stänga, och **semantisk gruppering** där regler går först och AI bara får det
reglerna missar.

Byggd för att gå att granska: **inget byggsteg, inga beroenden**. Koden som körs
är koden som ligger här.

---

## Adressfältet

Skriv **`t`** följt av mellanslag eller Tab i adressfältet, sedan din sökning:

```
t oauth        → Byt till fliken "OAuth redirect_uri mismatch"
t github       → matchar även på domän
t              → senast använda flikarna
```

Enter byter flik, oavsett vilket fönster den ligger i. Nyckelordet ändras i
`manifest.json` under `"omnibox"` — det går inte att ändra i körtid.

**Det som fortfarande inte går:** att påverka webbläsarens *egna* förslag när du
skriver utan nyckelord. `chrome.omnibox` ger tillägget tangenttryck först efter
nyckelordet, och den inbyggda "Byt till den här fliken"-rankningen har inget API.
Ett tillägg som påstår annat gör det via en overlay, inte via adressfältet.

`Ctrl+Shift+K` öppnar samma sökning som en palett med förhandsvisning, om du
hellre vill se hela listan.

---

## Installera

1. Öppna `edge://extensions` (eller `chrome://extensions`).
2. Slå på **Utvecklarläge**.
3. **Läs in uppackat** → välj den här mappen, den som har `manifest.json` direkt i sig (inte `src`).
4. Inställningssidan öppnas automatiskt vid första installationen.

Ändra kortkommandon på `edge://extensions/shortcuts`.

---

## Behörigheter

```json
"permissions": ["tabs", "tabGroups", "storage"],
"optional_host_permissions": [
  "http://localhost/*", "http://127.0.0.1/*",
  "https://api.anthropic.com/*", "https://api.openai.com/*"
]
```

| Behörighet | Varför |
|---|---|
| `tabs` | Läsa flikars titel och URL. Utan den är allt annat meningslöst. |
| `tabGroups` | Skapa, namnge och färgsätta grupper. |
| `storage` | Inställningar och ångra-listan, i `chrome.storage.local`. |
| `commands` | Kortkommandon. Implicit via `manifest.json`. |

Det finns **inga** content scripts, ingen `<all_urls>`, ingen `webRequest`, ingen
historik, inga bokmärken och ingen telemetri. Host-behörigheterna är *optional* —
de frågas först när du väljer en AI-backend, och bara för den endpoint du valt.

Sidinnehåll läses aldrig. Tillägget ser flikars titel och URL, inget mer.

---

## AI-backends

Alla fyra implementerar samma gränssnitt i `src/lib/ai/`. Ingen är påslagen som
standard — regelmotorn räcker långt.

| Backend | Data lämnar maskinen | Kräver |
|---|---|---|
| **Ollama** | Nej | Lokal Ollama-server |
| **Edge inbyggd AI** | Nej | Edge Canary/Dev + flagga + ~5,5 GB VRAM |
| **OpenAI-kompatibel** | Ja (till din endpoint) | Bas-URL + ev. nyckel |
| **Anthropic** | Ja | API-nyckel |

Bara flikarnas **titel och domän** skickas — aldrig hela URL:er, aldrig
sidinnehåll — och bara för de flikar ingen regel kände igen.

### Ollama-fällan

Ollama blockerar `chrome-extension://`-origin via CORS. Starta servern så här
(tilläggets ID står på inställningssidan):

```sh
OLLAMA_ORIGINS='chrome-extension://<ditt-extension-id>' ollama serve
```

### Edge Prompt API

`LanguageModel` är developer preview i augusti 2026: bara Canary/Dev, bakom
flaggan *Prompt API for on-device language model* i `edge://flags`. Phi-4-mini
kräver 5,5 GB VRAM och 20 GB disk; den mindre Aion-1.0-Instruct går på CPU bakom
en egen flagga. Inställningssidan visar vilket läge din maskin är i.

### Anthropic från webbläsaren

Anropet skickar `anthropic-dangerous-direct-browser-access: true` — utan den
headern blockerar CORS förfrågan. Nyckeln ligger i tilläggets lokala lagring, inte
på en server: **använd en separat, återkallningsbar nyckel.**

---

## Så fungerar grupperingen

```
alla flikar
  ├── fästa/tomma       → hoppas över (fästa flikar kan inte ligga i grupper)
  ├── redan grupperade  → lämnas i fred (kan slås av)
  ├── domänregel träff  → grupp direkt, gratis och deterministiskt
  └── resten            → AI, max 80 flikar per anrop
```

AI-grupper med bara en flik kastas — de är nästan alltid brus. Reglerna bor i
`src/lib/rules.js` och är en vanlig array; lägg till dina egna domäner där.
Gruppnamnen kommer från språkkatalogen och följer webbläsarens språk. Byter du
språk får grupperna nya namn: en grupp som skapats på svenska ("Kod")
återanvänds inte av engelsk gruppering ("Code"), utan en ny grupp hamnar bredvid.

## Så fungerar dubblettstädningen

Två flikar är dubbletter om deras *normaliserade* URL är identisk: `www.` bort,
`http`/`https` likställda, spårningsparametrar (`utm_*`, `fbclid`, `gclid`, …)
borttagna, query sorterad, `#fragment` och avslutande snedstreck ignorerade. Spårningsparametrar,
`#fragment` och avslutande snedstreck har var sin inställning, resten är alltid på.

Vilken flik som behålls avgörs i tur och ordning av: fäst → aktiv → spelar ljud →
redan grupperad → senast använd. **Fästa flikar stängs aldrig.** Senaste
städningen sparas och kan ångras från paletten i tio minuter.

---

## Så fungerar inaktiva flikar

Varje flik har en tidsstämpel (`tab.lastAccessed`) för när den senast var aktiv
i sitt fönster. Den finns från Chrome/Edge 121, därav `minimum_chrome_version`.
`Ctrl+I` i paletten listar flikar som inte varit aktiva på fler dagar än gränsen
(7 som standard, ändras i inställningarna), äldst först. Bocka ur det du vill
behålla och verkställ. Stängningen kan ångras från paletten i tio minuter, på
samma sätt som en dubblettstädning.

Fästa, aktiva och ljudspelande flikar föreslås aldrig, och flikar i en grupp
bara om du slagit på det. En flik utan tidsstämpel föreslås inte heller. Det
finns inget kortkommando som stänger direkt, utan förhandsvisning.

**Ej verifierat:** om tidsstämpeln överlever en omstart med återställda flikar.
Gör den inte det ser alla flikar nyöppnade ut efter omstart, och då föreslås
färre flikar än väntat. Det blir aldrig fler.

## Språk

Tillägget följer webbläsarens språk: svenska om Edge/Chrome körs på svenska,
annars engelska. Texterna ligger i `_locales/<språk>/messages.json`. Ett nytt
språk är en ny katalog med samma nycklar; testerna kontrollerar att alla
kataloger har samma nycklar och att varje nyckel koden använder finns.

## Filkarta

```
manifest.json
_locales/
  en/messages.json       engelska (standard)
  sv/messages.json       svenska
src/
  background.js          service worker — bara kortkommandon
  lib/
    settings.js          storage.local, defaults
    urlkey.js            URL-normalisering för dubbletter
    fuzzy.js             delsekvensmatchning för paletten
    rules.js             domän → kategori
    tabs.js              query, dedupe-plan, inaktiva flikar, gruppapplicering, ångra
    grouping.js          regler först, sen AI
    omnibox.js           adressfältssökning bakom nyckelordet `t`
    i18n.js              uppslag i _locales, `kod` och [[tangent]] i texter
    ai/
      index.js           gränssnitt, prompt, JSON-schema
      ollama.js  openai.js  anthropic.js  edge.js
  palette/               popup: sök, förhandsvisa, verkställ
  options/               inställningar
test/logic.test.mjs      test för URL-normalisering, regler, fuzzy, dedupe, inaktiva, omnibox, språk
```

Testerna körs utan beroenden och utan webbläsare:

```sh
node test/logic.test.mjs
```

De verifierar bland annat att fästa flikar aldrig hamnar i stängningslistan och
att `github.com.evil.se` inte matchar `github.com`-regeln.

Rubriker från webbsidor är opålitlig indata och sätts alltid som textnoder,
aldrig via `innerHTML`.

---

## Kortkommandon

| Tangent | Gör |
|---|---|
| `t` + mellanslag i adressfältet | Sök bland öppna flikar |
| `Ctrl+Shift+K` | Öppna paletten |
| `Ctrl+Shift+U` | Städa dubbletter direkt (utan förhandsvisning) |
| — | Gruppera direkt (ingen standardtangent) |
| `Ctrl+D` / `Ctrl+G` / `Ctrl+I` | I paletten: förhandsvisa dubbletter / gruppering / inaktiva flikar |
| `Mellanslag` | I listan med inaktiva flikar: behåll eller stäng fliken |
| `↑` `↓` `Enter` | Navigera och hoppa till flik |
| `Esc` | Tillbaka, sen stäng |
