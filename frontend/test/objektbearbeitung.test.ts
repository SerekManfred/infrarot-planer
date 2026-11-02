// Objekte bearbeiten (Paket N1): Maße mit fester Mitte, minimal verschieben, Meldung statt stillem Verwerfen, Drehen.
// Maße sind TESTWERTE.
import { raumform } from '@infrarot/rechenkern';
import { describe, expect, it } from 'vitest';
import { objektDrehen, objektMasse } from '../src/planhilfen';

const RECHTECK = raumform({ basis: { w: 4, h: 3 }, teile: [] });
const L_FORM = raumform({ basis: { w: 6, h: 4 }, teile: [{ op: 'sub', wand: 'oben', versatz: 3, laenge: 3, tiefe: 2 }] });

describe('Objektmaße', () => {
  it('Praxistest: Sofa 0,75 × 1,15 m nahe der unteren Wand, Tiefe 3 → Mitte bleibt, minimal in den Raum verschoben', () => {
    const sofa = { x: 1, y: 1.8, b: 0.75, t: 1.15 };
    const e = objektMasse(sofa, 0.75, 3, RECHTECK);
    expect(e).toEqual({ ok: true, r: { x: 1, y: 0, b: 0.75, t: 3 } });
  });
  it('Mitte bleibt, wenn Platz ist', () => {
    expect(objektMasse({ x: 1, y: 1, b: 1, t: 1 }, 2, 0.5, RECHTECK)).toEqual({ ok: true, r: { x: 0.5, y: 1.25, b: 2, t: 0.5 } });
  });
  it('zu groß oder über einem Einsprung: Meldung, nichts still verworfen', () => {
    expect(objektMasse({ x: 1, y: 1, b: 1, t: 1 }, 1, 3.5, RECHTECK)).toEqual({ ok: false, meldung: 'Tiefer als der Raum (höchstens 3,00 m)' });
    expect(objektMasse({ x: 1, y: 1, b: 1, t: 1 }, 0.05, 1, RECHTECK)).toMatchObject({ ok: false });
    // L-Form: Objekt unten rechts 2 m breit auf 3 m Tiefe würde in den Ausschnitt ragen
    const e = objektMasse({ x: 4, y: 2.5, b: 1.5, t: 1 }, 1.5, 3, L_FORM);
    expect(e).toMatchObject({ ok: false, meldung: expect.stringContaining('Einsprung') });
  });
  it('Drehen um 90°: Breite und Tiefe tauschen, Mitte bleibt; an der Wand minimal verschoben; sonst Hinweis', () => {
    expect(objektDrehen({ x: 1, y: 1, b: 2, t: 0.9 }, RECHTECK)).toEqual({ ok: true, r: { x: 1.55, y: 0.45, b: 0.9, t: 2 } });
    expect(objektDrehen({ x: 0, y: 2.1, b: 2, t: 0.9 }, RECHTECK)).toEqual({ ok: true, r: { x: 0.55, y: 1, b: 0.9, t: 2 } });
    expect(objektDrehen({ x: 0, y: 0, b: 3.5, t: 1 }, RECHTECK)).toMatchObject({ ok: false, meldung: expect.stringMatching(/^Drehen nicht möglich: Tiefer als der Raum/) });
  });
});
