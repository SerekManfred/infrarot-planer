// Anzeige für den Außendienst: abgeleiteter Status und verständliche Hinweise.
import { hinweisRaumhoehe, PFLICHT_PAUSCHALE_SONSTIGER_BESTAND } from '@infrarot/rechenkern';
import { describe, expect, it } from 'vitest';
import { GEBAEUDESTANDARDS, HILFE, hinweisFuerAussendienst, statusAnzeige } from '../src/texte';

describe('statusAnzeige', () => {
  it('Entwurf eines Altbaus ohne W/m²-Werte: „wartet auf Fachprüfer“', () => {
    expect(statusAnzeige({ status: 'entwurf', wartet_auf_fachpruefer: true })).toEqual({ text: 'wartet auf Fachprüfer', klasse: 'status-wartet' });
    expect(statusAnzeige({ status: 'entwurf', wartet_auf_fachpruefer: false })).toEqual({ text: 'Vor-Ort-Entwurf', klasse: 'status-entwurf' });
    expect(statusAnzeige({ status: 'freigegeben', wartet_auf_fachpruefer: false }).text).toBe('freigegeben');
  });
});

describe('hinweisFuerAussendienst', () => {
  it('blendet Kontrollrechnung und die schon angezeigte Altbau-Pauschale aus', () => {
    expect(hinweisFuerAussendienst('Gegenprobe C: Vorgabe fehlt: Norm-Außentemperatur')).toBeNull();
    expect(hinweisFuerAussendienst(PFLICHT_PAUSCHALE_SONSTIGER_BESTAND)).toBeNull();
  });
  it('hohe Räume: Anpassung macht der Fachprüfer', () => {
    expect(hinweisFuerAussendienst(hinweisRaumhoehe(2.8))).toBe('Raumhöhe über 2,80 m – der Fachprüfer prüft die Pauschale.');
  });
  it('andere Hinweise bleiben', () => {
    expect(hinweisFuerAussendienst('Eingabe fehlt: Fläche (Länge × Breite)')).toBe('Eingabe fehlt: Fläche (Länge × Breite)');
  });
});

describe('Beschriftungen', () => {
  it('„sonstiger Bestand“ heißt in der Oberfläche „Altbau (nicht Effizienzhaus)“, mit Hilfetext', () => {
    expect(GEBAEUDESTANDARDS.sonstiger_bestand).toBe('Altbau (nicht Effizienzhaus)');
    expect(HILFE.altbau).toContain('legt der Fachprüfer fest');
  });
});
