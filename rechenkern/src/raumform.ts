// Raumformen aus Rechtecken (Festlegung Auftraggeber 02.11.2026, Paket M2): Raum = Hauptrechteck (Länge × Breite)
// plus Anbauten (add) bzw. minus Ausschnitte (sub), jeweils an einer Wand des Hauptrechtecks angesetzt.
//
// Koordinaten wie im Deckenplan: Ursprung linke obere Ecke des Hauptrechtecks, x entlang der Länge, y entlang der
// Breite, Meter. Anbauten an der oberen bzw. linken Wand liegen bei negativen Koordinaten – so verschieben sich
// vorhandene Objekte und Module nie, wenn ein Teil hinzukommt.
//
// Rechnung: Alle Rechteckkanten spannen ein Raster auf; je Rasterzelle wird in der Reihenfolge der Teile entschieden,
// ob sie zum Raum gehört (Hauptrechteck, dann je Teil vereinigen bzw. abziehen). Daraus ergeben sich Fläche, Umfang,
// Wandsegmente, Umriss und die Prüfungen „liegt im Raum“ und „Abstand zur nächsten Wand“ (euklidisch, damit auch
// Innenecken richtig zählen). Freie Polygone und Dachschrägen-Geometrie sind nicht Teil davon.

import type { Rechteck, Wand } from './platzierung';

export interface RaumTeil {
  op: 'add' | 'sub';
  /** Wand des Hauptrechtecks, an der das Teil ansetzt */
  wand: Wand;
  /** Abstand vom Wandanfang (oben/unten: von links, links/rechts: von oben) */
  versatz: number;
  /** Ausdehnung entlang der Wand */
  laenge: number;
  /** Ausdehnung quer zur Wand (Anbau nach außen, Ausschnitt nach innen) */
  tiefe: number;
}

export interface RaumGeometrie {
  basis: { w: number; h: number };
  teile: RaumTeil[];
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Richtung in den Raum hinein */
  innen: { x: number; y: number };
  laenge: number;
}

export interface Raumform {
  /** Rasterkanten und Belegung (innen[i][j]: Zelle zwischen xs[i]..xs[i+1] und ys[j]..ys[j+1]) */
  xs: number[];
  ys: number[];
  innen: boolean[][];
  flaeche_m2: number;
  umfang_m: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** Wandsegmente (zusammengefasst, je mit Richtung in den Raum) */
  segmente: Segment[];
  /** Umriss als geschlossene Linienzüge (Eckpunkte) */
  umriss: { x: number; y: number }[][];
  /** true: nur das Hauptrechteck ohne Teile */
  rechteck: boolean;
}

const EPS = 1e-6;

/** Rechteck eines Teils in Raumkoordinaten */
export function teilRechteck(t: RaumTeil, w: number, h: number): Rechteck {
  const add = t.op === 'add';
  if (t.wand === 'oben') return { x: t.versatz, y: add ? -t.tiefe : 0, b: t.laenge, t: t.tiefe };
  if (t.wand === 'unten') return { x: t.versatz, y: add ? h : h - t.tiefe, b: t.laenge, t: t.tiefe };
  if (t.wand === 'links') return { x: add ? -t.tiefe : 0, y: t.versatz, b: t.tiefe, t: t.laenge };
  return { x: add ? w : w - t.tiefe, y: t.versatz, b: t.tiefe, t: t.laenge };
}

function runden(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function eindeutig(werte: number[]): number[] {
  const s = [...werte].map(runden).sort((a, b) => a - b);
  return s.filter((v, i) => i === 0 || v - s[i - 1] > EPS);
}

/** Form aus der Geometrie; ohne Teile das einfache Rechteck */
export function raumform(g: RaumGeometrie): Raumform {
  const { w, h } = g.basis;
  const teile = g.teile.filter((t) => t.laenge > EPS && t.tiefe > EPS);
  const rechtecke = teile.map((t) => ({ op: t.op, r: teilRechteck(t, w, h) }));
  const xs = eindeutig([0, w, ...rechtecke.flatMap(({ r }) => [r.x, r.x + r.b])]);
  const ys = eindeutig([0, h, ...rechtecke.flatMap(({ r }) => [r.y, r.y + r.t])]);
  const innen: boolean[][] = [];
  let flaeche = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    innen.push([]);
    for (let j = 0; j < ys.length - 1; j++) {
      const mx = (xs[i] + xs[i + 1]) / 2;
      const my = (ys[j] + ys[j + 1]) / 2;
      const im = (r: Rechteck) => mx > r.x && mx < r.x + r.b && my > r.y && my < r.y + r.t;
      let drin = im({ x: 0, y: 0, b: w, t: h });
      for (const { op, r } of rechtecke) if (im(r)) drin = op === 'add';
      innen[i].push(drin);
      if (drin) flaeche += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
    }
  }
  const belegt = (i: number, j: number) => i >= 0 && j >= 0 && i < xs.length - 1 && j < ys.length - 1 && innen[i][j];

  // Randkanten gerichtet (Raum rechts der Laufrichtung, y nach unten): oben → nach rechts, rechts → nach unten …
  type Kante = { a: [number, number]; b: [number, number] };
  const kanten: Kante[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (!innen[i][j]) continue;
      if (!belegt(i, j - 1)) kanten.push({ a: [i, j], b: [i + 1, j] });
      if (!belegt(i + 1, j)) kanten.push({ a: [i + 1, j], b: [i + 1, j + 1] });
      if (!belegt(i, j + 1)) kanten.push({ a: [i + 1, j + 1], b: [i, j + 1] });
      if (!belegt(i - 1, j)) kanten.push({ a: [i, j + 1], b: [i, j] });
    }
  }
  // zu Linienzügen verketten, gerade Stücke zusammenfassen
  const schluessel = (p: [number, number]) => `${p[0]},${p[1]}`;
  const ab = new Map<string, Kante[]>();
  for (const k of kanten) ab.set(schluessel(k.a), [...(ab.get(schluessel(k.a)) ?? []), k]);
  const benutzt = new Set<Kante>();
  const umriss: { x: number; y: number }[][] = [];
  for (const start of kanten) {
    if (benutzt.has(start)) continue;
    const punkte: [number, number][] = [];
    let k: Kante | undefined = start;
    while (k && !benutzt.has(k)) {
      benutzt.add(k);
      punkte.push(k.a);
      const weiter: Kante[] = (ab.get(schluessel(k.b)) ?? []).filter((x) => !benutzt.has(x));
      k = weiter[0];
    }
    // Ecken: nur Punkte mit Richtungswechsel
    const ecken = punkte.filter((p, n) => {
      const v = punkte[(n - 1 + punkte.length) % punkte.length];
      const z = punkte[(n + 1) % punkte.length];
      return !((v[0] === p[0] && p[0] === z[0]) || (v[1] === p[1] && p[1] === z[1]));
    });
    umriss.push(ecken.map(([i, j]) => ({ x: xs[i], y: ys[j] })));
  }
  const segmente: Segment[] = [];
  for (const ring of umriss) {
    ring.forEach((p, n) => {
      const q = ring[(n + 1) % ring.length];
      const dx = Math.sign(q.x - p.x);
      const dy = Math.sign(q.y - p.y);
      // Raum liegt rechts der Laufrichtung (Bildschirmkoordinaten): Normale = (−dy, dx)
      segmente.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, innen: { x: -dy, y: dx }, laenge: Math.hypot(q.x - p.x, q.y - p.y) });
    });
  }
  const bbox = {
    x0: Math.min(...umriss.flat().map((p) => p.x)),
    y0: Math.min(...umriss.flat().map((p) => p.y)),
    x1: Math.max(...umriss.flat().map((p) => p.x)),
    y1: Math.max(...umriss.flat().map((p) => p.y)),
  };
  return {
    xs, ys, innen, flaeche_m2: runden(flaeche), umfang_m: runden(segmente.reduce((s, x) => s + x.laenge, 0)), bbox, segmente, umriss,
    rechteck: rechtecke.length === 0,
  };
}

export function rechteckForm(L: number, B: number): Raumform {
  return raumform({ basis: { w: L, h: B }, teile: [] });
}

/** Form eines Raums: aus der Geometrie, sonst aus Länge × Breite; null ohne Maße */
export function formVonRaum(r: { laenge_m: number | null; breite_m: number | null; geometrie?: RaumGeometrie | null }): Raumform | null {
  if (!r.laenge_m || !r.breite_m || r.laenge_m <= 0 || r.breite_m <= 0) return null;
  return raumform({ basis: { w: r.laenge_m, h: r.breite_m }, teile: r.geometrie?.teile ?? [] });
}

/** Liegt das Rechteck vollständig im Raum? (Punkt: im Raum oder auf dem Rand) */
export function enthaeltRechteck(f: Raumform, r: Rechteck): boolean {
  if (r.x < f.bbox.x0 - EPS || r.y < f.bbox.y0 - EPS || r.x + r.b > f.bbox.x1 + EPS || r.y + r.t > f.bbox.y1 + EPS) return false;
  for (let i = 0; i < f.xs.length - 1; i++) {
    if (f.xs[i + 1] <= r.x + EPS || f.xs[i] >= r.x + r.b - EPS) continue;
    for (let j = 0; j < f.ys.length - 1; j++) {
      if (f.ys[j + 1] <= r.y + EPS || f.ys[j] >= r.y + r.t - EPS) continue;
      if (!f.innen[i][j]) return false;
    }
  }
  if (r.b <= EPS && r.t <= EPS) return punktImRaum(f, r.x, r.y);
  return true;
}

export function punktImRaum(f: Raumform, x: number, y: number): boolean {
  for (let i = 0; i < f.xs.length - 1; i++) {
    if (x < f.xs[i] - EPS || x > f.xs[i + 1] + EPS) continue;
    for (let j = 0; j < f.ys.length - 1; j++) {
      if (y < f.ys[j] - EPS || y > f.ys[j + 1] + EPS) continue;
      if (f.innen[i][j]) return true;
    }
  }
  return false;
}

/** Kürzeste Entfernung eines Rechtecks zu einer Wand (euklidisch; an Innenecken zählt die Ecke) */
export function wandAbstand(f: Raumform, r: Rechteck): number {
  let min = Infinity;
  for (const s of f.segmente) {
    const sx0 = Math.min(s.x1, s.x2);
    const sx1 = Math.max(s.x1, s.x2);
    const sy0 = Math.min(s.y1, s.y2);
    const sy1 = Math.max(s.y1, s.y2);
    const dx = Math.max(0, sx0 - (r.x + r.b), r.x - sx1);
    const dy = Math.max(0, sy0 - (r.y + r.t), r.y - sy1);
    min = Math.min(min, Math.hypot(dx, dy));
  }
  return min;
}
