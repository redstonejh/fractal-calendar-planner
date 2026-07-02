// fractal-calendar.js — FRACTAL BUCKETS with per-level LOD.
//
// ONE bucket style — the ticketing pipeline zone, verbatim — at every level of the fractal:
// the year is 12 month buckets; a month is a bucket of day buckets; a day is a bucket of
// (future) cards. Same 16px corners, same 1px border, same glass, same header recipe, fixed,
// all the way down. No intermediate "near" states — LOD is simply which level you're looking at.
//
// Zooming leans the camera gently toward the cursor (one composited transform). Crossing the
// lean ceiling EXPANDS the bucket under the gesture into the full window: a REAL bucket whose
// rect animates while its trim stays fixed — it is a proper bucket at every frame, nothing is
// scaled, nothing goes blurry, the acrylic never switches off. Scrolling back out contracts it
// into its slot and crossfades onto its pixel-identical twin.
(() => {
  const YEAR = 2026;                          // one year for now
  const EASE = "cubic-bezier(.22, 1, .26, 1)";
  const MORPH_MS = 460;                       // expand/contract duration
  const LEAN_MAX = 2.8;                       // a REAL runway (~4 wheel ticks) before the handoff
  const CENTER_Z = 2.0;                       // by this zoom the target is fully centred — lined up for the swap
  const RADIUS_F = 16 / 245;                  // the ticketing zone's corner PROPORTION (16px on its ~245px side):
                                              // perceived roundness is relative to size, so the radius scales
                                              // with each bucket — same shape at every level, no capsule minis
  const MONTHS = ["January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"];
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  let surface = null;
  let level = 0;                              // 0 = year, 1 = a month, 2 = a day
  let layers = [null, null, null];            // the live element per level (year layer persists)
  let srcSel = [null, null];                  // how to find the slot each expander contracts back into
  let transitioning = false;
  let gz = 1, gsx = 0, gsy = 0;               // the current level's lean (target values; CSS transition glides)
  let settleTimer = 0;
  let anchorC = null, lastCur = { x: -1, y: -1 }, lastWheelT = 0;

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
      /* Full-window surface: nothing is clipped by an invisible frame — content reaches the true
         window edges. The container passes pointer events through (the top strip keeps working);
         the grid and expanded buckets re-enable them. */
      .fc-surface { position: fixed; inset: 0; z-index: 800; pointer-events: none; -webkit-app-region: no-drag; overflow: hidden; }
      .fc-level { position: absolute; inset: 0; transform-origin: 0 0; will-change: transform; }
      .fc-grid { position: absolute; inset: 56px 14px 14px; display: grid; pointer-events: auto;
        grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(3, 1fr); gap: 14px; }
      /* ONE frost pass for the whole year layer, clipped to the 12 bucket shapes — the acrylic
         rides the zoom continuously and costs one backdrop pass instead of twelve. */
      .fc-frost { position: absolute; inset: 0; pointer-events: none;
        -webkit-backdrop-filter: blur(var(--fc-blur, 28px)) saturate(140%); backdrop-filter: blur(var(--fc-blur, 28px)) saturate(140%); }

      /* ── THE bucket — the ticketing pipeline zone, verbatim. Fixed trim at every level. ── */
      .fc-bucket { position: relative; box-sizing: border-box; display: flex; flex-direction: column; min-height: 0;
        overflow: hidden; border-radius: 16px; padding: 12px 14px 14px; color: #fff;
        background: linear-gradient(180deg, rgba(22,26,36,0.5), rgba(12,16,24,0.42));
        border: 1px solid rgba(255,255,255,0.14);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 18px 42px rgba(0,0,0,0.28);
        transition: border-color .18s ease, box-shadow .18s ease, background .18s ease; }
      /* The zone header, verbatim. */
      .fc-hd { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 2px 4px 11px; font-size: 0.98rem; font-weight: 700; line-height: 1.25; letter-spacing: .01em;
        color: rgba(255,255,255,0.85); white-space: nowrap; }
      /* The zone count-pill recipe carries the year / weekday sub-labels. */
      .fc-pill { flex: 0 0 auto; font-size: 0.72rem; font-weight: 600; color: rgba(255,255,255,0.62);
        background: rgba(255,255,255,0.10); border-radius: 999px; padding: 1px 8px; }
      .fc-dowrow { flex: 0 0 auto; display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; padding: 0 0 6px; }
      .fc-dowrow span { text-align: center; font-size: 0.6rem; font-weight: 700; color: rgba(255,255,255,0.4);
        white-space: nowrap; overflow: hidden; }
      .fc-days { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(7, 1fr);
        grid-template-rows: repeat(6, 1fr); gap: 6px; }
      /* A day bucket: the same family, sized down — translucent fill (it sits on the month's
         glass), 1px border, fixed radius. Identical at every level it appears. */
      .fc-day { position: relative; min-height: 0; border-radius: 10px; overflow: hidden;
        background: linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.035));
        border: 1px solid rgba(255,255,255,0.10);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
        transition: border-color .18s ease, box-shadow .18s ease, background .18s ease; }
      .fc-day-num { position: absolute; top: 4px; left: 7px; font-size: 0.68rem; font-weight: 700;
        color: rgba(255,255,255,0.78); line-height: 1; }
      .fc-day-body { position: absolute; inset: 22px 6px 6px; }
      .fc-today { border-color: rgba(125,180,255,0.85);
        box-shadow: inset 0 0 0 1px rgba(125,180,255,0.45), 0 0 14px rgba(90,150,255,0.3); }
      /* The zone empty-state, verbatim ("Drag tickets here" → cards). */
      .fc-empty { width: 100%; margin: auto 0; padding: 14px 8px; text-align: center;
        color: rgba(255,255,255,0.38); font-size: 0.8rem; line-height: 1.4; }

      /* LOD is per LEVEL: the year grid renders its months as QUIET structural buckets — the day
         grid is texture, so its numbers and weekday labels (unreadable at this size = pure noise)
         belong to the month level, where they're legible. Bands keep their space: the expander is
         still the mini's geometric twin. */
      .fc-level .fc-day-num { display: none; }
      .fc-level .fc-dowrow span { visibility: hidden; }
      /* Level semantics: at the YEAR the month is the object (days are texture); inside a month
         the day buckets are the objects — wearing the pipeline's is-target glow on hover. */
      .fc-surface[data-level="0"] .fc-day { pointer-events: none; }
      .fc-surface[data-level="0"] .fc-month { cursor: pointer; }
      .fc-surface[data-level="0"] .fc-month:hover { border-color: rgba(125,180,255,0.92);
        background: linear-gradient(180deg, rgba(70,110,190,0.34), rgba(40,70,130,0.26));
        box-shadow: inset 0 0 0 1px rgba(125,180,255,0.5), 0 0 30px rgba(90,150,255,0.42); }
      .fc-expander[data-kind="month"] .fc-day { cursor: pointer; pointer-events: auto; }
      .fc-expander[data-kind="month"] .fc-day:hover { border-color: rgba(125,180,255,0.92);
        background: linear-gradient(180deg, rgba(70,110,190,0.34), rgba(40,70,130,0.26));
        box-shadow: inset 0 0 0 1px rgba(125,180,255,0.5), 0 0 18px rgba(90,150,255,0.35); }

      /* The expander: the SAME bucket, laid out at its FINAL size from frame one (standard trim,
         one layout, one backdrop pass), travelling between its slot and the window on a composited
         transform — so the motion runs on the GPU and it lands at scale 1 as a byte-standard
         bucket, pixel-identical to its twin in the grid. */
      .fc-expander { position: absolute; z-index: 5; left: 0; pointer-events: auto;
        transform-origin: 0 0; will-change: transform;
        -webkit-backdrop-filter: blur(var(--fc-blur, 28px)) saturate(140%); backdrop-filter: blur(var(--fc-blur, 28px)) saturate(140%); }
    `;
    document.head.appendChild(style);
  };

  // ── Builders — the same structure at every size (the interior reflows; nothing scales) ──
  const dayCellHTML = (m, d) => {
    const date = iso(m, d);
    return `<div class="fc-day${date === todayIso ? " fc-today" : ""}" data-date="${date}"` +
      (d === 1 ? ` style="grid-column-start:${firstDow(m) + 1}"` : "") +
      `><span class="fc-day-num">${d}</span><div class="fc-day-body"></div></div>`;
  };
  const monthInnerHTML = (m, expanded) =>
    `<div class="fc-hd"><span>${MONTHS[m]}</span>${expanded ? `<span class="fc-pill">${YEAR}</span>` : ""}</div>` +
    `<div class="fc-dowrow">${DOW.map((d) => `<span>${d}</span>`).join("")}</div>` +
    `<div class="fc-days">${Array.from({ length: daysIn(m) }, (_, i) => dayCellHTML(m, i + 1)).join("")}</div>`;
  const dayInnerHTML = (date) => {
    const [, mo, da] = date.split("-").map(Number);
    const d = new Date(YEAR, mo - 1, da);
    return `<div class="fc-hd"><span>${MONTHS[mo - 1]} ${da}</span><span class="fc-pill">${DOW_FULL[d.getDay()]}, ${YEAR}</span></div>` +
      `<div class="fc-empty" data-date="${date}">Drag cards here</div>`;
  };

  const buildYear = () => {
    const el = document.createElement("div");
    el.className = "fc-level";
    const frost = document.createElement("div");
    frost.className = "fc-frost";
    el.appendChild(frost);
    const grid = document.createElement("div");
    grid.className = "fc-grid";
    for (let m = 0; m < 12; m++) {
      const month = document.createElement("div");
      month.className = "fc-bucket fc-month";
      month.dataset.month = String(m + 1);
      month.innerHTML = monthInnerHTML(m, false);
      grid.appendChild(month);
    }
    el.appendChild(grid);
    return el;
  };

  // Clip the year layer's single frost pass to the 12 bucket shapes (layer-layout coords — the
  // clip rides the lean transform with the layer).
  // Proportional corners: the ticketing zone's radius FRACTION applied to each element's own
  // size — a mini month and the expanded month are the same shape, not "oval vs sharp".
  const radiusFor = (w, h) => clampN(RADIUS_F * Math.min(w, h), 2, 64);
  const setDayRadii = (root) => {
    const c0 = root.querySelector(".fc-day");
    if (!c0) return;
    const r = `${radiusFor(c0.offsetWidth, c0.offsetHeight).toFixed(1)}px`;
    root.querySelectorAll(".fc-day").forEach((c) => { c.style.borderRadius = r; });
  };
  const layoutFrost = () => {
    const yearEl = layers[0]; if (!yearEl) return;
    const frost = yearEl.querySelector(":scope > .fc-frost");
    const grid = yearEl.querySelector(":scope > .fc-grid");
    if (!frost || !grid) return;
    const gx = grid.offsetLeft, gy = grid.offsetTop;
    const parts = [...grid.children].map((m) => {
      const w = m.offsetWidth, h = m.offsetHeight;
      const x = gx + m.offsetLeft, y = gy + m.offsetTop;
      const r = radiusFor(w, h);
      m.style.borderRadius = `${r.toFixed(1)}px`;
      return `M ${x + r} ${y} L ${x + w - r} ${y} A ${r} ${r} 0 0 1 ${x + w} ${y + r} ` +
        `L ${x + w} ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} L ${x + r} ${y + h} ` +
        `A ${r} ${r} 0 0 1 ${x} ${y + h - r} L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
    });
    frost.style.clipPath = `path('${parts.join(" ")}')`;
    setDayRadii(grid);
  };

  // ── The lean: one composited transform, cursor-anchored, gently centre-drifting ─────────
  const apply = (animate) => {
    const el = layers[level]; if (!el) return;
    el.style.transition = animate ? `transform 300ms cubic-bezier(.25, .46, .45, .94)` : "none";
    el.style.transform = `translate(${-gsx}px, ${-gsy}px) scale(${gz})`;
    surface.style.setProperty("--fc-blur", `${(28 / gz).toFixed(1)}px`);   // constant effective frost
  };
  const clampS = () => {
    // The clamp loosens as the lean deepens: centring an edge/corner bucket needs the world's
    // edge to travel inside the frame (the expansion re-frames everything moments later).
    const pad = clampN((gz - 1) / (CENTER_Z - 1), 0, 1) * window.innerWidth * 0.45;
    gsx = clampN(gsx, -pad, window.innerWidth * (gz - 1) + pad);
    gsy = clampN(gsy, -pad, window.innerHeight * (gz - 1) + pad);
  };
  const scheduleSettle = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (transitioning) return;
      const el = layers[level]; if (el) el.style.transition = "none";
      // idle-time demote/re-promote → raster at the final scale, tack-sharp, no next-gesture hitch
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (transitioning) return;
        const l = layers[level]; if (!l) return;
        l.style.willChange = "auto";
        requestAnimationFrame(() => { l.style.willChange = ""; });
      }));
    }, 340);
  };

  // Which bucket holds the gesture's locked anchor point (layer-layout coords).
  const layerOffset = (el, stopAt) => {
    let x = 0, y = 0;
    for (let n = el; n && n !== stopAt; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    return { x, y };
  };
  // Sub-pixel layout rect of an element within its layer (offsetLeft is integer-rounded; grid fr
  // positions are fractional and the dive multiplies any error by ~4× — measure via live rects
  // divided by the layer's current scale instead).
  const layoutRect = (el, layer) => {
    const lr = layer.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const sx = lr.width / layer.offsetWidth, sy = lr.height / layer.offsetHeight;
    return { x: (er.left - lr.left) / sx, y: (er.top - lr.top) / sy, w: er.width / sx, h: er.height / sy };
  };
  const targetAt = (cx, cy) => {
    const sel = level === 0 ? ".fc-month" : ".fc-day";
    let hit = null, best = null, bd = Infinity;
    layers[level].querySelectorAll(sel).forEach((el) => {
      const o = layerOffset(el, layers[level]);
      const w = el.offsetWidth, h = el.offsetHeight;
      if (cx >= o.x && cx <= o.x + w && cy >= o.y && cy <= o.y + h) hit = el;
      const d = Math.hypot(cx - (o.x + w / 2), cy - (o.y + h / 2));
      if (d < bd) { bd = d; best = el; }
    });
    return hit || best;
  };

  // ── Expander lifecycle ───────────────────────────────────────────────────────────────────
  const buildExpander = (targetEl) => {
    const isMonth = level === 0;
    const exp = document.createElement("div");
    exp.className = "fc-bucket fc-expander";
    exp.dataset.kind = isMonth ? "month" : "day";
    if (isMonth) { exp.dataset.month = targetEl.dataset.month; exp.innerHTML = monthInnerHTML(+targetEl.dataset.month - 1, true); }
    else { exp.dataset.date = targetEl.dataset.date; exp.innerHTML = dayInnerHTML(targetEl.dataset.date); }
    const W = window.innerWidth, TOP = 48, EH = window.innerHeight - TOP;
    Object.assign(exp.style, { top: `${TOP}px`, width: `${W}px`, height: `${EH}px`,
      borderRadius: `${radiusFor(W, EH).toFixed(1)}px` });   // same corner PROPORTION as its mini twin
    return exp;
  };
  const finishExpander = (exp) => setDayRadii(exp);   // proportional day-cell corners (needs layout → after append)
  const keyOf = (el) => (el.dataset.month ? "m" + el.dataset.month : "d" + el.dataset.date);
  // Hover = intent: pre-build (and pre-raster, at 0.001 opacity) the expander for the bucket
  // under the cursor, so the morph starts WARM — no DOM-insert/first-raster hitch at the exact
  // moment the eye is watching.
  let warm = null;
  const prefetch = (targetEl) => {
    const key = keyOf(targetEl);
    if (warm && warm.key === key) return;
    if (warm) { warm.el.remove(); warm = null; }
    const exp = buildExpander(targetEl);
    Object.assign(exp.style, { opacity: "0.001", pointerEvents: "none", zIndex: "1" });
    surface.appendChild(exp);
    finishExpander(exp);
    warm = { key, el: exp };
  };
  const dropWarm = () => { if (warm) { warm.el.remove(); warm = null; } };

  // ── Expand: ONE camera move — the outer world dives INTO the bucket on the very same
  //    trajectory the expander rides out of it (the iOS app-open grammar). ──────────────────
  const expand = (targetEl) => {
    transitioning = true;
    const W = window.innerWidth, TOP = 48, EH = window.innerHeight - TOP;
    const r = targetEl.getBoundingClientRect();   // live (leaned) rect — the expander's start
    const key = keyOf(targetEl);
    let exp;
    if (warm && warm.key === key) { exp = warm.el; warm = null; }
    else { dropWarm(); exp = buildExpander(targetEl); surface.appendChild(exp); finishExpander(exp); }
    srcSel[level] = level === 0 ? `.fc-month[data-month="${targetEl.dataset.month}"]` : `.fc-day[data-date="${targetEl.dataset.date}"]`;
    Object.assign(exp.style, { zIndex: "5", pointerEvents: "auto", transition: "none", opacity: "0",
      transform: `translate(${r.left}px, ${r.top - TOP}px) scale(${r.width / W}, ${r.height / EH})` });
    // The dive: map the bucket's LAYOUT rect onto the expander's final rect — the outer layer
    // travels there (non-uniform, per axis) so the slot stays pinned under the expander.
    const below = layers[level];
    const b = layoutRect(targetEl, below);        // sub-pixel slot rect within the layer
    const KX = W / b.w, KY = EH / b.h;
    const dive = `translate(${(-b.x * KX).toFixed(2)}px, ${(TOP - below.offsetTop - b.y * KY).toFixed(2)}px) scale(${KX.toFixed(4)}, ${KY.toFixed(4)})`;
    void exp.offsetWidth;
    requestAnimationFrame(() => {                 // one frame for the (warm) raster to commit
      exp.style.transition = `transform ${MORPH_MS}ms ${EASE}, opacity ${Math.round(MORPH_MS * 0.35)}ms ease`;
      exp.style.transform = "none";
      exp.style.opacity = "1";
      below.style.transition = `transform ${MORPH_MS}ms ${EASE}, opacity ${MORPH_MS}ms ease`;
      below.style.transform = dive;
      below.style.opacity = "0";
    });
    gz = 1; gsx = 0; gsy = 0;
    setTimeout(() => {
      exp.style.transition = "none";
      below.style.transition = "none";
      below.style.visibility = "hidden";
      below.style.transform = "none"; below.style.opacity = "1";   // parked at identity for the return
      level += 1;
      layers[level] = exp;
      surface.dataset.level = String(level);
      surface.style.setProperty("--fc-blur", "28px");
      transitioning = false;
    }, MORPH_MS + 60);
  };

  // ── Contract: back into the slot, crossfading onto its pixel-identical twin ─────────────
  // ── Contract: the reverse camera move — the outer world rides back OUT of the bucket while
  //    the expander shrinks home, crossfading onto its pixel-identical twin at the landing. ──
  const contract = () => {
    transitioning = true;
    const exp = layers[level];
    const below = layers[level - 1];
    const W = exp.offsetWidth, EH = exp.offsetHeight, TOP = exp.offsetTop;
    const src = below.querySelector(srcSel[level - 1]);
    // slot geometry from LAYOUT, sub-pixel (below is parked at identity — rects are layout-true)
    const b = layoutRect(src, below);
    const rx = below.offsetLeft + b.x, ry = below.offsetTop + b.y;
    const KX = W / b.w, KY = EH / b.h;
    const dive = `translate(${(-b.x * KX).toFixed(2)}px, ${(TOP - below.offsetTop - b.y * KY).toFixed(2)}px) scale(${KX.toFixed(4)}, ${KY.toFixed(4)})`;
    below.style.transition = "none";
    below.style.transform = dive;                 // start deep inside the bucket…
    below.style.opacity = "0";
    below.style.visibility = "";
    exp.style.transition = "none";
    exp.style.transform = "none";                 // shed any lean before travelling home
    void below.offsetWidth;
    requestAnimationFrame(() => {
      below.style.transition = `transform ${MORPH_MS}ms ${EASE}, opacity ${MORPH_MS}ms ease`;
      below.style.transform = "none";             // …and ride back out to rest
      below.style.opacity = "1";
      exp.style.transition = `transform ${MORPH_MS}ms ${EASE}, opacity ${Math.round(MORPH_MS * 0.45)}ms ease ${Math.round(MORPH_MS * 0.55)}ms`;
      exp.style.transform = `translate(${rx.toFixed(2)}px, ${(ry - TOP).toFixed(2)}px) scale(${(b.w / W).toFixed(4)}, ${(b.h / EH).toFixed(4)})`;
      exp.style.opacity = "0";
    });
    setTimeout(() => {
      exp.remove();
      layers[level] = null;
      level -= 1;
      surface.dataset.level = String(level);
      gz = 1; gsx = 0; gsy = 0;
      surface.style.setProperty("--fc-blur", "28px");
      anchorC = null;
      dropWarm();
      transitioning = false;
    }, MORPH_MS + 60);
  };

  // ── Wheel: lean toward the cursor; the ceiling expands, the floor contracts ─────────────
  const onWheel = (e) => {
    e.preventDefault();
    if (transitioning) return;
    const px = e.clientX, py = e.clientY;
    const zoomingIn = e.deltaY < 0;
    if (!zoomingIn && gz <= 1.001 && level > 0) { contract(); return; }
    const nz = clampN(gz * Math.exp(-e.deltaY * 0.0022), 1, LEAN_MAX);
    const now = performance.now();
    if (!anchorC || now - lastWheelT > 450 || Math.hypot(px - lastCur.x, py - lastCur.y) > 30) {
      anchorC = { x: (px + gsx) / gz, y: (py + gsy) / gz };   // lock the gesture's target point
    }
    lastWheelT = now; lastCur = { x: px, y: py };
    // The camera steers the target to the EXPANDER'S final centre while zooming — fully lined up
    // well before the ceiling, so the handoff swap is invisible: same spot, same shape, more detail.
    const bias = clampN((nz - 1) / (CENTER_Z - 1), 0, 1);
    const CX = window.innerWidth / 2, CY = 48 + (window.innerHeight - 48) / 2;
    const ax = px + (CX - px) * bias, ay = py + (CY - py) * bias;
    gsx = anchorC.x * nz - ax;
    gsy = anchorC.y * nz - ay;
    gz = nz;
    clampS();
    if (zoomingIn && gz >= LEAN_MAX - 0.01 && level < 2) {
      const t = targetAt(anchorC.x, anchorC.y);
      anchorC = null;
      if (t) { expand(t); return; }
    }
    apply(true);
    scheduleSettle();
  };

  // ── Boot ────────────────────────────────────────────────────────────────────────────────
  const init = () => {
    if (surface) return;
    ensureStyles();
    surface = document.createElement("div");
    surface.className = "fc-surface";
    surface.dataset.level = "0";
    layers[0] = buildYear();
    surface.appendChild(layers[0]);
    document.body.appendChild(surface);
    surface.addEventListener("wheel", onWheel, { passive: false });
    // Buckets that glow are buttons: click opens; Escape backs out. Hover pre-warms the expander.
    const clickTarget = (e) => {
      if (transitioning || level >= 2) return null;
      const t = level === 0 ? e.target.closest?.(".fc-month") : e.target.closest?.(".fc-day");
      return t && layers[level].contains(t) ? t : null;
    };
    surface.addEventListener("click", (e) => { const t = clickTarget(e); if (t) expand(t); });
    surface.addEventListener("mouseover", (e) => { const t = clickTarget(e); if (t) prefetch(t); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && level > 0 && !transitioning) contract(); });
    window.addEventListener("resize", () => {
      gz = 1; gsx = 0; gsy = 0; apply(false);
      dropWarm();
      for (let i = 1; i <= level; i++) if (layers[i]) Object.assign(layers[i].style, { left: "0px", top: "48px", width: `${window.innerWidth}px`, height: `${window.innerHeight - 48}px` });
      layoutFrost();
    });
    apply(false);
    layoutFrost();
  };

  window.fractalCalendar = {
    year: YEAR,
    level: () => level,
    zoom: () => gz,
    dayEl: (date) => surface?.querySelector(`.fc-day[data-date="${date}"], .fc-empty[data-date="${date}"]`) || null,
    monthEl: (m) => surface?.querySelector(`.fc-expander[data-month="${m}"], .fc-month[data-month="${m}"]`) || null,
    // Landing-parity harness: place the expander at a month's slot at rest and diff every day
    // cell's rect against the mini's — identical fixed styling should agree to ~0px.
    _parity: (mIdx) => {
      const mini = layers[0].querySelector(`.fc-month[data-month="${mIdx}"]`);
      const r = mini.getBoundingClientRect();
      const exp = document.createElement("div");
      exp.className = "fc-bucket fc-expander fc-parity";
      exp.dataset.kind = "month";
      exp.innerHTML = monthInnerHTML(mIdx - 1, true);
      Object.assign(exp.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      surface.appendChild(exp);
      const mc = [...mini.querySelectorAll(".fc-day")], sc = [...exp.querySelectorAll(".fc-day")];
      const deltas = mc.map((a, i) => {
        const ra = a.getBoundingClientRect(), rb = sc[i].getBoundingClientRect();
        return [rb.left - ra.left, rb.top - ra.top, rb.right - ra.right, rb.bottom - ra.bottom].map((v) => +v.toFixed(2));
      });
      const worst = Math.max(...deltas.flat().map(Math.abs));
      return { worst, day1: deltas[0], day31: deltas[deltas.length - 1] };
    },
    _parityClear: () => surface.querySelectorAll(".fc-parity").forEach((el) => el.remove()),
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
