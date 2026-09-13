import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { Script } from "node:vm";
import { startServer } from "./serve-pawse.mjs";

const { values: options } = parseArgs({
  options: { url: { type: "string" }, screenshot: { type: "string" }, "ui-screenshot": { type: "string" } },
});
const buddies = [
  { id: "miso", name: "Miso", logo: "cat-logo", legs: 4 },
  { id: "totoro", name: "Totoro", logo: "totoro-logo", legs: 2 },
  { id: "puppy", name: "Kawaii pup", logo: "puppy-logo", legs: 4 },
  { id: "labrador", name: "Labrador", logo: "labrador-logo", legs: 4 },
];

async function findBrowser() {
  if (process.env.BROWSER_PATH) {
    await access(process.env.BROWSER_PATH, constants.X_OK);
    return process.env.BROWSER_PATH;
  }
  const names = process.platform === "win32"
    ? ["msedge.exe", "chrome.exe", "chromium.exe"]
    : ["microsoft-edge", "google-chrome", "chromium", "chromium-browser"];
  const candidates = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)
    .flatMap(directory => names.map(name => path.join(directory, name)));
  if (process.platform === "win32") {
    for (const directory of [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(path.join(directory, "Microsoft", "Edge", "Application", "msedge.exe"));
      candidates.push(path.join(directory, "Google", "Chrome", "Application", "chrome.exe"));
    }
  } else if (process.platform === "darwin") {
    for (const name of ["Microsoft Edge", "Google Chrome", "Chromium"]) {
      candidates.push(path.join(path.sep, "Applications", `${name}.app`, "Contents", "MacOS", name));
    }
  }
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) throw error;
    }
  }
  throw new Error("No Edge/Chrome/Chromium found. Set BROWSER_PATH to an installed browser executable.");
}

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response;
}

const executable = await findBrowser();
let server, profile, browser, socket, send;
let browserError, browserClosed;
let closed = false;
try {
  if (!options.url) server = await startServer();
  const url = options.url ?? `http://127.0.0.1:${server.address().port}/pawse/`;
  const html = await (await get(url)).text();
  if (!html.includes("<title>Pawse - Miso</title>")) throw new Error("Expected Pawse HTML");
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]);
  console.log("Checking:", url);
  profile = await mkdtemp(path.join(tmpdir(), "pawse-motion-"));
  browser = spawn(executable, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });
  browser.on("error", error => { browserError = error; });
  browserClosed = new Promise(resolve => browser.once("close", () => { closed = true; resolve(); }));
  let port;
  for (let i = 0; i < 100; i++) {
    if (browserError) throw browserError;
    if (closed) throw new Error(`Browser exited during startup (${browser.exitCode})`);
    try {
      port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
      if (port) break;
    } catch (error) {
      if (!["ENOENT", "EBUSY"].includes(error.code)) throw error;
    }
    await delay(100);
  }
  if (!port) throw new Error("Browser startup timed out");
  const targets = await (await get(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(target => target.type === "page");
  if (!target) throw new Error("Browser has no inspectable page");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Browser connection timed out")), 10000);
    socket.onopen = () => { clearTimeout(timer); resolve(); };
    socket.onerror = () => { clearTimeout(timer); reject(new Error("Browser connection failed")); };
  });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    if (pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
  };
  socket.onclose = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Browser connection closed"));
    }
    pending.clear();
  };
  send = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) {
        reject(new Error("Browser connection is not open"));
        return;
      }
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timed out: ${method}`));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function run(fn, ...args) {
    return evaluate(`(${fn})(${args.map(arg => JSON.stringify(arg)).join(",")})`);
  }
  async function waitFor(expression, description) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Timed out: ${description}`);
  }
  async function viewport(width) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1100, deviceScaleFactor: 1, mobile: false });
    await run(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
    const params = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode, modifiers };
    await send("Input.dispatchKeyEvent", { type: "keyDown", ...params });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
  }
  async function checkCompanion(buddy, hash = `#${buddy.id}`) {
    return run((buddy, destination, hash) => {
      const ok = (condition, message) => { if (!condition) throw new Error(buddy.id + ": " + message); };
      ok(location.pathname === destination.pathname && location.search === destination.search, "URL path/query changed");
      ok(location.hash === hash, "Fragment mismatch: " + location.hash);
      ok(document.body.dataset.companion === buddy.id, "Wrong companion");
      ok(document.title === "Pawse - " + buddy.name && $("brand-name").textContent === "Pawse", "Brand/title mismatch");
      ok($("brand-icon").getAttribute("href") === "#" + buddy.logo, "Avatar mismatch");
      const selected = [...document.querySelectorAll('input[name="companion"]:checked')];
      ok(selected.length === 1 && selected[0].value === buddy.id, "Radio selection mismatch");
      ok($("motion-label").textContent.includes(buddy.name) && $("gentle-copy").textContent.includes(buddy.name), "Companion copy mismatch");
      for (const id of ["awake-art", "sleep-art", "walk-art"]) {
        const art = $(id);
        ok(art.getAttribute("role") === "img" && art.getAttribute("aria-label")?.trim(), "Missing art description: " + id);
        for (const group of art.querySelectorAll("[data-buddy-art]")) {
          ok((getComputedStyle(group).display !== "none") === (group.dataset.buddyArt === buddy.id), "Wrong visible art: " + id);
        }
      }
      return location.pathname + location.search + location.hash + " / " + document.title;
    }, buddy, { pathname: new URL(url).pathname, search: new URL(url).search }, hash);
  }
  async function loadFragment(fragment, buddy) {
    // A fragment-only navigation can reuse the document; start blank to test initialization.
    await send("Page.navigate", { url: "about:blank" });
    await waitFor("location.href === 'about:blank' && document.readyState === 'complete'", "blank page");
    const destination = new URL(url);
    destination.hash = fragment;
    const navigation = await send("Page.navigate", { url: destination.href });
    if (navigation.errorText) throw new Error(navigation.errorText);
    await waitFor(`document.readyState === 'complete' && document.body.dataset.companion === ${JSON.stringify(buddy.id)}`, destination.href);
    await checkCompanion(buddy, destination.hash);
  }
  async function screenshot(file, clip) {
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, ...(clip ? { clip } : {}) });
    await writeFile(file, Buffer.from(shot.data, "base64"));
  }
  await send("Runtime.enable");
  await send("Page.enable");
  await viewport(1280);
  for (const buddy of buddies) {
    await loadFragment(buddy.id, buddy);
    await evaluate("window.__pawseBeforeReload = true");
    await send("Page.reload");
    await waitFor(`!window.__pawseBeforeReload && document.readyState === 'complete' && document.body.dataset.companion === ${JSON.stringify(buddy.id)}`, "fragment reload");
    console.log("Initial fragment and reload:", await checkCompanion(buddy));
  }
  for (const fragment of ["unknown-companion", "constructor", "__proto__", ""]) {
    await loadFragment(fragment, buddies[0]);
  }
  for (const fragment of [...buddies.map(buddy => buddy.id), "unknown-companion", "constructor", "__proto__", ""]) {
    const buddy = buddies.find(buddy => buddy.id === fragment) ?? buddies[0];
    await run(fragment => { location.hash = fragment; }, fragment);
    await waitFor(`document.body.dataset.companion === ${JSON.stringify(buddy.id)}`, "hashchange: " + fragment);
    await checkCompanion(buddy, fragment ? "#" + fragment : "");
  }
  console.log("Hash changes and unknown fragment fallback: passed.");
  console.log("Art and controls:", await run(buddies => {
    if (Object.keys(companions).length !== buddies.length || Object.keys(walkModels).length !== buddies.length) throw new Error("Companion/model count mismatch");
    for (const buddy of buddies) {
      const radio = document.querySelector('input[name="companion"][value="' + buddy.id + '"]');
      if (radio?.type !== "radio" || radio.disabled || radio.labels.length !== 1 ||
          radio.labels[0].textContent.trim() !== buddy.name ||
          !radio.closest("fieldset")?.querySelector("legend")?.textContent.trim()) throw new Error("Radio is not natively labelled: " + buddy.id);
      for (const id of ["awake-art", "sleep-art", "walk-art"]) {
        if ($(id).querySelectorAll('[data-buddy-art="' + buddy.id + '"]').length !== 1) throw new Error("Missing/duplicate art: " + id + "/" + buddy.id);
      }
      if (walkModels[buddy.id].legs.length !== buddy.legs ||
          document.querySelectorAll('[data-walk-model="' + buddy.id + '"] [data-leg]').length !== buddy.legs) throw new Error("Articulated legs missing: " + buddy.id);
    }
    if (document.querySelectorAll(".scene-tab").length !== 3) throw new Error("Demo scenes missing");
    for (const id of ["accept", "snooze", "replay", "end-time", "water-toggle", "screen-toggle", "motion-toggle"]) {
      if (!$(id)) throw new Error("Missing control: " + id);
    }
    const ids = [...document.querySelectorAll("[id]")].map(element => element.id);
    if (new Set(ids).size !== ids.length) throw new Error("Duplicate SVG/control IDs");
    for (const use of document.querySelectorAll("use")) {
      const href = use.getAttribute("href");
      if (!href?.startsWith("#") || !$(href.slice(1))) throw new Error("Broken inline SVG reference: " + href);
    }
    return "Four labelled native radios, original SVG states and articulated models";
  }, buddies));
  const accessibility = await send("Accessibility.getFullAXTree");
  const radios = accessibility.nodes.filter(node => !node.ignored && node.role?.value === "radio");
  if (radios.length !== 4 || buddies.some(buddy => !radios.some(node => node.name?.value === buddy.name))) {
    throw new Error("Companion radio names missing from accessibility tree");
  }
  await send("Page.bringToFront");
  await run(() => { stopWalk(); document.activeElement?.blur(); });
  let focused = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    await key("Tab", "Tab", 9);
    focused = await evaluate('document.activeElement.matches(\'input[name="companion"]\')');
    if (focused) break;
  }
  if (!focused) throw new Error("Tab cannot reach companion radios");
  await checkCompanion(buddies[0], "");
  for (const [keyName, keyCode, order] of [
    ["ArrowRight", 39, [1, 2, 3, 0]],
    ["ArrowLeft", 37, [3, 2, 1, 0]],
  ]) {
    for (const index of order) {
      await key(keyName, keyName, keyCode);
      await checkCompanion(buddies[index]);
      await run(id => {
        const input = document.activeElement;
        if (input.value !== id || !input.matches(":focus-visible") ||
            parseFloat(getComputedStyle(input.nextElementSibling).outlineWidth) < 2) throw new Error("Keyboard focus indicator missing: " + id);
      }, buddies[index].id);
    }
  }
  await run(() => document.querySelector('input[value="puppy"]').focus());
  await key(" ", "Space", 32);
  await checkCompanion(buddies[2]);
  await key("Tab", "Tab", 9);
  if (await evaluate('document.activeElement.matches(\'input[name="companion"]\')')) throw new Error("Radio group traps Tab");
  await key("Tab", "Tab", 9, 8);
  if (!await evaluate('document.activeElement.matches(\'input[name="companion"][value="puppy"]\')')) throw new Error("Shift+Tab did not restore selected radio focus");
  await evaluate("window.__pawseBeforeReload = true");
  await send("Page.reload");
  await waitFor("!window.__pawseBeforeReload && document.readyState === 'complete' && document.body.dataset.companion === 'puppy'", "keyboard choice reload");
  await checkCompanion(buddies[2]);
  console.log("Native keyboard: Tab, both arrows with wrapping, Space, Shift+Tab and URL reload passed.");
  console.log("Geometry:", await run(() => {
    let samples = 0, planted = 0;
    for (const model of Object.values(walkModels)) {
      if (![model.upper, model.lower].every(value => typeof value === "number" && Number.isFinite(value) && value > 0)) throw new Error("Invalid bone length");
      for (const leg of model.legs) {
        for (let i = 0; i <= 1000; i++) {
          const d = i / 1000 * model.stride;
          const bob = -model.bounce * (.5 - .5 * Math.cos(d / model.stride * 4 * Math.PI));
          const p = legPose(d, leg, model, bob), next = legPose(d + .001, leg, model, bob);
          if (Object.values(p).some(n => typeof n === 'number' && !Number.isFinite(n))) throw new Error('Non-finite leg pose');
          if (Math.abs(Math.hypot(p.kneeX - leg.x, p.kneeY - p.hipY) - model.upper) > .001) throw new Error('Upper bone stretch');
          if (Math.abs(Math.hypot(p.kneeX - p.x, p.kneeY - p.y) - model.lower) > .001) throw new Error('Lower bone stretch');
          if (p.contact && next.contact && next.phase >= p.phase) {
            if (Math.abs(p.x + d - (next.x + d + .001)) > .00001 || p.y !== 126) throw new Error('Planted foot slips');
            planted++;
          }
          samples++;
        }
      }
    }
    if (samples !== 14014) throw new Error("Expected 14014 pose samples, got " + samples);
    return { samples, planted, message: "Three four-legged gaits and one two-legged gait; fixed bones and planted feet" };
  }));
  console.log("Live animation:", await run(async buddies => {
    const measurements = [];
    const events = [];
    window.addEventListener('resize', () => events.push('resize'));
    document.addEventListener('visibilitychange', () => events.push(document.visibilityState));
    for (const { id: name } of buddies) {
      for (const direction of [1, -1]) {
        document.querySelector('input[value="' + name + '"]').click();
        nextWalkDirection = direction; render('finish');
        const initial = { duration: walkState?.duration, scale: walkState?.scale, distance: walkState?.distance, canWalk: canWalk(), visibility: document.visibilityState };
        let previous = new Map(), maxDrift = 0, count = 0;
        for (let frame = 0; frame < 45; frame++) {
          await new Promise(requestAnimationFrame);
          const state = walkState;
          if (!state) throw new Error('Walk ended too soon: ' + JSON.stringify({name, direction, frame, initial, events}));
          const offset = new DOMMatrix(getComputedStyle(pet).transform).e;
          const distance = (state.distance + state.direction * offset) / state.scale;
          for (const leg of state.model.legs) {
            const pose = legPose(distance, leg, state.model, 0);
            const point = new DOMPoint(0, 0).matrixTransform(leg.paw.getScreenCTM());
            const old = previous.get(leg.id);
            if (old && old.contact && pose.contact && pose.phase >= old.phase) {
              maxDrift = Math.max(maxDrift, Math.hypot(point.x - old.x, point.y - old.y)); count++;
            }
            previous.set(leg.id, { x: point.x, y: point.y, phase: pose.phase, contact: pose.contact });
          }
        }
        if (count < 20 || maxDrift >= .05) throw new Error('Foot drift: ' + name + '/' + direction + ' ' + maxDrift);
        measurements.push({ name, direction, stanceFrames: count, maxFootDriftPixels: maxDrift });
      }
    }
    return measurements;
  }, buddies));
  console.log("Reminder actions and settings:", await run(buddies => {
    const results = [];
    const ok = (name, condition) => { if (!condition) throw new Error(name); results.push(name); };
    const select = id => document.querySelector('input[value="' + id + '"]').click();
    const scene = mode => document.querySelector('.scene-tab[data-mode="' + mode + '"]').click();
    const settings = () => JSON.stringify(["end-time", "water-toggle", "screen-toggle", "motion-toggle"].map(id =>
      id === "end-time" ? $(id).value : $(id).getAttribute("aria-checked")));
    const stopped = () => walkState === null && walkFrame === 0 && !pet.style.transform && !pet.classList.contains("walking");
    render('finish', false);
    $('end-time').value = '16:45';
    $('end-time').dispatchEvent(new Event('change'));
    ok('End time updates demo clocks and meter', $('wall-clock').textContent === '16:45' &&
      $('tray-clock').textContent === '16:45' && $('meter-value').textContent === '16:45');
    const unchanged = settings();
    for (const { id } of buddies) {
      for (const mode of ["water", "screen", "finish"]) {
        for (const action of ["accept", "snooze"]) {
          select(id); scene(mode);
          ok(id + "/" + mode + " starts", walkState?.model === walkModels[id] && reminderState === "ready");
          $(action).click();
          const state = action === "accept" ? "accepted" : "snoozed";
          const sleeping = action === "snooze" || mode === "finish";
          ok(id + "/" + mode + "/" + action, stopped() && reminderState === state && $("bubble-actions").hidden &&
            pet.classList.contains("sleeping") === sleeping);
          for (const target of buddies) {
            select(target.id);
            ok(id + "/" + mode + "/" + action + " -> " + target.id,
              stopped() && current === mode && reminderState === state && $("bubble-actions").hidden &&
              !$("bubble").hidden && pet.classList.contains("sleeping") === sleeping &&
              settings() === unchanged && document.title === "Pawse - " + target.name &&
              $("brand-icon").getAttribute("href") === "#" + target.logo && location.hash === "#" + target.id);
            if (mode === "finish") ok("End time retained: " + target.id, $("wall-clock").textContent === "16:45" && $("meter-value").textContent === "16:45");
          }
          $("replay").click();
          ok("Replay resets " + action, reminderState === "ready" && !$("bubble-actions").hidden && !!walkState);
        }
      }
      select(id);
      for (const mode of ["water", "screen"]) {
        scene(mode); $(mode + "-toggle").click();
        ok("Disabling interrupts " + id + "/" + mode, stopped() && $("bubble").hidden && pet.classList.contains("sleeping"));
        $(mode + "-toggle").click();
        ok("Re-enabling resumes " + id + "/" + mode, walkState?.model === walkModels[id] && !$("bubble").hidden);
      }
    }
    $("water-toggle").click(); $("screen-toggle").click();
    const disabledSettings = settings();
    for (const mode of ["water", "screen"]) {
      scene(mode);
      for (const { id } of buddies) {
        select(id);
        ok("Disabled " + mode + " retained: " + id, stopped() && $("bubble").hidden &&
          pet.classList.contains("sleeping") && current === mode && settings() === disabledSettings);
      }
    }
    $("water-toggle").click(); $("screen-toggle").click();
    scene("finish"); $("motion-toggle").click();
    const stillSettings = settings();
    for (const { id } of buddies) {
      select(id); $("replay").click();
      ok("Motion off retained: " + id, stopped() && settings() === stillSettings && reminderState === "ready");
    }
    $("motion-toggle").click();
    ok("Motion on restarts walk", !!walkState);
    for (const { id } of buddies) {
      select(id);
      ok("Switch replaces interrupted gait: " + id, walkState?.model === walkModels[id]);
      scene("water");
      const previous = walkState;
      scene("screen");
      ok("Scene interrupts old route: " + id, walkState !== previous && current === "screen" && walkState?.model === walkModels[id]);
    }
    $("end-time").value = "17:30"; $("end-time").dispatchEvent(new Event("change"));
    return results.length + " assertions passed";
  }, buddies));
  console.log("Arrival and visibility:", await run(async buddies => {
    const results = [];
    for (const { id } of buddies) {
      document.querySelector('input[value="' + id + '"]').click();
      render("finish");
      walkState.elapsed = walkState.duration - .03;
      for (let attempt = 0; attempt < 100 && walkState; attempt++) await new Promise(requestAnimationFrame);
      if (walkState || walkFrame || pet.style.transform || pet.classList.contains("walking") ||
          getComputedStyle($("bubble")).visibility !== "visible") throw new Error("Arrival did not settle: " + id);
      render("finish");
      // Headless tab visibility is platform-dependent; exercise the hidden event with a scoped override.
      const descriptor = Object.getOwnPropertyDescriptor(document, "hidden");
      try {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
        if (walkState || walkFrame || pet.style.transform || pet.classList.contains("walking")) throw new Error("Visibility did not cancel: " + id);
      } finally {
        if (descriptor) Object.defineProperty(document, "hidden", descriptor);
        else delete document.hidden;
      }
      results.push(id + ": arrival and simulated hidden-document cancellation");
    }
    return results;
  }, buddies));
  for (const buddy of buddies) {
    await viewport(1280);
    await run(id => { document.querySelector('input[value="' + id + '"]').click(); render("finish"); }, buddy.id);
    await viewport(960);
    await waitFor("walkState === null && walkFrame === 0 && !pet.style.transform", "resize cancels route: " + buddy.id);
  }
  console.log("Real viewport resize cancels all four routes.");
  await viewport(1280);
  for (const buddy of buddies) {
    await run(id => {
      document.querySelector('input[value="' + id + '"]').click(); render("finish");
      if (!walkState) throw new Error("No active walk before reduced motion: " + id);
    }, buddy.id);
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    // Let emulated media dispatch its change event before reading MediaQueryList.matches.
    await delay(100);
    await waitFor("reducedMotion.matches && walkState === null && walkFrame === 0", "reduced motion cancels " + buddy.id);
    await run(id => {
      for (const mode of ["water", "screen", "finish"]) {
        document.querySelector('.scene-tab[data-mode="' + mode + '"]').click(); $("replay").click();
        if (walkState || pet.style.transform || pet.classList.contains("walking")) throw new Error("Reduced motion ignored: " + id + "/" + mode);
      }
    }, buddy.id);
    await send("Emulation.setEmulatedMedia", { features: [] });
    await delay(100);
    await waitFor("!reducedMotion.matches", "restore motion preference");
  }
  console.log("Reduced motion cancels and prevents walking for all companions/scenes.");
  for (const width of [320, 390, 580, 1280]) {
    await viewport(width);
    console.log("Layout:", await run(buddies => {
      for (const buddy of buddies) {
        document.querySelector('input[value="' + buddy.id + '"]').click();
        for (const mode of ["water", "screen", "finish"]) {
          render(mode, false);
          const bubble = $("bubble").getBoundingClientRect(), desktop = $("desktop").getBoundingClientRect();
          if (document.documentElement.scrollWidth > innerWidth || bubble.left < desktop.left - 1 ||
              bubble.right > desktop.right + 1 || bubble.top < desktop.top - 1 || bubble.bottom > desktop.bottom + 1) throw new Error("Scene overflow: " + buddy.id + "/" + mode + "/" + innerWidth);
        }
        const picker = document.querySelector(".buddy-switch").getBoundingClientRect();
        if (picker.left < 0 || picker.right > innerWidth) throw new Error("Picker overflow");
        const bounds = [];
        for (const choice of buddies) {
          const input = document.querySelector('input[value="' + choice.id + '"]'), label = input.labels[0], span = input.nextElementSibling;
          const box = span.getBoundingClientRect();
          if (box.width < 32 || box.height < 32 || box.left < picker.left || box.right > picker.right ||
              box.top < picker.top || box.bottom > picker.bottom || !label.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))) throw new Error("Unusable picker target: " + choice.id);
          const text = [...span.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim() === choice.name);
          if (!text) throw new Error("Missing picker label: " + choice.id);
          const range = document.createRange(); range.selectNodeContents(text);
          const textBox = range.getBoundingClientRect();
          if (textBox.left < box.left - 1 || textBox.right > box.right + 1 || textBox.top < box.top - 1 || textBox.bottom > box.bottom + 1) throw new Error("Clipped picker label: " + choice.id);
          for (const other of bounds) {
            if (Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1 &&
                Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1) throw new Error("Overlapping picker targets");
          }
          bounds.push(box);
        }
      }
      return innerWidth + "px: all four companions, three scenes and readable picker targets";
    }, buddies));
  }
  await viewport(1280);
  await run(() => { render("finish", false); window.scrollTo(0, 0); });
  if (options["ui-screenshot"]) {
    const { cssContentSize } = await send("Page.getLayoutMetrics");
    await screenshot(options["ui-screenshot"], { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 });
    console.log("Demo screenshot:", options["ui-screenshot"]);
  }
  if (options.screenshot) {
    await viewport(1400);
    await run(buddies => {
      stopWalk(); document.body.classList.add("reduced-motion"); window.scrollTo(0, 0);
      const board = document.createElement("div");
      Object.assign(board.style, { position: "absolute", top: 0, left: 0, width: "1400px", height: "880px", display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gridTemplateRows: "repeat(4, 1fr)", background: "#f6f4ed", zIndex: 99 });
      for (const buddy of buddies) {
        for (const [column, phase] of ["avatar", "sitting", "sleeping", 0, .25, .5, .75].entries()) {
          let art;
          if (phase === "avatar") {
            art = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            art.setAttribute("viewBox", $(buddy.logo).getAttribute("viewBox"));
            const use = document.createElementNS(art.namespaceURI, "use");
            use.setAttribute("href", "#" + buddy.logo); art.append(use);
          } else {
            if (typeof phase === "number") paintWalk(phase * walkModels[buddy.id].stride, walkModels[buddy.id]);
            art = $(phase === "sitting" ? "awake-art" : phase === "sleeping" ? "sleep-art" : "walk-art").cloneNode(true);
          }
          // Snapshot local transforms/IDs; shared, unmodified symbol/gradient references stay original.
          const ids = new Map();
          for (const element of [art, ...art.querySelectorAll("[id]")]) {
            if (element.id) { const old = element.id; element.id = "sheet-" + buddy.id + "-" + column + "-" + old; ids.set(old, element.id); }
          }
          for (const element of [art, ...art.querySelectorAll("*")]) {
            for (const attr of [...element.attributes]) {
              let value = attr.value;
              if (attr.localName === "href" && value.startsWith("#") && ids.has(value.slice(1))) value = "#" + ids.get(value.slice(1));
              value = value.replace(/url\(#([^)]+)\)/g, (match, id) => ids.has(id) ? "url(#" + ids.get(id) + ")" : match);
              if (value !== attr.value) element.setAttribute(attr.name, value);
            }
          }
          Object.assign(art.style, { display: "block", position: "static", width: "170px", height: "155px", transform: "none", overflow: "visible" });
          art.querySelectorAll("[data-buddy-art]").forEach(group => { group.style.display = group.dataset.buddyArt === buddy.id ? "inline" : "none"; });
          const cell = document.createElement("div");
          Object.assign(cell.style, { display: "grid", placeItems: "center", alignContent: "center", gap: "5px", padding: "10px", border: "1px solid #dddcd2" });
          const label = document.createElement("span");
          Object.assign(label.style, { fontSize: "12px", fontWeight: "600" });
          label.textContent = buddy.name + " / " + (typeof phase === "number" ? "walk " + Math.round(phase * 100) + "%" : phase);
          cell.append(art, label); board.append(cell);
        }
      }
      document.body.append(board);
      const ids = [...document.querySelectorAll("[id]")].map(element => element.id);
      if (new Set(ids).size !== ids.length || board.children.length !== 28) throw new Error("Invalid contact sheet snapshots");
    }, buddies);
    await screenshot(options.screenshot, { x: 0, y: 0, width: 1400, height: 880, scale: 1.5 });
    console.log("Original-art contact sheet (avatar, sitting, sleeping, four walk phases):", options.screenshot);
  }
  if (errors.length) throw new Error(errors.join(", "));
  console.log("No runtime exceptions.");
} finally {
  try {
    if (socket?.readyState === WebSocket.OPEN && send) {
      try {
        await send("Browser.close");
      } catch (error) {
        console.error("Could not close the test browser via CDP; stopping its own process:", error.message);
        process.exitCode = 1;
      }
    }
    socket?.close();
    if (browser) {
      await Promise.race([browserClosed, delay(3000, undefined, { ref: false })]);
      if (!closed) {
        browser.kill();
        await Promise.race([browserClosed, delay(3000, undefined, { ref: false })]);
      }
      if (!closed) throw new Error(`Test browser did not exit; retained its profile at ${profile}`);
    }
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
}
