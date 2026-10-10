// Raumweise Auswertung über alle Heizlastquellen.
//
// Je Raum wird gerechnet, was an Eingaben vorliegt:
//   A Pauschal        → berechnePauschal
//   B Hottgenroth     → übernommener Wert
//   C vereinfacht     → berechneRaum (Gegenprobe)
// Maßgeblich ist die Quelle, die für den Raum gewählt ist.
// Abweichung der Gegenprobe: (Φ_C − Φ_maßgeblich) / Φ_maßgeblich.
//
// Fehler in einem Raum brechen die Auswertung nicht ab, sondern stehen in `fehler` des Raums.

import { berechneRaum, RechenkernFehler } from './heizlast';
import { berechnePauschal, type PauschalEingabe, type PauschalErgebnis } from './pauschal';
import type { RaumEingabe, RaumErgebnis } from './typen';
import { RECHENKERN_VERSION } from './version';

export type Heizlastquelle = 'A' | 'B' | 'C';

export interface AuswertungRaumEingabe {
  id: string;
  bezeichnung: string;
  quelle: Heizlastquelle;
  /** null, wenn Vorgaben für A fehlen */
  pauschal?: PauschalEingabe | null;
  /** Raumheizlast aus Hottgenroth in W */
  hottgenroth_w?: number | null;
  /** null, wenn für C keine (vollständigen) Bauteildaten vorliegen */
  berechnung?: RaumEingabe | null;
}

export interface AuswertungEingabe {
  /** nur für Quelle C nötig */
  theta_e_c?: number | null;
  delta_u_wb_w_m2k?: number | null;
  raeume: AuswertungRaumEingabe[];
}

export interface AuswertungRaumErgebnis {
  id: string;
  bezeichnung: string;
  quelle: Heizlastquelle;
  phi_a_w: number | null;
  phi_b_w: number | null;
  phi_c_w: number | null;
  /** Raumheizlast der gewählten Quelle in W; null, wenn sie nicht ermittelt werden konnte */
  phi_massgeblich_w: number | null;
  /** (Φ_C − Φ_maßgeblich) / Φ_maßgeblich; null ohne Gegenprobe, bei Quelle C oder Φ_maßgeblich = 0 */
  abweichung_c: number | null;
  pauschal: PauschalErgebnis | null;
  berechnung: RaumErgebnis | null;
  fehler: string[];
}

export interface AuswertungErgebnis {
  rechenkern_version: string;
  raeume: AuswertungRaumErgebnis[];
  summe: {
    /** Summe der maßgeblichen Raumheizlasten aller Räume mit Ergebnis in W */
    phi_massgeblich_w: number;
    raeume_mit_ergebnis: number;
    raeume_ohne_ergebnis: number;
  };
}

/** Relative Abweichung der Gegenprobe; null, wenn die Bezugsgröße 0 ist */
export function abweichung(phiGegenprobeW: number, phiBezugW: number): number | null {
  return phiBezugW === 0 ? null : (phiGegenprobeW - phiBezugW) / phiBezugW;
}

function meldung(fehler: unknown): string {
  if (fehler instanceof RechenkernFehler) return fehler.message;
  throw fehler;
}

export function berechneAuswertung(eingabe: AuswertungEingabe): AuswertungErgebnis {
  if (!eingabe || !Array.isArray(eingabe.raeume)) {
    throw new RechenkernFehler('raeume', 'muss eine Liste sein');
  }
  const raeume = eingabe.raeume.map((raum, i): AuswertungRaumErgebnis => {
    const pfad = `raeume[${i}]`;
    if (!['A', 'B', 'C'].includes(raum.quelle)) {
      throw new RechenkernFehler(`${pfad}.quelle`, `unbekannte Heizlastquelle „${String(raum.quelle)}“`);
    }
    const fehler: string[] = [];

    let pauschal: PauschalErgebnis | null = null;
    if (raum.pauschal) {
      try {
        pauschal = berechnePauschal(raum.pauschal, `${pfad}.pauschal`);
      } catch (e) {
        fehler.push(meldung(e));
      }
    }

    let phiB: number | null = null;
    if (raum.hottgenroth_w !== null && raum.hottgenroth_w !== undefined) {
      if (typeof raum.hottgenroth_w === 'number' && Number.isFinite(raum.hottgenroth_w) && raum.hottgenroth_w >= 0) {
        phiB = raum.hottgenroth_w;
      } else {
        fehler.push(`${pfad}.hottgenroth_w: muss eine Zahl ≥ 0 sein`);
      }
    }

    let berechnung: RaumErgebnis | null = null;
    if (raum.berechnung) {
      try {
        const thetaE = eingabe.theta_e_c;
        const deltaUWb = eingabe.delta_u_wb_w_m2k;
        if (typeof thetaE !== 'number' || typeof deltaUWb !== 'number') {
          throw new RechenkernFehler(pfad, 'für Quelle C sind theta_e_c und delta_u_wb_w_m2k erforderlich');
        }
        berechnung = berechneRaum(raum.berechnung, thetaE, deltaUWb, `${pfad}.berechnung`);
      } catch (e) {
        fehler.push(meldung(e));
      }
    }

    const phiA = pauschal?.phi_w ?? null;
    const phiC = berechnung?.phi_hl_w ?? null;
    const phiMassgeblich = { A: phiA, B: phiB, C: phiC }[raum.quelle];
    const abweichungC =
      raum.quelle !== 'C' && phiC !== null && phiMassgeblich !== null ? abweichung(phiC, phiMassgeblich) : null;

    return {
      id: raum.id,
      bezeichnung: raum.bezeichnung,
      quelle: raum.quelle,
      phi_a_w: phiA,
      phi_b_w: phiB,
      phi_c_w: phiC,
      phi_massgeblich_w: phiMassgeblich,
      abweichung_c: abweichungC,
      pauschal,
      berechnung,
      fehler,
    };
  });

  const mitErgebnis = raeume.filter((r) => r.phi_massgeblich_w !== null);
  return {
    rechenkern_version: RECHENKERN_VERSION,
    raeume,
    summe: {
      phi_massgeblich_w: mitErgebnis.reduce((s, r) => s + (r.phi_massgeblich_w as number), 0),
      raeume_mit_ergebnis: mitErgebnis.length,
      raeume_ohne_ergebnis: raeume.length - mitErgebnis.length,
    },
  };
}
