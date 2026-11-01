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
});
