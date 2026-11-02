// Raumform-Vorlagen und Offline-Fläche (Paket M2). Maße sind TESTWERTE.
import { raumform } from '@infrarot/rechenkern';
import { describe, expect, it } from 'vitest';
import { neuesTeil, vorlageTeile } from '../src/raumvorlagen';

describe('Raumform-Vorlagen', () => {
  it('L-Form, U-Form, Erker auf 6 × 4 m: plausible Flächen, ein zusammenhängender Raum', () => {
    const f = (v: 'l' | 'u' | 'erker') => raumform({ basis: { w: 6, h: 4 }, teile: vorlageTeile(v, 6, 4) });
    expect(f('l').flaeche_m2).toBe(18);
    expect(f('l').segmente).toHaveLength(6);
    expect(f('u').flaeche_m2).toBe(20);
    expect(f('u').segmente).toHaveLength(8);
    expect(f('erker').flaeche_m2).toBeCloseTo(24 + 2 * 0.8);
    expect(vorlageTeile('rechteck', 6, 4)).toEqual([]);
    for (const v of ['l', 'u', 'erker'] as const) expect(f(v).umriss).toHaveLength(1);
  });
  it('neues Teil mittig an der Wand, im Raster 5 cm', () => {
    expect(neuesTeil('add', 5, 3)).toEqual({ op: 'add', wand: 'unten', versatz: 1.75, laenge: 1.5, tiefe: 1 });
  });
});
