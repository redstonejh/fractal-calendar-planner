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
  const MORPH_MS = 340;                       // the handoff reads as ONE MORE TICK (same curve, near-tick duration)
  const TICK_K = 0.42;                        // each wheel tick covers this fraction of what REMAINS to the locked framing
  const HANDOFF_RATIO = 1.22;                 // remaining zoom ≤ this → swap in the real container (negligible travel)
  const EXP_M = 16;                           // equal spacing to the window edges…
  let expTop = 58;                            // …and the SAME spacing beneath the circular buttons (measured at boot/resize)
  const measureTop = () => {
    let b = 42;
    document.querySelectorAll(".window-control-cluster").forEach((el) => { b = Math.max(b, el.getBoundingClientRect().bottom); });
    expTop = Math.round(b + EXP_M);
  };
  // The DEFINED viewport: where a settled (locked) bucket lives. Zoom may overflow it mid-gesture;
  // every landing settles exactly inside it.
  const expRect = () => ({ x: EXP_M, y: expTop, w: window.innerWidth - 2 * EXP_M, h: window.innerHeight - expTop - EXP_M });
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
  let gz = 1, gsx = 0, gsy = 0;               // the current level's camera (target values; CSS transition glides)
  let settleTimer = 0;
  let lockedT = null, lastCur = { x: -1, y: -1 }, lastWheelT = 0;   // the gesture's LOCKED target bucket

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
      /* The grid is sized in JS so every bucket has EXACTLY the expanded view's aspect ratio —
         the expand/contract morph is then a UNIFORM scale: nothing ever stretches. */
      .fc-grid { position: absolute; display: grid; pointer-events: auto;
        grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(3, 1fr); gap: 14px; }
      /* ONE frost pass for the whole year layer, clipped to the 12 bucket shapes — the acrylic
         rides the zoom continuously and costs one backdrop pass instead of twelve. */
      .fc-frost { position: absolute; inset: 0; pointer-events: none;
        -webkit-backdrop-filter: blur(var(--fc-blur, 28px)) saturate(140%); backdrop-filter: blur(var(--fc-blur, 28px)) saturate(140%); }

      /* ── THE bucket — the ticketing zone at k=1, and the SAME OBJECT grown at every level: all
         trim is calc(base × --kx/--ky) and every band/gap/inset is an axis-safe fraction, so a
         mini scaled UP and the expanded view scaled DOWN have their interiors in IDENTICAL
         relative positions — the day grids line up mechanically at the handoff. ── */
      /* Rings replace borders (inset shadows paint WITHOUT touching the content box), so their
         width can lerp per lockstep with zero effect on the geometry parity. Every stage property
         — ring width, label sizes, detail opacity — interpolates via --lp (0 at rest → 1 at the
         boundary) toward the transition state, so each lock stop is that increment closer. */
      .fc-bucket { position: relative; box-sizing: border-box; display: flex; flex-direction: column; min-height: 0;
        overflow: hidden; color: #fff; border: 0;
        border-radius: calc(var(--mon-r, 16px) * var(--kx, 1)) / calc(var(--mon-r, 16px) * var(--ky, 1));
        padding: calc(8px * var(--ky, 1)) calc(10px * var(--kx, 1)) calc(10px * var(--ky, 1));
        background: linear-gradient(180deg, rgba(22,26,36,0.5), rgba(12,16,24,0.42));
        box-shadow: inset 0 0 0 var(--ring, 1px) rgba(255,255,255,0.14),
          inset 0 1px 0 rgba(255,255,255,0.18), 0 18px 42px rgba(0,0,0,0.28);
        transition: box-shadow .18s ease, background .18s ease; }
      /* Lockstep lerps: the year layer's months (and a month's days) step toward the boundary. */
      .fc-level .fc-month { --ring: calc(1px + (var(--ring-t, 1px) - 1px) * var(--lp, 0)); }
      .fc-level .fc-day, .fc-expander[data-kind="month"] .fc-day {
        --ringd: calc(1px + (var(--ring-t, 1px) - 1px) * var(--lp, 0)); }
      .fc-level .fc-hd { font-size: calc(0.98rem + (var(--hd-t, 0.98rem) - 0.98rem) * var(--lp, 0)); }
      .fc-level .fc-day-num { font-size: var(--num-t, 0.85rem); opacity: var(--lp, 0); }
      .fc-level .fc-dowrow span { font-size: var(--dow-t, 0.72rem); opacity: var(--lp, 0); }
      .fc-expander[data-kind="month"] .fc-day-num {
        font-size: calc(0.85rem + (var(--num-t, 0.85rem) - 0.85rem) * var(--lp, 0)); }
      /* The zone header: a fixed FRACTION band (text floats inside it — text is per-level LOD). */
      .fc-hd { flex: 0 0 9%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 0 1%; font-size: 0.98rem; font-weight: 700; line-height: 1.25; letter-spacing: .01em;
        color: rgba(255,255,255,0.85); white-space: nowrap; min-height: 0; }
      .fc-expander .fc-hd { font-size: 1.3rem; }
      /* The zone count-pill recipe carries the year / weekday sub-labels. */
      .fc-pill { flex: 0 0 auto; font-size: 0.72rem; font-weight: 600; color: rgba(255,255,255,0.62);
        background: rgba(255,255,255,0.10); border-radius: 999px; padding: 1px 8px; }
      .fc-dowrow { flex: 0 0 5%; display: grid; grid-template-columns: repeat(7, 1fr); column-gap: 1.6%;
        align-items: center; min-height: 0; }
      .fc-dowrow span { text-align: center; font-size: 0.72rem; font-weight: 700; color: rgba(255,255,255,0.4);
        white-space: nowrap; overflow: hidden; }
      .fc-days { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(7, 1fr);
        grid-template-rows: repeat(6, 1fr); column-gap: 1.6%; row-gap: 2%; }
      /* A day bucket: the same family — its trim scales by the SAME k, so cells coincide too. */
      .fc-day { position: relative; min-height: 0; overflow: hidden; border: 0;
        border-radius: calc(var(--day-r, 3px) * var(--kx, 1)) / calc(var(--day-r, 3px) * var(--ky, 1));
        background: linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.035));
        box-shadow: inset 0 0 0 var(--ringd, 1px) rgba(255,255,255,0.10),
          inset 0 1px 0 rgba(255,255,255,0.08);
        transition: box-shadow .18s ease, background .18s ease; }
      .fc-day-num { position: absolute; top: 6%; left: 7%; font-size: 0.85rem; font-weight: 700;
        color: rgba(255,255,255,0.78); line-height: 1; }
      .fc-day-body { position: absolute; inset: 24% 5% 5%; }
      .fc-today { box-shadow: inset 0 0 0 var(--ringd, 1px) rgba(255,255,255,0.10),
        inset 0 0 0 calc(var(--ringd, 1px) + 1px) rgba(125,180,255,0.45),
        0 0 14px rgba(90,150,255,0.3); }
      /* The zone empty-state, verbatim ("Drag tickets here" → cards). */
      .fc-empty { width: 100%; margin: auto 0; padding: 14px 8px; text-align: center;
        color: rgba(255,255,255,0.38); font-size: 0.8rem; line-height: 1.4; }

      /* Level semantics: at the YEAR the month is the object (days are texture whose detail fades
         in per lockstep via --lp); inside a month the day buckets are the objects — wearing the
         pipeline's is-target glow on hover. */
      .fc-surface[data-level="0"] .fc-day { pointer-events: none; }
      .fc-surface[data-level="0"] .fc-month { cursor: pointer; }
      .fc-surface[data-level="0"] .fc-month:hover {
        background: linear-gradient(180deg, rgba(70,110,190,0.34), rgba(40,70,130,0.26));
        box-shadow: inset 0 0 0 1px rgba(125,180,255,0.5), 0 0 30px rgba(90,150,255,0.42); }
      .fc-expander[data-kind="month"] .fc-day { cursor: pointer; pointer-events: auto; }
      .fc-expander[data-kind="month"] .fc-day:hover {
        background: linear-gradient(180deg, rgba(70,110,190,0.34), rgba(40,70,130,0.26));
        box-shadow: inset 0 0 0 1px rgba(125,180,255,0.5), 0 0 18px rgba(90,150,255,0.35); }

      /* The expander: the SAME bucket, laid out at its FINAL size from frame one (standard trim,
         one layout, one backdrop pass), travelling between its slot and the window on a composited
         transform — so the motion runs on the GPU and it lands at scale 1 as a byte-standard
         bucket, pixel-identical to its twin in the grid. */
      .fc-expander { position: absolute; z-index: 5; pointer-events: auto;
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
    `<div class="fc-hd"><span>${MONTHS[m]}</span></div>` +
    `<div class="fc-dowrow">${DOW.map((d) => `<span>${d}</span>`).join("")}</div>` +
    `<div class="fc-days">${Array.from({ length: daysIn(m) }, (_, i) => dayCellHTML(m, i + 1)).join("")}</div>`;
  const dayInnerHTML = (date) => {
    const [, mo, da] = date.split("-").map(Number);
    const d = new Date(YEAR, mo - 1, da);
    return `<div class="fc-hd"><span>${MONTHS[mo - 1]} ${da}</span><span class="fc-pill">${DOW_FULL[d.getDay()]}</span></div>` +
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
  // Proportional corners: the ticketing zone's radius FRACTION, measured off the mini buckets and
  // published as CSS vars — the same base × the expander's k = the same shape at every level.
  const radiusFor = (w, h) => clampN(RADIUS_F * Math.min(w, h), 2, 64);
  // Size the 4×3 grid so each bucket's aspect EQUALS the expanded view's (W : H−48): the morph
  // between a slot and the full view is then a uniform scale — no horizontal stretch, ever.
  // The grid contain-fits at that aspect and centres in the region below the control strip.
  const layoutGrid = (grid) => {
    const GAP = 14;
    const E = expRect();                                       // the year grid lives INSIDE the defined viewport
    const A = E.w / E.h;                                       // bucket aspect == expanded aspect (uniform morphs)
    let cw = (E.w - 3 * GAP) / 4, ch = cw / A;                 // width-limited fit…
    if (3 * ch + 2 * GAP > E.h) { ch = (E.h - 2 * GAP) / 3; cw = ch * A; }   // …else height-limited
    const gw = 4 * cw + 3 * GAP, gh = 3 * ch + 2 * GAP;
    Object.assign(grid.style, {
      left: `${(E.x + (E.w - gw) / 2).toFixed(2)}px`,
      top: `${(E.y + (E.h - gh) / 2).toFixed(2)}px`,
      width: `${gw.toFixed(2)}px`,
      height: `${gh.toFixed(2)}px`,
    });
  };
  const layoutFrost = () => {
    const yearEl = layers[0]; if (!yearEl) return;
    const frost = yearEl.querySelector(":scope > .fc-frost");
    const grid = yearEl.querySelector(":scope > .fc-grid");
    if (!frost || !grid) return;
    layoutGrid(grid);
    const m0 = grid.firstElementChild, c0 = grid.querySelector(".fc-day");
    const monR = radiusFor(m0.offsetWidth, m0.offsetHeight);
    surface.style.setProperty("--mon-r", `${monR.toFixed(1)}px`);
    if (c0) surface.style.setProperty("--day-r", `${radiusFor(c0.offsetWidth, c0.offsetHeight).toFixed(1)}px`);
    const gx = grid.offsetLeft, gy = grid.offsetTop;
    const parts = [...grid.children].map((m) => {
      const w = m.offsetWidth, h = m.offsetHeight;
      const x = gx + m.offsetLeft, y = gy + m.offsetTop;
      const r = monR;
      return `M ${x + r} ${y} L ${x + w - r} ${y} A ${r} ${r} 0 0 1 ${x + w} ${y + r} ` +
        `L ${x + w} ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} L ${x + r} ${y + h} ` +
        `A ${r} ${r} 0 0 1 ${x} ${y + h - r} L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
    });
    frost.style.clipPath = `path('${parts.join(" ")}')`;
    setChildTargets(yearEl);
  };

  // ── The lean: one composited transform, cursor-anchored, gently centre-drifting ─────────
  const apply = (animate) => {
    const el = layers[level]; if (!el) return;
    el.style.transition = animate ? `transform 300ms ${EASE}` : "none";
    el.style.transform = `translate(${-gsx}px, ${-gsy}px) scale(${gz})`;
    // Lockstep progress: 0 at rest -> 1 at the boundary. Text sizes, ring weights and detail
    // opacity all lerp on this, so every lock stop is that increment closer to the transition.
    const S = el._childS || 0;
    el.style.setProperty("--lp", (S > 1 ? clampN((gz - 1) / (S / HANDOFF_RATIO - 1), 0, 1) : 0).toFixed(3));
    surface.style.setProperty("--fc-blur", `${(28 / gz).toFixed(1)}px`);   // constant effective frost
  };
  // The LOCKED framing of a bucket: uniform contain-fit of its slot inside the expanded view's
  // rect, centred — the fixed destination every wheel tick steps toward.
  const framingFor = (targetEl) => {
    const below = layers[level];
    const b = layoutRect(targetEl, below);
    const E = expRect();
    const S = Math.min(E.w / b.w, E.h / b.h);
    return { s: S,
      sx: below.offsetLeft + (b.x + b.w / 2) * S - (E.x + E.w / 2),
      sy: below.offsetTop + (b.y + b.h / 2) * S - (E.y + E.h / 2) };
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
    const E = expRect();
    Object.assign(exp.style, { left: `${E.x}px`, top: `${E.y}px`, width: `${E.w}px`, height: `${E.h}px` });
    // The parity factors: the expander IS its source bucket grown by (final ÷ slot) per axis —
    // every k-scaled trim value inside then lands on the mini's pixels when mapped back onto it.
    const b = layoutRect(targetEl, layers[level]);
    exp.style.setProperty("--kx", (E.w / b.w).toFixed(4));
    exp.style.setProperty("--ky", (E.h / b.h).toFixed(4));
    return exp;
  };
  // Publish the lockstep TARGETS for a host's child buckets: the local values that, carried by the
  // camera to the handoff, land exactly on the incoming container's text sizes and ring weights.
  const setChildTargets = (host) => {
    const E = expRect();
    const kind = host.classList.contains("fc-expander") ? host.dataset.kind : "year";
    if (kind === "day") { host._childS = 0; return; }
    const c = kind === "year" ? host.querySelector(".fc-month") : host.querySelector(".fc-day");
    if (!c) { host._childS = 0; return; }
    const b = layoutRect(c, host);
    const kx = E.w / b.w;
    host._childS = Math.min(E.w / b.w, E.h / b.h);
    host.style.setProperty("--ring-t", `${(1 / kx).toFixed(3)}px`);
    host.style.setProperty("--hd-t", `${(1.3 / kx).toFixed(4)}rem`);
    host.style.setProperty("--num-t", `${((kind === "year" ? 0.85 : 1.3) / kx).toFixed(4)}rem`);
    host.style.setProperty("--dow-t", `${(0.72 / kx).toFixed(4)}rem`);
  };
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
    setChildTargets(exp);
    warm = { key, el: exp };
  };
  const dropWarm = () => { if (warm) { warm.el.remove(); warm = null; } };

  // ── Expand: ONE camera move — the outer world dives INTO the bucket on the very same
  //    trajectory the expander rides out of it (the iOS app-open grammar). ──────────────────
  const expand = (targetEl) => {
    transitioning = true;
    const E = expRect();
    const r = targetEl.getBoundingClientRect();   // live (leaned) rect — the expander's start
    const key = keyOf(targetEl);
    let exp;
    if (warm && warm.key === key) { exp = warm.el; warm = null; }
    else { dropWarm(); exp = buildExpander(targetEl); surface.appendChild(exp); setChildTargets(exp); }
    srcSel[level] = level === 0 ? `.fc-month[data-month="${targetEl.dataset.month}"]` : `.fc-day[data-date="${targetEl.dataset.date}"]`;
    Object.assign(exp.style, { zIndex: "5", pointerEvents: "auto", transition: "none", opacity: "0",
      transform: `translate(${(r.left - E.x).toFixed(2)}px, ${(r.top - E.y).toFixed(2)}px) scale(${(r.width / E.w).toFixed(5)}, ${(r.height / E.h).toFixed(5)})` });
    // The dive: map the bucket's LAYOUT rect onto the expander's final rect — the outer layer
    // travels there (non-uniform, per axis) so the slot stays pinned under the expander.
    const below = layers[level];
    const b = layoutRect(targetEl, below);        // sub-pixel slot rect within the layer
    const KX = E.w / b.w, KY = E.h / b.h;
    const dive = `translate(${(E.x - below.offsetLeft - b.x * KX).toFixed(2)}px, ${(E.y - below.offsetTop - b.y * KY).toFixed(2)}px) scale(${KX.toFixed(4)}, ${KY.toFixed(4)})`;
    void exp.offsetWidth;
    requestAnimationFrame(() => {                 // one frame for the (warm) raster to commit
      exp.style.transition = `transform ${MORPH_MS}ms ${EASE}, opacity 120ms ease`;
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
      sharpen();
    }, MORPH_MS + 60);
  };

  // ── Contract: back into the slot, crossfading onto its pixel-identical twin ─────────────
  // ── Contract: the reverse camera move. The outer world rides back OUT of the bucket and
  //    settles at the bucket's LOCKED FRAMING (contain-fit, centred) — so continuing to scroll
  //    out steps down stage by stage, symmetric with the way in. Escape rides all the way out. ──
  const contract = (fullOut) => {
    transitioning = true;
    const exp = layers[level];
    const below = layers[level - 1];
    const E = expRect();
    const src = below.querySelector(srcSel[level - 1]);
    // slot geometry from LAYOUT, sub-pixel (below is parked at identity — rects are layout-true)
    const b = layoutRect(src, below);
    const KX = E.w / b.w, KY = E.h / b.h;
    const dive = `translate(${(E.x - below.offsetLeft - b.x * KX).toFixed(2)}px, ${(E.y - below.offsetTop - b.y * KY).toFixed(2)}px) scale(${KX.toFixed(4)}, ${KY.toFixed(4)})`;
    // The landing framing: identity for a full ride-out (Escape), else the locked contain-fit.
    const S = fullOut ? 1 : Math.min(E.w / b.w, E.h / b.h);
    const fsx = fullOut ? 0 : below.offsetLeft + (b.x + b.w / 2) * S - (E.x + E.w / 2);
    const fsy = fullOut ? 0 : below.offsetTop + (b.y + b.h / 2) * S - (E.y + E.h / 2);
    // the slot's screen rect UNDER that framing = where the expander shrinks to
    const rx = below.offsetLeft + b.x * S - fsx, ry = below.offsetTop + b.y * S - fsy;
    below.style.transition = "none";
    below.style.transform = dive;                 // start deep inside the bucket…
    below.style.opacity = "0";
    below.style.visibility = "";
    exp.style.transition = "none";
    exp.style.transform = "none";                 // shed any camera before travelling home
    void below.offsetWidth;
    requestAnimationFrame(() => {
      below.style.transition = `transform ${MORPH_MS}ms ${EASE}, opacity ${MORPH_MS}ms ease`;
      below.style.transform = `translate(${(-fsx).toFixed(2)}px, ${(-fsy).toFixed(2)}px) scale(${S.toFixed(4)})`;
      below.style.opacity = "1";
      exp.style.transition = `transform ${MORPH_MS}ms ${EASE}, opacity ${Math.round(MORPH_MS * 0.45)}ms ease ${Math.round(MORPH_MS * 0.55)}ms`;
      exp.style.transform = `translate(${(rx - E.x).toFixed(2)}px, ${(ry - E.y).toFixed(2)}px) scale(${(b.w * S / E.w).toFixed(5)}, ${(b.h * S / E.h).toFixed(5)})`;
      exp.style.opacity = "0";
    });
    setTimeout(() => {
      exp.remove();
      layers[level] = null;
      level -= 1;
      surface.dataset.level = String(level);
      gz = S; gsx = fsx; gsy = fsy;               // the camera continues from the landing framing
      apply(false);
      surface.style.setProperty("--fc-blur", `${(28 / gz).toFixed(1)}px`);
      lockedT = null;
      dropWarm();
      transitioning = false;
    }, MORPH_MS + 60);
  };

  // ── Wheel: every tick is ONE STAGE closer to the locked framing ─────────────────────────
  // The gesture locks a target bucket; each tick-in covers TICK_K of the REMAINING distance to
  // its contain-fit framing (so every single tick visibly approaches the locked month viewport);
  // once the remaining zoom is negligible the real container swaps in with near-zero travel.
  // Ticks out step back toward identity the same way; at rest, one more tick contracts a level.
  const onWheel = (e) => {
    e.preventDefault();
    if (transitioning) return;
    const px = e.clientX, py = e.clientY;
    const now = performance.now();
    const newGesture = now - lastWheelT > 450 || Math.hypot(px - lastCur.x, py - lastCur.y) > 30;
    lastWheelT = now; lastCur = { x: px, y: py };
    if (e.deltaY > 0) {                                        // ── stepping OUT
      if (gz <= 1.02 && level > 0) { contract(false); return; }
      gz += (1 - gz) * TICK_K; gsx -= gsx * TICK_K; gsy -= gsy * TICK_K;
      if (gz <= 1.15) { gz = 1; gsx = 0; gsy = 0; lockedT = null; }   // symmetric tick-count with the way in
      apply(true); scheduleSettle(); return;
    }
    if (level >= 2) return;                                    // a day is the deepest bucket (for now)
    if (newGesture || !lockedT || !lockedT.isConnected) {      // ── lock the gesture's target
      const layer = layers[level];
      lockedT = targetAt((px - layer.offsetLeft + gsx) / gz, (py - layer.offsetTop + gsy) / gz);
      if (lockedT) prefetch(lockedT);
    }
    if (!lockedT) return;
    const F = framingFor(lockedT);
    gz += (F.s - gz) * TICK_K; gsx += (F.sx - gsx) * TICK_K; gsy += (F.sy - gsy) * TICK_K;
    if (F.s / gz <= HANDOFF_RATIO) { const t = lockedT; lockedT = null; expand(t); return; }
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
    measureTop();
    surface.addEventListener("wheel", onWheel, { passive: false });
    // Buckets that glow are buttons: click opens; Escape backs out. Hover pre-warms the expander.
    const clickTarget = (e) => {
      if (transitioning || level >= 2) return null;
      const t = level === 0 ? e.target.closest?.(".fc-month") : e.target.closest?.(".fc-day");
      return t && layers[level].contains(t) ? t : null;
    };
    surface.addEventListener("click", (e) => { const t = clickTarget(e); if (t) expand(t); });
    surface.addEventListener("mouseover", (e) => { const t = clickTarget(e); if (t) prefetch(t); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && level > 0 && !transitioning) contract(true); });
    window.addEventListener("resize", () => {
      measureTop();
      gz = 1; gsx = 0; gsy = 0; apply(false);
      dropWarm();
      const E = expRect();
      for (let i = 1; i <= level; i++) if (layers[i]) Object.assign(layers[i].style, { left: `${E.x}px`, top: `${E.y}px`, width: `${E.w}px`, height: `${E.h}px` });
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
    // HANDOFF-parity harness: stage the expander exactly as expand() would at the CURRENT camera —
    // final layout, slot-mapped transform — and diff every day cell's rect against the (possibly
    // zoomed) mini's. This is the mechanical lineup at the last stage before the transition.
    _parity: (mIdx, opacity = 1) => {
      const mini = layers[0].querySelector(`.fc-month[data-month="${mIdx}"]`);
      const r = mini.getBoundingClientRect();
      const E = expRect();
      const exp = document.createElement("div");
      exp.className = "fc-bucket fc-expander fc-parity";
      exp.dataset.kind = "month";
      exp.innerHTML = monthInnerHTML(mIdx - 1, true);
      const b = layoutRect(mini, layers[0]);
      exp.style.setProperty("--kx", (E.w / b.w).toFixed(4));
      exp.style.setProperty("--ky", (E.h / b.h).toFixed(4));
      setChildTargets(exp);
      Object.assign(exp.style, { left: `${E.x}px`, top: `${E.y}px`, width: `${E.w}px`, height: `${E.h}px`, opacity: String(opacity),
        transformOrigin: "0 0",
        transform: `translate(${(r.left - E.x).toFixed(2)}px, ${(r.top - E.y).toFixed(2)}px) scale(${(r.width / E.w).toFixed(5)}, ${(r.height / E.h).toFixed(5)})` });
      surface.appendChild(exp);
      const mc = [...mini.querySelectorAll(".fc-day")], sc = [...exp.querySelectorAll(".fc-day")];
      const deltas = mc.map((a, i) => {
        const ra = a.getBoundingClientRect(), rb = sc[i].getBoundingClientRect();
        return [rb.left - ra.left, rb.top - ra.top, rb.right - ra.right, rb.bottom - ra.bottom].map((v) => +v.toFixed(2));
      });
      const worst = Math.max(...deltas.flat().map(Math.abs));
      return { camera: +gz.toFixed(2), worst, day1: deltas[0], day31: deltas[deltas.length - 1] };
    },
    _parityClear: () => surface.querySelectorAll(".fc-parity").forEach((el) => el.remove()),
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
