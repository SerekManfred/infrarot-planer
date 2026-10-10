// Quelle A: pauschale Raumheizlast aus W/m² und Raumfläche, optional mit Höhenzuschlag.
//
//   Φ_A = q · A · (1 + z_H)
//   z_H = p/100 · (h − h_G)   für h > h_G, sonst 0
//
// q = Pauschale in W/m², A = Raumfläche in m², h = Raumhöhe in m,
// h_G = Grenzhöhe in m, p = Zuschlag in % je Meter Mehrhöhe.

import { RechenkernFehler } from './heizlast';

export interface HoehenzuschlagEingabe {
  /** Grenzhöhe h_G in m, ab der der Zuschlag greift */
  grenzhoehe_m: number;
  /** Zuschlag p in % je Meter über der Grenzhöhe */
  prozent_je_m: number;
}

export interface PauschalEingabe {
  flaeche_m2: number;
  /** Pauschale q in W/m² */
  pauschale_w_m2: number;
  /** Raumhöhe h in m; nur für den Höhenzuschlag nötig */
  hoehe_m?: number | null;
  /** fehlt oder null → kein Höhenzuschlag */
  hoehenzuschlag?: HoehenzuschlagEingabe | null;
}

export interface PauschalErgebnis {
  flaeche_m2: number;
  pauschale_w_m2: number;
  /** z_H (dimensionslos, 0,1 = 10 %) */
  hoehenzuschlag_faktor: number;
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

/** Höhenzuschlag z_H; 0, wenn die Raumhöhe die Grenzhöhe nicht überschreitet */
export function hoehenzuschlagFaktor(hoeheM: number, zuschlag: HoehenzuschlagEingabe, pfad = 'hoehenzuschlag'): number {
  const h = zahl(hoeheM, 'hoehe_m', 0);
  const grenze = zahl(zuschlag.grenzhoehe_m, `${pfad}.grenzhoehe_m`, 0);
  const prozent = zahl(zuschlag.prozent_je_m, `${pfad}.prozent_je_m`, 0);
  return h > grenze ? (prozent / 100) * (h - grenze) : 0;
}

export function berechnePauschal(eingabe: PauschalEingabe, pfad = 'pauschal'): PauschalErgebnis {
  const flaeche = zahl(eingabe.flaeche_m2, `${pfad}.flaeche_m2`, 0);
  const q = zahl(eingabe.pauschale_w_m2, `${pfad}.pauschale_w_m2`, 0);
  let zH = 0;
  if (eingabe.hoehenzuschlag) {
    if (eingabe.hoehe_m === null || eingabe.hoehe_m === undefined) {
      throw new RechenkernFehler(`${pfad}.hoehe_m`, 'für den Höhenzuschlag erforderlich');
    }
    zH = hoehenzuschlagFaktor(eingabe.hoehe_m, eingabe.hoehenzuschlag, `${pfad}.hoehenzuschlag`);
  }
  return { flaeche_m2: flaeche, pauschale_w_m2: q, hoehenzuschlag_faktor: zH, phi_w: q * flaeche * (1 + zH) };
}
