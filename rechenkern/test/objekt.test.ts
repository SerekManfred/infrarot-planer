// Alle Zahlenwerte in diesen Tests sind TESTWERTE (Fantasiewerte), keine Fachvorgaben.

import { describe, expect, it } from 'vitest';
import {
  berechneObjekt,
  HINWEIS_SONSTIGER_BESTAND,
  istBad,
  PFLICHT_PAUSCHALE_SONSTIGER_BESTAND,
  verarbeiteJson,
  type ObjektPlanung,
  type PlanungRaum,
} from '../src';

function raum(teil: Partial<PlanungRaum> = {}): PlanungRaum {
  return {
    id: 1,
    bezeichnung: 'Wohnen',
    raumtyp_id: 10,
    laenge_m: 4,
    breite_m: 5,
    flaeche_m2: 20,
    hoehe_m: 2.5,
    volumen_m3: null,
    heizlastquelle: 'A',
    hottgenroth_w: null,
    pauschale_w_m2: null,
    theta_int: null,
    luftwechsel: null,
    flaechen: [],
    ...teil,
  };
}

function planung(raeume: PlanungRaum[], teil: Partial<ObjektPlanung['objekt']> = {}): ObjektPlanung {
  return {
    objekt: {
      id: 7,
      bezeichnung: 'Gebäude',
      gebaeudestandard: 'neubau',
      gebaeudestandard_text: 'Neubau',
      delta_u_wb: null,
      pauschale_abweichungen: {},
      theta_e: null,
      ...teil,
    },
    vorgaben: {
      rueckfall_neubau_w_m2: 45,
      rueckfall_effizienzhaus_sanierung_w_m2: 75,
      rueckfall_sonstiger_bestand_w_m2: null,
      hoehe_hinweis_m: 2.9,
      delta_u_wb: 0.05,
    },
    pauschalen: [{ raumtyp_id: 10, gebaeudestandard: 'neubau', w_m2: 33 }],
    raumtypen: [
      { id: 10, bezeichnung: 'TESTWOHNEN', theta_int: 20, luftwechsel: 0.5, reduktionsfaktor: null },
      { id: 11, bezeichnung: 'TESTKELLER', theta_int: null, luftwechsel: null, reduktionsfaktor: 0.5 },
    ],
    bauteile: [{ id: 100, u_wert: 0.3 }],
    geschosse: [{ id: 3, bezeichnung: 'EG', raeume }],
  };
}

describe('berechneObjekt – Module je Raum (Raumliste)', () => {
  const regeln = [
    { schluessel: 'abstand_wand_cm', bezeichnung: 'TEST Wand', wert: 50, wert_text: '' },
    { schluessel: 'abstand_modul_cm', bezeichnung: 'TEST Modul', wert: 40, wert_text: '' },
    { schluessel: 'leistungsreserve_prozent', bezeichnung: 'TEST Reserve', wert: 10, wert_text: '' },
    { schluessel: 'ueberdimensionierung_prozent', bezeichnung: 'TEST Über', wert: 20, wert_text: '' },
    { schluessel: 'mindesthoehe_m', bezeichnung: 'TEST Höhe', wert: 2, wert_text: '' },
    { schluessel: 'thermostat_je_raum', bezeichnung: 'TEST Thermostat', wert: null, wert_text: 'ja' },
  ];
  const modul = {
    id: 'a', modul_id: 1, artikel_nr: 'T-1', bezeichnung: 'TESTMODUL', leistung_w: 750, laenge_m: 0.9, breite_m: 0.7,
    schutzart: 'IP44', bad_geeignet: true, x: 1.5, y: 2.0, gedreht: false,
  };

  it('20 m² · 33 W/m² = 660 W → benötigt 726 W; ein Modul 750 W, ein Thermostat, regelkonform', () => {
    const { auswertung } = berechneObjekt({ ...planung([raum({ module: [modul] })]), regeln });
    const m = auswertung.raeume[0].modulplanung;
    expect(m.benoetigt_w).toBeCloseTo(726);
    expect(m).toMatchObject({ installiert_w: 750, anzahl: 1, thermostate: 1, module_mit_verstoss: 0, hinweise: [] });
    expect(m.typen).toEqual([{ artikel_nr: 'T-1', bezeichnung: 'TESTMODUL', leistung_w: 750, anzahl: 1 }]);
    expect(auswertung.summe).toMatchObject({ module: 1, installiert_w: 750, thermostate: 1 });
  });

  it('ohne Regeln im Projektstand: jede Regel „Vorgabe fehlt“, nichts geschätzt', () => {
    const { auswertung } = berechneObjekt(planung([raum({ module: [modul] })]));
    const m = auswertung.raeume[0].modulplanung;
    expect(m.benoetigt_w).toBeNull();
    expect(m.thermostate).toBe(0);
    expect(m.hinweise.some((h) => h.startsWith('Vorgabe fehlt'))).toBe(true);
  });

  it('Raumtyp Bad erkannt', () => {
    expect(istBad('Bad')).toBe(true);
    expect(istBad('Badezimmer')).toBe(true);
    expect(istBad('WC')).toBe(false);
    expect(istBad(null)).toBe(false);
  });
});

describe('berechneObjekt – Quelle A und Herkunft', () => {
  it('Pauschale aus der Matrix: 20 m² · 33 W/m² = 660 W', () => {
    const { auswertung } = berechneObjekt(planung([raum()]));
    const r = auswertung.raeume[0];
    expect(r.werte.pauschale_w_m2).toEqual({ wert: 33, herkunft: 'vorgabe' });
    expect(r.phi_massgeblich_w).toBe(660);
    expect(r.hinweise).toEqual([]);
    expect(r).toMatchObject({ raum_id: 1, geschoss_id: 3, geschoss: 'EG', raumtyp: 'TESTWOHNEN', quelle: 'A' });
    expect(auswertung.summe).toEqual({
      phi_massgeblich_w: 660, raeume_mit_ergebnis: 1, raeume_ohne_ergebnis: 0, module: 0, installiert_w: 0, thermostate: 0, flaeche_m2: 20, reserve_w: null, reserve_prozent: null,
    });
  });

  it('Reihenfolge: Raum vor Projekt vor Vorgabe vor Rückfallwert', () => {
    const projekt = { pauschale_abweichungen: { '10': 36 } };
    expect(berechneObjekt(planung([raum()], projekt)).auswertung.raeume[0].werte.pauschale_w_m2).toEqual({ wert: 36, herkunft: 'projekt' });
    expect(berechneObjekt(planung([raum({ pauschale_w_m2: 40 })], projekt)).auswertung.raeume[0].werte.pauschale_w_m2).toEqual({
      wert: 40,
      herkunft: 'raum',
    });
    // ohne Raumtyp: Rückfallwert 45 W/m² → 900 W
    const ohneTyp = berechneObjekt(planung([raum({ raumtyp_id: null })])).auswertung.raeume[0];
    expect(ohneTyp.werte.pauschale_w_m2).toEqual({ wert: 45, herkunft: 'rueckfall' });
    expect(ohneTyp.phi_a_w).toBe(900);
  });

  it('sonstiger Bestand: weder Tabelle noch Projektwert noch Rückfall – Pauschale je Raum Pflicht', () => {
    const vorgabeDa = planung([raum()], {
      gebaeudestandard: 'sonstiger_bestand',
      gebaeudestandard_text: 'sonstiger Bestand',
      pauschale_abweichungen: { '10': 36 },
    });
    vorgabeDa.pauschalen.push({ raumtyp_id: 10, gebaeudestandard: 'sonstiger_bestand', w_m2: 99 });
    vorgabeDa.vorgaben.rueckfall_sonstiger_bestand_w_m2 = 98;
    const { auswertung } = berechneObjekt(vorgabeDa);
    expect(auswertung.hinweise).toEqual([HINWEIS_SONSTIGER_BESTAND]);
    expect(auswertung.vorgaben.rueckfall_w_m2).toEqual({ wert: null, herkunft: 'fehlt' });
    expect(auswertung.raeume[0].hinweise).toEqual([PFLICHT_PAUSCHALE_SONSTIGER_BESTAND]);
    expect(auswertung.raeume[0].phi_massgeblich_w).toBeNull();
    expect(auswertung.summe.raeume_ohne_ergebnis).toBe(1);

    vorgabeDa.geschosse[0].raeume[0].pauschale_w_m2 = 120;
    const mitRaumwert = berechneObjekt(vorgabeDa).auswertung.raeume[0];
    expect(mitRaumwert.werte.pauschale_w_m2).toEqual({ wert: 120, herkunft: 'raum' });
    expect(mitRaumwert.phi_a_w).toBe(2400);
    expect(mitRaumwert.hinweise).toEqual([]);
  });

  it('fehlende Tabellen- und Rückfallwerte → „Vorgabe fehlt“ mit Raumtyp und Gebäudestandard', () => {
    const p = planung([raum()], { gebaeudestandard: 'effizienzhaus_sanierung', gebaeudestandard_text: 'Effizienzhaus-Sanierung' });
    p.vorgaben.rueckfall_effizienzhaus_sanierung_w_m2 = null;
    const r = berechneObjekt(p).auswertung.raeume[0];
    expect(r.hinweise).toEqual(['Vorgabe fehlt: Pauschale W/m² für „TESTWOHNEN“ / Effizienzhaus-Sanierung']);
  });

  it('Raum höher als die Hinweis-Höhe: nur Hinweis, kein Zuschlag', () => {
    const r = berechneObjekt(planung([raum({ hoehe_m: 3.2 })])).auswertung.raeume[0];
    expect(r.phi_a_w).toBe(660);
    expect(r.hinweise).toEqual(['Raumhöhe über 2,90 m – Pauschale prüfen und ggf. manuell anpassen.']);
    // genau auf der Grenze und ohne Höhe: kein Hinweis
    expect(berechneObjekt(planung([raum({ hoehe_m: 2.9 })])).auswertung.raeume[0].hinweise).toEqual([]);
    expect(berechneObjekt(planung([raum({ hoehe_m: null })])).auswertung.raeume[0].hinweise).toEqual([]);
  });

  it('kein Hinweis mehr, wenn die Pauschale für den Raum von Hand angepasst ist', () => {
    const r = berechneObjekt(planung([raum({ hoehe_m: 3.4, pauschale_w_m2: 40 })])).auswertung.raeume[0];
    expect(r.phi_a_w).toBe(800);
    expect(r.hinweise).toEqual([]);
  });

  it('fehlende Fläche und fehlender Hottgenroth-Wert', () => {
    const r = berechneObjekt(planung([raum({ flaeche_m2: null, heizlastquelle: 'B' })])).auswertung.raeume[0];
    expect(r.hinweise).toEqual(['Eingabe fehlt: Fläche (Länge × Breite)', 'Eingabe fehlt: Raumheizlast aus Hottgenroth']);
  });
});

describe('berechneObjekt – Gegenprobe C', () => {
  it('ohne Klimadaten: Mangel statt Ergebnis', () => {
    const r = berechneObjekt(planung([raum({ heizlastquelle: 'C' })])).auswertung.raeume[0];
    expect(r.hinweise).toContain('Gegenprobe C: Vorgabe fehlt: Norm-Außentemperatur (Klimadaten des Gebäudes zuordnen)');
    expect(r.phi_c_w).toBeNull();
  });

  it('Wand aus der Bibliothek, Fenster mit eigenem U-Wert', () => {
    // Wand 10 m² brutto, Fenster 2 m² → Wand netto 8 m²
    // H_T = 8·(0,3+0,05) + 2·(1,0+0,05) = 2,8 + 2,1 = 4,9 W/K
    // H_V = 0,34·0,5·(20·2,5) = 8,5 W/K;  Δθ = 20 − (−10) = 30 K
    // Φ_C = (4,9 + 8,5) · 30 = 402 W;  Abweichung zu A (660 W) = (402 − 660)/660
    const wand = {
      id: 5,
      bezeichnung: 'Außenwand',
      bauteil_id: 100,
      u_wert: null,
      flaeche_brutto_m2: 10,
      angrenzung: 'aussen' as const,
      angrenzender_raumtyp_id: null,
      theta_angrenzend: null,
      f_korrektur: null,
      delta_u_wb: null,
      oeffnungen: [{ id: 6, bezeichnung: 'Fenster', bauteil_id: null, u_wert: 1.0, flaeche_m2: 2, anzahl: 1 }],
    };
    const { auswertung, eingabe } = berechneObjekt(planung([raum({ flaechen: [wand] })], { theta_e: -10 }));
    const r = auswertung.raeume[0];
    expect(r.hinweise).toEqual([]);
    expect(r.phi_c_w).toBeCloseTo(402, 9);
    expect(r.abweichung_c).toBeCloseTo((402 - 660) / 660, 12);
    expect(eingabe.raeume[0].berechnung?.flaechen[0].u_wert_w_m2k).toBe(0.3);
  });

  it('Reduktionsfaktor fehlt beim angrenzenden Raumtyp', () => {
    const p = planung([raum()], { theta_e: -10 });
    p.raumtypen[1].reduktionsfaktor = null;
    p.geschosse[0].raeume[0].flaechen = [
      {
        id: 5,
        bezeichnung: 'Decke',
        bauteil_id: 100,
        u_wert: null,
        flaeche_brutto_m2: 20,
        angrenzung: 'unbeheizt',
        angrenzender_raumtyp_id: 11,
        theta_angrenzend: null,
        f_korrektur: null,
        delta_u_wb: null,
        oeffnungen: [],
      },
    ];
    const r = berechneObjekt(p).auswertung.raeume[0];
    expect(r.hinweise).toEqual(['Gegenprobe C: Fläche „Decke“: Vorgabe fehlt: Reduktionsfaktor für Raumtyp „TESTKELLER“']);
  });
});

describe('verarbeiteJson – art "objekt"', () => {
  it('liefert Eingabe und Auswertung', () => {
    const antwort = JSON.parse(verarbeiteJson(JSON.stringify({ art: 'objekt', ...planung([raum()]) })));
    expect(antwort.ok).toBe(true);
    expect(antwort.ergebnis.eingabe.art).toBe('auswertung');
    expect(antwort.ergebnis.auswertung.summe.phi_massgeblich_w).toBe(660);
  });
});
