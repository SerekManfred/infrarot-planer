// Wärmeverteilung im Deckenplan (Festlegung Auftraggeber 01.11.2026) – vereinfachte Veranschaulichung der
// Strahlungsverteilung, KEINE Behaglichkeitsberechnung nach Norm.
//
// Modell:
// - Jedes Modul ist ein ebener, nach unten abstrahlender Rechteckstrahler an der Decke (Raumhöhe H), diffus (Lambert).
// - Spezifische Ausstrahlung (Strahlungsdichte) M = ε · σ · (T_Oberfläche⁴ − T_Raum⁴) in W/m² (Stefan-Boltzmann).
// - Bestrahlungsstärke an einem Punkt einer horizontalen Empfangsfläche (Höhe z, Normale nach oben):
//   E = M · F, mit F = Sichtfaktor vom differentiellen Flächenelement zum parallelen Rechteck (exakte Formel für die
//   Ecke, beliebige Lage durch Überlagerung der vier Eckrechtecke).
// - Abstrahlwinkel: Teile des Moduls, die vom Punkt aus gesehen außerhalb des halben Abstrahlwinkels um die
//   Modulnormale liegen, strahlen den Punkt nicht an. Dafür wird das Modul in Teilflächen zerlegt; jede Teilfläche
//   wird mit der exakten Formel gerechnet und zählt, wenn ihr Mittelpunkt im Kegel liegt. Ab 180° keine Begrenzung.
// - Summe über alle Module. Keine Reflexionen, keine Abschattung, keine Konvektion.
// Koordinaten wie im Deckenplan: x entlang der Länge, y entlang der Breite, Meter; z von Fußboden nach oben.

import { istPunkt, modulRechteck, objektSchluessel, type PlatziertesModul, type Sperrflaeche } from './platzierung';

/** Stefan-Boltzmann-Konstante in W/(m²·K⁴) */
export const SIGMA = 5.670374419e-8;
/** Teilflächen je Modulseite für die Begrenzung durch den Abstrahlwinkel */
const TEILUNG = 8;

/**
 * Sichtfaktor vom Flächenelement zu einem parallelen Rechteck a × b im Abstand c, dessen Ecke senkrecht über dem
 * Element liegt: F = 1/(2π) · [X/√(1+X²) · atan(Y/√(1+X²)) + Y/√(1+Y²) · atan(X/√(1+Y²))], X = a/c, Y = b/c.
 */
export function sichtfaktorEcke(a: number, b: number, c: number): number {
  if (a <= 0 || b <= 0 || c <= 0) return 0;
  const X = a / c;
  const Y = b / c;
  const wx = Math.sqrt(1 + X * X);
  const wy = Math.sqrt(1 + Y * Y);
  return ((X / wx) * Math.atan(Y / wx) + (Y / wy) * Math.atan(X / wy)) / (2 * Math.PI);
}

function eckeVorzeichen(dx: number, dy: number, c: number): number {
  return Math.sign(dx) * Math.sign(dy) * sichtfaktorEcke(Math.abs(dx), Math.abs(dy), c);
}

/** Sichtfaktor vom Flächenelement bei (px, py) zum parallelen Rechteck [x0, x1] × [y0, y1] im Abstand c (Überlagerung) */
export function sichtfaktorRechteck(px: number, py: number, x0: number, y0: number, x1: number, y1: number, c: number): number {
  if (c <= 0) return 0;
  return (
    eckeVorzeichen(x1 - px, y1 - py, c) - eckeVorzeichen(x0 - px, y1 - py, c) - eckeVorzeichen(x1 - px, y0 - py, c) + eckeVorzeichen(x0 - px, y0 - py, c)
  );
}

/** Spezifische Ausstrahlung M = ε·σ·(Ts⁴ − Tr⁴) in W/m²; nie negativ (ein kälteres Modul heizt nicht) */
export function strahlungsdichte(oberflaecheC: number, raumC: number, emissionsgrad: number): number {
  const ts = oberflaecheC + 273.15;
  const tr = raumC + 273.15;
  return Math.max(0, emissionsgrad * SIGMA * (ts ** 4 - tr ** 4));
}

export interface Strahler {
  /** Rechteck an der Decke */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** spezifische Ausstrahlung in W/m² */
  m: number;
  /** voller Abstrahlwinkel in Grad (≥ 180 = keine Begrenzung) */
  winkel_grad: number;
}

/** Bestrahlungsstärke in W/m² an einem Punkt einer horizontalen Fläche im Abstand c unter der Decke */
export function bestrahlung(px: number, py: number, c: number, strahler: Strahler[]): number {
  if (c <= 0) return 0;
  let summe = 0;
  for (const s of strahler) {
    if (s.winkel_grad >= 180) {
      summe += s.m * sichtfaktorRechteck(px, py, s.x0, s.y0, s.x1, s.y1, c);
      continue;
    }
    // Kegel: Teilfläche zählt, wenn ihr Mittelpunkt höchstens c·tan(Winkel/2) waagerecht entfernt ist
    const r = c * Math.tan(((s.winkel_grad / 2) * Math.PI) / 180);
    const dx = (s.x1 - s.x0) / TEILUNG;
    const dy = (s.y1 - s.y0) / TEILUNG;
    for (let i = 0; i < TEILUNG; i++) {
      for (let j = 0; j < TEILUNG; j++) {
        const ax = s.x0 + i * dx;
        const ay = s.y0 + j * dy;
        if (Math.hypot(ax + dx / 2 - px, ay + dy / 2 - py) > r) continue;
        summe += s.m * sichtfaktorRechteck(px, py, ax, ay, ax + dx, ay + dy, c);
      }
    }
  }
  return summe;
}

/** Strahler-Kennwerte eines Moduls; null-Werte des Katalogs werden durch die Vorgaben ersetzt */
export interface StrahlerWerte {
  temperatur_c: number | null;
  emissionsgrad: number | null;
  abstrahlwinkel_grad: number | null;
}

export interface WaermeZelle {
  x: number;
  y: number;
  b: number;
  t: number;
  /** Bestrahlungsstärke in W/m² */
  wert: number;
  /** Empfangsfläche: Fußboden oder Oberseite einer Sperrfläche (Möbel) */
  flaeche: 'boden' | 'moebel';
  /** Höhe der Empfangsfläche in m */
  z: number;
}

export interface Waermeverteilung {
  zellen: WaermeZelle[];
  max_w_m2: number;
  min_w_m2: number;
  /** Mittelwert über alle Rasterzellen (gleich große Zellen = flächengewichtet) */
  mittel_w_m2: number;
  /** mindestens ein Kennwert kam aus den Vorgabewerten statt aus dem Modulkatalog */
  mit_vorgabewerten: boolean;
  /** Was fehlt, damit gerechnet werden kann (dann keine Zellen) */
  fehlt: string[];
}

export interface WaermeEingabe {
  laenge_m: number;
  breite_m: number;
  hoehe_m: number | null;
  raumtemperatur_c: number | null;
  module: PlatziertesModul[];
  /** Kennwerte je Modul-ID aus dem Katalog (fehlende Module: alles null) */
  kennwerte: Map<number, StrahlerWerte>;
  vorgaben: StrahlerWerte;
  sperrflaechen: Sperrflaeche[];
  /** Standardhöhe der Oberseite je Objektschlüssel (Objektbibliothek), wenn am Objekt keine eigene steht */
  sperrhoehe: Record<string, number | null>;
  /** Kantenlänge der Rasterzellen in m */
  raster_m?: number;
}

/**
 * Höhe der Oberseite eines Objekts: eigene Angabe, sonst Standardhöhe aus der Objektbibliothek. Punkte (Deckeneinbauten)
 * und Streifen (Dachschräge, Unterzug) sind keine Empfangsflächen; ohne Höhe in der Bibliothek ebenfalls keine.
 */
export function sperrHoehe(s: Sperrflaeche, vorgabe: WaermeEingabe['sperrhoehe']): number | null {
  if (istPunkt(s) || s.wand) return null;
  return s.hoehe ?? vorgabe[objektSchluessel(s)] ?? null;
}

/**
 * Raster der Bestrahlungsstärke über den Raum. Empfangsfläche je Zelle: Oberseite der höchsten Sperrfläche über dem
 * Zellmittelpunkt (unter Möbeln wird der Boden nicht dargestellt), sonst der Fußboden.
 */
export function waermeverteilung(e: WaermeEingabe): Waermeverteilung {
  const fehlt: string[] = [];
  if (!e.hoehe_m || e.hoehe_m <= 0) fehlt.push('Eingabe fehlt: Raumhöhe');
  if (e.raumtemperatur_c === null) fehlt.push('Vorgabe fehlt: Raumtemperatur des Raumtyps');
  let mitVorgabe = false;
  const strahler: Strahler[] = [];
  for (const m of e.module) {
    const k = (m.modul_id !== null && e.kennwerte.get(m.modul_id)) || { temperatur_c: null, emissionsgrad: null, abstrahlwinkel_grad: null };
    const wert = (feld: keyof StrahlerWerte, name: string) => {
      if (k[feld] !== null) return k[feld];
      if (e.vorgaben[feld] !== null) {
        mitVorgabe = true;
        return e.vorgaben[feld];
      }
      const text = `Vorgabe fehlt: ${name} (weder im Modulkatalog noch als Vorgabewert)`;
      if (!fehlt.includes(text)) fehlt.push(text);
      return null;
    };
    const t = wert('temperatur_c', 'Oberflächentemperatur');
    const eps = wert('emissionsgrad', 'Emissionsgrad');
    const w = wert('abstrahlwinkel_grad', 'Abstrahlwinkel');
    if (t === null || eps === null || w === null || e.raumtemperatur_c === null) continue;
    const r = modulRechteck(m);
    strahler.push({ x0: r.x, y0: r.y, x1: r.x + r.b, y1: r.y + r.t, m: strahlungsdichte(t, e.raumtemperatur_c, eps), winkel_grad: w });
  }
  if (fehlt.length > 0 || !e.hoehe_m) return { zellen: [], max_w_m2: 0, min_w_m2: 0, mittel_w_m2: 0, mit_vorgabewerten: mitVorgabe, fehlt };

  const raster = e.raster_m ?? 0.1;
  const nx = Math.max(1, Math.round(e.laenge_m / raster));
  const ny = Math.max(1, Math.round(e.breite_m / raster));
  const bx = e.laenge_m / nx;
  const by = e.breite_m / ny;
  const moebel = e.sperrflaechen
    .map((s) => ({ s, z: sperrHoehe(s, e.sperrhoehe) }))
    .filter((x): x is { s: Sperrflaeche; z: number } => x.z !== null && x.s.b > 0 && x.s.t > 0);
  const zellen: WaermeZelle[] = [];
  let max = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const px = (i + 0.5) * bx;
      const py = (j + 0.5) * by;
      let z = 0;
      let flaeche: WaermeZelle['flaeche'] = 'boden';
      for (const { s, z: hz } of moebel) {
        if (px < s.x || px > s.x + s.b || py < s.y || py > s.y + s.t) continue;
        // höchste Oberseite zählt; auch eine Fläche auf Bodenhöhe (z. B. Dusche) ist eine eigene Empfangsfläche
        if (flaeche === 'boden' || hz > z) {
          z = Math.max(z, hz);
          flaeche = 'moebel';
        }
      }
      const wert = bestrahlung(px, py, e.hoehe_m - z, strahler);
      if (wert > max) max = wert;
      zellen.push({ x: i * bx, y: j * by, b: bx, t: by, wert, flaeche, z });
    }
  }
  const min = zellen.reduce((m, z) => Math.min(m, z.wert), Infinity);
  const mittel = zellen.reduce((s, z) => s + z.wert, 0) / zellen.length;
  return { zellen, max_w_m2: max, min_w_m2: min, mittel_w_m2: mittel, mit_vorgabewerten: mitVorgabe, fehlt: [] };
}
