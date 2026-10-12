// Quelle A: pauschale Raumheizlast aus W/m² und Raumfläche.
//
//   Φ_A = q · A
//
// q = Pauschale in W/m², A = Raumfläche in m².
// Einen automatischen Höhenzuschlag gibt es bewusst nicht (Festlegung Auftraggeber 12.10.2026):
// Bei hohen Räumen erscheint nur ein Hinweis, die Pauschale bei Bedarf von Hand anzupassen (siehe objekt.ts).

import { RechenkernFehler } from './heizlast';

export interface PauschalEingabe {
  flaeche_m2: number;
  /** Pauschale q in W/m² */
  pauschale_w_m2: number;
}

export interface PauschalErgebnis {
  flaeche_m2: number;
  pauschale_w_m2: number;
  phi_w: number;
}

function zahl(wert: unknown, pfad: string, min?: number): number {
  if (typeof wert !== 'number' || !Number.isFinite(wert)) {
    throw new RechenkernFehler(pfad, 'muss eine endliche Zahl sein');
  }
  if (min !== undefined && wert < min) {
    throw new RechenkernFehler(pfad, `darf nicht kleiner als ${min} sein`);
  }
  return wert;
}

/** Fläche eines Rechteckraums in m² */
export function rechteckFlaeche(laengeM: number, breiteM: number): number {
  return zahl(laengeM, 'laenge_m', 0) * zahl(breiteM, 'breite_m', 0);
}

export function berechnePauschal(eingabe: PauschalEingabe, pfad = 'pauschal'): PauschalErgebnis {
  const flaeche = zahl(eingabe.flaeche_m2, `${pfad}.flaeche_m2`, 0);
  const q = zahl(eingabe.pauschale_w_m2, `${pfad}.pauschale_w_m2`, 0);
  return { flaeche_m2: flaeche, pauschale_w_m2: q, phi_w: q * flaeche };
}
