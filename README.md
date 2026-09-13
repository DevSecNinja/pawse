# Pawse

Een rustig maatje voor waterpauzes, minder schermtijd en het einde van je werkdag.
Pawse is een interactieve **browsermockup met Nederlandse UI**, geen desktop-app.
Kies **Miso**, **Totoro**, **Kawaii pup** of **Labrador**; de productnaam blijft Pawse.

**Demo:** https://devsecninja.github.io/pawse/

Direct naar [Miso](https://devsecninja.github.io/pawse/#miso),
[Totoro](https://devsecninja.github.io/pawse/#totoro),
[Kawaii pup](https://devsecninja.github.io/pawse/#puppy) of
[Labrador](https://devsecninja.github.io/pawse/#labrador).

## Lokaal starten

Open `index.html` direct in een moderne browser, of gebruik **Node.js 24.2+**:

```sh
node serve-pawse.mjs
```

Open de getoonde URL. De server luistert alleen op `127.0.0.1` en kiest een vrije
poort. Met `node serve-pawse.mjs 8080` kies je zelf een poort; stop met Ctrl+C.
Herstart de server na wijzigingen aan de HTML. Geen installatie, npm-pakketten
of build nodig. Ook `/pawse/` werkt lokaal, net als op GitHub Pages.

## Bediening en grenzen

- Kies je maatje bovenaan; de keuze staat in `#miso`, `#totoro`, `#puppy` of
  `#labrador`. De radioknoppen werken ook met Tab, de pijltjestoetsen en spatie.
- Probeer de drie momenten: water halen, acht actieve schermuren en werkdag afsluiten.
- Bevestig, kies snooze of speel de aankomst opnieuw met **Nog een keer**.
- Pas de eindtijd aan; zet water, het achtuurseintje of wandelen aan/uit.
  De systeemvoorkeur voor minder beweging wordt ook gerespecteerd.

De personages, zijaanzichten, afzonderlijk bewegende poten, afwisselende
looprichtingen, bevestigingen en slaapstanden zijn geanimeerd en interactief.
Elk maatje heeft eigen, zelfgetekende inline SVG voor avatar, zithouding, slaapstand
en zijaanzicht, niet alleen een andere kleur. Er zijn geen externe assets, services
of analytics.

Het bureaublad, de klokken en de gebruiksduur zijn **voorbeelden**. Er is geen
OS-overlay, echte activiteitsmeting, notificatieplanning of snoozetimer. Er wordt
niets afgesloten, geblokkeerd of vergrendeld. Instellingen gelden alleen voor de
huidige pagina en worden niet opgeslagen; alleen de maatjeskeuze zit in de URL.

## Bestanden en regressiecheck

| Bestand | Inhoud |
| --- | --- |
| `index.html` | Hele mockup: CSS, inline SVG en JavaScript. SVG-symbolen bevatten de gezichten; `walk-art` bevat de goedgekeurde zijaanzichten. |
| `serve-pawse.mjs` | Kleine lokale HTTP-server, ook herbruikbaar door de check. |
| `check-pawse-motion.mjs` | Bestaande loop- en gedragscheck via headless Edge/Chrome en CDP, zonder extra dependencies. |
| `.nojekyll` | Statische GitHub Pages-publicatie vanaf `main`, map `/`; geen eigen deploymentworkflow nodig. |

De looplogica staat in `walkModels`, `legPose`, `paintWalk`, `walkProgress`,
`advanceWalk`, `walkIn` en `stopWalk`. Miso, Kawaii pup en Labrador hebben vier
afzonderlijke poten en eigen kop-, oor- of staartbewegingen; Totoro heeft een
zwaardere tweebenige gang. Afstand en
stappatroon blijven gekoppeld, steunpoten blijven op de grond, en aankomst eindigt
met het neerzetten van de poten. Onderbreken annuleert de animatie en verplaatsing.
`applyCompanion` verzorgt de avatar en maatjesteksten, `render` de demo-toestanden.

```sh
node check-pawse-motion.mjs
node check-pawse-motion.mjs --screenshot pawse-walk-frames.png
node check-pawse-motion.mjs --ui-screenshot pawse-demo.png --screenshot pawse-walk-frames.png
```

De check heeft Node.js 24.2+ en een geinstalleerde **Edge, Chrome of Chromium**
nodig. Hij zoekt gangbare installaties op Windows, macOS en Linux.
Stel zo nodig `BROWSER_PATH` in op het volledige pad naar het browserprogramma.
Hij start een eigen tijdelijke loopbackserver en een uniek browserprofiel in de
tijdelijke systeemmap, en ruimt beide op; bestaande browsers en servers worden
niet gebruikt of gestopt. De optionele
schermafbeeldingen blijven op de opgegeven paden en horen niet in de repository.
`--screenshot` maakt een contactblad met alle vier maatjes: avatar, zithouding,
slaapstand en vier loopfasen. `--ui-screenshot` bewaart daarvoor de gewone demo.

De check controleert **14014 IK-houdingen**, vaste botlengtes en minder dan 0,05 px
verschuiving van steunpoten voor alle vier maatjes in beide richtingen. Verder:
directe URL-keuze, herladen, hashwissels en onbekende fragmenten; Pawse-naam, avatars,
toegankelijke labels en echte toetsenbordbediening; bevestigen, snoozen, uitgeschakelde
herinneringen en behoud van instellingen bij maatjeswissels; onderbreken, aankomst,
resize, gesimuleerde onzichtbaarheid en reduced motion. Layout en keuzeknoppen worden
bij 320, 390, 580 en 1280 px getest. Een gepubliceerde versie kan expliciet worden
gecontroleerd met:

```sh
node check-pawse-motion.mjs --url https://devsecninja.github.io/pawse/
```

## Later verder

Gebruik dit als bewaard ontwerp en gedragsreferentie. Een volgende stap kan een
native desktopvenster met echte lokale activiteitssignalen en herinneringen zijn;
die integratie bestaat hier nog niet. Houd schermtijd en ingestelde eindtijd
gescheiden en behoud de rustige, optionele bediening.

**Personagerechten:** Miso, Kawaii pup en Labrador zijn eigen ontwerpen. Totoro is een personage van
derden; deze zelfgetekende, gestileerde fan-art is een niet-officieel concept,
zonder affiliatie of goedkeuring. Rechten op Totoro blijven bij de rechthebbenden;
deze publicatie verleent geen licentie op dat personage. Er is geen algemene
licentie toegevoegd en er is geen externe referentieafbeelding opgenomen.
