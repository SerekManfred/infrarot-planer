// Beschriftung im Objekt (Paket N6) und Ziehen von Quadrat/Kreis (Paket N4). Maße sind TESTWERTE.
import { describe, expect, it } from 'vitest';
import { beschriftungEinpassen, kreisAusZeiger, quadratAusEcke } from '../src/planhilfen';

describe('Objektnamen einpassen', () => {
  it('passt: Grundgröße', () => {
    expect(beschriftungEinpassen('Sofa', 200, 60)).toEqual({ groesse: 13, zeilen: ['Sofa'] });
  });
  it('zu breit: erst kleiner (bis 9 px)', () => {
    const e = beschriftungEinpassen('Kleiderschrank', 90, 40);
    expect(e.zeilen).toEqual(['Kleiderschrank']);
    expect(e.groesse).toBeLessThan(13);
    expect(e.groesse).toBeGreaterThanOrEqual(9);
  });
  it('dann zwei Zeilen an der Wortgrenze, dann mit „…“ gekürzt, nie breiter als das Objekt', () => {
    expect(beschriftungEinpassen('Sitzplatz (allgemein)', 70, 40).zeilen).toEqual(['Sitzplatz', '(allgemein)']);
    const kurz = beschriftungEinpassen('Kühlschrank/Hochschrank Küche', 40, 12);
    expect(kurz.zeilen).toHaveLength(1);
    expect(kurz.zeilen[0].endsWith('…')).toBe(true);
    expect(kurz.zeilen[0].length * 0.6 * kurz.groesse).toBeLessThanOrEqual(40);
    expect(beschriftungEinpassen('WC', 8, 30).zeilen).toEqual([]); // passt gar nicht: nur Tooltip
  });
});

describe('Quadrat und Kreis ziehen', () => {
  const bbox = { x0: 0, y0: 0, x1: 4, y1: 3 };
  it('Quadrat: gegenüberliegende Ecke fest, Seitenlänge = größere Ausdehnung, im Raum begrenzt', () => {
    const s = { x: 1, y: 1, b: 1, t: 1 };
    expect(quadratAusEcke(s, { x: 1, y: 1, b: 1.5, t: 1.2 }, 'se', bbox)).toEqual({ x: 1, y: 1, b: 1.5, t: 1.5 });
    expect(quadratAusEcke(s, { x: 0, y: 0, b: 2, t: 2 }, 'nw', bbox)).toEqual({ x: 0, y: 0, b: 2, t: 2 });
    expect(quadratAusEcke(s, { x: 1, y: 1, b: 5, t: 1 }, 'se', bbox).b).toBe(2); // unten nur 2 m Platz
  });
  it('Kreis: Mitte bleibt, Durchmesser aus dem Zeigerabstand, im Raum begrenzt', () => {
    const s = { x: 1, y: 1, b: 1, t: 1 }; // Mitte (1,5|1,5)
    expect(kreisAusZeiger(s, { x: 2.5, y: 1.5 }, bbox)).toEqual({ x: 0.5, y: 0.5, b: 2, t: 2 });
    expect(kreisAusZeiger(s, { x: 4, y: 1.5 }, bbox).b).toBe(3); // höchstens 2 × 1,5 m
  });
});
