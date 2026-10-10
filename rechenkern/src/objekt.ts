// Auswertung eines Objekts (Gebäudes) aus dem vollständigen Planungsstand.
//
// Löst je Raum die Fachvorgaben auf – mit Herkunft jedes Werts – und rechnet dann über berechneAuswertung.
// Server (Backend über die CLI) und Browser (offline) nutzen diese eine Funktion, damit beide gleich rechnen.
// Fehlende Werte werden nie geschätzt, sondern als „Vorgabe fehlt“ bzw. „Eingabe fehlt“ gemeldet.
//
// Herkunft eines Werts: raum → projekt → vorgabe → rueckfall; theta_e aus den Klimadaten; sonst „fehlt“.

import { berechneAuswertung, type AuswertungEingabe, type AuswertungRaumEingabe, type AuswertungRaumErgebnis, type Heizlastquelle } from './auswertung';
import type { PauschalEingabe } from './pauschal';
import type { Angrenzung, BauteilflaecheEingabe, OeffnungEingabe, RaumEingabe } from './typen';

export type Gebaeudestandard = 'neubau' | 'effizienzhaus_sanierung' | 'sonstiger_bestand';
export type Herkunft = 'raum' | 'projekt' | 'vorgabe' | 'rueckfall' | 'klimadaten' | 'fehlt';

export interface Wert {
  wert: number | null;
  herkunft: Herkunft;
}

export const HINWEIS_SONSTIGER_BESTAND = 'Infrarot als alleiniges Heizsystem wird für diesen Gebäudestandard nicht empfohlen.';

export interface PlanungOeffnung {
  id: number;
  bezeichnung: string;
  bauteil_id: number | null;
  u_wert: number | null;
  flaeche_m2: number;
  anzahl: number;
}

export interface PlanungFlaeche {
  id: number;
  bezeichnung: string;
  bauteil_id: number | null;
  u_wert: number | null;
  flaeche_brutto_m2: number;
  angrenzung: Angrenzung;
  angrenzender_raumtyp_id: number | null;
  theta_angrenzend: number | null;
  f_korrektur: number | null;
  delta_u_wb: number | null;
  oeffnungen: PlanungOeffnung[];
}

export interface PlanungRaum {
  id: number;
  bezeichnung: string;
  raumtyp_id: number | null;
  laenge_m: number | null;
  breite_m: number | null;
  flaeche_m2: number | null;
  hoehe_m: number | null;
  volumen_m3: number | null;
  heizlastquelle: Heizlastquelle;
  hottgenroth_w: number | null;
  pauschale_w_m2: number | null;
  theta_int: number | null;
  luftwechsel: number | null;
  flaechen: PlanungFlaeche[];
}

export interface PlanungGeschoss {
  id: number;
  bezeichnung: string;
  /** in der Reihenfolge der Anzeige */
  raeume: PlanungRaum[];
}

export interface PlanungRaumtyp {
  id: number;
  bezeichnung: string;
  theta_int: number | null;
  luftwechsel: number | null;
  reduktionsfaktor: number | null;
}

export interface ObjektPlanung {
  art?: 'objekt';
  objekt: {
    id: number;
    bezeichnung: string;
    gebaeudestandard: Gebaeudestandard;
    gebaeudestandard_text: string;
    delta_u_wb: number | null;
    hoehenzuschlag_grenzhoehe_m: number | null;
    hoehenzuschlag_prozent_je_m: number | null;
    /** {raumtyp_id: W/m²} */
    pauschale_abweichungen: Record<string, number>;
    /** Norm-Außentemperatur der zugeordneten Klimadaten; null ohne Zuordnung */
    theta_e: number | null;
  };
  /** zentrale Fachvorgaben (Einzelwerte) */
  vorgaben: {
    rueckfall_neubau_w_m2: number | null;
    rueckfall_effizienzhaus_sanierung_w_m2: number | null;
    rueckfall_sonstiger_bestand_w_m2: number | null;
    hoehenzuschlag_grenzhoehe_m: number | null;
    hoehenzuschlag_prozent_je_m: number | null;
    delta_u_wb: number | null;
  };
  pauschalen: { raumtyp_id: number; gebaeudestandard: Gebaeudestandard; w_m2: number }[];
  raumtypen: PlanungRaumtyp[];
  /** nur U-Werte der Bauteilbibliothek werden gebraucht */
  bauteile: { id: number; u_wert: number }[];
  /** in der Reihenfolge der Anzeige */
  geschosse: PlanungGeschoss[];
}

export interface ObjektRaumAuswertung extends Omit<AuswertungRaumErgebnis, 'id' | 'bezeichnung' | 'quelle' | 'fehler'> {
  raum_id: number;
  geschoss_id: number;
  geschoss: string;
  bezeichnung: string;
  raumtyp_id: number | null;
  raumtyp: string | null;
  laenge_m: number | null;
  breite_m: number | null;
  flaeche_m2: number | null;
  hoehe_m: number | null;
  quelle: Heizlastquelle;
  werte: { pauschale_w_m2: Wert; theta_int: Wert; luftwechsel: Wert };
  hinweise: string[];
}

export interface ObjektAuswertung {
  rechenkern_version: string;
  objekt: { id: number; bezeichnung: string; gebaeudestandard: Gebaeudestandard; gebaeudestandard_text: string };
  hinweise: string[];
  vorgaben: Record<'rueckfall_w_m2' | 'hoehenzuschlag_grenzhoehe_m' | 'hoehenzuschlag_prozent_je_m' | 'delta_u_wb' | 'theta_e', Wert>;
  raeume: ObjektRaumAuswertung[];
  summe: { phi_massgeblich_w: number; raeume_mit_ergebnis: number; raeume_ohne_ergebnis: number };
}

function wert(w: number | null | undefined, herkunft: Herkunft): Wert {
  return w === null || w === undefined ? { wert: null, herkunft: 'fehlt' } : { wert: w, herkunft };
}

/** Erster vorhandener Wert mit seiner Herkunft, sonst „fehlt“ */
function zuerst(...kandidaten: [number | null | undefined, Herkunft][]): Wert {
  for (const [w, herkunft] of kandidaten) {
    if (w !== null && w !== undefined) return { wert: w, herkunft };
  }
  return { wert: null, herkunft: 'fehlt' };
}

function gegenprobeEingabe(
  raum: PlanungRaum,
  werte: ObjektRaumAuswertung['werte'],
  objektWerte: ObjektAuswertung['vorgaben'],
  raumtypen: Map<number, PlanungRaumtyp>,
  uWert: (e: { u_wert: number | null; bauteil_id: number | null }) => number | null,
): [RaumEingabe | null, string[]] {
  const maengel: string[] = [];
  if (objektWerte.theta_e.wert === null) maengel.push('Vorgabe fehlt: Norm-Außentemperatur (Klimadaten des Gebäudes zuordnen)');
  if (objektWerte.delta_u_wb.wert === null) maengel.push('Vorgabe fehlt: Wärmebrückenzuschlag ΔU_WB');
  if (werte.theta_int.wert === null) maengel.push('Vorgabe fehlt: Norm-Innentemperatur des Raumtyps');
  if (werte.luftwechsel.wert === null) maengel.push('Vorgabe fehlt: Luftwechsel des Raumtyps');
  let volumen: number | null;
  if (raum.volumen_m3 !== null) {
    volumen = raum.volumen_m3;
  } else if (raum.flaeche_m2 !== null && raum.hoehe_m !== null) {
    volumen = raum.flaeche_m2 * raum.hoehe_m;
  } else {
    volumen = null;
    maengel.push('Eingabe fehlt: Raumvolumen (Fläche und Höhe)');
  }

  const flaechen: BauteilflaecheEingabe[] = raum.flaechen.map((fl) => {
    const ort = `Fläche „${fl.bezeichnung || fl.id}“`;
    const u = uWert(fl);
    if (u === null) maengel.push(`${ort}: Eingabe fehlt: U-Wert (Bauteil wählen oder eingeben)`);
    let f = fl.f_korrektur;
    const nachbar = fl.angrenzender_raumtyp_id !== null ? raumtypen.get(fl.angrenzender_raumtyp_id) : undefined;
    if (f === null && nachbar) {
      f = nachbar.reduktionsfaktor;
      if (f === null) maengel.push(`${ort}: Vorgabe fehlt: Reduktionsfaktor für Raumtyp „${nachbar.bezeichnung}“`);
    } else if (f === null && fl.angrenzung === 'erdreich') {
      maengel.push(`${ort}: Eingabe fehlt: Faktor f (angrenzenden Raumtyp wählen oder f eingeben)`);
    } else if (f === null && (fl.angrenzung === 'beheizt' || fl.angrenzung === 'unbeheizt') && fl.theta_angrenzend === null) {
      maengel.push(`${ort}: Eingabe fehlt: angrenzender Raumtyp, Nachbartemperatur oder Faktor f`);
    }
    const oeffnungen: OeffnungEingabe[] = fl.oeffnungen.map((oe) => {
      const uOe = uWert(oe);
      if (uOe === null) maengel.push(`${ort} / Öffnung „${oe.bezeichnung || oe.id}“: Eingabe fehlt: U-Wert`);
      return { bezeichnung: oe.bezeichnung || `Öffnung ${oe.id}`, flaeche_m2: oe.flaeche_m2, anzahl: oe.anzahl, u_wert_w_m2k: uOe as number };
    });
    return {
      bezeichnung: fl.bezeichnung || `Fläche ${fl.id}`,
      flaeche_brutto_m2: fl.flaeche_brutto_m2,
      u_wert_w_m2k: u as number,
      angrenzung: fl.angrenzung,
      theta_angrenzend_c: fl.theta_angrenzend,
      f_korrektur: f,
      delta_u_wb_w_m2k: fl.delta_u_wb,
      oeffnungen,
    };
  });
  if (maengel.length > 0) return [null, maengel];
  return [
    {
      id: String(raum.id),
      bezeichnung: raum.bezeichnung,
      theta_int_c: werte.theta_int.wert as number,
      luftwechsel_1_h: werte.luftwechsel.wert as number,
      volumen_m3: volumen as number,
      flaechen,
    },
    [],
  ];
}

function zahlText(w: number): string {
  return w.toFixed(2).replace('.', ',');
}

/** Rechenkern-Eingabe und Auswertung eines Objekts */
export function berechneObjekt(planung: ObjektPlanung): { eingabe: AuswertungEingabe & { art: 'auswertung' }; auswertung: ObjektAuswertung } {
  const { objekt, vorgaben: v } = planung;
  const gs = objekt.gebaeudestandard;
  const tabelle = new Map(planung.pauschalen.map((p) => [`${p.raumtyp_id}|${p.gebaeudestandard}`, p.w_m2]));
  const raumtypen = new Map(planung.raumtypen.map((t) => [t.id, t]));
  const bauteile = new Map(planung.bauteile.map((b) => [b.id, b.u_wert]));
  const uWert = (e: { u_wert: number | null; bauteil_id: number | null }) =>
    e.u_wert !== null ? e.u_wert : e.bauteil_id !== null ? (bauteile.get(e.bauteil_id) ?? null) : null;
  const rueckfall = v[`rueckfall_${gs}_w_m2`];
  const abweichungen = objekt.pauschale_abweichungen ?? {};

  const objektWerte: ObjektAuswertung['vorgaben'] = {
    rueckfall_w_m2: wert(rueckfall, 'vorgabe'),
    hoehenzuschlag_grenzhoehe_m: zuerst([objekt.hoehenzuschlag_grenzhoehe_m, 'projekt'], [v.hoehenzuschlag_grenzhoehe_m, 'vorgabe']),
    hoehenzuschlag_prozent_je_m: zuerst([objekt.hoehenzuschlag_prozent_je_m, 'projekt'], [v.hoehenzuschlag_prozent_je_m, 'vorgabe']),
    delta_u_wb: zuerst([objekt.delta_u_wb, 'projekt'], [v.delta_u_wb, 'vorgabe']),
    theta_e: wert(objekt.theta_e, 'klimadaten'),
  };
  const grenzhoehe = objektWerte.hoehenzuschlag_grenzhoehe_m.wert;
  const prozent = objektWerte.hoehenzuschlag_prozent_je_m.wert;
  const objektHinweise = gs === 'sonstiger_bestand' ? [HINWEIS_SONSTIGER_BESTAND] : [];

  const infos: Omit<ObjektRaumAuswertung, keyof Omit<AuswertungRaumErgebnis, 'id' | 'bezeichnung' | 'quelle' | 'fehler'>>[] = [];
  const raeumeEingabe: AuswertungRaumEingabe[] = [];
  for (const geschoss of planung.geschosse) {
    for (const raum of geschoss.raeume) {
      const raumtyp = raum.raumtyp_id !== null ? raumtypen.get(raum.raumtyp_id) : undefined;
      const hinweise: string[] = [];
      const werte = {
        pauschale_w_m2: zuerst(
          [raum.pauschale_w_m2, 'raum'],
          [raumtyp ? abweichungen[String(raum.raumtyp_id)] : null, 'projekt'],
          [raumtyp ? tabelle.get(`${raum.raumtyp_id}|${gs}`) : null, 'vorgabe'],
          [rueckfall, 'rueckfall'],
        ),
        theta_int: zuerst([raum.theta_int, 'raum'], [raumtyp?.theta_int, 'vorgabe']),
        luftwechsel: zuerst([raum.luftwechsel, 'raum'], [raumtyp?.luftwechsel, 'vorgabe']),
      };

      // Quelle A
      let pauschal: PauschalEingabe | null = null;
      const q = werte.pauschale_w_m2.wert;
      if (raum.flaeche_m2 === null) {
        hinweise.push('Eingabe fehlt: Fläche (Länge × Breite)');
      } else if (q === null) {
        hinweise.push(`Vorgabe fehlt: Pauschale W/m² für „${raumtyp ? raumtyp.bezeichnung : 'ohne Raumtyp'}“ / ${objekt.gebaeudestandard_text}`);
      } else {
        pauschal = { flaeche_m2: raum.flaeche_m2, pauschale_w_m2: q, hoehe_m: raum.hoehe_m };
        const ueberGrenze = grenzhoehe !== null && raum.hoehe_m !== null && raum.hoehe_m > grenzhoehe;
        if (ueberGrenze && prozent !== null) {
          pauschal.hoehenzuschlag = { grenzhoehe_m: grenzhoehe, prozent_je_m: prozent };
        } else if (ueberGrenze) {
          hinweise.push(`Vorgabe fehlt: Höhenzuschlag (% je m) – Raum höher als ${zahlText(grenzhoehe as number)} m, ohne Zuschlag gerechnet`);
        } else if (raum.hoehe_m === null && prozent !== null) {
          hinweise.push('Eingabe fehlt: Raumhöhe – Höhenzuschlag nicht geprüft');
        }
      }

      // Quelle B
      if (raum.heizlastquelle === 'B' && raum.hottgenroth_w === null) hinweise.push('Eingabe fehlt: Raumheizlast aus Hottgenroth');

      // Quelle C (Gegenprobe), nur wenn Bauteile erfasst oder C gewählt ist
      let berechnung: RaumEingabe | null = null;
      if (raum.flaechen.length > 0 || raum.heizlastquelle === 'C') {
        const [e, maengel] = gegenprobeEingabe(raum, werte, objektWerte, raumtypen, uWert);
        berechnung = e;
        hinweise.push(...maengel.map((m) => `Gegenprobe C: ${m}`));
      }

      raeumeEingabe.push({
        id: String(raum.id),
        bezeichnung: raum.bezeichnung,
        quelle: raum.heizlastquelle,
        pauschal,
        hottgenroth_w: raum.hottgenroth_w,
        berechnung,
      });
      infos.push({
        raum_id: raum.id,
        geschoss_id: geschoss.id,
        geschoss: geschoss.bezeichnung,
        bezeichnung: raum.bezeichnung,
        raumtyp_id: raum.raumtyp_id,
        raumtyp: raumtyp ? raumtyp.bezeichnung : null,
        laenge_m: raum.laenge_m,
        breite_m: raum.breite_m,
        flaeche_m2: raum.flaeche_m2,
        hoehe_m: raum.hoehe_m,
        quelle: raum.heizlastquelle,
        werte,
        hinweise,
      });
    }
  }

  const eingabe = {
    art: 'auswertung' as const,
    theta_e_c: objektWerte.theta_e.wert,
    delta_u_wb_w_m2k: objektWerte.delta_u_wb.wert,
    raeume: raeumeEingabe,
  };
  const ergebnis = berechneAuswertung(eingabe);
  const raeume = infos.map((info, i): ObjektRaumAuswertung => {
    const { id: _id, bezeichnung: _b, quelle: _q, fehler, ...rest } = ergebnis.raeume[i];
    return { ...info, ...rest, hinweise: [...info.hinweise, ...fehler] };
  });

  return {
    eingabe,
    auswertung: {
      rechenkern_version: ergebnis.rechenkern_version,
      objekt: { id: objekt.id, bezeichnung: objekt.bezeichnung, gebaeudestandard: gs, gebaeudestandard_text: objekt.gebaeudestandard_text },
      hinweise: objektHinweise,
      vorgaben: objektWerte,
      raeume,
      summe: ergebnis.summe,
    },
  };
}
