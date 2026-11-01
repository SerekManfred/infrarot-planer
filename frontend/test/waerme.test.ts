// Wärmeverteilung im Deckenplan: feste Farbskala und Vorgaben aus den Fachvorgaben. Werte sind TESTWERTE.
import { describe, expect, it } from 'vitest';
import { berechnen, farbe, FARBEN, skala, SKALA_STUFE, sperrhoehen, stufe } from '../src/komponenten/Waermeverteilung';

const regel = (schluessel: string, wert: number | null) => ({ schluessel, bezeichnung: schluessel, wert, wert_text: '' });

describe('Wärmeverteilung', () => {
  it('feste Skala in 10-W/m²-Stufen, ab 70 W/m² dunkelste Stufe', () => {
    const fest = skala({ min_w_m2: 3, max_w_m2: 30 }, 'fest');
    expect(SKALA_STUFE).toBe(10);
    expect(fest.grenzen).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
    expect(fest.oben).toBeNull();
    expect(farbe(0, fest)).toBe(farbe(9.9, fest));
    expect(farbe(70, fest)).toBe(farbe(900, fest));
  });

  it('Autoskala: kleinster Wert hellste, größter Wert kräftigste Farbe, gleich breite Stufen dazwischen', () => {
    const auto = skala({ min_w_m2: 4, max_w_m2: 12 }, 'auto');
    expect(auto.grenzen[0]).toBe(4);
    expect(auto.grenzen[1]).toBe(5);
    expect(auto.oben).toBe(12);
    expect(auto.stellen).toBe(1);
    expect(stufe(4, auto)).toBe(0);
    expect(stufe(12, auto)).toBe(FARBEN.length - 1);
    expect(stufe(8, auto)).toBe(4);
    // kaum Unterschiede: alles eine Stufe, keine Division durch null
    expect(stufe(5, skala({ min_w_m2: 5, max_w_m2: 5 }, 'auto'))).toBe(0);
  });

  it('kräftige Farben: hell → kräftig rot, 8 verschiedene Stufen', () => {
    expect(new Set(FARBEN).size).toBe(8);
    expect(FARBEN[0]).toBe('#fff3e0');
    expect(FARBEN.at(-1)).toBe('#7f0000');
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
    expect(ergebnis.max_w_m2).toBeGreaterThan(ergebnis.mittel_w_m2);
    expect(ergebnis.mittel_w_m2).toBeGreaterThan(ergebnis.min_w_m2);
    // ohne Vorgabewerte: nicht darstellbar, nichts geschätzt
    const ohne = berechnen({ laenge_m: 5, breite_m: 4, hoehe_m: 2.5, raumtemperatur_c: 20, module: [modul], sperrflaechen: [], katalog: [], regeln: [] });
    expect(ohne.zellen).toEqual([]);
    expect(ohne.fehlt.length).toBe(3);
  });
});
