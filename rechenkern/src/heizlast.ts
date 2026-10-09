// Raumweise Heizlast, vereinfachtes Verfahren nach dem Prinzip der DIN EN 12831-1.
//
//   Φ_HL,i = Φ_T,i + Φ_V,i
//   Φ_T,i  = H_T,i · (θint,i − θe),   H_T,i = Σ_k A_k · (U_k + ΔU_WB) · f_k
//   Φ_V,i  = H_V,i · (θint,i − θe),   H_V,i = 0,34 · n_i · V_i
//
// Die Funktionen rechnen ungerundet; Rundung ist Sache der Darstellung.
// Ausführliche Herleitung und Einheiten: rechenkern/README.md

import type {
  BauteilflaecheEingabe,
  ElementErgebnis,
  HeizlastEingabe,
  HeizlastErgebnis,
  RaumEingabe,
  RaumErgebnis,
} from './typen';
import { RECHENKERN_VERSION } from './version';

/** Volumenbezogene Wärmekapazität der Luft ρ·c_p in Wh/(m³·K) */
export const WAERMEKAPAZITAET_LUFT_WH_M3K = 0.34;

/** Toleranz für Rundungsfehler beim Abzug der Öffnungen von der Bruttofläche in m² */
const FLAECHEN_TOLERANZ_M2 = 1e-9;

export class RechenkernFehler extends Error {
  constructor(
    public readonly pfad: string,
    public readonly meldung: string,
  ) {
    super(`${pfad}: ${meldung}`);
    this.name = 'RechenkernFehler';
  }
}

function pruefeZahl(wert: unknown, pfad: string, min?: number): number {
  if (typeof wert !== 'number' || !Number.isFinite(wert)) {
    throw new RechenkernFehler(pfad, 'muss eine endliche Zahl sein');
  }
  if (min !== undefined && wert < min) {
    throw new RechenkernFehler(pfad, `darf nicht kleiner als ${min} sein`);
  }
  return wert;
}

function istGesetzt<T>(wert: T | null | undefined): wert is T {
  return wert !== null && wert !== undefined;
}

/**
 * Temperatur-Korrekturfaktor f einer Bauteilfläche.
 *
 * - f_korrektur angegeben → dieser Wert
 * - 'aussen' → f = 1
 * - 'beheizt' / 'unbeheizt' mit θ_angrenzend → f = (θint − θ_angrenzend) / (θint − θe)
 *   (negativ, wenn der Nachbarraum wärmer ist: Wärmegewinn)
 * - 'erdreich' ohne f_korrektur → Fehler (f muss nach Norm ermittelt und angegeben werden)
 */
export function temperaturKorrekturfaktor(
  flaeche: BauteilflaecheEingabe,
  thetaIntC: number,
  thetaEC: number,
  pfad = 'flaeche',
): number {
  if (istGesetzt(flaeche.f_korrektur)) {
    return pruefeZahl(flaeche.f_korrektur, `${pfad}.f_korrektur`);
  }
  switch (flaeche.angrenzung) {
    case 'aussen':
      return 1;
    case 'beheizt':
    case 'unbeheizt': {
      if (!istGesetzt(flaeche.theta_angrenzend_c)) {
        throw new RechenkernFehler(pfad, 'f_korrektur oder theta_angrenzend_c erforderlich');
      }
      const thetaU = pruefeZahl(flaeche.theta_angrenzend_c, `${pfad}.theta_angrenzend_c`);
      return (thetaIntC - thetaU) / (thetaIntC - thetaEC);
    }
    case 'erdreich':
      throw new RechenkernFehler(pfad, 'f_korrektur ist bei Angrenzung an Erdreich erforderlich');
    default:
      throw new RechenkernFehler(`${pfad}.angrenzung`, `unbekannter Wert „${String(flaeche.angrenzung)}“`);
  }
}

/** Heizlast eines Raums. */
export function berechneRaum(
  raum: RaumEingabe,
  thetaEC: number,
  deltaUWbGlobal: number,
  pfad = 'raum',
): RaumErgebnis {
  const thetaInt = pruefeZahl(raum.theta_int_c, `${pfad}.theta_int_c`);
  const n = pruefeZahl(raum.luftwechsel_1_h, `${pfad}.luftwechsel_1_h`, 0);
  const volumen = pruefeZahl(raum.volumen_m3, `${pfad}.volumen_m3`, 0);
  if (thetaInt <= thetaEC) {
    throw new RechenkernFehler(`${pfad}.theta_int_c`, 'muss größer als die Norm-Außentemperatur sein');
  }
  const deltaTheta = thetaInt - thetaEC;

  const elemente: ElementErgebnis[] = [];
  (raum.flaechen ?? []).forEach((flaeche, fi) => {
    const fPfad = `${pfad}.flaechen[${fi}]`;
    const aBrutto = pruefeZahl(flaeche.flaeche_brutto_m2, `${fPfad}.flaeche_brutto_m2`, 0);
    const u = pruefeZahl(flaeche.u_wert_w_m2k, `${fPfad}.u_wert_w_m2k`, 0);
    const deltaUWb = istGesetzt(flaeche.delta_u_wb_w_m2k)
      ? pruefeZahl(flaeche.delta_u_wb_w_m2k, `${fPfad}.delta_u_wb_w_m2k`, 0)
      : deltaUWbGlobal;
    const f = temperaturKorrekturfaktor(flaeche, thetaInt, thetaEC, fPfad);
    const name = flaeche.bezeichnung ?? `Fläche ${fi + 1}`;

    let aOeffnungen = 0;
    (flaeche.oeffnungen ?? []).forEach((oeffnung, oi) => {
      const oPfad = `${fPfad}.oeffnungen[${oi}]`;
      const aEinzeln = pruefeZahl(oeffnung.flaeche_m2, `${oPfad}.flaeche_m2`, 0);
      const anzahl = istGesetzt(oeffnung.anzahl) ? pruefeZahl(oeffnung.anzahl, `${oPfad}.anzahl`, 0) : 1;
      const uO = pruefeZahl(oeffnung.u_wert_w_m2k, `${oPfad}.u_wert_w_m2k`, 0);
      const a = aEinzeln * anzahl;
      aOeffnungen += a;
      elemente.push({
        bezeichnung: oeffnung.bezeichnung ?? `${name} – Öffnung ${oi + 1}`,
        art: 'oeffnung',
        flaeche_m2: a,
        u_wert_w_m2k: uO,
        delta_u_wb_w_m2k: deltaUWb,
        f_korrektur: f,
        h_t_w_k: a * (uO + deltaUWb) * f,
      });
    });

    const aNetto = aBrutto - aOeffnungen;
    if (aNetto < -FLAECHEN_TOLERANZ_M2) {
      throw new RechenkernFehler(fPfad, 'Öffnungen sind größer als die Bruttofläche');
    }
    const aNettoBereinigt = Math.max(0, aNetto);
    // Fläche vor ihren Öffnungen einsortieren, damit die Aufstellung lesbar bleibt
    elemente.splice(elemente.length - (flaeche.oeffnungen?.length ?? 0), 0, {
      bezeichnung: name,
      art: 'flaeche',
      flaeche_m2: aNettoBereinigt,
      u_wert_w_m2k: u,
      delta_u_wb_w_m2k: deltaUWb,
      f_korrektur: f,
      h_t_w_k: aNettoBereinigt * (u + deltaUWb) * f,
    });
  });

  const hT = elemente.reduce((summe, e) => summe + e.h_t_w_k, 0);
  const hV = WAERMEKAPAZITAET_LUFT_WH_M3K * n * volumen;
  const phiT = hT * deltaTheta;
  const phiV = hV * deltaTheta;

  return {
    id: raum.id,
    bezeichnung: raum.bezeichnung,
    theta_int_c: thetaInt,
    delta_theta_k: deltaTheta,
    h_t_w_k: hT,
    h_v_w_k: hV,
    phi_t_w: phiT,
    phi_v_w: phiV,
    phi_hl_w: phiT + phiV,
    elemente,
  };
}

/** Heizlast aller Räume eines Objekts. */
export function berechneHeizlast(eingabe: HeizlastEingabe): HeizlastErgebnis {
  const thetaE = pruefeZahl(eingabe.theta_e_c, 'theta_e_c');
  const deltaUWb = pruefeZahl(eingabe.delta_u_wb_w_m2k, 'delta_u_wb_w_m2k', 0);
  if (!Array.isArray(eingabe.raeume)) {
    throw new RechenkernFehler('raeume', 'muss eine Liste sein');
  }
  const raeume = eingabe.raeume.map((raum, i) => berechneRaum(raum, thetaE, deltaUWb, `raeume[${i}]`));
  const summe = raeume.reduce(
    (s, r) => ({ phi_t_w: s.phi_t_w + r.phi_t_w, phi_v_w: s.phi_v_w + r.phi_v_w, phi_hl_w: s.phi_hl_w + r.phi_hl_w }),
    { phi_t_w: 0, phi_v_w: 0, phi_hl_w: 0 },
  );
  return { rechenkern_version: RECHENKERN_VERSION, theta_e_c: thetaE, raeume, summe };
}
