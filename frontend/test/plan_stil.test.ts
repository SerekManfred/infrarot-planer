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
  it('Tippflächen ohne Rand, Auswahl nur an sichtbaren Formen', () => {
    expect(css).toMatch(/\.plan \.plan-tippflaeche \{ fill: transparent; stroke: none !important; \}/);
    expect(css).not.toMatch(/^\.gewaehlt rect/m);
  });
});
