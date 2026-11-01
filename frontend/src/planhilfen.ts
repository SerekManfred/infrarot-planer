// Deckenplan: reine Geometrie- und Texthilfen ohne Browser-Abhängigkeit (testbar).
import type { Sperrflaeche, Wand } from '@infrarot/rechenkern';
import { zahl } from './texte';

/** kleinste Breite eines Streifens in m */
const MIN_GROESSE = 0.1;
const begrenzen = (w: number, min: number, max: number) => Math.min(Math.max(w, min), Math.max(min, max));

/**
 * Streifen (Dachschräge, Unterzug): parallel zu einer Wand, von Wand zu Wand durchgehend, im Abstand `abstand` von
 * dieser Wand und `breite` tief. Die Dachschräge liegt an der Wand (Abstand 0).
 */
export function streifenRechteck(wand: Wand, abstand: number, breite: number, L: number, B: number): Pick<Sperrflaeche, 'x' | 'y' | 'b' | 't'> {
  const quer = wand === 'oben' || wand === 'unten' ? B : L;
  const br = begrenzen(breite, MIN_GROESSE, quer);
  const ab = begrenzen(abstand, 0, quer - br);
  if (wand === 'oben') return { x: 0, y: ab, b: L, t: br };
  if (wand === 'unten') return { x: 0, y: B - ab - br, b: L, t: br };
  if (wand === 'links') return { x: ab, y: 0, b: br, t: B };
  return { x: L - ab - br, y: 0, b: br, t: B };
}

/** Lage eines Streifens: Abstand von seiner Wand und Breite */
export function streifenLage(s: Sperrflaeche, L: number, B: number): { abstand: number; breite: number } {
  const w = s.wand ?? 'oben';
  if (w === 'oben') return { abstand: s.y, breite: s.t };
  if (w === 'unten') return { abstand: B - s.y - s.t, breite: s.t };
  if (w === 'links') return { abstand: s.x, breite: s.b };
  return { abstand: L - s.x - s.b, breite: s.b };
}

/** Höhenangabe verständlich: „Höhe: 0,45 m (Standard für Sofa)“ bzw. „(angepasst)“ (Praxistest 01.11.2026) */
export function hoeheText(eigen: number | null | undefined, standard: number | null, name: string): string {
  if (eigen !== undefined && eigen !== null) return `Höhe: ${zahl(eigen)} m (angepasst)`;
  if (standard === null) return `Höhe: keine Angabe (Standard für ${name} fehlt)`;
  return `Höhe: ${zahl(standard)} m (Standard für ${name})`;
}

