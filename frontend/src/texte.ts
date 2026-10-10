// Anzeigetexte und Formatierung (deutsch)
import type { Angrenzung, Gebaeudestandard, Herkunft, Heizlastquelle, Projektstatus, Rolle } from './api';

export const ROLLEN: Record<Rolle, string> = {
  aussendienst: 'Außendienst MEH',
  fachpruefer: 'Fachprüfer Serek',
  admin: 'Admin',
};

export const STATUS: Record<Projektstatus, string> = {
  entwurf: 'Vor-Ort-Entwurf',
  geprueft: 'fachlich geprüft',
  freigegeben: 'freigegeben',
};

export const GEBAEUDESTANDARDS: Record<Gebaeudestandard, string> = {
  neubau: 'Neubau',
  effizienzhaus_sanierung: 'Effizienzhaus-Sanierung',
  sonstiger_bestand: 'sonstiger Bestand',
};

export const HINWEIS_SONSTIGER_BESTAND =
  'Infrarot als alleiniges Heizsystem wird für diesen Gebäudestandard nicht empfohlen.';

export const QUELLEN: Record<Heizlastquelle, string> = {
  A: 'A Pauschal',
  B: 'B Hottgenroth',
  C: 'C Berechnung',
};

export const HERKUNFT: Record<Herkunft, string> = {
  raum: 'Raumwert',
  projekt: 'Projektwert',
  vorgabe: 'Vorgabe',
  rueckfall: 'Rückfallwert',
  klimadaten: 'Klimadaten',
  fehlt: 'Vorgabe fehlt',
};

export const ANGRENZUNG: Record<Angrenzung, string> = {
  aussen: 'Außenluft',
  beheizt: 'beheizter Raum',
  unbeheizt: 'unbeheizter Raum',
  erdreich: 'Erdreich',
};

const zahlFormate = new Map<number, Intl.NumberFormat>();

export function zahl(wert: number | null | undefined, stellen = 2): string {
  if (wert === null || wert === undefined) return '–';
  if (!zahlFormate.has(stellen)) {
    zahlFormate.set(stellen, new Intl.NumberFormat('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen }));
  }
  return zahlFormate.get(stellen)!.format(wert);
}

export function watt(wert: number | null | undefined): string {
  return wert === null || wert === undefined ? '–' : `${zahl(wert, 0)} W`;
}

export function prozent(anteil: number | null | undefined): string {
  if (anteil === null || anteil === undefined) return '–';
  return `${anteil > 0 ? '+' : ''}${zahl(anteil * 100, 0)} %`;
}

/** Liest Zahlen mit Komma oder Punkt; leer → null; ungültig → NaN */
export function leseZahl(text: string): number | null {
  const bereinigt = text.trim().replace(/\s/g, '').replace(',', '.');
  if (bereinigt === '') return null;
  return /^-?\d*\.?\d+$/.test(bereinigt) ? Number(bereinigt) : NaN;
}

const zeitFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });

export function zeitpunkt(iso: string | null): string {
  return iso ? zeitFormat.format(new Date(iso)) : '–';
}
