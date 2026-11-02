// Wärmeverteilung im Deckenplan: feste Farbskala und Vorgaben aus den Fachvorgaben. Werte sind TESTWERTE.
import { describe, expect, it } from 'vitest';
import { achse, berechnen, farbe, FARBEN, farbeStetig, rasterMasse, skala, SKALA_STUFE, sperrhoehen, stufe, waermeBild, wertAn } from '../src/komponenten/Waermeverteilung';

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

  it('Standardhöhen je Objekt aus der Objektbibliothek; fehlende bleiben leer', () => {
    expect(sperrhoehen([{ schluessel: 'sofa', hoehe_m: 0.45 }, { schluessel: 'dachfenster', hoehe_m: null }])).toEqual({ sofa: 0.45, dachfenster: null });
    expect(sperrhoehen(undefined)).toEqual({});
  });

  it('Module ohne Katalogkennwerte: mit Vorgabewerten aus den Regeln gerechnet und gekennzeichnet', () => {
    const modul = { id: 'm', modul_id: 7, artikel_nr: 'T', bezeichnung: 'T', leistung_w: 500, laenge_m: 1, breite_m: 0.5, schutzart: 'IP44', bad_geeignet: true, x: 2, y: 1.75, gedreht: false };
    const ergebnis = berechnen({
      laenge_m: 5, breite_m: 4, hoehe_m: 2.5, raumtemperatur_c: 20, module: [modul], sperrflaechen: [], katalog: [],
      regeln: [regel('strahler_temperatur_c', 90), regel('strahler_emissionsgrad', 0.9), regel('strahler_abstrahlwinkel_grad', 180)], objekte: [],
    });
    expect(ergebnis.fehlt).toEqual([]);
    expect(ergebnis.mit_vorgabewerten).toBe(true);
    expect(ergebnis.max_w_m2).toBeGreaterThan(ergebnis.mittel_w_m2);
    expect(ergebnis.mittel_w_m2).toBeGreaterThan(ergebnis.min_w_m2);
    // ohne Vorgabewerte: nicht darstellbar, nichts geschätzt
    const ohne = berechnen({ laenge_m: 5, breite_m: 4, hoehe_m: 2.5, raumtemperatur_c: 20, module: [modul], sperrflaechen: [], katalog: [], regeln: [], objekte: [] });
    expect(ohne.zellen).toEqual([]);
    expect(ohne.fehlt.length).toBe(3);
  });

  describe('weiche Darstellung (Praxistest I)', () => {
    // 2 × 2 Zellen à 1 m, spaltenweise wie im Rechenkern: (0,0)=0, (0,1)=10, (1,0)=20, (1,1)=30 W/m² (TESTWERTE)
    const zelle = (x: number, y: number, wert: number) => ({ x, y, b: 1, t: 1, wert, flaeche: 'boden' as const, z: 0 });
    const e = { zellen: [zelle(0, 0, 0), zelle(0, 1, 10), zelle(1, 0, 20), zelle(1, 1, 30)] };

    it('Raster erkannt, Werte zwischen den Zellmittelpunkten bilinear, am Rand gehalten', () => {
      expect(rasterMasse(e)).toEqual({ nx: 2, ny: 2, laenge: 2, breite: 2, x0: 0, y0: 0 });
      // Raumform mit Anbau oben: Raster beginnt bei negativem y
      expect(rasterMasse({ zellen: e.zellen.map((z) => ({ ...z, y: z.y - 1 })) })).toMatchObject({ y0: -1, breite: 2 });
      expect(wertAn(e, 0.5, 0.5)).toBeCloseTo(0);
      expect(wertAn(e, 1, 1)).toBeCloseTo(15);
      expect(wertAn(e, 1.5, 0.5)).toBeCloseTo(20);
      expect(wertAn(e, 0, 0)).toBeCloseTo(0);
      expect(wertAn({ zellen: [] }, 1, 1)).toBeNull();
    });

    it('Farben stufenlos: Mischung benachbarter Skalenfarben, Enden wie die Skala', () => {
      const s = skala({ min_w_m2: 0, max_w_m2: 70 }, 'auto');
      expect(farbeStetig(0, s)).toEqual([0xff, 0xf3, 0xe0]);
      expect(farbeStetig(70, s)).toEqual([0x7f, 0x00, 0x00]);
      // genau zwischen Stufe 0 (#fff3e0) und 1 (#fdd49e)
      expect(farbeStetig(5, s)).toEqual([254, 228, 191]);
      expect(farbeStetig(99, skala({ min_w_m2: 0, max_w_m2: 1 }, 'fest'))).toEqual([0x7f, 0x00, 0x00]);
    });

    it('Bild: je Zelle faktor × faktor Bildpunkte, deckend', () => {
      const b = waermeBild(e, skala({ min_w_m2: 0, max_w_m2: 30 }, 'auto'), 4);
      expect([b.breite, b.hoehe, b.daten.length]).toEqual([8, 8, 8 * 8 * 4]);
      expect(b.daten[3]).toBe(255);
      // erster Bildpunkt = hellste Farbe (Wert 0 am Rand gehalten)
      expect([...b.daten.slice(0, 3)]).toEqual([0xff, 0xf3, 0xe0]);
    });

    it('Farbbalken beschriftet: feste Skala 0 … ≥ 70, Autoskala fünf Werte von Min bis Max', () => {
      expect(achse(skala({ min_w_m2: 0, max_w_m2: 1 }, 'fest')).map((a) => a.text)).toEqual(['0', '10', '20', '30', '40', '50', '60', '≥ 70']);
      expect(achse(skala({ min_w_m2: 2, max_w_m2: 10 }, 'auto')).map((a) => a.text)).toEqual(['2,0', '4,0', '6,0', '8,0', '10,0']);
    });
  });
});
