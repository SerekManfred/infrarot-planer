// Raumform-Vorlagen (Paket M2, 02.11.2026): vorbelegte Teile zum Hauptrechteck, danach frei anpassbar.
// Rein geometrische Startwerte für die Bedienung – keine Fachwerte.
import type { RaumTeil } from '@infrarot/rechenkern';

export type Vorlage = 'rechteck' | 'l' | 'u' | 'erker';

export const VORLAGEN: Record<Vorlage, string> = { rechteck: 'Rechteck', l: 'L-Form', u: 'U-Form', erker: 'Erker' };

const r = (v: number) => Math.round(v / 0.05) * 0.05;

/** Teile einer Vorlage für ein Hauptrechteck w × h (Länge × Breite) */
export function vorlageTeile(v: Vorlage, w: number, h: number): RaumTeil[] {
  if (v === 'l') return [{ op: 'sub', wand: 'oben', versatz: r(w / 2), laenge: r(w - r(w / 2)), tiefe: r(h / 2) }];
  if (v === 'u') return [{ op: 'sub', wand: 'oben', versatz: r(w / 3), laenge: r(w / 3), tiefe: r(h / 2) }];
  if (v === 'erker') {
    const laenge = r(Math.min(2, w / 2));
    return [{ op: 'add', wand: 'unten', versatz: r((w - laenge) / 2), laenge, tiefe: r(Math.min(0.8, h / 3)) }];
  }
  return [];
}

/** Neues Teil mit Startmaßen (mittig an der Wand) */
export function neuesTeil(op: RaumTeil['op'], w: number, h: number): RaumTeil {
  const laenge = r(Math.min(1.5, w / 2));
  return { op, wand: op === 'add' ? 'unten' : 'oben', versatz: r((w - laenge) / 2), laenge, tiefe: r(Math.min(1, h / 3)) };
}
