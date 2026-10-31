// Darstellungsgeometrie des Deckenplans (Festlegung 31.10.2026): Türen und Fenster als Orientierung wie im Bauplan
// und Abstände eines Moduls zu den nächstgelegenen Wänden (auch für den späteren PDF-Platzierungsplan).
//
// Türen und Fenster sind KEINE Sperrflächen und beeinflussen weder Platzierung noch Regelprüfung.
// Koordinaten wie in platzierung.ts: Ursprung linke obere Raumecke, x entlang der Länge, y entlang der Breite, Meter.

import type { Rechteck, Wand } from './platzierung';

export type OeffnungArt = 'tuer' | 'fenster';

export interface TuerFenster {
  id: string;
  art: OeffnungArt;
  wand: Wand;
  /** Abstand vom Wandanfang bis zum Beginn der Öffnung; Wandanfang: oben/unten links (x = 0), links/rechts oben (y = 0) */
  position: number;
  breite: number;
  /** nur Tür: schlägt in den Raum (innen) oder nach außen auf */
  aufschlag?: 'innen' | 'aussen' | null;
  /** nur Tür: Seite der Bänder, vom Raum aus auf die Wand geschaut */
  band?: 'links' | 'rechts' | null;
}

export interface Punkt {
  x: number;
  y: number;
}

/** Vorgabebreite einer neuen Tür (Bedienkomfort, danach anpassbar) */
export const TUER_BREITE_M = 0.9;
/** Vorgabebreite eines neuen Fensters (Bedienkomfort, danach anpassbar) */
export const FENSTER_BREITE_M = 1.0;

export function wandLaenge(wand: Wand, L: number, B: number): number {
  return wand === 'oben' || wand === 'unten' ? L : B;
}

/** Einheitsvektor von der Wand in den Raum hinein */
export function nachInnen(wand: Wand): Punkt {
  return { oben: { x: 0, y: 1 }, unten: { x: 0, y: -1 }, links: { x: 1, y: 0 }, rechts: { x: -1, y: 0 } }[wand];
}

/** Punkt auf der Wandlinie im Abstand s vom Wandanfang */
export function wandPunkt(wand: Wand, s: number, L: number, B: number): Punkt {
  if (wand === 'oben') return { x: s, y: 0 };
  if (wand === 'unten') return { x: s, y: B };
  if (wand === 'links') return { x: 0, y: s };
  return { x: L, y: s };
}

/** Anfang und Ende der Öffnung auf der Wandlinie (Position und Breite auf die Wand begrenzt) */
export function oeffnungStrecke(o: Pick<TuerFenster, 'wand' | 'position' | 'breite'>, L: number, B: number): [Punkt, Punkt] {
  const laenge = wandLaenge(o.wand, L, B);
  const breite = Math.min(o.breite, laenge);
  const anfang = Math.min(Math.max(o.position, 0), laenge - breite);
  return [wandPunkt(o.wand, anfang, L, B), wandPunkt(o.wand, anfang + breite, L, B)];
}

export interface TuerGeometrie {
  /** Drehpunkt (Bänder) */
  band: Punkt;
  /** freies Ende des geöffneten Türblatts (90°) */
  blatt: Punkt;
  /** freies Ende der geschlossenen Tür auf der Wand (Ende des Viertelkreises) */
  zu: Punkt;
  /** SVG-Bogen von blatt nach zu: sweep-flag */
  sweep: 0 | 1;
}

/**
 * Türblatt und Viertelkreis wie im Bauplan. Band „links“/„rechts“ gilt vom Raum aus auf die Wand geschaut;
 * „aussen“ zeichnet das Türblatt auf der anderen Seite der Wand.
 */
export function tuerGeometrie(o: TuerFenster, L: number, B: number): TuerGeometrie {
  const [anfang, ende] = oeffnungStrecke(o, L, B);
  // Vom Raum aus gesehen liegt „links“ bei oben/rechts am Wandanfang, bei unten/links am Wandende
  const bandAmAnfang = o.wand === 'oben' || o.wand === 'rechts' ? (o.band ?? 'links') === 'links' : (o.band ?? 'links') === 'rechts';
  const band = bandAmAnfang ? anfang : ende;
  const zu = bandAmAnfang ? ende : anfang;
  const breite = Math.hypot(zu.x - band.x, zu.y - band.y);
  const n = nachInnen(o.wand);
  const richtung = (o.aufschlag ?? 'innen') === 'innen' ? 1 : -1;
  const blatt = { x: band.x + n.x * breite * richtung, y: band.y + n.y * breite * richtung };
  // Drehrichtung von blatt nach zu um band (y nach unten: positives Kreuzprodukt = im Uhrzeigersinn = sweep 1)
  const kreuz = (blatt.x - band.x) * (zu.y - band.y) - (blatt.y - band.y) * (zu.x - band.x);
  return { band, blatt, zu, sweep: kreuz > 0 ? 1 : 0 };
}

export interface Wandabstand {
  wand: Wand;
  /** lichter Abstand Modulkante – Wand in m */
  abstand: number;
  /** Bemaßungslinie von der Modulkante zur Wand */
  von: Punkt;
  bis: Punkt;
}

/**
 * Abstände eines Moduls zu den beiden nächstgelegenen Wänden – je eine in x- und in y-Richtung, damit das Modul
 * eindeutig eingemessen ist. Die Bemaßungslinie liegt auf Höhe der Modulmitte.
 */
export function wandAbstaende(a: Rechteck, L: number, B: number): [Wandabstand, Wandabstand] {
  const mx = a.x + a.b / 2;
  const my = a.y + a.t / 2;
  const links = a.x;
  const rechts = L - (a.x + a.b);
  const oben = a.y;
  const unten = B - (a.y + a.t);
  const x: Wandabstand =
    links <= rechts
      ? { wand: 'links', abstand: links, von: { x: a.x, y: my }, bis: { x: 0, y: my } }
      : { wand: 'rechts', abstand: rechts, von: { x: a.x + a.b, y: my }, bis: { x: L, y: my } };
  const y: Wandabstand =
    oben <= unten
      ? { wand: 'oben', abstand: oben, von: { x: mx, y: a.y }, bis: { x: mx, y: 0 } }
      : { wand: 'unten', abstand: unten, von: { x: mx, y: a.y + a.t }, bis: { x: mx, y: B } };
  return [x, y];
}

/** Nächstgelegene Wand zu einem Punkt im Raum und die Lage darauf (für „Wand antippen“) */
export function naechsteWand(p: Punkt, L: number, B: number): { wand: Wand; abstand: number; s: number } {
  const kandidaten: { wand: Wand; abstand: number; s: number }[] = [
    { wand: 'oben', abstand: Math.abs(p.y), s: p.x },
    { wand: 'unten', abstand: Math.abs(B - p.y), s: p.x },
    { wand: 'links', abstand: Math.abs(p.x), s: p.y },
    { wand: 'rechts', abstand: Math.abs(L - p.x), s: p.y },
  ];
  return kandidaten.reduce((a, b) => (b.abstand < a.abstand ? b : a));
}
