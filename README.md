# Pawse

A gentle buddy for water breaks, less screen time and the end of your workday.
Pawse is an interactive **browser mockup with an English UI**, not a desktop app.
Choose **Miso**, **Totoro**, **Kawaii pup** or **Labrador**; the product name stays Pawse.

**Demo:** https://devsecninja.github.io/pawse/

Jump straight to [Miso](https://devsecninja.github.io/pawse/#miso),
[Totoro](https://devsecninja.github.io/pawse/#totoro),
[Kawaii pup](https://devsecninja.github.io/pawse/#puppy) or
[Labrador](https://devsecninja.github.io/pawse/#labrador).

## Running locally

Open `index.html` directly in a modern browser, or use **Node.js 24.2+**:

```sh
node serve-pawse.mjs
```

Open the URL shown. The server listens only on `127.0.0.1` and picks an available
port. Use `node serve-pawse.mjs 8080` to choose a port; stop with Ctrl+C.
Restart the server after changing the HTML. No installation, npm packages
or build required. The `/pawse/` path also works locally, just like on GitHub Pages.

## Controls and limitations

- Choose your buddy at the top; the selection is stored in `#miso`, `#totoro`, `#puppy` or
  `#labrador`. The radio buttons also work with Tab, the arrow keys and Space.
- Try the three moments: getting water, eight hours of active screen time and wrapping up the workday.
- Accept, snooze or replay the arrival with **Play again**.
- Adjust the end time; turn water reminders, the eight-hour reminder or walking on/off.
  The system's reduced-motion preference is also respected.

The characters, side views, independently moving legs, alternating
walking directions, confirmations and sleeping states are animated and interactive.
Each buddy has its own hand-drawn inline SVG for its avatar, sitting pose, sleeping
pose and side view, not just a different colour. There are no external assets, services
or analytics.

The desktop, clocks and usage times are **examples**. There is no
OS overlay, actual activity tracking, notification scheduling or snooze timer. Nothing
gets closed, blocked or locked. Settings apply only to the
current page and are not saved; only the buddy selection is stored in the URL.

## Files and regression check

| File | Contents |
| --- | --- |
| `index.html` | The entire mockup: CSS, inline SVG and JavaScript. SVG symbols contain the faces; `walk-art` contains the approved side views. |
| `serve-pawse.mjs` | Small local HTTP server, also reusable by the check. |
| `check-pawse-motion.mjs` | Walking and behaviour checks using headless Edge/Chrome and CDP, with no extra dependencies. |
| `.nojekyll` | Static GitHub Pages publishing from `main`, folder `/`; no custom deployment workflow needed. |

The walking logic lives in `walkModels`, `legPose`, `paintWalk`, `walkProgress`,
`advanceWalk`, `walkIn` and `stopWalk`. Miso, Kawaii pup and Labrador have four
separate legs and their own head, ear or tail movements; Totoro has a
heavier two-legged gait. Distance and
gait stay linked, supporting paws stay planted, and arrival ends
with the paws settling on the ground. Interrupting cancels the animation and movement.
`applyCompanion` handles the avatar and buddy-specific copy; `render` handles the demo states.

```sh
node check-pawse-motion.mjs
node check-pawse-motion.mjs --screenshot pawse-walk-frames.png
node check-pawse-motion.mjs --ui-screenshot pawse-demo.png --screenshot pawse-walk-frames.png
```

The check requires Node.js 24.2+ and an installed copy of **Edge, Chrome or Chromium**.
It looks for common installations on Windows, macOS and Linux.
If needed, set `BROWSER_PATH` to the full path of the browser executable.
It starts its own temporary loopback server and a unique browser profile in the
system's temporary directory, then cleans up both; existing browsers and servers are
not used or stopped. Optional
screenshots remain at the specified paths and do not belong in the repository.
`--screenshot` creates a contact sheet of all four buddies: avatar, sitting pose,
sleeping pose and four walking phases. `--ui-screenshot` saves the normal demo first.

The check verifies **14014 IK poses**, fixed bone lengths and less than 0.05 px
of supporting-paw drift for all four buddies in both directions. It also covers:
direct URL selection, reloads, hash changes and unknown fragments; the Pawse name, avatars,
English initial and dynamic UI copy, accessible labels and real keyboard controls; accepting, snoozing, disabled
reminders and settings preservation when switching buddies; interruptions, arrival,
resizing, simulated page invisibility and reduced motion. Layout and selection controls are
tested at 320, 390, 580 and 1280 px. A published version can be checked
explicitly with:

```sh
node check-pawse-motion.mjs --url https://devsecninja.github.io/pawse/
```

## Future development

Use this as a saved design and behaviour reference. A next step could be a
native desktop window with real local activity signals and reminders;
that integration does not exist here yet. Keep screen time and the chosen end time
separate, and preserve the gentle, optional controls.

**Character rights:** Miso, Kawaii pup and Labrador are original designs. Totoro is a third-party
character; this hand-drawn, stylized fan art is an unofficial concept,
with no affiliation or endorsement. Rights to Totoro remain with their respective holders;
this publication does not grant a licence to that character. No general
licence has been added, and no external reference image is included.
