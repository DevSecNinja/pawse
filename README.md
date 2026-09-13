# Pawse

Een rustig maatje voor waterpauzes, minder schermtijd en het einde van je werkdag.
Pawse is een interactieve **browsermockup met Nederlandse UI**, geen desktop-app.
Kies het eigen katje Miso of het gestileerde bosmaatje Totoro; de productnaam blijft Pawse.

**Demo:** https://devsecninja.github.io/pawse/

Direct naar [Miso](https://devsecninja.github.io/pawse/#miso) of
[Totoro](https://devsecninja.github.io/pawse/#totoro).

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

- Kies **Miso / Totoro** bovenaan; de keuze staat in `#miso` of `#totoro`.
- Probeer de drie momenten: water halen, acht actieve schermuren en werkdag afsluiten.
- Bevestig, kies snooze of speel de aankomst opnieuw met **Nog een keer**.
- Pas de eindtijd aan; zet water, het achtuurseintje of wandelen aan/uit.
  De systeemvoorkeur voor minder beweging wordt ook gerespecteerd.

De personages, zijaanzichten, afzonderlijk bewegende poten, afwisselende
looprichtingen, bevestigingen en slaapstanden zijn geanimeerd en interactief.
Alle illustraties zijn inline SVG; er zijn geen externe assets, services of analytics.

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
`advanceWalk`, `walkIn` en `stopWalk`. Miso heeft vier afzonderlijke poten en een
bewegende kop/staart; Totoro heeft een zwaardere tweebenige gang. Afstand en
stappatroon blijven gekoppeld, steunpoten blijven op de grond, en aankomst eindigt
met het neerzetten van de poten. Onderbreken annuleert de animatie en verplaatsing.
`applyCompanion` verzorgt de avatar en maatjesteksten, `render` de demo-toestanden.

```sh
node check-pawse-motion.mjs
node check-pawse-motion.mjs --screenshot pawse-walk-frames.png
```

De check heeft Node.js 24.2+ en een geinstalleerde **Edge, Chrome of Chromium**
nodig. Hij zoekt gangbare installaties op Windows, macOS en Linux.
Stel zo nodig `BROWSER_PATH` in op het volledige pad naar het browserprogramma.
Hij start een eigen tijdelijke loopbackserver en browserprofiel, en ruimt beide
op; bestaande browsers en servers worden niet gebruikt of gestopt. De optionele
screenshot blijft op het opgegeven pad en hoort niet in de repository.

De check controleert 6006 IK-houdingen, vaste botlengtes, minder dan 0,05 px
verschuiving van steunpoten in beide richtingen, toestandswissels, reduced motion,
mobiele layout en de Pawse-naam/maatjeskeuze onder `/pawse/`. Een gepubliceerde
versie kan expliciet worden gecontroleerd met:

```sh
node check-pawse-motion.mjs --url https://devsecninja.github.io/pawse/
```

## Later verder

Gebruik dit als bewaard ontwerp en gedragsreferentie. Een volgende stap kan een
native desktopvenster met echte lokale activiteitssignalen en herinneringen zijn;
die integratie bestaat hier nog niet. Houd schermtijd en ingestelde eindtijd
gescheiden en behoud de rustige, optionele bediening.

**Personagerechten:** Miso is een eigen ontwerp. Totoro is een personage van
derden; deze zelfgetekende, gestileerde fan-art is een niet-officieel concept,
zonder affiliatie of goedkeuring. Rechten op Totoro blijven bij de rechthebbenden;
deze publicatie verleent geen licentie op dat personage. Er is geen algemene
licentie toegevoegd en er is geen externe referentieafbeelding opgenomen.
