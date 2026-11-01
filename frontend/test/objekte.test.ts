// Objektbibliothek im Deckenplan (Festlegung 01.11.2026): Auswahl nach Raumtyp, zuletzt verwendet, Streifen, Höhenangabe.
// Alle Objekte und Maße sind TESTWERTE.
import { describe, expect, it } from 'vitest';
import type { BibliotheksObjekt } from '../src/api';
import { hoeheText, streifenLage, streifenRechteck } from '../src/planhilfen';
import { masseText, objekteFuerRaum, zuletztLesen, zuletztMerken } from '../src/objekte';

function obj(schluessel: string, raumtyp_ids: number[], reihenfolge: number, teil: Partial<BibliotheksObjekt> = {}): BibliotheksObjekt {
  return {
    schluessel, name: `TEST ${schluessel}`, gruppe: 'moebel', raumtyp_ids, form: 'rechteck', breite_m: 1, tiefe_m: 0.5, hoehe_m: 0.4,
    kategorie: 'tabu', abstand_cm: 30, quelle: 'TESTWERT', aktiv: true, reihenfolge, ...teil,
  };
}

const BAD = 3;
const WOHNEN = 1;
const OBJEKTE = [
  obj('hochschrank', [WOHNEN, BAD, 5, 6], 0),
  obj('sofa', [WOHNEN], 1),
  obj('dusche', [BAD], 2),
  obj('waschtisch', [BAD], 4),
  obj('badewanne', [BAD], 3),
  obj('sonstiges', [], 5),
  obj('leuchte', [], 6, { form: 'punkt', gruppe: 'decke' }),
  obj('alt', [BAD], 7, { aktiv: false }),
];

describe('Objektauswahl', () => {
  it('im Bad zuerst die speziellen Bad-Objekte (Dusche vor Hochschrank), dann die für alle Räume; inaktive nie', () => {
    const { passend, allgemein, weitere } = objekteFuerRaum(OBJEKTE, BAD);
    expect(passend.map((o) => o.schluessel)).toEqual(['dusche', 'badewanne', 'waschtisch', 'hochschrank']);
    expect(allgemein.map((o) => o.schluessel)).toEqual(['sonstiges', 'leuchte']);
    expect(weitere.map((o) => o.schluessel)).toEqual(['sofa']);
  });

  it('ohne Raumtyp: allgemeine und alle übrigen', () => {
    const { passend, allgemein, weitere } = objekteFuerRaum(OBJEKTE, null);
    expect([passend.length, allgemein.length, weitere.length]).toEqual([0, 2, 5]);
  });

  it('zuletzt verwendete: neueste zuerst, ohne Doppelte, höchstens 6', () => {
    const daten = new Map<string, string>();
    const sp = { getItem: (k: string) => daten.get(k) ?? null, setItem: (k: string, v: string) => void daten.set(k, v) };
    for (const s of ['a', 'b', 'c', 'a', 'd', 'e', 'f', 'g']) zuletztMerken(s, sp);
    expect(zuletztLesen(sp)).toEqual(['g', 'f', 'e', 'd', 'a', 'c']);
    expect(zuletztLesen(undefined)).toEqual([]);
  });

  it('Maße verständlich', () => {
    expect(masseText({ form: 'rechteck', breite_m: 2.2, tiefe_m: 0.9, hoehe_m: 0.45 })).toBe('2,20 × 0,90 × 0,45 m');
    expect(masseText({ form: 'streifen', breite_m: 1, tiefe_m: null, hoehe_m: null })).toBe('Streifen, Breite 1,00 m');
    expect(masseText({ form: 'punkt', breite_m: null, tiefe_m: null, hoehe_m: null })).toBe('Punkt');
  });
});

describe('Höhe verständlich beschriftet (Praxistest E)', () => {
  it('Standard mit Objektname, nach Änderung „angepasst“', () => {
    expect(hoeheText(null, 0.45, 'Sofa')).toBe('Höhe: 0,45 m (Standard für Sofa)');
    expect(hoeheText(0.5, 0.45, 'Sofa')).toBe('Höhe: 0,50 m (angepasst)');
    expect(hoeheText(undefined, null, 'Dachfenster')).toBe('Höhe: keine Angabe (Standard für Dachfenster fehlt)');
  });
});

describe('Streifen (Dachschräge, Unterzug)', () => {
  it('von Wand zu Wand, Abstand und Breite je Wand; Lage zurückgerechnet', () => {
    const L = 5;
    const B = 4;
    expect(streifenRechteck('oben', 0, 1, L, B)).toEqual({ x: 0, y: 0, b: 5, t: 1 });
    expect(streifenRechteck('unten', 0.5, 0.25, L, B)).toEqual({ x: 0, y: 3.25, b: 5, t: 0.25 });
    expect(streifenRechteck('rechts', 1, 0.5, L, B)).toEqual({ x: 3.5, y: 0, b: 0.5, t: 4 });
    // nie über den Raum hinaus
    expect(streifenRechteck('links', 9, 1, L, B)).toEqual({ x: 4, y: 0, b: 1, t: 4 });
    const s = { id: 's', objekt: 'unterzug', wand: 'unten' as const, ...streifenRechteck('unten', 0.5, 0.25, L, B) };
    expect(streifenLage(s, L, B)).toEqual({ abstand: 0.5, breite: 0.25 });
  });
});
