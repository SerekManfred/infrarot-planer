// Anzeigetexte und Formatierung (deutsch)
import { PFLICHT_PAUSCHALE_SONSTIGER_BESTAND } from '@infrarot/rechenkern';
import type { Angrenzung, Gebaeudestandard, Herkunft, Heizlastquelle, Projekt, Projektstatus, Rolle } from './api';

export const ROLLEN: Record<Rolle, string> = {
  admin: 'Admin',
  fachpruefer: 'Fachprüfer Serek',
  aussendienst: 'Außendienst MEH',
};

export function rollenText(rollen: Rolle[]): string {
  return rollen.map((r) => ROLLEN[r]).join(' + ');
}

export const STATUS: Record<Projektstatus, string> = {
  entwurf: 'Vor-Ort-Entwurf',
  geprueft: 'fachlich geprüft',
  freigegeben: 'freigegeben',
};

/** Angezeigter Status: „wartet auf Fachprüfer“ wird aus den Daten abgeleitet (Altbau, Raum ohne W/m²-Wert) */
export function statusAnzeige(p: Pick<Projekt, 'status' | 'wartet_auf_fachpruefer'>): { text: string; klasse: string } {
  if (p.status === 'entwurf' && p.wartet_auf_fachpruefer) return { text: 'wartet auf Fachprüfer', klasse: 'status-wartet' };
  return { text: STATUS[p.status], klasse: `status-${p.status}` };
}

export const GEBAEUDESTANDARDS: Record<Gebaeudestandard, string> = {
  neubau: 'Neubau',
  effizienzhaus_sanierung: 'Effizienzhaus-Sanierung',
  sonstiger_bestand: 'Altbau (nicht Effizienzhaus)',
};

export const HINWEIS_SONSTIGER_BESTAND =
  'Infrarot als alleiniges Heizsystem wird für diesen Gebäudestandard nicht empfohlen.';

export const PAUSCHALE_DURCH_FACHPRUEFER = 'Pauschale wird vom Fachprüfer festgelegt';

/**
 * Hinweise des Rechenkerns für den Außendienst: Kontrollrechnung ausblenden, die fehlende Altbau-Pauschale steht schon
 * an der Pauschale, und Anpassungen der Pauschale macht der Fachprüfer.
 */
export function hinweisFuerAussendienst(h: string): string | null {
  if (h.startsWith('Gegenprobe C:') || h === PFLICHT_PAUSCHALE_SONSTIGER_BESTAND) return null;
  if (h.startsWith('Raumhöhe über')) return h.replace(/ – Pauschale prüfen und ggf\. manuell anpassen\.$/, ' – der Fachprüfer prüft die Pauschale.');
  return h;
}

/** Beschriftungen von Fachbegriffen; Formelzeichen klein in Klammern dahinter */
export const BEGRIFF = {
  raumtemperatur: 'Raumtemperatur (θint, °C)',
  luftwechsel: 'Luftwechsel (n, pro Stunde)',
  korrekturfaktor: 'Korrekturfaktor angrenzender Raum (f)',
  quelle: 'Quelle des Werts',
  uWert: 'U-Wert (W/(m²K))',
  waermebruecken: 'Wärmebrückenzuschlag (ΔU_WB, W/(m²K))',
};

/**
 * Hilfetexte in Alltagssprache für das ⓘ neben Fachbegriffen (Festlegung 13.10.2026).
 * Die ersten fünf sind vom Auftraggeber vorgegeben, die übrigen sinngemäß ergänzt. Bewusst ohne Fachwerte.
 */
export const HILFE = {
  altbau:
    'Bestandsgebäude ohne Effizienzhaus-Standard. Infrarot als alleinige Heizung wird hier nicht empfohlen; die Werte legt der Fachprüfer fest.',
  raumtemperatur: 'Gewünschte Temperatur im Raum, z. B. Wohnen 20 °C, Bad 24 °C. Nur für die Kontrollrechnung.',
  luftwechsel: 'Wie oft die Raumluft pro Stunde ausgetauscht wird, z. B. 0,5 = die Hälfte der Luft je Stunde. Nur für die Kontrollrechnung.',
  korrekturfaktor:
    'Berücksichtigt, ob ein Bauteil an Außenluft (1,0), Erdreich oder einen unbeheizten Raum grenzt (kleiner als 1). Nur für die Kontrollrechnung.',
  quelle: 'Woher der Wert stammt, z. B. „Erfahrungswert Serek 2026“ oder eine Norm.',

  gebaeudestandard: 'Wie gut das Gebäude gedämmt ist. Davon hängt ab, wie viel Heizleistung je m² gebraucht wird.',
  neubau: 'Neu gebautes Gebäude nach heutigem Wärmeschutz.',
  effizienzhaus: 'Bestandsgebäude, das auf einen Effizienzhaus-Standard saniert wurde (z. B. gedämmt, neue Fenster).',
  raumtyp: 'Wofür der Raum genutzt wird, z. B. Wohnen, Bad, Schlafen. Davon hängt der W/m²-Wert ab.',
  hoehe: 'Höhe vom Fußboden bis zur Decke. Bei sehr hohen Räumen prüft der Fachprüfer den W/m²-Wert.',
  pauschale: 'Heizleistung in Watt je Quadratmeter Raumfläche. Fläche × W/m² ergibt die Heizlast des Raums. Den Wert gibt der Fachprüfer vor.',
  heizlast:
    'Heizleistung in Watt, die der Raum an einem sehr kalten Tag braucht, um warm zu bleiben. Danach richtet sich die Leistung der Infrarot-Module.',
  heizlastSumme: 'Alle Raumheizlasten zusammengezählt, in Watt.',
  heizlastquelle:
    'Woher die Heizlast stammt: A = Fläche × W/m², B = Wert aus einer Berechnung mit Hottgenroth, C = vereinfachte Berechnung über die Bauteile.',
  hottgenroth: 'Raumheizlast aus einer Berechnung mit der Software Hottgenroth, in Watt übernommen.',
  kontrollrechnung:
    'Überschlägige Berechnung aus Wänden, Fenstern, Decke, Boden und Lüftung. Dient zur Kontrolle der Heizlast aus der W/m²-Pauschale.',
  abweichung: 'Unterschied zwischen Kontrollrechnung und gewählter Heizlast. Über 20 % wird er rot markiert.',
  herkunft:
    'Woher der W/m²-Wert kommt: Raumwert = nur für diesen Raum, Projektwert = nur für dieses Projekt, Vorgabe = Tabelle des Fachprüfers, Rückfallwert = allgemeiner Wert des Gebäudestandards.',
  rueckfallwert: 'W/m²-Wert, der gilt, wenn für einen Raumtyp kein eigener Wert hinterlegt ist.',
  hinweisHoehe: 'Ab dieser Raumhöhe erscheint der Hinweis, den W/m²-Wert zu prüfen. Es wird nichts automatisch aufgeschlagen.',
  uWert: 'Wie viel Wärme ein Bauteil (Wand, Fenster, Dach) nach außen verliert. Je kleiner der Wert, desto besser gedämmt. Nur für die Kontrollrechnung.',
  waermebruecken:
    'Aufschlag auf alle U-Werte für Wärmeverluste an Ecken, Anschlüssen und Durchdringungen. Nur für die Kontrollrechnung.',
  klimadaten: 'Tiefste Außentemperatur, mit der am Standort gerechnet wird; ermittelt über die Postleitzahl. Nur für die Kontrollrechnung.',
  angrenzung: 'Woran das Bauteil auf der anderen Seite grenzt: Außenluft, Erdreich, einen beheizten oder unbeheizten Raum.',
  wartet: 'Bei Altbau legt der Fachprüfer die W/m²-Werte fest. Bis dahin kann das Projekt nicht geprüft und nicht angeboten werden.',
  vorgabenStand:
    'Das Projekt rechnet mit den Fachvorgaben vom Tag des Anlegens. Spätere Änderungen gelten erst nach „Neue Vorgaben übernehmen“.',
  auschecken: 'Projekt auf dieses Gerät holen, damit es ohne Internet bearbeitet werden kann. Andere können es so lange nicht ändern.',
} as const;

/** Erklärung je Gebäudestandard (für das ⓘ an der Auswahl) */
export const HILFE_GEBAEUDESTANDARD: Record<Gebaeudestandard, string> = {
  neubau: HILFE.neubau,
  effizienzhaus_sanierung: HILFE.effizienzhaus,
  sonstiger_bestand: HILFE.altbau,
};

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
