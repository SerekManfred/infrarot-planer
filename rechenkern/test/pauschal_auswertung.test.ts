// Alle Zahlenwerte in diesen Tests sind TESTWERTE (Fantasiewerte), keine Fachvorgaben.

import { describe, expect, it } from 'vitest';
import {
  abweichung,
  berechneAuswertung,
  berechnePauschal,
  rechteckFlaeche,
  verarbeiteJson,
  type AuswertungRaumEingabe,
  type RaumEingabe,
} from '../src';

const TESTWERT = { pauschale_w_m2: 50 };

describe('rechteckFlaeche', () => {
  it('Länge × Breite', () => {
    expect(rechteckFlaeche(4, 5)).toBe(20);
    expect(rechteckFlaeche(3.25, 4.1)).toBeCloseTo(13.325, 12);
  });
  it('negative Maße → Fehler', () => {
    expect(() => rechteckFlaeche(-1, 5)).toThrow(/laenge_m/);
  });
});

describe('berechnePauschal', () => {
  it('q · A', () => {
    const e = berechnePauschal({ flaeche_m2: 20, pauschale_w_m2: TESTWERT.pauschale_w_m2 });
    expect(e).toEqual({ flaeche_m2: 20, pauschale_w_m2: 50, phi_w: 1000 });
  });
  it('kein Höhenzuschlag: zusätzliche Angaben ändern nichts', () => {
    const e = berechnePauschal({ flaeche_m2: 20, pauschale_w_m2: 50, hoehe_m: 4, hoehenzuschlag: { prozent_je_m: 10 } } as never);
    expect(e.phi_w).toBe(1000);
  });
  it('negative Pauschale → Fehler', () => {
    expect(() => berechnePauschal({ flaeche_m2: 20, pauschale_w_m2: -1 })).toThrow(/pauschale_w_m2/);
  });
});

describe('abweichung', () => {
  it('relativ zur maßgeblichen Heizlast', () => {
    expect(abweichung(1100, 1000)).toBeCloseTo(0.1, 12);
    expect(abweichung(900, 1000)).toBeCloseTo(-0.1, 12);
    expect(abweichung(100, 0)).toBeNull();
  });
});

/** Raum für Quelle C: nur Lüftung, Φ_C = 0,34 · 1 · 50 · 30 = 510 W (TESTWERTE) */
function gegenprobe(): RaumEingabe {
  return { id: 'x', bezeichnung: 'x', theta_int_c: 20, luftwechsel_1_h: 1, volumen_m3: 50, flaechen: [] };
}

function raum(teil: Partial<AuswertungRaumEingabe>): AuswertungRaumEingabe {
  return { id: 'R', bezeichnung: 'Raum', quelle: 'A', ...teil };
}

describe('berechneAuswertung', () => {
  const basis = { theta_e_c: -10, delta_u_wb_w_m2k: 0 };

  it('Quelle A maßgeblich, C als Gegenprobe mit Abweichung', () => {
    const e = berechneAuswertung({
      ...basis,
      raeume: [raum({ pauschal: { flaeche_m2: 10, pauschale_w_m2: 50 }, berechnung: gegenprobe() })],
    });
    const r = e.raeume[0];
    expect(r.phi_a_w).toBe(500);
    expect(r.phi_c_w).toBeCloseTo(510, 10);
    expect(r.phi_massgeblich_w).toBe(500);
    expect(r.abweichung_c).toBeCloseTo(0.02, 12);
    expect(r.fehler).toEqual([]);
  });

  it('Quelle B maßgeblich, A wird trotzdem mitgerechnet', () => {
    const r = berechneAuswertung({
      raeume: [raum({ quelle: 'B', hottgenroth_w: 640, pauschal: { flaeche_m2: 10, pauschale_w_m2: 50 } })],
    }).raeume[0];
    expect(r.phi_massgeblich_w).toBe(640);
    expect(r.phi_a_w).toBe(500);
    expect(r.abweichung_c).toBeNull();
  });

  it('Quelle C maßgeblich: keine Abweichung zu sich selbst', () => {
    const r = berechneAuswertung({ ...basis, raeume: [raum({ quelle: 'C', berechnung: gegenprobe() })] }).raeume[0];
    expect(r.phi_massgeblich_w).toBeCloseTo(510, 10);
    expect(r.abweichung_c).toBeNull();
  });

  it('fehlende Eingaben: kein Ergebnis, aber kein Abbruch', () => {
    const e = berechneAuswertung({
      raeume: [
        raum({ id: '1' }), // A ohne Pauschale (Vorgabe fehlt)
        raum({ id: '2', quelle: 'B' }), // B ohne Wert
        raum({ id: '3', pauschal: { flaeche_m2: 4, pauschale_w_m2: 50 } }),
      ],
    });
    expect(e.raeume.map((r) => r.phi_massgeblich_w)).toEqual([null, null, 200]);
    expect(e.summe).toEqual({ phi_massgeblich_w: 200, raeume_mit_ergebnis: 1, raeume_ohne_ergebnis: 2 });
  });

  it('Fehler in einem Raum landen in dessen Fehlerliste', () => {
    const e = berechneAuswertung({
      raeume: [
        raum({ pauschal: { flaeche_m2: -1, pauschale_w_m2: 50 }, hottgenroth_w: -5, berechnung: gegenprobe() }),
      ],
    });
    expect(e.raeume[0].fehler).toHaveLength(3);
    expect(e.raeume[0].fehler[0]).toMatch(/^raeume\[0\]\.pauschal\.flaeche_m2/);
    expect(e.raeume[0].fehler[2]).toMatch(/theta_e_c/);
  });

  it('unbekannte Quelle → Abbruch', () => {
    expect(() => berechneAuswertung({ raeume: [raum({ quelle: 'D' as 'A' })] })).toThrow(/Heizlastquelle/);
  });
});

describe('verarbeiteJson mit art', () => {
  it('auswertung', () => {
    const antwort = JSON.parse(
      verarbeiteJson(JSON.stringify({ art: 'auswertung', raeume: [raum({ pauschal: { flaeche_m2: 2, pauschale_w_m2: 50 } })] })),
    );
    expect(antwort.ok).toBe(true);
    expect(antwort.ergebnis.summe.phi_massgeblich_w).toBe(100);
  });
  it('unbekannte art', () => {
    expect(JSON.parse(verarbeiteJson('{"art":"quatsch"}')).fehler.pfad).toBe('art');
  });
});
