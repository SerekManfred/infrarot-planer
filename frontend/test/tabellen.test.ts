// Einheitliche Tabellen (Paket J) und Emissionsgrad (Paket K). TESTWERTE.
import { describe, expect, it } from 'vitest';
import { zahlText } from '../src/komponenten/VTabelle';
import { HILFE } from '../src/texte';

describe('Tabellen und Emissionsgrad', () => {
  it('Zahlen deutsch, ohne unnötige Nachkommastellen, leer mit Ersatztext', () => {
    expect(zahlText(0.93)).toBe('0,93');
    expect(zahlText(1250)).toBe('1.250');
    expect(zahlText(null, '', 'fehlt')).toBe('fehlt');
    expect(zahlText(45, ' W/m²')).toBe('45 W/m²');
  });
  it('Hilfetext Emissionsgrad wie festgelegt', () => {
    expect(HILFE.emissionsgrad).toBe(
      'Verhältniszahl ohne Einheit: wie viel Wärme die Oberfläche im Vergleich zu einem idealen Strahler abgibt. Pulverbeschichtete Metall- und Glasoberflächen typisch 0,90–0,95; genauen Wert aus dem Herstellerdatenblatt übernehmen.',
    );
  });
});
