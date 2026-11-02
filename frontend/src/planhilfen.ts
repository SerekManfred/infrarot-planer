// Deckenplan: reine Geometrie- und Texthilfen ohne Browser-Abhängigkeit (testbar).
import { enthaeltRechteck, type Raumform, type Sperrflaeche, type Wand } from '@infrarot/rechenkern';
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


// ── Objekte bearbeiten (Paket N1, 02.11.2026) ──

export type MassErgebnis = { ok: true; r: { x: number; y: number; b: number; t: number } } | { ok: false; meldung: string };

const mmRunden = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Neue Breite/Tiefe eines Objekts: Die Mitte bleibt; ragt das Objekt dann über die Raumgrenze, wird es minimal in den
 * Raum verschoben. Passt es nicht (größer als der Raum oder über einem Einsprung), kommt eine Meldung – nie still verwerfen.
 */
export function objektMasse(
  s: { x: number; y: number; b: number; t: number },
  b: number,
  t: number,
  form: Pick<Raumform, 'bbox'> & Parameters<typeof enthaeltRechteck>[0],
): MassErgebnis {
  if (!(b >= MIN_GROESSE) || !(t >= MIN_GROESSE)) return { ok: false, meldung: `Mindestens ${zahl(MIN_GROESSE)} m` };
  const { x0, y0, x1, y1 } = form.bbox;
  if (b > x1 - x0 + 1e-9) return { ok: false, meldung: `Breiter als der Raum (höchstens ${zahl(x1 - x0)} m)` };
  if (t > y1 - y0 + 1e-9) return { ok: false, meldung: `Tiefer als der Raum (höchstens ${zahl(y1 - y0)} m)` };
  const cx = s.x + s.b / 2;
  const cy = s.y + s.t / 2;
  const x = Math.min(Math.max(cx - b / 2, x0), x1 - b);
  const y = Math.min(Math.max(cy - t / 2, y0), y1 - t);
  const r = { x: mmRunden(x), y: mmRunden(y), b: mmRunden(b), t: mmRunden(t) };
  if (!enthaeltRechteck(form, r)) return { ok: false, meldung: 'Ragt aus dem Raum (Einsprung) – erst verschieben oder kleiner wählen' };
  return { ok: true, r };
}

/** Um 90° drehen: Breite und Tiefe tauschen, Mitte bleibt (bei Bedarf minimal in den Raum verschoben) */
export function objektDrehen(s: { x: number; y: number; b: number; t: number }, form: Parameters<typeof objektMasse>[3]): MassErgebnis {
  const e = objektMasse(s, s.t, s.b, form);
  return e.ok ? e : { ok: false, meldung: `Drehen nicht möglich: ${e.meldung}` };
}

// ── Beschriftung im Objekt (Paket N6, 02.11.2026) ──

/** ungefähre Zeichenbreite (fette Sans-Schrift) im Verhältnis zur Schriftgröße */
const ZEICHENBREITE = 0.6;

/**
 * Objektnamen in die Objektfläche einpassen: erst die Schrift bis zur Mindestgröße verkleinern, dann auf zwei Zeilen
 * umbrechen, dann mit „…“ kürzen. Nie breiter oder höher als die Fläche; passt nicht einmal eine Zeile, bleibt die
 * Beschriftung leer (voller Name im Tooltip und in der Bearbeitungsleiste).
 */
export function beschriftungEinpassen(text: string, breitePx: number, hoehePx: number, grund = 13, min = 9): { groesse: number; zeilen: string[] } {
  const passt = (t: string, g: number) => t.length * ZEICHENBREITE * g <= breitePx;
  for (let g = grund; g >= min; g--) {
    if (passt(text, g) && g * 1.15 <= hoehePx) return { groesse: g, zeilen: [text] };
  }
  const g = min;
  const zeile = g * 1.15;
  if (zeile > hoehePx) return { groesse: g, zeilen: [] };
  // zwei Zeilen: an der Wortgrenze, die die längere Zeile am kürzesten macht
  const woerter = text.split(/(?<=[\s-])/);
  if (woerter.length > 1 && 2 * zeile <= hoehePx) {
    let beste: [string, string] | null = null;
    for (let i = 1; i < woerter.length; i++) {
      const a = woerter.slice(0, i).join('').trim();
      const b = woerter.slice(i).join('').trim();
      if (passt(a, g) && passt(b, g) && (!beste || Math.max(a.length, b.length) < Math.max(beste[0].length, beste[1].length))) beste = [a, b];
    }
    if (beste) return { groesse: g, zeilen: beste };
  }
  const max = Math.floor(breitePx / (ZEICHENBREITE * g));
  if (max < 2) return { groesse: g, zeilen: [] };
  return { groesse: g, zeilen: [`${text.slice(0, max - 1).trimEnd()}…`] };
}

/** Quadrat beim Ziehen an einer Ecke: Seitenlänge = größere Ausdehnung, gegenüberliegende Ecke bleibt fest */
export function quadratAusEcke(
  s: { x: number; y: number; b: number; t: number },
  r: { x: number; y: number; b: number; t: number },
  ecke: 'nw' | 'ne' | 'sw' | 'se',
  bbox: { x0: number; y0: number; x1: number; y1: number },
): { x: number; y: number; b: number; t: number } {
  const fx = ecke === 'nw' || ecke === 'sw' ? s.x + s.b : s.x;
  const fy = ecke === 'nw' || ecke === 'ne' ? s.y + s.t : s.y;
  const links = ecke === 'nw' || ecke === 'sw';
  const oben = ecke === 'nw' || ecke === 'ne';
  const platz = Math.min(links ? fx - bbox.x0 : bbox.x1 - fx, oben ? fy - bbox.y0 : bbox.y1 - fy);
  const d = Math.max(MIN_GROESSE, Math.min(Math.max(r.b, r.t), platz));
  return { x: mmRunden(links ? fx - d : fx), y: mmRunden(oben ? fy - d : fy), b: mmRunden(d), t: mmRunden(d) };
}

/** Kreis: Durchmesser aus dem Abstand des Zeigers zur Mitte, Mitte bleibt, nie über die Umrandung */
export function kreisAusZeiger(
  s: { x: number; y: number; b: number; t: number },
  p: { x: number; y: number },
  bbox: { x0: number; y0: number; x1: number; y1: number },
): { x: number; y: number; b: number; t: number } {
  const cx = s.x + s.b / 2;
  const cy = s.y + s.t / 2;
  const platz = 2 * Math.min(cx - bbox.x0, bbox.x1 - cx, cy - bbox.y0, bbox.y1 - cy);
  const d = Math.max(MIN_GROESSE, Math.min(2 * Math.max(Math.abs(p.x - cx), Math.abs(p.y - cy)), platz));
  const dg = Math.round(d / 0.05) * 0.05 || MIN_GROESSE;
  return { x: mmRunden(cx - dg / 2), y: mmRunden(cy - dg / 2), b: mmRunden(dg), t: mmRunden(dg) };
}
