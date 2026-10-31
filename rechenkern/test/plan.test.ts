// Darstellungsgeometrie: Tür, Fenster, Wandabstände. Maße sind Beispielwerte, keine Fachvorgaben.

import { describe, expect, it } from 'vitest';
import { naechsteWand, oeffnungStrecke, tuerGeometrie, wandAbstaende, type TuerFenster } from '../src';

const tuer = (teil: Partial<TuerFenster>): TuerFenster => ({ id: 't', art: 'tuer', wand: 'oben', position: 1, breite: 0.9, aufschlag: 'innen', band: 'links', ...teil });

describe('Tür wie im Bauplan (Raum 5 × 4 m)', () => {
  it('obere Wand, Band links, nach innen: Drehpunkt am Wandanfang, Türblatt in den Raum, Bogen gegen den Uhrzeigersinn', () => {
    const g = tuerGeometrie(tuer({}), 5, 4);
    expect(g.band).toEqual({ x: 1, y: 0 });
    expect(g.zu).toEqual({ x: 1.9, y: 0 });
    expect(g.blatt.x).toBeCloseTo(1);
    expect(g.blatt.y).toBeCloseTo(0.9);
    expect(g.sweep).toBe(0);
  });

  it('untere Wand, Band links (vom Raum aus): Drehpunkt am Wandende, Türblatt nach oben in den Raum', () => {
    const g = tuerGeometrie(tuer({ wand: 'unten' }), 5, 4);
    expect(g.band).toEqual({ x: 1.9, y: 4 });
    expect(g.blatt.y).toBeCloseTo(3.1);
  });

  it('nach außen: Türblatt jenseits der Wand, Bogen gespiegelt', () => {
    const innen = tuerGeometrie(tuer({ wand: 'links', band: 'rechts' }), 5, 4);
    const aussen = tuerGeometrie(tuer({ wand: 'links', band: 'rechts', aufschlag: 'aussen' }), 5, 4);
    expect(innen.blatt.x).toBeCloseTo(0.9);
    expect(aussen.blatt.x).toBeCloseTo(-0.9);
    expect(aussen.sweep).not.toBe(innen.sweep);
  });

  it('Öffnung wird auf die Wand begrenzt', () => {
    expect(oeffnungStrecke({ wand: 'rechts', position: 3.5, breite: 1.0 }, 5, 4)).toEqual([{ x: 5, y: 3 }, { x: 5, y: 4 }]);
  });
});

describe('Bemaßung', () => {
  it('Modulabstände zu den nächstgelegenen Wänden in x und y', () => {
    const [x, y] = wandAbstaende({ x: 3.2, y: 0.75, b: 1.0, t: 0.6 }, 5, 4);
    expect(x.wand).toBe('rechts');
    expect(x.abstand).toBeCloseTo(0.8);
    expect(x.von).toEqual({ x: 4.2, y: 1.05 });
    expect(x.bis).toEqual({ x: 5, y: 1.05 });
    expect(y).toMatchObject({ wand: 'oben', abstand: 0.75, von: { x: 3.7, y: 0.75 }, bis: { x: 3.7, y: 0 } });
  });

  it('nächste Wand zu einem angetippten Punkt', () => {
    expect(naechsteWand({ x: 2, y: 3.9 }, 5, 4)).toEqual({ wand: 'unten', abstand: expect.closeTo(0.1), s: 2 });
    expect(naechsteWand({ x: 4.95, y: 1 }, 5, 4).wand).toBe('rechts');
  });
});
