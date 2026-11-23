// Garbage collection model for one collection route.
//
// Two views of the same system:
//   - `analyze`: closed-form steady-state equations (what the page typesets).
//   - `Sim`:     a minute-by-minute discrete simulation, to check the equations
//                and to drive the animation.

export interface Params {
  buildings: number;    // B, buildings on the route
  flux: number;         // g, kg of garbage per building per day
  frontage: number;     // w, metres of curb per building
  share: number;        // s, containers per building (fractional = shared)
  containerKg: number;  // k, kg per container
  parkingPer: number;   // p, parking spaces displaced per container
  trucks: number;       // N, trucks sent out each pickup day
  pickups: number;      // f, pickups per week
  truckT: number;       // C, tonnes per truck load
  speed: number;        // v, km/h while driving the route
  liftSec: number;      // t_l, seconds to empty one container
  bagSec: number;       // t_b, seconds per 10 kg of loose bags
  dumpMin: number;      // t_d, minutes one way between the neighborhood's corner and the dump
  streetSpeed: number;  // u, km/h driving the street grid to and from the corner
  unloadMin: number;    // t_u, minutes to unload at the dump
  crew: number;         // c, workers per truck
  shiftH: number;       // H, shift length in hours
  wage: number;         // $ per worker-hour, loaded
  truckDay: number;     // $ per truck shift (capital + fuel + maintenance)
}

export interface Analysis {
  gaps: number[];          // Δ_i, days between consecutive pickups (sums to 7)
  daysBetween: number;     // Δ = ⌈7 / f⌉, the longest gap: it decides capacity and staffing
  perPickupT: number;      // G = B g Δ, tonnes waiting after the longest gap
  containers: number;      // n = s B
  binT: number;            // K = n k, tonnes of container capacity
  overflowT: number;       // O = max(0, G − K), tonnes left loose after the longest gap
  overflowFrac: number;    // share of the week bins are full: Σ Δ_i max(0, 1 − K/G_i) / 7
  parking: number;         // n p
  curbSpaces: number;      // B w / 6 m
  loadsPerTruck: number;   // ⌈G / (N C)⌉, each truck has 1/N of the route
  loads: number;           // L = N · loadsPerTruck
  driveH: number;          // (B w + turns) / v
  liftH: number;           // n t_l
  bagH: number;            // O t_b
  routeH: number;          // sweep time: drive + lift + bags
  meanGridM: number;       // d̄, mean grid (Manhattan) distance from a site to the corner
  roundTripH: number;      // R = 2 (t_d + d̄/u) + t_u
  dumpH: number;           // L R
  truckH: number;          // T = route + dump, truck-hours on the heaviest pickup
  perTruckH: number;       // T / N, must fit in a shift
  trucksNeeded: number;    // smallest N with per-truck time ≤ H
  enough: boolean;
  weeklyLoads: number;     // Σ_i N ⌈G_i / (N C)⌉
  weeklyRouteH: number;    // f · sweep   (grows with frequency)
  weeklyDumpH: number;     // weeklyLoads · R ≈ 7 B g / C · R   (does not)
  weeklyLaborH: number;    // f N c H, paid by the shift
  weeklyCost: number;
  costPerT: number;
}

const hours = (sec: number) => sec / 3600;
const ceil = (x: number) => Math.ceil(x - 1e-9);

export function analyze(P: Params): Analysis {
  const days = [...pickupDays(P.pickups)].sort((a, b) => a - b);
  const gaps = days.map((d, i) => (days[(i + 1) % days.length]! - d + 7) % 7 || 7);
  const daysBetween = Math.max(...gaps);
  const tonnes = (gap: number) => P.buildings * P.flux * gap / 1000;
  const perPickupT = tonnes(daysBetween);
  const { sites, perSite } = sitesFor(P);
  const containers = sites * perSite;
  const binT = containers * P.containerKg / 1000;
  const overflowT = Math.max(0, perPickupT - binT);
  const overflowFrac = gaps.reduce((a, g) => a + g * Math.max(0, 1 - binT / tonnes(g)), 0) / 7;

  const geo = geometry(P);
  const driveH = (P.buildings * P.frontage + (geo.rows - 1) * BLOCK_M) / (P.speed * 1000);
  const liftH = hours(containers * P.liftSec);
  const bagH = hours(overflowT * 100 * P.bagSec);
  const routeH = driveH + liftH + bagH;
  const meanGridM = geo.sites.reduce((a, p) => a + p.x + p.y, 0) / geo.sites.length;
  const roundTripH = (2 * (P.dumpMin + meanGridM / (P.streetSpeed * 1000 / 60)) + P.unloadMin) / 60;

  // With N trucks, each sweeps 1/N of the route and makes its own dump trips.
  const perTruck = (N: number, G: number) => routeH / N + ceil(G / (N * P.truckT)) * roundTripH;
  const N = Math.min(P.trucks, sites);
  const loadsPerTruck = Math.max(1, ceil(perPickupT / (N * P.truckT)));
  const loads = N * loadsPerTruck;
  const dumpH = loads * roundTripH;
  let trucksNeeded = 1;
  while (trucksNeeded < sites && perTruck(trucksNeeded, perPickupT) > P.shiftH) trucksNeeded++;
  const weeklyLoads = gaps.reduce((a, g) => a + N * Math.max(1, ceil(tonnes(g) / (N * P.truckT))), 0);

  const weeklyLaborH = P.pickups * P.trucks * P.crew * P.shiftH;
  const weeklyCost = weeklyLaborH * P.wage + P.pickups * P.trucks * P.truckDay;
  return {
    gaps, daysBetween, perPickupT, containers, binT, overflowT, overflowFrac,
    parking: containers * P.parkingPer, curbSpaces: P.buildings * P.frontage / 6,
    loadsPerTruck, loads, driveH, liftH, bagH, routeH, meanGridM, roundTripH, dumpH,
    truckH: routeH + dumpH, perTruckH: (routeH + dumpH) / N, trucksNeeded,
    enough: P.trucks >= trucksNeeded,
    weeklyLoads, weeklyRouteH: P.pickups * (driveH + liftH), weeklyDumpH: weeklyLoads * roundTripH,
    weeklyLaborH, weeklyCost, costPerT: weeklyCost / tonnes(7),
  };
}

// A "site" is one curbside spot holding one or more containers. When
// containers are shared (s < 1), several buildings feed one site.
export function sitesFor(P: Params): { sites: number; perSite: number } {
  return P.share >= 1
    ? { sites: P.buildings, perSite: Math.round(P.share) }
    : { sites: Math.max(1, Math.round(P.buildings * P.share)), perSite: 1 };
}

// ---------------------------------------------------------------- geometry

// The route snakes back and forth along parallel streets BLOCK_M apart,
// forming a roughly square neighborhood. The exit to the dump is the corner
// (0, 0); trucks reach it along the grid, so distance is x + y.
export const BLOCK_M = 80;

export interface Geometry {
  rows: number; rowLenM: number;
  sites: { x: number; y: number }[]; // metres
}

export function geometry(P: Params): Geometry {
  const { sites } = sitesFor(P);
  const routeM = P.buildings * P.frontage;
  const rows = Math.max(1, Math.round(Math.sqrt(routeM / BLOCK_M)));
  const rowLenM = routeM / rows;
  const gap = routeM / sites;
  return {
    rows, rowLenM,
    sites: Array.from({ length: sites }, (_, i) => {
      const along = (i + 0.5) * gap, r = Math.min(rows - 1, Math.floor(along / rowLenM));
      const off = along - r * rowLenM;
      return { x: r % 2 ? rowLenM - off : off, y: r * BLOCK_M };
    }),
  };
}

// ---------------------------------------------------------------- simulation

export interface Site { cap: number; containers: number; inBin: number; loose: number }

export type Place = number | "dump";
export type TruckState = "toRoute" | "collecting" | "toDump" | "unloading" | "fromDump" | "done";

export interface Truck {
  from: number; to: number; cursor: number; load: number;
  state: TruckState; final: boolean;
  start: number; end: number | null;
  // Animation: moving from `at` to `toward` over [actStart, busyUntil].
  at: Place; toward: Place; actStart: number; busyUntil: number;
}

export interface DayStats {
  generated: number; collected: number;
  looseKgMin: number; overflowSiteMin: number;
  missed: number; truckShifts: number; dumpTrips: number;
  laborH: number; overtimeH: number;
}

export const SHIFT_START = 6 * 60; // minutes after midnight

const blankDay = (): DayStats => ({
  generated: 0, collected: 0, looseKgMin: 0, overflowSiteMin: 0,
  missed: 0, truckShifts: 0, dumpTrips: 0, laborH: 0, overtimeH: 0,
});

export function pickupDays(f: number): Set<number> {
  const days = new Set<number>();
  for (let k = 0; k < f; k++) days.add(Math.floor(k * 7 / f));
  return days;
}

export class Sim {
  t = 0; // minutes since start (day 0 is a Monday)
  readonly sites: Site[];
  trucks: Truck[] = [];
  day: DayStats = blankDay();
  history: DayStats[] = [];
  private readonly siteFluxKgMin: number;
  readonly days: Set<number>;
  readonly geo: Geometry;

  constructor(readonly P: Params) {
    const { sites, perSite } = sitesFor(P);
    this.sites = Array.from({ length: sites }, () => ({
      containers: perSite, cap: perSite * P.containerKg, inBin: 0, loose: 0,
    }));
    this.siteFluxKgMin = P.buildings * P.flux / sites / 1440;
    this.days = pickupDays(P.pickups);
    this.geo = geometry(P);
  }

  // Minutes from a site to the dump: grid to the corner, then the haul.
  private toDumpMin(site: number): number {
    const p = this.geo.sites[Math.min(site, this.geo.sites.length - 1)]!;
    return this.P.dumpMin + (p.x + p.y) / (this.P.streetSpeed * 1000 / 60);
  }

  private startShift(): void {
    const n = this.sites.length, N = Math.min(this.P.trucks, n);
    for (let k = 0; k < N; k++) {
      const from = Math.floor(k * n / N), to = Math.floor((k + 1) * n / N);
      this.trucks.push({
        from, to, cursor: from, load: 0, state: "toRoute", final: false,
        start: this.t, end: null,
        at: "dump", toward: from, actStart: this.t, busyUntil: this.t + this.toDumpMin(from),
      });
    }
    this.day.truckShifts += N;
  }

  // Advance a truck through every action that finishes by now.
  private stepTruck(tr: Truck): void {
    const P = this.P, cap = P.truckT * 1000, shiftEnd = tr.start + P.shiftH * 60;
    const go = (toward: Place, dur: number, state: TruckState) => {
      tr.at = tr.toward; tr.toward = toward; tr.state = state;
      tr.actStart = tr.busyUntil; tr.busyUntil += dur;
    };
    while (tr.state !== "done" && tr.busyUntil <= this.t) {
      switch (tr.state) {
        case "toRoute":
        case "fromDump":
          tr.state = "collecting"; tr.at = tr.toward;
          break;
        case "collecting": {
          // Out of route, or out of time (leaving enough to dump and finish).
          if (tr.cursor >= tr.to || tr.busyUntil + this.toDumpMin(tr.cursor) + P.unloadMin >= shiftEnd) {
            this.day.missed += tr.to - tr.cursor;
            tr.final = true;
            go("dump", this.toDumpMin(Math.max(tr.from, tr.cursor - 1)), "toDump");
            break;
          }
          const s = this.sites[tr.cursor]!;
          let svc = 0;
          if (s.inBin + s.loose > 0) {
            let room = cap - tr.load;
            const fromBin = Math.min(s.inBin, room); room -= fromBin;
            const fromLoose = Math.min(s.loose, room);
            svc = (s.containers * P.liftSec + fromLoose / 10 * P.bagSec) / 60;
            s.inBin -= fromBin; s.loose -= fromLoose;
            tr.load += fromBin + fromLoose;
            this.day.collected += fromBin + fromLoose;
          }
          if (tr.load >= cap - 1e-6) {
            // Full: come back to this site afterwards if anything is left on it.
            const here = tr.cursor;
            if (s.inBin + s.loose <= 1e-6) tr.cursor++;
            tr.busyUntil += svc;
            go("dump", this.toDumpMin(here), "toDump");
          } else {
            tr.cursor++;
            tr.busyUntil += svc;
            const next = Math.min(tr.cursor, tr.to - 1);
            const a = this.geo.sites[tr.cursor - 1]!, b = this.geo.sites[next]!;
            const gapM = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
            go(next, tr.cursor < tr.to ? gapM / (P.speed * 1000 / 60) : 0, "collecting");
          }
          break;
        }
        case "toDump":
          go("dump", P.unloadMin, "unloading");
          break;
        case "unloading":
          tr.load = 0; this.day.dumpTrips++;
          if (tr.final) { tr.state = "done"; tr.end = tr.busyUntil; break; }
          go(Math.min(tr.cursor, tr.to - 1), this.toDumpMin(tr.cursor), "fromDump");
          break;
      }
    }
  }

  private finishTruck(tr: Truck): void {
    const P = this.P;
    const workedH = Math.max(P.shiftH, ((tr.end ?? this.t) - tr.start) / 60);
    this.day.laborH += P.crew * workedH;
    this.day.overtimeH += P.crew * (workedH - P.shiftH);
  }

  tick(): void {
    for (const s of this.sites) {
      const add = this.siteFluxKgMin, room = s.cap - s.inBin;
      if (add <= room) s.inBin += add;
      else { s.inBin = s.cap; s.loose += add - room; }
      this.day.generated += add;
      this.day.looseKgMin += s.loose;
      if (s.loose > 0) this.day.overflowSiteMin++;
    }
    if (this.t % 1440 === SHIFT_START && this.days.has(Math.floor(this.t / 1440) % 7)) this.startShift();
    for (const tr of this.trucks) {
      this.stepTruck(tr);
      if (tr.state === "done") this.finishTruck(tr);
    }
    this.trucks = this.trucks.filter(tr => tr.state !== "done");
    this.t++;
    if (this.t % 1440 === 0) {
      this.history.push(this.day);
      if (this.history.length > 7) this.history.shift();
      this.day = blankDay();
    }
  }
}
