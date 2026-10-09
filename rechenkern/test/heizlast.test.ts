// Alle Zahlenwerte in diesen Tests sind TESTWERTE (Fantasiewerte).
// Sie stammen nicht aus DIN/TS 12831-1 oder der Bekanntmachung zu Pauschal-U-Werten
// und dürfen nicht als Planungswerte verwendet werden.

import { describe, expect, it } from 'vitest';
import {
  berechneHeizlast,
  berechneRaum,
  RechenkernFehler,
  temperaturKorrekturfaktor,
  verarbeiteJson,
  WAERMEKAPAZITAET_LUFT_WH_M3K,
  type HeizlastEingabe,
  type RaumEingabe,
} from '../src';

const TESTWERT = {
  theta_e_c: -10,
  theta_int_c: 20,
  delta_u_wb_w_m2k: 0.05,
  u_wand_w_m2k: 0.5,
  u_fenster_w_m2k: 1.3,
  luftwechsel_1_h: 0.5,
};

/** Raum 4 m × 5 m × 2,5 m = 50 m³, eine Außenwand 5 m × 2,5 m mit einem Fenster 2 m² (TESTWERTE) */
function testRaum(): RaumEingabe {
  return {
    id: 'R1',
    bezeichnung: 'Testraum',
    theta_int_c: TESTWERT.theta_int_c,
    luftwechsel_1_h: TESTWERT.luftwechsel_1_h,
    volumen_m3: 50,
    flaechen: [
      {
        bezeichnung: 'Außenwand Süd',
        flaeche_brutto_m2: 12.5,
        u_wert_w_m2k: TESTWERT.u_wand_w_m2k,
        angrenzung: 'aussen',
        oeffnungen: [{ bezeichnung: 'Fenster', flaeche_m2: 2, u_wert_w_m2k: TESTWERT.u_fenster_w_m2k }],
      },
    ],
  };
}

describe('Konstanten', () => {
  it('Wärmekapazität der Luft ist 0,34 Wh/(m³·K)', () => {
    expect(WAERMEKAPAZITAET_LUFT_WH_M3K).toBe(0.34);
  });
});

describe('berechneRaum – Handrechnung', () => {
  // Wand netto: (12,5 − 2) · (0,5 + 0,05) · 1 = 5,775 W/K
  // Fenster:     2 · (1,3 + 0,05) · 1          = 2,7   W/K
  // H_T = 8,475 W/K; Δθ = 20 − (−10) = 30 K; Φ_T = 254,25 W
  // H_V = 0,34 · 0,5 · 50 = 8,5 W/K;          Φ_V = 255 W
  // Φ_HL = 509,25 W
  const ergebnis = berechneRaum(testRaum(), TESTWERT.theta_e_c, TESTWERT.delta_u_wb_w_m2k);

  it('Transmission', () => {
    expect(ergebnis.h_t_w_k).toBeCloseTo(8.475, 10);
    expect(ergebnis.phi_t_w).toBeCloseTo(254.25, 10);
  });

  it('Lüftung', () => {
    expect(ergebnis.h_v_w_k).toBeCloseTo(8.5, 10);
    expect(ergebnis.phi_v_w).toBeCloseTo(255, 10);
  });

  it('Raumheizlast und Temperaturdifferenz', () => {
    expect(ergebnis.delta_theta_k).toBe(30);
    expect(ergebnis.phi_hl_w).toBeCloseTo(509.25, 10);
  });

  it('Aufstellung: Fläche netto vor ihren Öffnungen', () => {
    expect(ergebnis.elemente.map((e) => [e.art, e.bezeichnung])).toEqual([
      ['flaeche', 'Außenwand Süd'],
      ['oeffnung', 'Fenster'],
    ]);
    expect(ergebnis.elemente[0].flaeche_m2).toBeCloseTo(10.5, 10);
    expect(ergebnis.elemente[0].h_t_w_k).toBeCloseTo(5.775, 10);
    expect(ergebnis.elemente[1].h_t_w_k).toBeCloseTo(2.7, 10);
  });
});

describe('Öffnungen', () => {
  it('Anzahl multipliziert die Öffnungsfläche', () => {
    const raum = testRaum();
    raum.flaechen[0].oeffnungen = [{ flaeche_m2: 1.5, anzahl: 3, u_wert_w_m2k: TESTWERT.u_fenster_w_m2k }];
    const e = berechneRaum(raum, TESTWERT.theta_e_c, 0);
    expect(e.elemente[0].flaeche_m2).toBeCloseTo(8, 10); // 12,5 − 4,5
    expect(e.elemente[1].flaeche_m2).toBeCloseTo(4.5, 10);
  });

  it('Öffnungen größer als Bruttofläche → Fehler', () => {
    const raum = testRaum();
    raum.flaechen[0].oeffnungen = [{ flaeche_m2: 13, u_wert_w_m2k: TESTWERT.u_fenster_w_m2k }];
    expect(() => berechneRaum(raum, TESTWERT.theta_e_c, 0)).toThrow(/größer als die Bruttofläche/);
  });

  it('Öffnungen genau so groß wie Bruttofläche → Nettofläche 0', () => {
    const raum = testRaum();
    raum.flaechen[0].oeffnungen = [{ flaeche_m2: 12.5, u_wert_w_m2k: TESTWERT.u_fenster_w_m2k }];
    expect(berechneRaum(raum, TESTWERT.theta_e_c, 0).elemente[0].flaeche_m2).toBe(0);
  });
});

describe('Wärmebrückenzuschlag', () => {
  it('Flächenwert ersetzt den globalen Wert, auch für die Öffnungen der Fläche', () => {
    const raum = testRaum();
    raum.flaechen[0].delta_u_wb_w_m2k = 0;
    const e = berechneRaum(raum, TESTWERT.theta_e_c, TESTWERT.delta_u_wb_w_m2k);
    expect(e.elemente.every((el) => el.delta_u_wb_w_m2k === 0)).toBe(true);
    expect(e.h_t_w_k).toBeCloseTo(10.5 * 0.5 + 2 * 1.3, 10);
  });
});

describe('temperaturKorrekturfaktor', () => {
  const basis = { flaeche_brutto_m2: 10, u_wert_w_m2k: 1 };

  it('außen → 1', () => {
    expect(temperaturKorrekturfaktor({ ...basis, angrenzung: 'aussen' }, 20, -10)).toBe(1);
  });

  it('beheizter Nachbar kälter → (θint − θu)/(θint − θe)', () => {
    expect(temperaturKorrekturfaktor({ ...basis, angrenzung: 'beheizt', theta_angrenzend_c: 15 }, 20, -10)).toBeCloseTo(
      5 / 30,
      12,
    );
  });

  it('Nachbar wärmer → negativer Faktor (Wärmegewinn)', () => {
    expect(temperaturKorrekturfaktor({ ...basis, angrenzung: 'beheizt', theta_angrenzend_c: 24 }, 20, -10)).toBeCloseTo(
      -4 / 30,
      12,
    );
  });

  it('angegebenes f hat Vorrang', () => {
    expect(
      temperaturKorrekturfaktor({ ...basis, angrenzung: 'unbeheizt', theta_angrenzend_c: 5, f_korrektur: 0.7 }, 20, -10),
    ).toBe(0.7);
  });

  it('Erdreich ohne f → Fehler', () => {
    expect(() => temperaturKorrekturfaktor({ ...basis, angrenzung: 'erdreich' }, 20, -10)).toThrow(RechenkernFehler);
  });

  it('unbeheizt ohne Temperatur und ohne f → Fehler', () => {
    expect(() => temperaturKorrekturfaktor({ ...basis, angrenzung: 'unbeheizt' }, 20, -10)).toThrow(/erforderlich/);
  });
});

describe('Eingabeprüfung', () => {
  it('θint ≤ θe → Fehler', () => {
    const raum = { ...testRaum(), theta_int_c: -10 };
    expect(() => berechneRaum(raum, TESTWERT.theta_e_c, 0)).toThrow(/größer als die Norm-Außentemperatur/);
  });

  it('negativer U-Wert → Fehler mit Pfad', () => {
    const raum = testRaum();
    raum.flaechen[0].u_wert_w_m2k = -1;
    try {
      berechneRaum(raum, TESTWERT.theta_e_c, 0, 'raeume[0]');
      expect.unreachable();
    } catch (fehler) {
      expect(fehler).toBeInstanceOf(RechenkernFehler);
      expect((fehler as RechenkernFehler).pfad).toBe('raeume[0].flaechen[0].u_wert_w_m2k');
    }
  });

  it('fehlende Zahl → Fehler', () => {
    const raum = { ...testRaum(), volumen_m3: undefined as unknown as number };
    expect(() => berechneRaum(raum, TESTWERT.theta_e_c, 0)).toThrow(/endliche Zahl/);
  });

  it('Raum ohne Flächen hat nur Lüftungsheizlast', () => {
    const raum = { ...testRaum(), flaechen: [] };
    const e = berechneRaum(raum, TESTWERT.theta_e_c, 0);
    expect(e.phi_t_w).toBe(0);
    expect(e.phi_hl_w).toBeCloseTo(255, 10);
  });
});

describe('berechneHeizlast', () => {
  const eingabe: HeizlastEingabe = {
    theta_e_c: TESTWERT.theta_e_c,
    delta_u_wb_w_m2k: TESTWERT.delta_u_wb_w_m2k,
    raeume: [testRaum(), { ...testRaum(), id: 'R2', bezeichnung: 'Testraum 2', theta_int_c: 24 }],
  };

  it('summiert die Raumheizlasten und nennt die Version', () => {
    const e = berechneHeizlast(eingabe);
    // Raum 2: Δθ = 34 K → Φ_HL = (8,475 + 8,5) · 34 = 577,15 W
    expect(e.raeume[1].phi_hl_w).toBeCloseTo(577.15, 10);
    expect(e.summe.phi_hl_w).toBeCloseTo(509.25 + 577.15, 10);
    expect(e.summe.phi_hl_w).toBeCloseTo(e.summe.phi_t_w + e.summe.phi_v_w, 10);
    expect(e.rechenkern_version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('Fehlerpfad nennt den Raumindex', () => {
    const fehlerhaft = { ...eingabe, raeume: [testRaum(), { ...testRaum(), luftwechsel_1_h: -1 }] };
    expect(() => berechneHeizlast(fehlerhaft)).toThrow(/^raeume\[1\]\.luftwechsel_1_h/);
  });
});

describe('verarbeiteJson', () => {
  it('liefert ok und Ergebnis', () => {
    const antwort = JSON.parse(
      verarbeiteJson(JSON.stringify({ theta_e_c: -10, delta_u_wb_w_m2k: 0.05, raeume: [testRaum()] })),
    );
    expect(antwort.ok).toBe(true);
    expect(antwort.ergebnis.summe.phi_hl_w).toBeCloseTo(509.25, 10);
  });

  it('meldet fachliche Fehler strukturiert', () => {
    const antwort = JSON.parse(verarbeiteJson(JSON.stringify({ theta_e_c: 'kalt', delta_u_wb_w_m2k: 0, raeume: [] })));
    expect(antwort).toEqual({ ok: false, fehler: { pfad: 'theta_e_c', meldung: 'muss eine endliche Zahl sein' } });
  });

  it('meldet ungültiges JSON', () => {
    expect(JSON.parse(verarbeiteJson('{kaputt')).ok).toBe(false);
  });
});
