// fractal-calendar.js — a FRACTAL YEAR: one zoomable surface where every month is a glass bucket
// containing its day buckets. Mouse over an area and scroll to zoom INTO that spot (the zoom is
// anchored at the cursor); scroll back out to see the whole year. One year for now.
//
// Built from the ticketing client's design system — the same frosted-bucket glass, the same
// is-target hover glow, the same easing and z-order recipes — so the modules read as one cohesive
// ecosystem: a month IS a bucket containing day buckets, and each day is a drop-bucket surface
// (data-date + .fc-day-body) ready to hold cards from the other modules.
(() => {
  const YEAR = 2026;                          // one year for now
  const TOP = 64, MARGIN = 18;                // the same workspace band the pipeline buckets used
  const EASE = "cubic-bezier(.22, 1, .26, 1)";
  const Z_MAX = 26;                           // one day comfortably fills the view at max depth
  const MONTHS = ["January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"];
  const DOW = ["S", "M", "T", "W", "T", "F", "S"];
  const DOW_FULL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let viewport = null, world = null;
  let z = 1, sx = 0, sy = 0;                  // applied zoom + scroll offsets into the zoomed world
  let gz = 1, gsx = 0, gsy = 0;               // glide targets — wheel writes these, a rAF loop eases toward them
  let raf = 0;

  const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const ensureStyles = () => {
    if (document.getElementById("fractal-calendar-styles")) return;
    const style = document.createElement("style");
    style.id = "fractal-calendar-styles";
    style.textContent = `
      /* The zoom viewport clips the world; z 800 = the pipeline buckets' layer (above the grid,
         below the top menus at 2600+/4600). */
      .fc-cal { position: fixed; left: ${MARGIN}px; right: ${MARGIN}px; top: ${TOP}px; bottom: ${MARGIN}px;
        z-index: 800; overflow: hidden; border-radius: 18px; pointer-events: auto; -webkit-app-region: no-drag; }
      /* The world zooms via the LAYOUT zoom property (not a transform): every level re-lays-out and
         re-rasterises, so text/borders stay tack-sharp even 40× deep — the fractal never goes soft. */
      .fc-world { position: absolute; left: 0; top: 0; box-sizing: border-box;
        display: grid; grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(3, 1fr);
        gap: 14px; padding: 2px; }
      /* A month is a BUCKET — the exact pipeline-zone glass. The backdrop blur is counter-scaled
         (--fc-blur = 28/z) so its EFFECTIVE radius stays constant instead of exploding with the zoom. */
      .fc-month { position: relative; display: flex; flex-direction: column; min-height: 0; border-radius: 16px;
        padding: 10px 12px 12px; color: #fff;
        background: linear-gradient(180deg, rgba(22,26,36,0.5), rgba(12,16,24,0.42));
        -webkit-backdrop-filter: blur(var(--fc-blur, 28px)) saturate(140%); backdrop-filter: blur(var(--fc-blur, 28px)) saturate(140%);
        border: 1px solid rgba(255,255,255,0.14);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 18px 42px rgba(0,0,0,0.28); }
      .fc-month-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
        padding: 0 2px 6px; font-size: 0.92rem; font-weight: 700; letter-spacing: .01em; color: rgba(255,255,255,0.85);
        transition: opacity .25s ease; }
      .fc-month-year { font-size: 0.68rem; font-weight: 600; color: rgba(255,255,255,0.4); }
      /* Zoomed OUT the month reads as its NAME floating over the day-grid texture (the fractal's
         coarse level); zooming in fades the name away and the days take over. */
      .fc-month-big { position: absolute; inset: 0; z-index: 3; display: flex; align-items: center; justify-content: center;
        font-size: 1.9rem; font-weight: 800; letter-spacing: .02em; color: rgba(255,255,255,0.88);
        text-shadow: 0 2px 14px rgba(0,0,0,0.55); pointer-events: none; opacity: 0; transition: opacity .25s ease; }
      .fc-cal[data-lod="year"] .fc-month-big { opacity: 1; }
      .fc-cal[data-lod="year"] .fc-days { opacity: 0.55; }
      .fc-cal[data-lod="year"] .fc-day-num, .fc-cal[data-lod="year"] .fc-dow { opacity: 0; }
      .fc-dow { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; padding-bottom: 4px; transition: opacity .25s ease; }
      .fc-dow span { text-align: center; font-size: 0.52rem; font-weight: 700; color: rgba(255,255,255,0.35); }
      .fc-days { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(7, 1fr);
        grid-auto-rows: 1fr; gap: 4px; transition: opacity .25s ease; }
      /* A day is a bucket too — translucent fill (no backdrop blur: 365 of them must stay cheap),
         wearing the pipeline's is-target blue glow on hover. */
      .fc-day { position: relative; min-height: 0; border-radius: 7px; overflow: hidden; cursor: pointer;
        background: linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.035));
        border: 1px solid rgba(255,255,255,0.10);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
        transition: border-color .18s ease, box-shadow .18s ease, background .18s ease; }
      .fc-day:hover { border-color: rgba(125,180,255,0.92);
        background: linear-gradient(180deg, rgba(70,110,190,0.34), rgba(40,70,130,0.26));
        box-shadow: inset 0 0 0 1px rgba(125,180,255,0.5), 0 0 18px rgba(90,150,255,0.35); }
      .fc-day-num { position: absolute; top: 8%; left: 9%; font-size: 0.58rem; font-weight: 700;
        color: rgba(255,255,255,0.78); line-height: 1; transition: opacity .25s ease; }
      .fc-day-dow { position: absolute; top: 8%; right: 9%; font-size: 0.42rem; font-weight: 600;
        color: rgba(255,255,255,0.38); line-height: 1; opacity: 0; transition: opacity .25s ease; }
      .fc-cal[data-lod="day"] .fc-day-dow { opacity: 1; }
      .fc-day-body { position: absolute; inset: 28% 6% 6% 6%; }   /* the bucket surface — cards land here later */
      .fc-today { border-color: rgba(125,180,255,0.85);
        box-shadow: inset 0 0 0 1px rgba(125,180,255,0.45), 0 0 14px rgba(90,150,255,0.3); }
    `;
    document.head.appendChild(style);
  };

  const daysIn = (m) => new Date(YEAR, m + 1, 0).getDate();
  const firstDow = (m) => new Date(YEAR, m, 1).getDay();
  const iso = (m, d) => `${YEAR}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const build = () => {
    if (viewport) return;
    ensureStyles();
    viewport = document.createElement("div");
    viewport.className = "fc-cal";
    viewport.dataset.lod = "year";
    world = document.createElement("div");
    world.className = "fc-world";
    const now = new Date();
    const todayIso = now.getFullYear() === YEAR ? iso(now.getMonth(), now.getDate()) : "";
    for (let m = 0; m < 12; m++) {
      const month = document.createElement("div");
      month.className = "fc-month";
      month.dataset.month = String(m + 1);
      const n = daysIn(m), off = firstDow(m);
      month.innerHTML =
        `<div class="fc-month-hd"><span>${MONTHS[m]}</span><span class="fc-month-year">${YEAR}</span></div>` +
        `<div class="fc-dow">${DOW.map((d) => `<span>${d}</span>`).join("")}</div>` +
        `<div class="fc-days">${Array.from({ length: n }, (_, i) => {
          const d = i + 1, date = iso(m, d), dow = new Date(YEAR, m, d).getDay();
          return `<div class="fc-day${date === todayIso ? " fc-today" : ""}" data-date="${date}"` +
            (i === 0 ? ` style="grid-column-start:${off + 1}"` : "") +
            `><span class="fc-day-num">${d}</span><span class="fc-day-dow">${DOW_FULL[dow]}</span><div class="fc-day-body"></div></div>`;
        }).join("")}</div>` +
        `<div class="fc-month-big">${MONTHS[m]}</div>`;
      world.appendChild(month);
    }
    viewport.appendChild(world);
    document.body.appendChild(viewport);
    sizeWorld();
    viewport.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", () => { sizeWorld(); clampS(); apply(); });
  };

  // The world's BASE size = the viewport (explicit px, so the zoom property scales from a fixed
  // layout instead of re-resolving inset:0 in zoomed coordinates).
  const sizeWorld = () => {
    const r = viewport.getBoundingClientRect();
    world.style.width = `${Math.round(r.width)}px`;
    world.style.height = `${Math.round(r.height)}px`;
  };

  // Keep the world's edges pinned to the viewport: no gaps can open while zoomed in.
  const clampS = () => {
    const r = viewport.getBoundingClientRect();
    gsx = clampN(gsx, 0, Math.max(0, r.width * gz - r.width));
    gsy = clampN(gsy, 0, Math.max(0, r.height * gz - r.height));
  };

  const lodOf = (zz) => (zz < 1.8 ? "year" : zz < 6 ? "month" : "day");

  const apply = () => {
    world.style.zoom = z;
    // Pan via the viewport's REAL scroll (zoom multiplies the world's own left/top lengths, so
    // offsetting those would scale the pan by z; scroll offsets are in rendered pixels — exact).
    viewport.scrollLeft = sx;
    viewport.scrollTop = sy;
    viewport.style.setProperty("--fc-blur", `${(28 / z).toFixed(2)}px`);   // constant EFFECTIVE glass blur
    const lod = lodOf(z);
    if (viewport.dataset.lod !== lod) viewport.dataset.lod = lod;
  };

  // Wheel = fractal zoom anchored at the cursor: the world point under the mouse stays put while
  // everything scales around it. Targets glide via rAF so chunky wheel notches feel like one motion.
  const onWheel = (e) => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const nz = clampN(gz * Math.exp(-e.deltaY * 0.0022), 1, Z_MAX);
    gsx = ((px + gsx) / gz) * nz - px;   // anchor: content point (px+s)/z is invariant
    gsy = ((py + gsy) / gz) * nz - py;
    gz = nz;
    clampS();
    if (!raf) glide();
  };
  const glide = () => {
    raf = requestAnimationFrame(() => {
      const k = 0.26;   // ease toward the target — the same "smooth glide" feel as the deck scroll
      z += (gz - z) * k; sx += (gsx - sx) * k; sy += (gsy - sy) * k;
      if (Math.abs(gz - z) < 0.002 && Math.abs(gsx - sx) < 0.4 && Math.abs(gsy - sy) < 0.4) {
        z = gz; sx = gsx; sy = gsy; apply(); raf = 0; return;
      }
      apply(); glide();
    });
  };

  // Ecosystem hooks: other modules can resolve a day/month bucket to land things in.
  const init = () => { build(); apply(); };
  window.fractalCalendar = {
    year: YEAR,
    dayEl: (date) => viewport?.querySelector(`.fc-day[data-date="${date}"]`) || null,
    monthEl: (m) => viewport?.querySelector(`.fc-month[data-month="${m}"]`) || null,
    zoom: () => z,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
