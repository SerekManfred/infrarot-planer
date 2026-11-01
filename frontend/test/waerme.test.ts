// Wärmeverteilung im Deckenplan: feste Farbskala und Vorgaben aus den Fachvorgaben. Werte sind TESTWERTE.
import { describe, expect, it } from 'vitest';
import { berechnen, farbe, SKALA_STUFE, sperrhoehen } from '../src/komponenten/Waermeverteilung';

const regel = (schluessel: string, wert: number | null) => ({ schluessel, bezeichnung: schluessel, wert, wert_text: '' });

describe('Wärmeverteilung', () => {
  it('feste Skala in 10-W/m²-Stufen, ab 70 W/m² dunkelste Stufe', () => {
    expect(SKALA_STUFE).toBe(10);
    expect(farbe(0)).toBe(farbe(9.9));
    expect(farbe(10)).not.toBe(farbe(0));
    expect(farbe(70)).toBe(farbe(900));
    expect(farbe(60)).not.toBe(farbe(70));
  });

  it('Höhen je Sperrflächen-Typ aus den Regeln; fehlende bleiben leer', () => {
    expect(sperrhoehen([regel('hoehe_sitzplatz_m', 0.45), regel('hoehe_bett_m', null)])).toMatchObject({ sitzplatz: 0.45, bett: null });
  });

  it('Module ohne Katalogkennwerte: mit Vorgabewerten aus den Regeln gerechnet und gekennzeichnet', () => {
    const modul = { id: 'm', modul_id: 7, artikel_nr: 'T', bezeichnung: 'T', leistung_w: 500, laenge_m: 1, breite_m: 0.5, schutzart: 'IP44', bad_geeignet: true, x: 2, y: 1.75, gedreht: false };
    const ergebnis = berechnen({
      laenge_m: 5, breite_m: 4, hoehe_m: 2.5, raumtemperatur_c: 20, module: [modul], sperrflaechen: [], katalog: [],
      regeln: [regel('strahler_temperatur_c', 90), regel('strahler_emissionsgrad', 0.9), regel('strahler_abstrahlwinkel_grad', 180)],
    });
    expect(ergebnis.fehlt).toEqual([]);
    expect(ergebnis.mit_vorgabewerten).toBe(true);
    expect(ergebnis.max_w_m2).toBeGreaterThan(0);
    // ohne Vorgabewerte: nicht darstellbar, nichts geschätzt
    const ohne = berechnen({ laenge_m: 5, breite_m: 4, hoehe_m: 2.5, raumtemperatur_c: 20, module: [modul], sperrflaechen: [], katalog: [], regeln: [] });
    expect(ohne.zellen).toEqual([]);
    expect(ohne.fehlt.length).toBe(3);
  });
});
