// fractal-calendar.js — a SEMANTIC-ZOOM year: the whole year renders as 12 glass month buckets,
// and a gentle continuous zoom (one GPU transform — no per-frame layout) glides toward wherever
// the cursor points. Cross the zoom BOUNDARY and the calendar infers which bucket you were
// heading into, loads that container as a REAL full-size view (month → its day buckets; a day →
// its own bucket), and morphs it seamlessly from the bucket's on-screen rect to fill the
// viewport (a FLIP transition). Zooming back out reverses the morph, landing you exactly where
// you left the outer level. One year for now.
//
// While zooming, the anchor DRIFTS toward the viewport centre as z rises, so the thing you're
// zooming into self-centres instead of getting cut off at the edge — and by the time the
// boundary trips, the inferred bucket morphs from (near) centre.
//
// Design system: the ticketing client's bucket glass, is-target hover glow, easing and z-order
// recipes — the modules read as one ecosystem. Every month/day is a bucket surface (data-date +
// .fc-day-body) ready to hold cards from the other modules.
(() => {
  const YEAR = 2026;                          // one year for now
  const TOP = 64, MARGIN = 18;                // the same workspace band the pipeline buckets used
  const EASE = "cubic-bezier(.22, 1, .26, 1)";
  const MORPH_MS = 520;                       // the focus/unfocus morph duration
  const HANDOFF = [2.6, 2.4, 1.35];           // per-level zoom ceiling: crossing it focuses the bucket under the cursor
  const BACKOFF = 0.9;                        // zooming below this at a focused level morphs back out
  const MONTHS = ["January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"];
  const DOW = ["S", "M", "T", "W", "T", "F", "S"];
  const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  let viewport = null;
  let level = 0;                              // 0 = year, 1 = a month, 2 = a day
  let layers = [null, null, null];            // the live element per level (year layer persists; stages build on demand)
  let saved = [null, null];                   // the outer level's {z,sx,sy, srcTransform} captured at each focus
  let transitioning = false;
  let gz = 1, gsx = 0, gsy = 0;               // the target zoom + pan; a CSS transition glides the layer to it
  let settleTimer = 0;                        // fires after the last wheel notch → glass + sharp raster return

  const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const daysIn = (m) => new Date(YEAR, m + 1, 0).getDate();
  const firstDow = (m) => new Date(YEAR, m, 1).getDay();
  const iso = (m, d) => `${YEAR}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const todayIso = (() => { const n = new Date(); return n.getFullYear() === YEAR ? iso(n.getMonth(), n.getDate()) : ""; })();

  const ensureStyles = () => {
    if (document.getElementById("fractal-calendar-styles")) return;
    const style = document.createElement("style");
    style.id = "fractal-calendar-styles";
    style.textContent = `
      .fc-cal { position: fixed; left: ${MARGIN}px; right: ${MARGIN}px; top: ${TOP}px; bottom: ${MARGIN}px;
        z-index: 800; overflow: hidden; border-radius: 18px; pointer-events: auto; -webkit-app-region: no-drag; }
      /* Levels are absolute layers; zoom/pan is ONE composited transform on the active layer. */
      .fc-layer { position: absolute; inset: 0; transform-origin: 0 0; }
      .fc-year { display: grid; grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(3, 1fr);
        gap: 14px; padding: 2px; box-sizing: border-box; }
      /* A month is a BUCKET — the exact pipeline-zone glass. (--fc-blur counter-scales the backdrop
         blur against the zoom so the glass keeps a constant effective radius.) */
      .fc-month { position: relative; display: flex; flex-direction: column; min-height: 0; border-radius: 16px;
        padding: 10px 12px 12px; color: #fff; overflow: hidden;
        background: linear-gradient(180deg, rgba(22,26,36,0.5), rgba(12,16,24,0.42));
        -webkit-backdrop-filter: blur(var(--fc-blur, 28px)) saturate(140%); backdrop-filter: blur(var(--fc-blur, 28px)) saturate(140%);
        border: 1px solid rgba(255,255,255,0.14);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 18px 42px rgba(0,0,0,0.28); }
      /* Zoomed OUT: the month is just its NAME in the centre over the day texture (no header — the
         name "writes itself" into the header as you get close, then the month view takes over). */
      .fc-month-big { position: absolute; inset: 0; z-index: 3; display: flex; align-items: center; justify-content: center;
        font-size: 1.9rem; font-weight: 800; letter-spacing: .02em; color: rgba(255,255,255,0.88);
        text-shadow: 0 2px 14px rgba(0,0,0,0.55); pointer-events: none; opacity: 1; transition: opacity .3s ease; }
      .fc-month-hd { display: flex; align-items: baseline; gap: 8px; padding: 0 2px 6px;
        font-size: 0.92rem; font-weight: 700; letter-spacing: .01em; color: rgba(255,255,255,0.85);
        opacity: 0; transition: opacity .3s ease; }
      .fc-cal[data-lod="near"] .fc-month-big { opacity: 0; }
      .fc-cal[data-lod="near"] .fc-month-hd { opacity: 1; }
      .fc-cal[data-lod="year"] .fc-day-num { opacity: 0; }
      .fc-cal[data-lod="year"] .fc-days { opacity: 0.55; }
      .fc-days { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(7, 1fr);
        grid-auto-rows: 1fr; gap: 4px; transition: opacity .3s ease; }
      /* A day is a bucket too — translucent fill (no backdrop blur: 365 must stay cheap), wearing
         the pipeline's is-target blue glow on hover. */
      .fc-day { position: relative; min-height: 0; border-radius: 7px; overflow: hidden; cursor: pointer;
        background: linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.035));
        border: 1px solid rgba(255,255,255,0.10);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
        transition: border-color .18s ease, box-shadow .18s ease, background .18s ease; }
      .fc-day:hover { border-color: rgba(125,180,255,0.92);
        background: linear-gradient(180deg, rgba(70,110,190,0.34), rgba(40,70,130,0.26));
        box-shadow: inset 0 0 0 1px rgba(125,180,255,0.5), 0 0 18px rgba(90,150,255,0.35); }
      .fc-day-num { position: absolute; top: 8%; left: 9%; font-size: 0.58rem; font-weight: 700;
        color: rgba(255,255,255,0.78); line-height: 1; transition: opacity .3s ease; }
      .fc-day-body { position: absolute; inset: 28% 6% 6% 6%; }   /* the bucket surface — cards land here later */
      .fc-today { border-color: rgba(125,180,255,0.85);
        box-shadow: inset 0 0 0 1px rgba(125,180,255,0.45), 0 0 14px rgba(90,150,255,0.3); }
      /* PERF: layers stay GPU-promoted permanently — promoting on gesture start cost a ~300ms
         hitch. While the camera moves, backdrop blur is swapped for a matched near-opaque fill
         (re-blurring 12 panels per frame is what killed the fps); at rest the glass returns and a
         two-frame demote/repromote (in idle time) re-rasterises the layer tack-sharp. */
      .fc-layer { will-change: transform; }
      .fc-moving .fc-month, .fc-moving .fc-stage {
        -webkit-backdrop-filter: none; backdrop-filter: none;
        background: linear-gradient(180deg, rgba(38,44,58,0.92), rgba(22,27,38,0.9)); }

      /* ── The FOCUSED container (a month or day loaded as a real full-size view) ─────────── */
      .fc-stage { box-sizing: border-box; display: flex; flex-direction: column; color: #fff; border-radius: 16px;
        padding: 16px 20px 20px; overflow: hidden;
        background: linear-gradient(180deg, rgba(22,26,36,0.55), rgba(12,16,24,0.46));
        -webkit-backdrop-filter: blur(var(--fc-blur, 28px)) saturate(140%); backdrop-filter: blur(var(--fc-blur, 28px)) saturate(140%);
        border: 1px solid rgba(255,255,255,0.14);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 18px 42px rgba(0,0,0,0.28); }
      .fc-stage-hd { display: flex; align-items: baseline; gap: 10px; padding: 0 2px 10px;
        font-size: 1.25rem; font-weight: 800; letter-spacing: .01em; color: rgba(255,255,255,0.9); }
      .fc-stage-sub { font-size: 0.82rem; font-weight: 600; color: rgba(255,255,255,0.45); }
      .fc-dowrow { display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; padding-bottom: 8px; }
      .fc-dowrow span { text-align: center; font-size: 0.72rem; font-weight: 700; color: rgba(255,255,255,0.4); }
      .fc-stage-days { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(7, 1fr);
        grid-auto-rows: 1fr; gap: 10px; }
      .fc-stage-days .fc-day { border-radius: 12px; }
      .fc-stage-days .fc-day-num { font-size: 0.95rem; top: 9px; left: 12px; }
      .fc-day-dow { position: absolute; top: 11px; right: 12px; font-size: 0.68rem; font-weight: 600;
        color: rgba(255,255,255,0.38); line-height: 1; }
      .fc-dayview-body { flex: 1 1 auto; min-height: 0; border-radius: 12px;
        background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.025));
        border: 1px dashed rgba(210, 227, 255, 0.35); }
    `;
    document.head.appendChild(style);
  };

  // ── Builders ────────────────────────────────────────────────────────────────
  const dayCellHTML = (m, d, withDow) => {
    const date = iso(m, d);
    const dow = withDow ? `<span class="fc-day-dow">${DOW_FULL[new Date(YEAR, m, d).getDay()].slice(0, 3)}</span>` : "";
    return `<div class="fc-day${date === todayIso ? " fc-today" : ""}" data-date="${date}"` +
      (d === 1 ? ` style="grid-column-start:${firstDow(m) + 1}"` : "") +
      `><span class="fc-day-num">${d}</span>${dow}<div class="fc-day-body"></div></div>`;
  };

  const buildYear = () => {
    const el = document.createElement("div");
    el.className = "fc-layer fc-year";
    for (let m = 0; m < 12; m++) {
      const month = document.createElement("div");
      month.className = "fc-month";
      month.dataset.month = String(m + 1);
      month.innerHTML =
        `<div class="fc-month-hd"><span>${MONTHS[m]}</span></div>` +
        `<div class="fc-days">${Array.from({ length: daysIn(m) }, (_, i) => dayCellHTML(m, i + 1, false)).join("")}</div>` +
        `<div class="fc-month-big">${MONTHS[m]}</div>`;
      el.appendChild(month);
    }
    return el;
  };

  // A month LOADED as its own container: real layout at full size (nothing is a scaled-up pixel).
  const buildMonthView = (m) => {
    const el = document.createElement("div");
    el.className = "fc-layer fc-stage fc-monthview";
    el.dataset.month = String(m + 1);
    el.innerHTML =
      `<div class="fc-stage-hd"><span>${MONTHS[m]}</span><span class="fc-stage-sub">${YEAR}</span></div>` +
      `<div class="fc-dowrow">${DOW_FULL.map((d) => `<span>${d.slice(0, 3)}</span>`).join("")}</div>` +
      `<div class="fc-stage-days">${Array.from({ length: daysIn(m) }, (_, i) => dayCellHTML(m, i + 1, true)).join("")}</div>`;
    return el;
  };

  // A single day as its own bucket view — the surface future modules drop cards onto.
  const buildDayView = (date) => {
    const [, mo, da] = date.split("-").map(Number);
    const d = new Date(YEAR, mo - 1, da);
    const el = document.createElement("div");
    el.className = "fc-layer fc-stage fc-dayview";
    el.dataset.date = date;
    el.innerHTML =
      `<div class="fc-stage-hd"><span>${MONTHS[mo - 1]} ${da}</span><span class="fc-stage-sub">${DOW_FULL[d.getDay()]}, ${YEAR}</span></div>` +
      `<div class="fc-dayview-body" data-date="${date}"></div>`;
    return el;
  };

  // ── Zoom / pan on the ACTIVE layer (one composited transform — cheap) ──────
  const resetZoom = () => { gz = 1; gsx = gsy = 0; };
  const setMoving = (on) => viewport.classList.toggle("fc-moving", on);
  // The glide is COMPOSITOR-DRIVEN: each wheel notch retargets a short CSS transition, so the GPU
  // scales the cached raster at full frame rate (a rAF loop re-rasterised 377 painted nodes per
  // frame — that was the fps killer). At rest the raster re-sharpens and the glass returns.
  const apply = (animate) => {
    const el = layers[level]; if (!el) return;
    el.style.transition = animate ? `transform 300ms cubic-bezier(.25, .46, .45, .94)` : "none";
    el.style.transform = `translate(${-gsx}px, ${-gsy}px) scale(${gz})`;
    if (level === 0) {
      const lod = gz < 1.6 ? "year" : "near";
      if (viewport.dataset.lod !== lod) viewport.dataset.lod = lod;
    }
  };
  const scheduleSettle = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (transitioning) return;
      const el = layers[level]; if (el) el.style.transition = "none";
      viewport.style.setProperty("--fc-blur", `${(28 / Math.max(1, gz)).toFixed(2)}px`);
      setMoving(false);   // the glass returns at rest…
      // …and a two-frame demote/re-promote (idle time — the gesture is over) forces a raster at
      // the final scale, so text is tack-sharp without a promotion hitch on the NEXT gesture.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (viewport.classList.contains("fc-moving") || transitioning) return;
        const l = layers[level]; if (!l) return;
        l.style.willChange = "auto";
        requestAnimationFrame(() => { l.style.willChange = ""; });
      }));
    }, 340);
  };
  const clampS = () => {
    const r = viewport.getBoundingClientRect();
    // Soft edges: as z approaches the boundary the clamp loosens, letting an edge/corner bucket
    // drift to the centre (the morph re-frames everything perfectly anyway).
    const pad = clampN((gz - 1) / (HANDOFF[level] - 1), 0, 1) * r.width * 0.22;
    gsx = clampN(gsx, -pad, Math.max(-pad, r.width * gz - r.width + pad));
    gsy = clampN(gsy, -pad, Math.max(-pad, r.height * gz - r.height + pad));
  };

  // The gesture's TARGET is locked when the zoom gesture starts: the world point under the cursor
  // at that moment. Every notch drifts THAT point toward the centre (recomputing per-notch would
  // compound past the target), and the boundary infers the bucket CONTAINING it — i.e. the bucket
  // you were heading into when you started zooming.
  let anchorC = null, lastCur = { x: -1, y: -1 }, lastWheelT = 0;
  const layerOffset = (el, stopAt) => {   // base-layout position of el within its layer (unzoomed px)
    let x = 0, y = 0;
    for (let n = el; n && n !== stopAt; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    return { x, y };
  };
  // Which bucket CONTAINS the gesture's world point (base-layout coords), else the nearest one.
  const targetAt = (cx, cy) => {
    const sel = level === 0 ? ".fc-month" : ".fc-day";
    let best = null, bd = Infinity, hit = null;
    layers[level].querySelectorAll(sel).forEach((el) => {
      const o = layerOffset(el, layers[level]);
      const w = el.offsetWidth, h = el.offsetHeight;
      if (cx >= o.x && cx <= o.x + w && cy >= o.y && cy <= o.y + h) hit = el;
      const d = Math.hypot(cx - (o.x + w / 2), cy - (o.y + h / 2));
      if (d < bd) { bd = d; best = el; }
    });
    return hit || best;
  };

  // ── The seamless boundary: FLIP the focused container in/out ───────────────
  const focusIn = (targetEl) => {
    transitioning = true;
    setMoving(true);
    const vr = viewport.getBoundingClientRect();
    const r = targetEl.getBoundingClientRect();
    const stage = level === 0 ? buildMonthView(+targetEl.dataset.month - 1) : buildDayView(targetEl.dataset.date);
    // The incoming container starts EXACTLY over the bucket it comes from…
    const srcTransform = `translate(${r.left - vr.left}px, ${r.top - vr.top}px) scale(${r.width / vr.width}, ${r.height / vr.height})`;
    stage.style.transformOrigin = "0 0";
    stage.style.transform = srcTransform;
    stage.style.opacity = "0.15";
    viewport.appendChild(stage);
    void stage.offsetWidth;
    // …and morphs to fill the viewport, while the outer layer keeps travelling INTO the bucket
    // (scaled about the bucket's centre) and fades — one continuous camera move.
    const below = layers[level];
    saved[level] = { z: gz, sx: gsx, sy: gsy, srcTransform };
    const k2 = Math.min(vr.width / r.width, vr.height / r.height);
    const cx = r.left - vr.left + r.width / 2, cy = r.top - vr.top + r.height / 2;
    below.style.transition = `transform ${MORPH_MS}ms ${EASE}, opacity ${MORPH_MS * 0.7}ms ease`;
    below.style.transform = `translate(${(vr.width / 2 - cx * k2) - gsx * k2}px, ${(vr.height / 2 - cy * k2) - gsy * k2}px) scale(${gz * k2})`;
    below.style.opacity = "0";
    stage.style.transition = `transform ${MORPH_MS}ms ${EASE}, opacity ${MORPH_MS * 0.6}ms ease`;
    stage.style.transform = "translate(0px, 0px) scale(1, 1)";
    stage.style.opacity = "1";
    setTimeout(() => {
      below.style.display = "none"; below.style.transition = "";
      stage.style.transition = "";
      level += 1; layers[level] = stage;
      resetZoom(); apply(false);
      viewport.style.setProperty("--fc-blur", "28px");
      setMoving(false);
      transitioning = false;
    }, MORPH_MS + 30);
  };

  const focusOut = () => {
    transitioning = true;
    setMoving(true);
    anchorC = null;   // a new level = a new gesture context
    const stage = layers[level];
    const below = layers[level - 1];
    const back = saved[level - 1];
    below.style.display = "";                 // returns still zoomed-into-the-bucket + invisible
    void below.offsetWidth;
    below.style.transition = `transform ${MORPH_MS}ms ${EASE}, opacity ${MORPH_MS * 0.8}ms ease`;
    below.style.transform = `translate(${-back.sx}px, ${-back.sy}px) scale(${back.z})`;
    below.style.opacity = "1";
    stage.style.transition = `transform ${MORPH_MS}ms ${EASE}, opacity ${MORPH_MS * 0.7}ms ease`;
    stage.style.transform = back.srcTransform;   // shrinks back into the bucket it came from
    stage.style.opacity = "0";
    setTimeout(() => {
      stage.remove(); layers[level] = null;
      below.style.transition = "";
      level -= 1;
      gz = back.z; gsx = back.sx; gsy = back.sy;
      apply(false);
      viewport.style.setProperty("--fc-blur", `${(28 / Math.max(1, gz)).toFixed(2)}px`);
      setMoving(false);
      transitioning = false;
    }, MORPH_MS + 30);
  };

  // ── Wheel: continuous zoom with a centre-drifting anchor + the boundary trigger ─
  const onWheel = (e) => {
    e.preventDefault();
    if (transitioning) return;
    const r = viewport.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const zoomingIn = e.deltaY < 0;
    // Boundary out: below the floor at a focused level → morph back to the outer container.
    if (!zoomingIn && level > 0 && gz <= BACKOFF + 0.02) { focusOut(); return; }
    const nz = clampN(gz * Math.exp(-e.deltaY * 0.0022), level > 0 ? BACKOFF : 1, HANDOFF[level]);
    // A NEW gesture (pause, or the cursor moved off) re-locks the anchor: the world point under
    // the cursor right now — the thing you're pointing at.
    const now = performance.now();
    if (!anchorC || now - lastWheelT > 450 || Math.hypot(e.clientX - lastCur.x, e.clientY - lastCur.y) > 30) {
      anchorC = { x: (px + gsx) / gz, y: (py + gsy) / gz };
    }
    lastWheelT = now; lastCur = { x: e.clientX, y: e.clientY };
    // The anchor DRIFTS to the viewport centre as z rises, so the target self-centres instead of
    // getting clipped at an edge — by boundary time it (and the morph) sit near dead centre.
    const bias = clampN((nz - 1) / (HANDOFF[level] - 1), 0, 1) * 0.9;
    const ax = px + (r.width / 2 - px) * bias, ay = py + (r.height / 2 - py) * bias;
    gsx = anchorC.x * nz - ax;
    gsy = anchorC.y * nz - ay;
    gz = nz;
    clampS();
    // Boundary in: crossing the ceiling means "I want THAT bucket" — the one holding the gesture's
    // locked anchor point → load its real container.
    if (zoomingIn && gz >= HANDOFF[level] - 0.01 && level < 2) {
      const t = targetAt(anchorC.x, anchorC.y);
      anchorC = null;
      if (t) { focusIn(t); return; }
    }
    setMoving(true);
    apply(true);
    scheduleSettle();
  };

  // ── Boot ────────────────────────────────────────────────────────────────────
  const init = () => {
    if (viewport) return;
    ensureStyles();
    viewport = document.createElement("div");
    viewport.className = "fc-cal";
    viewport.dataset.lod = "year";
    layers[0] = buildYear();
    viewport.appendChild(layers[0]);
    document.body.appendChild(viewport);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", () => { clampS(); apply(); });
    apply();
  };
  window.fractalCalendar = {
    year: YEAR,
    level: () => level,
    zoom: () => gz,
    dayEl: (date) => viewport?.querySelector(`.fc-day[data-date="${date}"], .fc-dayview-body[data-date="${date}"]`) || null,
    monthEl: (m) => viewport?.querySelector(`.fc-month[data-month="${m}"], .fc-monthview[data-month="${m}"]`) || null,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
