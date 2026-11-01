// Regression 31.10.2026: Eine Auswahl-Regel mit „stroke-width: 3px“ wirkte auf Tippfläche und Wandausschnitt von
// Tür/Fenster ohne non-scaling-stroke – 3 px wurden zu 3 m (riesige orange Fläche). Striche im Plan müssen immer in
// Bildschirmpixeln gezeichnet werden, Tippflächen dürfen nie einen Rand haben.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('Deckenplan-Stile', () => {
  it('alle Striche im Plan in Bildschirmpixeln', () => {
    expect(css).toMatch(/\.plan \* \{ vector-effect: non-scaling-stroke; \}/);
  });
  it('Modulkatalog: Kopfzeile und Spalte Artikel-Nr. fixiert, eigener Scrollbereich', () => {
    expect(css).toMatch(/\.katalog-rahmen \{[^}]*overflow: auto;/);
    expect(css).toMatch(/\.modulkatalog thead th \{ position: sticky; top: 0;/);
    expect(css).toMatch(/\.modulkatalog tbody td:first-child \{ position: sticky; left: 0;/);
  });
  it('Wärmeverteilung nimmt keine Zeigereingaben an (Sperrflächen und Module bleiben bedienbar)', () => {
    expect(css).toMatch(/\.waerme-schicht \{[^}]*pointer-events: none;/);
  });
  it('Tippflächen ohne Rand, Auswahl nur an sichtbaren Formen', () => {
    expect(css).toMatch(/\.plan \.plan-tippflaeche \{ fill: transparent; stroke: none !important; \}/);
    expect(css).not.toMatch(/^\.gewaehlt rect/m);
  });
  it('Beschriftungen im Plan schwarz mit weißem Rand (lesbar über der Wärmeverteilung), kräftige Umrisse', () => {
    const regel = /\.plan text \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(regel).toMatch(/fill: #000/);
    expect(regel).toMatch(/stroke: #fff/);
    expect(regel).toMatch(/paint-order: stroke/);
    expect(css).not.toMatch(/\.plan-modul text \{ fill: #fff/);
    expect(css).toMatch(/\.plan-sperr rect:not\(\.plan-halo\):not\(\.plan-halo-innen\), \.plan-modul rect \{ stroke-width: 2\.5px;/);
  });
  it('Hilfetexte dunkel und kontrastreich (Kontrast zu Weiß mindestens 7:1)', () => {
    const farbe = /--leise: #([0-9a-f]{6});/.exec(css)![1];
    const kanal = (i: number) => {
      const c = parseInt(farbe.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const l = 0.2126 * kanal(0) + 0.7152 * kanal(2) + 0.0722 * kanal(4);
    expect(1.05 / (l + 0.05)).toBeGreaterThanOrEqual(7);
  });
  it('Modulkatalog ohne Mindestbreiten je Spalte (passt am Laptop), Kopfzeile fixiert', () => {
    expect(css).not.toMatch(/\.modulkatalog td \{ min-width/);
    expect(css).toMatch(/\.modulkatalog th, \.modulkatalog td \{[^}]*white-space: nowrap;/);
  });
});
