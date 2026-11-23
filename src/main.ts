import { analyze, BLOCK_M, Params, Place, Sim } from "./model.js";

declare const MathJax: { typesetPromise(els?: Element[]): Promise<void>; typesetClear(els?: Element[]): void } | undefined;

// ---------------------------------------------------------------- parameters

const SHARE_STEPS = [1/16, 1/12, 1/8, 1/6, 1/4, 1/3, 1/2, 1, 2, 3, 4];
const shareLabel = (v: number) => v >= 1 ? `${v} per bldg` : `1 per ${Math.round(1 / v)} bldgs`;

interface Slider {
  key: keyof Params; sym: string; label: string;
  min: number; max: number; step: number; value: number; unit?: string;
  // Slider position ↔ parameter value, for non-linear sliders.
  toValue?: (x: number) => number; fromValue?: (v: number) => number; fmt?: (v: number) => string;
}
type Entry = Slider | { group: string };

const SLIDERS: Entry[] = [
  { group: "Neighborhood" },
  { key: "buildings", sym: "B", label: "Buildings on route", min: 40, max: 400, step: 10, value: 160 },
  { key: "flux", sym: "g", label: "Garbage per building", min: 10, max: 200, step: 5, value: 60, unit: "kg/day" },
  { key: "frontage", sym: "w", label: "Frontage per building", min: 6, max: 30, step: 1, value: 10, unit: "m" },

  { group: "Containers" },
  { key: "share", sym: "s", label: "Containers", min: 0, max: SHARE_STEPS.length - 1, step: 1, value: 2,
    toValue: x => SHARE_STEPS[x]!, fromValue: v => SHARE_STEPS.indexOf(v), fmt: shareLabel },
  { key: "containerKg", sym: "k", label: "Container size", min: 50, max: 1500, step: 25, value: 150, unit: "kg" },
  { key: "parkingPer", sym: "p", label: "Parking spaces per container", min: 0, max: 1.5, step: 0.05, value: 0.5 },

  { group: "Trucks" },
  { key: "trucks", sym: "N", label: "Trucks per pickup day", min: 1, max: 20, step: 1, value: 3 },
  { key: "pickups", sym: "f", label: "Pickups per week", min: 1, max: 7, step: 1, value: 3 },
  { key: "truckT", sym: "C", label: "Truck capacity", min: 2, max: 15, step: 0.5, value: 8, unit: "t" },
  { key: "speed", sym: "v", label: "Speed along route", min: 3, max: 30, step: 1, value: 10, unit: "km/h" },
  { key: "liftSec", sym: "t_l", label: "Time per container", min: 5, max: 180, step: 5, value: 30, unit: "s" },
  { key: "bagSec", sym: "t_b", label: "Time per 10 kg of loose bags", min: 2, max: 60, step: 1, value: 10, unit: "s" },
  { key: "streetSpeed", sym: "u", label: "Speed driving to the corner", min: 5, max: 40, step: 1, value: 15, unit: "km/h" },
  { key: "dumpMin", sym: "t_d", label: "Corner to dump (one way)", min: 5, max: 90, step: 5, value: 30, unit: "min" },
  { key: "unloadMin", sym: "t_u", label: "Unload time", min: 5, max: 60, step: 5, value: 20, unit: "min" },

  { group: "Labor & cost" },
  { key: "crew", sym: "c", label: "Crew per truck", min: 1, max: 3, step: 1, value: 2 },
  { key: "shiftH", sym: "H", label: "Shift length", min: 4, max: 12, step: 0.5, value: 8, unit: "h" },
  { key: "wage", sym: "\\$_h", label: "Loaded labor cost", min: 30, max: 200, step: 5, value: 90, unit: "$/h" },
  { key: "truckDay", sym: "\\$_t", label: "Truck cost per shift", min: 100, max: 3000, step: 50, value: 700, unit: "$" },
];

const PRESETS: Record<string, Partial<Params>> = {
  "NYC bins per building": { share: 2, containerKg: 150, pickups: 3, trucks: 3, truckT: 8, liftSec: 30, crew: 2 },
  "NYC bags (today)": { share: 1, containerKg: 50, pickups: 3, trucks: 3, truckT: 12, liftSec: 60, crew: 2 },
  "Shared, daily, 1 crew": { share: 1/6, containerKg: 1200, pickups: 7, trucks: 2, truckT: 8, liftSec: 45, crew: 1 },
  "Shared, 3×/week, 1 crew": { share: 1/6, containerKg: 1200, pickups: 3, trucks: 2, truckT: 8, liftSec: 45, crew: 1 },
};

const isSlider = (e: Entry): e is Slider => "key" in e;
const P = {} as Params;
for (const e of SLIDERS) if (isSlider(e)) P[e.key] = e.toValue ? e.toValue(e.value) : e.value;

// ---------------------------------------------------------------- controls

const $ = (id: string) => document.getElementById(id)!;
const controls = $("controls");
const presetBox = controls.querySelector(".presets")!;
for (const [name, pr] of Object.entries(PRESETS)) {
  const b = document.createElement("button");
  b.textContent = name;
  b.onclick = () => {
    for (const [k, v] of Object.entries(pr) as [keyof Params, number][]) { P[k] = v; syncSlider[k]!(); }
    changed();
  };
  presetBox.appendChild(b);
}

const syncSlider: Partial<Record<keyof Params, () => void>> = {};
for (const e of SLIDERS) {
  if (!isSlider(e)) {
    const h = document.createElement("h3"); h.textContent = e.group; controls.appendChild(h);
    continue;
  }
  const div = document.createElement("div");
  div.className = "ctl";
  div.innerHTML = `<label><span>${e.label} <span class="sym"></span></span><output></output></label>
    <input type="range" min="${e.min}" max="${e.max}" step="${e.step}" value="${e.value}">`;
  div.querySelector(".sym")!.textContent = `\\(${e.sym}\\)`;
  const input = div.querySelector("input")!, out = div.querySelector("output")!;
  const show = () => { out.textContent = e.fmt ? e.fmt(P[e.key]) : `${P[e.key]}${e.unit ? " " + e.unit : ""}`; };
  input.oninput = () => { P[e.key] = e.toValue ? e.toValue(+input.value) : +input.value; show(); changed(); };
  syncSlider[e.key] = () => { input.value = String(e.fromValue ? e.fromValue(P[e.key]) : P[e.key]); show(); };
  show();
  controls.appendChild(div);
}

// ---------------------------------------------------------------- equations

const n = (x: number, d = 1) => x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const bad = (cond: boolean, tex: string) => cond ? `\\color{red}{${tex}}` : tex;

function equationsTeX(): string {
  const A = analyze(P);
  const roundTrip = A.roundTripH * 60;
  return String.raw`
<h3>Between pickups</h3>
<p>Pickups fall on fixed weekdays, so the gaps \(\Delta_i\) are uneven
(${A.gaps.join(", ")} days). The longest one decides capacity and staffing:</p>
\[ \Delta = \max_i \Delta_i = \left\lceil \frac{7}{f} \right\rceil = ${A.daysBetween}\ \text{days} \qquad
   G = B\,g\,\Delta = ${n(A.perPickupT)}\ \text{t waiting} \]
\[ n = s\,B = ${n(A.containers, 0)}\ \text{containers} \qquad
   K = n\,k = ${n(A.binT)}\ \text{t of bin capacity} \]
<p>Each bin fills at a steady rate. Once \(G_i = B g \Delta_i > K\), the bins are full for the
last \(1 - K/G_i\) of that gap, and the rest piles up loose:</p>
\[ \text{time full} = \frac{1}{7}\sum_i \Delta_i \max\!\left(0,\ 1 - \frac{K}{G_i}\right)
   = ${bad(A.overflowFrac > 0, n(100 * A.overflowFrac, 0) + "\\%")}
   \qquad O = \max(0,\ G - K) = ${bad(A.overflowT > 0, n(A.overflowT))}\ \text{t loose} \]
\[ \text{parking} = n\,p = ${bad(A.parking / A.curbSpaces > 0.3, n(A.parking, 0))}
   \ \text{of}\ \approx\frac{B\,w}{6\,\text{m}} = ${n(A.curbSpaces, 0)}\ \text{curb spaces}
   \ (${n(100 * A.parking / A.curbSpaces, 0)}\%) \]

<h3>The heaviest pickup day</h3>
<p>Each of the \(N\) trucks sweeps \(1/N\) of the route, so each makes</p>
\[ \ell = \left\lceil \frac{G}{N\,C} \right\rceil = ${A.loadsPerTruck}\ \text{load${A.loadsPerTruck === 1 ? "" : "s"}}
   \qquad L = N\,\ell = ${A.loads} \]
<p>A full truck drives the grid to the corner, then hauls to the dump. The farther out it
fills, the longer that drive. With \(\bar d\) the mean grid distance from a container to the
corner, one round trip is</p>
\[ R = 2\left(t_d + \frac{\bar d}{u}\right) + t_u
     = 2\left(${P.dumpMin} + \frac{${n(A.meanGridM, 0)}\,\text{m}}{${P.streetSpeed}\,\text{km/h}}\right) + ${P.unloadMin}
     = ${n(roundTrip, 0)}\ \text{min} \]
<p>Total truck time to sweep the route and haul it all:</p>
\[ T = \underbrace{\frac{B\,w + \text{turns}}{v}}_{\text{drive}} + \underbrace{n\,t_l}_{\text{lift}} + \underbrace{O\,t_b}_{\text{bags}}
     + \underbrace{L\,R}_{\text{dump trips}}
   = ${n(A.driveH, 2)} + ${n(A.liftH, 2)} + ${n(A.bagH, 2)} + ${A.loads}\times${n(roundTrip / 60, 2)}
   = ${n(A.truckH, 2)}\ \text{truck-h} \]
\[ \frac{T}{N} = ${bad(!A.enough, n(A.perTruckH, 2))}\ \text{h per truck}\ \text{vs.}\ H = ${P.shiftH}
   \qquad N_\text{needed} = ${bad(!A.enough, String(A.trucksNeeded))} \]

<h3>Per week: what frequency actually costs</h3>
<p>The number of loads per week is about \(7Bg/C\) however often you pick up, so the
dump-trip term barely depends on frequency. Only the sweep (drive + lift) grows with \(f\):</p>
\[ \sum_i T_i \approx \underbrace{f\left(\frac{B\,w + \text{turns}}{v} + n\,t_l\right)}_{\text{grows with } f\ =\ ${n(A.weeklyRouteH, 1)}\ \text{h}}
   + \underbrace{\sum_i N\left\lceil\frac{G_i}{N C}\right\rceil R}_{\approx\ \frac{7Bg}{C}R\ =\ ${n(A.weeklyDumpH, 1)}\ \text{h}} \]
<p>Crews are paid by the shift, not by the tonne:</p>
\[ \text{labor} = f\,N\,c\,H = ${n(A.weeklyLaborH, 0)}\ \text{h/wk} \qquad
   \text{cost} = f\,N\,(c\,H\,\$_h + \$_t) = \$${n(A.weeklyCost, 0)}/\text{wk}
   = \$${n(A.costPerT, 0)}/\text{t} \]`;
}

const eqBox = $("equations");
let typesetting = false, eqDirty = true;
async function renderEquations(): Promise<void> {
  if (typesetting || !eqDirty) return;
  typesetting = true; eqDirty = false;
  if (typeof MathJax !== "undefined" && MathJax.typesetPromise) {
    MathJax.typesetClear([eqBox]);
    eqBox.innerHTML = equationsTeX();
    await MathJax.typesetPromise([eqBox]);
  } else {
    eqBox.innerHTML = equationsTeX();
  }
  typesetting = false;
  if (eqDirty) void renderEquations();
}

// ---------------------------------------------------------------- simulation stats

function renderSimStats(sim: Sim): void {
  const H = sim.history, d = H.length;
  const avg = (f: (x: typeof H[number]) => number) => d ? H.reduce((a, x) => a + f(x), 0) / d : NaN;
  const A = analyze(P);
  const rows: [string, string, string, boolean?][] = d === 0 ? [["Waiting for the first full day…", "", ""]] : [
    ["Bins full (share of time)", `${n(100 * A.overflowFrac, 0)}%`,
      `${n(100 * avg(x => x.overflowSiteMin) / 1440 / sim.sites.length, 0)}%`, avg(x => x.overflowSiteMin) > 0],
    ["Loose trash on sidewalk (avg)", "", `${n(avg(x => x.looseKgMin) / 1440 / 1000, 2)} t`, avg(x => x.looseKgMin) > 0],
    ["Containers skipped (out of time)", A.enough ? "0" : "some",
      `${n(avg(x => x.missed) * 7, 0)} /wk`, avg(x => x.missed) > 0],
    ["Dump trips", `${n(A.weeklyLoads, 0)} /wk`, `${n(avg(x => x.dumpTrips) * 7, 0)} /wk`],
    ["Crew hours", `${n(A.weeklyLaborH, 0)} /wk`, `${n(avg(x => x.laborH) * 7, 0)} /wk`],
    ["Overtime", "", `${n(avg(x => x.overtimeH) * 7, 0)} h/wk`, avg(x => x.overtimeH) > 0],
    ["Collected vs. generated", "", `${n(100 * avg(x => x.collected) / avg(x => x.generated), 0)}%`],
  ];
  $("simStats").innerHTML = `<tr><th></th><th>equations</th><th>simulation</th></tr>` + rows
    .map(([k, a, b, isBad]) => `<tr><td>${k}</td><td>${a}</td><td class="${isBad ? "bad" : ""}">${b}</td></tr>`).join("");

  const day = Math.floor(sim.t / 1440), m = sim.t % 1440;
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  $("clock").textContent =
    `Day ${day + 1} · ${DAYS[day % 7]} ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` +
    (sim.days.has(day % 7) ? " · pickup day" : "") + ` · ${sim.trucks.length} truck${sim.trucks.length === 1 ? "" : "s"} out`;
}

// ---------------------------------------------------------------- SVG animation

// The street grid, drawn to scale: rows of the route, cross streets every
// block, and the dump off the corner at (0, 0). Containers and trucks carry
// little "health bars" showing how full they are.

const SVG_NS = "http://www.w3.org/2000/svg";
const svg = $("map") as unknown as SVGSVGElement;
const PAD = 40; // room on the left for the dump

let toSvg: (x: number, y: number) => { x: number; y: number } = (x, y) => ({ x, y });
let siteEls: { bar: SVGRectElement; box: SVGRectElement }[] = [];
let truckEls: { g: SVGGElement; bar: SVGRectElement }[] = [];
let barW = 8, dumpPt = { x: 0, y: 0 };

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function buildSvg(sim: Sim): void {
  svg.replaceChildren();
  const { rows, rowLenM, sites } = sim.geo;
  const heightM = Math.max(1, (rows - 1) * BLOCK_M);
  const W = 640, H = Math.max(120, Math.min(420, 560 * heightM / rowLenM + 60));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const scale = Math.min((W - PAD - 20) / rowLenM, (H - 50) / heightM);
  const ox = PAD, oy = 30;
  toSvg = (x, y) => ({ x: ox + x * scale, y: oy + y * scale });

  // Cross streets every block, then the route's own streets.
  for (let x = 0; x <= rowLenM + 1; x += BLOCK_M) {
    const a = toSvg(x, 0), b = toSvg(x, heightM);
    svg.appendChild(el("line", { x1: a.x, y1: a.y - 8, x2: b.x, y2: b.y + 8, class: "grid" }));
  }
  for (let r = 0; r < rows; r++) {
    const a = toSvg(0, r * BLOCK_M), b = toSvg(rowLenM, r * BLOCK_M);
    svg.appendChild(el("line", { x1: a.x - 8, y1: a.y, x2: b.x + 8, y2: b.y, class: "street" }));
  }
  const corner = toSvg(0, 0);
  dumpPt = { x: 14, y: corner.y };
  svg.appendChild(el("line", { x1: dumpPt.x, y1: dumpPt.y, x2: corner.x, y2: corner.y, class: "haul" }));
  svg.appendChild(el("rect", { x: dumpPt.x - 10, y: dumpPt.y - 12, width: 20, height: 24, rx: 2, class: "dump" }));
  const label = el("text", { x: dumpPt.x, y: dumpPt.y + 24, class: "label" });
  label.textContent = "dump";
  svg.appendChild(label);

  // One health bar per container site, standing on its curb.
  const spacing = sites.length > 1 ? Math.max(1, Math.abs(toSvg(sites[1]!.x, 0).x - toSvg(sites[0]!.x, 0).x)) : 20;
  barW = Math.max(1.5, Math.min(8, spacing * 0.7));
  const barH = 14;
  siteEls = sites.map(p => {
    const q = toSvg(p.x, p.y);
    const box = el("rect", { x: q.x - barW / 2, y: q.y - barH - 3, width: barW, height: barH, class: "barbox" });
    const bar = el("rect", { x: q.x - barW / 2, y: q.y - 3, width: barW, height: 0, class: "bar" });
    svg.append(box, bar);
    return { box, bar };
  });
  truckEls = [];
}

const place = (sim: Sim, p: Place) => {
  if (p === "dump") return dumpPt;
  const s = sim.geo.sites[p]!;
  return toSvg(s.x, s.y);
};

// Trucks follow the grid: along the street first, then up/down the avenue.
function gridLerp(a: { x: number; y: number }, b: { x: number; y: number }, f: number) {
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y), d = dx + dy;
  if (d === 0) return a;
  const along = f * d;
  // Heading to the dump: go up the avenue first, then out along the top street.
  const yFirst = b === dumpPt;
  if (yFirst) {
    return along < dy ? { x: a.x, y: a.y + Math.sign(b.y - a.y) * along }
                      : { x: a.x + Math.sign(b.x - a.x) * (along - dy), y: b.y };
  }
  return along < dx ? { x: a.x + Math.sign(b.x - a.x) * along, y: a.y }
                    : { x: b.x, y: a.y + Math.sign(b.y - a.y) * (along - dx) };
}

function drawSvg(sim: Sim): void {
  sim.sites.forEach((s, i) => {
    const { bar, box } = siteEls[i]!;
    const frac = Math.min(1, s.inBin / s.cap);
    const h = +box.getAttribute("height")!, y0 = +box.getAttribute("y")! + h;
    bar.setAttribute("y", String(y0 - h * frac));
    bar.setAttribute("height", String(h * frac));
    bar.setAttribute("class", s.loose > 0 ? "bar over" : frac > 0.999 ? "bar full" : frac > 0.66 ? "bar warn" : "bar");
    box.setAttribute("class", s.loose > 0 ? "barbox over" : "barbox");
  });
  while (truckEls.length < sim.trucks.length) {
    const g = el("g", {});
    g.appendChild(el("rect", { x: -8, y: -5, width: 16, height: 10, rx: 2, class: "truck" }));
    g.appendChild(el("rect", { x: -9, y: -12, width: 18, height: 4, class: "barbox" }));
    const bar = el("rect", { x: -9, y: -12, width: 0, height: 4, class: "bar" });
    g.appendChild(bar);
    svg.appendChild(g); truckEls.push({ g, bar });
  }
  truckEls.forEach(({ g, bar }, i) => {
    const tr = sim.trucks[i];
    g.style.display = tr ? "" : "none";
    if (!tr) return;
    const a = place(sim, tr.at), b = place(sim, tr.toward);
    const span = tr.busyUntil - tr.actStart;
    const f = span > 0 ? Math.min(1, Math.max(0, (sim.t - tr.actStart) / span)) : 1;
    let p: { x: number; y: number };
    if (b === dumpPt || a === dumpPt) {
      // Via the corner: grid part and haul part split by time spent on each.
      const corner = toSvg(0, 0);
      const gridMin = span - (tr.state === "unloading" ? span : sim.P.dumpMin);
      const fg = gridMin > 0 ? (f * span) / gridMin : 1;
      if (b === dumpPt) p = fg < 1 ? gridLerp(a, corner, fg) : lerp(corner, dumpPt, (f * span - gridMin) / sim.P.dumpMin);
      else {
        const fh = (f * span) / sim.P.dumpMin;
        p = fh < 1 ? lerp(dumpPt, corner, fh) : gridLerp(corner, b, (f * span - sim.P.dumpMin) / Math.max(1e-9, gridMin));
      }
      if (tr.state === "unloading") p = dumpPt;
    } else {
      p = gridLerp(a, b, f);
    }
    g.setAttribute("transform", `translate(${p.x},${p.y})`);
    const frac = tr.load / (P.truckT * 1000);
    bar.setAttribute("width", String(18 * frac));
    bar.setAttribute("class", frac > 0.999 ? "bar full" : frac > 0.66 ? "bar warn" : "bar");
  });
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, f: number) {
  f = Math.min(1, Math.max(0, f));
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// ---------------------------------------------------------------- main loop

let sim = new Sim({ ...P });
let playing = true;
// Two log-scale speed sliders (2 sim-minutes to ~3.5 sim-days per real second):
// one for when trucks are out, so you can follow them, and one for the rest of
// the time, when only the bins are filling.
const logSpeed = (id: string) => {
  const input = $(id) as HTMLInputElement, out = $(id + "Out");
  const minPerSec = () => 2 * Math.pow(2500, +input.value / 100);
  const show = () => {
    const m = minPerSec();
    out.textContent = m < 90 ? `${Math.round(m)} min/s` : m < 1440 * 1.5 ? `${(m / 60).toFixed(1)} h/s` : `${(m / 1440).toFixed(1)} days/s`;
  };
  input.oninput = show;
  show();
  return minPerSec;
};
const idleSpeed = logSpeed("simSpeed"), truckSpeed = logSpeed("truckSpeed");
const simMinPerSec = () => sim.trucks.length > 0 ? truckSpeed() : idleSpeed();

function changed(): void {
  sim = new Sim({ ...P });
  buildSvg(sim);
  eqDirty = true;
  void renderEquations();
}
$("play").onclick = ev => { playing = !playing; (ev.target as HTMLButtonElement).textContent = playing ? "Pause" : "Play"; };
$("reset").onclick = changed;

let lastStats = 0, lastFrame: number | null = null, owed = 0;
function frame(ts: number): void {
  // Run as many one-minute ticks as real time owes us (capped, in case the tab was hidden).
  const dt = lastFrame === null ? 0 : Math.min(0.1, (ts - lastFrame) / 1000);
  lastFrame = ts;
  if (playing) {
    // Re-check the rate every tick, so time slows down as soon as trucks leave.
    owed += dt;
    while (owed > 0) { owed -= 1 / simMinPerSec(); sim.tick(); }
  }
  drawSvg(sim);
  if (ts - lastStats > 250) { renderSimStats(sim); lastStats = ts; }
  requestAnimationFrame(frame);
}

changed();
// Typeset the slider symbols once MathJax is ready; equations re-typeset on every change.
window.addEventListener("load", () => {
  if (typeof MathJax !== "undefined") void MathJax.typesetPromise([controls]).then(() => { eqDirty = true; void renderEquations(); });
});
requestAnimationFrame(frame);
