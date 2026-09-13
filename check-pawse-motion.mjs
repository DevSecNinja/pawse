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
  options: { url: { type: "string" }, screenshot: { type: "string" } },
});

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
  async function screenshot(file, clip) {
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, ...(clip ? { clip } : {}) });
    await writeFile(file, Buffer.from(shot.data, "base64"));
  }
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
  for (const name of ["totoro", "miso"]) {
    const destination = new URL(url);
    destination.hash = name;
    const navigation = await send("Page.navigate", { url: destination.href });
    if (navigation.errorText) throw new Error(navigation.errorText);
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      ready = await evaluate(`document.readyState === 'complete' && document.title === 'Pawse - ${name === "miso" ? "Miso" : "Totoro"}' && document.body.dataset.companion === '${name}'`);
      if (ready) break;
      await delay(100);
    }
    if (!ready) throw new Error(`Page did not initialize: ${destination.href}`);
    console.log("Branding and fragment:", await evaluate(`(() => {
      if (location.pathname !== ${JSON.stringify(destination.pathname)}) throw new Error('Subpath changed');
      if (document.getElementById('brand-name').textContent !== 'Pawse') throw new Error('Product name changed');
      if (!document.querySelector('input[value="${name}"]').checked) throw new Error('Radio selection mismatch');
      if (document.getElementById('brand-icon').getAttribute('href') !== '#${name === "miso" ? "cat-logo" : "totoro-logo"}') throw new Error('Avatar mismatch');
      if (document.querySelectorAll('[data-walk-model="miso"] [data-leg]').length !== 4 ||
          document.querySelectorAll('[data-walk-model="totoro"] [data-leg]').length !== 2) throw new Error('Articulated legs missing');
      if (document.querySelectorAll('.scene-tab').length !== 3) throw new Error('Demo scenes missing');
      for (const id of ['accept', 'snooze', 'replay', 'end-time', 'water-toggle', 'screen-toggle', 'motion-toggle']) {
        if (!document.getElementById(id)) throw new Error('Missing control: ' + id);
      }
      for (const use of document.querySelectorAll('use')) {
        const href = use.getAttribute('href');
        if (!href?.startsWith('#') || !document.getElementById(href.slice(1))) throw new Error('Broken inline SVG reference: ' + href);
      }
      return location.pathname + location.hash + ' / ' + document.title;
    })()`));
  }
  console.log("Geometry:", await evaluate(`(() => {
    let samples = 0, planted = 0;
    for (const model of Object.values(walkModels)) {
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
    return { samples, planted, message: 'Four-beat cat gait and two-beat forest companion, fixed bone lengths and planted feet' };
  })()`));
  console.log("Live animation:", await evaluate(`(async () => {
    const measurements = [];
    const events = [];
    window.addEventListener('resize', () => events.push('resize'));
    document.addEventListener('visibilitychange', () => events.push(document.visibilityState));
    for (const name of ['miso', 'totoro']) {
      for (const direction of [1, -1]) {
        companion = name; applyCompanion(); nextWalkDirection = direction; render('finish');
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
        if (count < 20 || maxDrift > .05) throw new Error('Foot drift: ' + name + '/' + direction + ' ' + maxDrift);
        measurements.push({ name, direction, stanceFrames: count, maxFootDriftPixels: maxDrift });
      }
    }
    return measurements;
  })()`));
  console.log("Lifecycle:", await evaluate(`(async () => {
    const results = [];
    const ok = (name, condition) => { if (!condition) throw new Error(name); results.push(name); };
    companion = 'miso'; applyCompanion(); render('water');
    document.getElementById('motion-toggle').click();
    ok('Motion off cancels frame and resets position', walkState === null && walkFrame === 0 && !pet.style.transform && !pet.classList.contains('walking'));
    document.getElementById('motion-toggle').click();
    ok('Motion on restarts walk', walkState !== null);
    document.querySelector('input[value="totoro"]').click();
    ok('Switch replaces active gait', walkState.model === walkModels.totoro);
    ok('Switch keeps Pawse and updates title, avatar and fragment',
      $('brand-name').textContent === 'Pawse' && document.title === 'Pawse - Totoro' &&
      $('brand-icon').getAttribute('href') === '#totoro-logo' && location.hash === '#totoro');
    document.getElementById('water-toggle').click();
    ok('Disabled reminder stops walk', !walkState && pet.classList.contains('sleeping') && document.getElementById('bubble').hidden);
    document.getElementById('water-toggle').click();
    showSnoozed();
    ok('Snooze stops walk', !walkState && pet.classList.contains('sleeping'));
    document.querySelector('input[value="miso"]').click();
    ok('Switch retains snooze', !walkState && pet.classList.contains('sleeping'));
    render('screen');
    $('screen-toggle').click();
    ok('Disabled screen reminder stops walk', !walkState && pet.classList.contains('sleeping') && $('bubble').hidden);
    $('screen-toggle').click();
    render('finish', false);
    $('end-time').value = '16:45';
    $('end-time').dispatchEvent(new Event('change'));
    ok('End time updates demo clocks and meter', $('wall-clock').textContent === '16:45' &&
      $('tray-clock').textContent === '16:45' && $('meter-value').textContent === '16:45');
    $('end-time').value = '17:30';
    $('end-time').dispatchEvent(new Event('change'));
    for (const name of ['miso', 'totoro']) {
      companion = name; applyCompanion();
      for (const mode of ['water', 'screen', 'finish']) {
        render(mode, false);
        showAccepted();
        ok(name + '/' + mode + ' accepts', !walkState && document.getElementById('bubble-actions').hidden);
      }
    }
    companion = 'miso'; applyCompanion(); render('finish');
    walkState.elapsed = walkState.duration - .03;
    await new Promise(resolve => setTimeout(resolve, 400));
    ok('Arrival settles paws and shows greeting', !walkState && !pet.classList.contains('walking') && getComputedStyle(document.getElementById('bubble')).visibility === 'visible');
    render('finish');
    document.getElementById('desktop').style.width = 'calc(100% - 20px)';
    window.dispatchEvent(new Event('resize'));
    ok('Resize cancels obsolete route', !walkState && !pet.style.transform);
    document.getElementById('desktop').style.removeProperty('width');
    return results;
  })()`));
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await new Promise(resolve => setTimeout(resolve, 50));
  console.log("Reduced motion:", await evaluate(`(() => { render('finish'); if (walkState || pet.classList.contains('walking')) throw new Error('Reduced motion ignored'); return 'respected'; })()`));
  await send("Emulation.setEmulatedMedia", { features: [] });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 1100, deviceScaleFactor: 1, mobile: false });
  console.log("Mobile:", await evaluate(`(() => { render('finish', false); const b=document.getElementById('bubble').getBoundingClientRect(),d=document.getElementById('desktop').getBoundingClientRect(); if(document.documentElement.scrollWidth>innerWidth||b.left<d.left||b.right>d.right)throw new Error('Mobile overflow'); return 'fits'; })()`));
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(() => {
    stopWalk(); document.body.classList.add('reduced-motion');
    const board=document.createElement('div');
    Object.assign(board.style,{position:'absolute',top:0,left:0,width:'1000px',height:'460px',display:'grid',
      gridTemplateColumns:'repeat(4,1fr)',background:'#f6f4ed',zIndex:99});
    for(const name of ['miso','totoro']){
      for(const phase of [0,.25,.5,.75]){
        paintWalk(phase*walkModels[name].stride,walkModels[name]);
        const art=document.getElementById('walk-art').cloneNode(true);
        Object.assign(art.style,{display:'block',position:'static',width:'225px',height:'175px',transform:'none'});
        art.querySelectorAll('[data-buddy-art]').forEach(g=>g.style.display=g.dataset.buddyArt===name?'inline':'none');
        const cell=document.createElement('div');Object.assign(cell.style,{display:'grid',placeItems:'center',padding:'10px'});
        const label=document.createElement('span');label.textContent=name+' / '+Math.round(phase*100)+'%';
        cell.append(art,label);board.append(cell);
      }
    }
    document.body.append(board);
  })()`);
  if (options.screenshot) {
    await screenshot(options.screenshot, { x: 0, y: 0, width: 1000, height: 460, scale: 1.5 });
    console.log("Gait screenshot:", options.screenshot);
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
