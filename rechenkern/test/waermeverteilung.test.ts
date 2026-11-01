// Wärmeverteilung (vereinfachte Strahlungsverteilung). Temperaturen, Emissionsgrade, Winkel sind TESTWERTE.

import { describe, expect, it } from 'vitest';
import {
  bestrahlung,
  SIGMA,
  sichtfaktorEcke,
  sichtfaktorRechteck,
  sperrHoehe,
  strahlungsdichte,
  waermeverteilung,
  type PlatziertesModul,
  type Strahler,
  type WaermeEingabe,
} from '../src';

describe('Sichtfaktor Flächenelement → paralleles Rechteck', () => {
  it('Ecke, Quadrat mit Kantenlänge = Abstand (X = Y = 1): F = (1/π)·(1/√2)·atan(1/√2) ≈ 0,13853', () => {
    const erwartet = (1 / Math.PI) * (1 / Math.SQRT2) * Math.atan(1 / Math.SQRT2);
    expect(sichtfaktorEcke(1, 1, 1)).toBeCloseTo(erwartet, 12);
    expect(sichtfaktorEcke(1, 1, 1)).toBeCloseTo(0.13853, 5);
  });

  it('unendlich große Decke: F → 1 (Punkt sieht nur die Decke)', () => {
    expect(sichtfaktorRechteck(0, 0, -1e5, -1e5, 1e5, 1e5, 2.5)).toBeCloseTo(1, 4);
  });

  it('Punkt mittig unter einem Rechteck = 4 gleiche Eckrechtecke', () => {
    expect(sichtfaktorRechteck(0, 0, -0.5, -0.4, 0.5, 0.4, 2)).toBeCloseTo(4 * sichtfaktorEcke(0.5, 0.4, 2), 12);
  });

  it('Symmetrie: gleiche Werte links/rechts und vorn/hinten der Modulmitte', () => {
    const f = (x: number, y: number) => sichtfaktorRechteck(x, y, 2, 1, 3, 1.6, 2.5);
    expect(f(1.2, 1.3)).toBeCloseTo(f(3.8, 1.3), 12);
    expect(f(2.5, 0.2)).toBeCloseTo(f(2.5, 2.4), 12);
  });

  it('nimmt mit dem Abstand ab – senkrecht und seitlich', () => {
    const unter = (c: number) => sichtfaktorRechteck(0, 0, -0.5, -0.3, 0.5, 0.3, c);
    expect(unter(1)).toBeGreaterThan(unter(2));
    expect(unter(2)).toBeGreaterThan(unter(3));
    const seitlich = (x: number) => sichtfaktorRechteck(x, 0, -0.5, -0.3, 0.5, 0.3, 2.5);
    expect(seitlich(0)).toBeGreaterThan(seitlich(1));
    expect(seitlich(1)).toBeGreaterThan(seitlich(3));
    expect(seitlich(3)).toBeGreaterThan(0);
  });

  it('kein Abstand oder kein Rechteck: 0', () => {
    expect(sichtfaktorRechteck(0, 0, -1, -1, 1, 1, 0)).toBe(0);
    expect(sichtfaktorEcke(0, 1, 1)).toBe(0);
  });
});

describe('Strahlungsdichte (Stefan-Boltzmann)', () => {
  it('ε = 0,9, 100 °C gegen 20 °C: 0,9 · σ · (373,15⁴ − 293,15⁴) ≈ 612 W/m²', () => {
    const erwartet = 0.9 * SIGMA * (373.15 ** 4 - 293.15 ** 4);
    expect(strahlungsdichte(100, 20, 0.9)).toBeCloseTo(erwartet, 9);
    expect(strahlungsdichte(100, 20, 0.9)).toBeCloseTo(612.6, 0);
  });
  it('gleich warm oder kälter als der Raum: 0', () => {
    expect(strahlungsdichte(20, 20, 0.9)).toBe(0);
    expect(strahlungsdichte(10, 20, 0.9)).toBe(0);
  });
});

describe('Bestrahlungsstärke', () => {
  const modul = (x0: number, winkel = 180, m = 600): Strahler => ({ x0, y0: 1, x1: x0 + 1, y1: 1.6, m, winkel_grad: winkel });

  it('Punkt direkt unter der Modulmitte = M · Sichtfaktor', () => {
    expect(bestrahlung(2.5, 1.3, 2.5, [modul(2)])).toBeCloseTo(600 * sichtfaktorRechteck(2.5, 1.3, 2, 1, 3, 1.6, 2.5), 10);
  });

  it('Summe mehrerer Module = Summe der Einzelwerte', () => {
    const a = modul(0.5);
    const b = modul(3);
    expect(bestrahlung(2, 1.3, 2.5, [a, b])).toBeCloseTo(bestrahlung(2, 1.3, 2.5, [a]) + bestrahlung(2, 1.3, 2.5, [b]), 10);
  });

  it('Abstrahlwinkel begrenzt: außerhalb des Kegels 0, darunter ungefähr der unbegrenzte Wert', () => {
    // 90° voll: Kegelradius bei 2,5 m Abstand = 2,5 m
    expect(bestrahlung(8, 1.3, 2.5, [modul(2, 90)])).toBe(0);
    expect(bestrahlung(8, 1.3, 2.5, [modul(2, 180)])).toBeGreaterThan(0);
    const unbegrenzt = bestrahlung(2.5, 1.3, 2.5, [modul(2, 180)]);
    expect(bestrahlung(2.5, 1.3, 2.5, [modul(2, 90)])).toBeCloseTo(unbegrenzt, 8);
  });

  it('auf einer höheren Fläche (näher an der Decke) mehr als auf dem Boden', () => {
    expect(bestrahlung(2.5, 1.3, 2.5 - 0.75, [modul(2)])).toBeGreaterThan(bestrahlung(2.5, 1.3, 2.5, [modul(2)]));
  });
});

describe('Raster im Raum', () => {
  const pm = (x: number, modulId: number | null = 1): PlatziertesModul => ({
    id: `m${x}`, modul_id: modulId, artikel_nr: 'T', bezeichnung: 'T', leistung_w: 600, laenge_m: 1, breite_m: 0.6,
    schutzart: 'IP44', bad_geeignet: true, x, y: 1.7, gedreht: false,
  });
  const eingabe = (teil: Partial<WaermeEingabe> = {}): WaermeEingabe => ({
    laenge_m: 5, breite_m: 4, hoehe_m: 2.5, raumtemperatur_c: 20, module: [pm(2)],
    kennwerte: new Map([[1, { temperatur_c: 100, emissionsgrad: 0.9, abstrahlwinkel_grad: 180 }]]),
    vorgaben: { temperatur_c: null, emissionsgrad: null, abstrahlwinkel_grad: null },
    sperrflaechen: [], sperrhoehe: {}, raster_m: 0.5, ...teil,
  });

  it('größter Wert unter dem Modul, Raster deckt den Raum ab, ohne Vorgabewerte', () => {
    const w = waermeverteilung(eingabe());
    expect(w.fehlt).toEqual([]);
    expect(w.zellen).toHaveLength(10 * 8);
    expect(w.mit_vorgabewerten).toBe(false);
    const groesste = w.zellen.reduce((a, b) => (b.wert > a.wert ? b : a));
    expect(groesste.x + groesste.b / 2).toBeCloseTo(2.25, 5); // Modul 2,0 … 3,0 m: Zellmitten 2,25 und 2,75
    expect(w.max_w_m2).toBe(groesste.wert);
  });

  it('fehlende Katalogwerte: mit Vorgabewerten gerechnet und gekennzeichnet; ohne Vorgaben „Vorgabe fehlt“', () => {
    const ohne = eingabe({ kennwerte: new Map() });
    expect(waermeverteilung(ohne).fehlt).toEqual([
      'Vorgabe fehlt: Oberflächentemperatur (weder im Modulkatalog noch als Vorgabewert)',
      'Vorgabe fehlt: Emissionsgrad (weder im Modulkatalog noch als Vorgabewert)',
      'Vorgabe fehlt: Abstrahlwinkel (weder im Modulkatalog noch als Vorgabewert)',
    ]);
    const mitVorgabe = waermeverteilung({ ...ohne, vorgaben: { temperatur_c: 100, emissionsgrad: 0.9, abstrahlwinkel_grad: 180 } });
    expect(mitVorgabe.fehlt).toEqual([]);
    expect(mitVorgabe.mit_vorgabewerten).toBe(true);
    expect(mitVorgabe.max_w_m2).toBeCloseTo(waermeverteilung(eingabe()).max_w_m2, 10);
  });

  it('ohne Raumhöhe oder Raumtemperatur keine Darstellung', () => {
    expect(waermeverteilung(eingabe({ hoehe_m: null })).fehlt).toContain('Eingabe fehlt: Raumhöhe');
    expect(waermeverteilung(eingabe({ raumtemperatur_c: null })).fehlt).toContain('Vorgabe fehlt: Raumtemperatur des Raumtyps');
  });

  it('Möbel als Empfangsfläche auf ihrer Höhe; der Boden darunter wird nicht dargestellt', () => {
    const tisch = { id: 's', typ: 'sonstiges' as const, x: 2, y: 1.5, b: 1, t: 1 };
    const w = waermeverteilung(eingabe({ sperrflaechen: [tisch], sperrhoehe: { sonstiges: 0.75 } }));
    const ueberTisch = w.zellen.find((z) => z.x === 2 && z.y === 1.5)!;
    const ohneTisch = waermeverteilung(eingabe()).zellen.find((z) => z.x === 2 && z.y === 1.5)!;
    expect(ueberTisch).toMatchObject({ flaeche: 'moebel', z: 0.75 });
    expect(ueberTisch.wert).toBeGreaterThan(ohneTisch.wert);
    // eigene Höhe hat Vorrang vor der Vorgabe; Leuchte und Dachschräge sind keine Empfangsflächen
    expect(sperrHoehe({ ...tisch, hoehe: 1.1 }, { sonstiges: 0.75 })).toBe(1.1);
    expect(sperrHoehe({ ...tisch, typ: 'dachschraege' }, { sonstiges: 0.75 })).toBeNull();
  });

  it('Hochschrank bis fast an die Decke: Oberseite sehr nah am Modul', () => {
    const schrank = { id: 'h', typ: 'hochschrank' as const, x: 0, y: 0, b: 1, t: 0.6 };
    const w = waermeverteilung(eingabe({ sperrflaechen: [schrank], sperrhoehe: { hochschrank: 2 } }));
    expect(w.zellen.find((z) => z.x === 0 && z.y === 0)).toMatchObject({ flaeche: 'moebel', z: 2 });
  });
});
