# Tabsifts integritetspolicy

*[English](PRIVACY.md) · Svenska* · Senast ändrad 2026-11-24

Tabsift är ett webbläsartillägg för att hitta, städa upp och ordna öppna
flikar. Den här sidan beskriver all data det hanterar. Varje påstående här går
att kontrollera mot källkoden i det här repot. Vid skillnad gäller den
engelska versionen.

## Vad tillägget läser

Med behörigheten `tabs` läser Tabsift **rubrik, adress, favicon-adress och
senast aktiv-tid** för dina öppna flikar, och om en flik är fäst, aktiv,
spelar ljud eller ligger i en grupp. Det används för att söka bland flikar,
hitta dubbletter, föreslå inaktiva flikar och gruppera dem.

Det läser **inte** sidors innehåll, kör inga skript på webbsidor och kommer
inte åt din historik, dina bokmärken, cookies eller nedladdningar.

## Vad som sparas, och var

Allt sparas i webbläsarens lokala tilläggslagring (`chrome.storage.local`) på
din dator. Inget synkas till ditt webbläsarkonto.

- **Inställningar**, inklusive en API-nyckel till en AI-leverantör om du anger
  en.
- **Senaste städningen** (adress, fönster och position för varje stängd flik),
  så att den går att ångra. Den raderas när du ångrar, när en ny städning
  ersätter den, eller första gången du öppnar paletten efter de tio minuter
  ångra gäller.

- **Listan över automatiskt stängda flikar** (titel, adress och tid för varje,
  de senaste 100), bara om du slår på automatisk rensning. Den gör att du kan
  öppna en flik igen. Töm den i inställningarna när du vill.

Tar du bort tillägget raderas allt.

## Vad som lämnar din dator

**Som standard ingenting.** Tabsift har ingen server, ingen analys, ingen
telemetri och ingen reklam.

Data skickas bara om **du** slår på en AI-leverantör i inställningarna för
att gruppera flikar. Då, när du grupperar:

- **Rubriken** (högst 120 tecken) och **domänen** för flikar som ingen
  inbyggd regel känner igen skickas till den leverantör du valt — aldrig hela
  adresser och aldrig sidinnehåll. Högst så många flikar som du ställt in
  (80 som standard) per anrop.
- Namnen på dina befintliga flikgrupper och Tabsifts inbyggda kategorier
  skickas med, så att leverantören kan återanvända dem.
- "Testa anslutningen" i inställningarna skickar tre påhittade exempelflikar.

Vart det går beror på ditt val:

| Leverantör | Mottagare |
|---|---|
| Ollama | Din egen Ollama-server (som standard på din dator) |
| Edge inbyggd AI | Ingenstans — modellen körs i webbläsaren |
| OpenAI-kompatibel | Adressen du angav |
| Anthropic | `api.anthropic.com`, med din egen API-nyckel |

Nätverksåtkomst till en leverantör är en valfri behörighet som webbläsaren ber
dig godkänna, och bara för den leverantör du valt. Vad leverantören gör med
datan regleras av leverantörens egen integritetspolicy.

## Delning och försäljning

Tabsift säljer inte data, delar den inte med tredje part och använder den inte
för reklam eller till något annat än funktionerna ovan.

## Kontakt

Frågor och felrapporter: <https://github.com/kanylbullen/tabsift/issues>
