// Zugriff auf die Backend-API. Die Sitzung liegt im HttpOnly-Cookie; das Frontend sieht kein Token.
// Typen der API-Daten; Schlüssel wie im Backend (snake_case).
import { anfrage } from './offline/daten';

export { ApiFehler } from './netz';

export type Rolle = 'admin' | 'fachpruefer' | 'aussendienst';
export type Projektstatus = 'entwurf' | 'geprueft' | 'freigegeben';
export type Gebaeudestandard = 'neubau' | 'effizienzhaus_sanierung' | 'sonstiger_bestand';
export type Heizlastquelle = 'A' | 'B' | 'C';
export type Angrenzung = 'aussen' | 'beheizt' | 'unbeheizt' | 'erdreich';
export type Herkunft = 'raum' | 'projekt' | 'vorgabe' | 'rueckfall' | 'klimadaten' | 'fehlt';

export interface Benutzer {
  id: number;
  email: string;
  name: string;
  /** kombinierbar, z. B. ['admin', 'fachpruefer'] */
  rollen: Rolle[];
  aktiv: boolean;
}

export function hatRolle(b: Benutzer, ...rollen: Rolle[]): boolean {
  return rollen.some((r) => b.rollen.includes(r));
}

export interface Projekt {
  id: number;
  nummer: string;
  bezeichnung: string;
  kunde_name: string;
  notizen: string;
  status: Projektstatus;
  ersteller_id: number | null;
  geprueft_von_id: number | null;
  geprueft_am: string | null;
  freigegeben_von_id: number | null;
  freigegeben_am: string | null;
  /** Offline-Sperre: welches Gerät das Projekt ausgecheckt hat */
  ausgecheckt_von_id: number | null;
  ausgecheckt_von_name: string | null;
  ausgecheckt_geraet: string | null;
  ausgecheckt_am: string | null;
  /** Stand der im Projekt eingefrorenen Fachvorgaben */
  vorgaben_stand_am: string | null;
  erstellt_am: string;
  geaendert_am: string;
}

export interface Objekt {
  id: number;
  projekt_id: number;
  bezeichnung: string;
  gebaeudestandard: Gebaeudestandard;
  strasse: string;
  plz: string;
  ort: string;
  baujahr: number | null;
  klimadaten_id: number | null;
  delta_u_wb: number | null;
  pauschale_abweichungen: Record<string, number>;
}

export interface ProjektDetail extends Projekt {
  objekte: Objekt[];
}

export interface Geschoss {
  id: number;
  objekt_id: number;
  bezeichnung: string;
  reihenfolge: number;
}

export interface Raum {
  id: number;
  geschoss_id: number;
  bezeichnung: string;
  raumtyp_id: number | null;
  laenge_m: number | null;
  breite_m: number | null;
  flaeche_m2: number | null;
  hoehe_m: number | null;
  volumen_m3: number | null;
  heizlastquelle: Heizlastquelle;
  hottgenroth_w: number | null;
  pauschale_w_m2: number | null;
  theta_int: number | null;
  luftwechsel: number | null;
}

export interface Flaeche {
  id: number;
  raum_id: number;
  bezeichnung: string;
  bauteil_id: number | null;
  u_wert: number | null;
  flaeche_brutto_m2: number;
  orientierung: string;
  angrenzung: Angrenzung;
  angrenzender_raumtyp_id: number | null;
  theta_angrenzend: number | null;
  f_korrektur: number | null;
  delta_u_wb: number | null;
}

export interface Oeffnung {
  id: number;
  bauteilflaeche_id: number;
  bezeichnung: string;
  bauteil_id: number | null;
  u_wert: number | null;
  flaeche_m2: number;
  anzahl: number;
}

export interface Raumtyp {
  id: number;
  bezeichnung: string;
  theta_int: number | null;
  luftwechsel: number | null;
  reduktionsfaktor: number | null;
  quelle: string;
  bemerkung: string;
  reihenfolge: number;
}

export interface Bauteil {
  id: number;
  kategorie: string;
  bezeichnung: string;
  baualtersklasse: string;
  u_wert: number;
  quelle: string;
}

export interface Klimadaten {
  id: number;
  plz: string;
  ort: string;
  theta_e: number;
  theta_m_e: number | null;
  quelle: string;
}

export interface FachvorgabenWerte {
  rueckfall_neubau_w_m2: number | null;
  rueckfall_effizienzhaus_sanierung_w_m2: number | null;
  /** Raumhöhe, ab der ein Hinweis zur Pauschale erscheint (kein Höhenzuschlag) */
  hoehe_hinweis_m: number | null;
  delta_u_wb: number | null;
  quelle: string;
  geaendert_am?: string;
}

export interface Pauschale {
  raumtyp_id: number;
  gebaeudestandard: Gebaeudestandard;
  w_m2: number;
  quelle: string;
}

export interface Fachvorgaben {
  werte: FachvorgabenWerte;
  raumtypen: Raumtyp[];
  pauschalen: Pauschale[];
  gebaeudestandards: Record<Gebaeudestandard, string>;
}

export interface Wert {
  wert: number | null;
  herkunft: Herkunft;
}

export interface AuswertungRaum {
  raum_id: number;
  geschoss_id: number;
  geschoss: string;
  bezeichnung: string;
  raumtyp: string | null;
  flaeche_m2: number | null;
  hoehe_m: number | null;
  quelle: Heizlastquelle;
  werte: { pauschale_w_m2: Wert; theta_int: Wert; luftwechsel: Wert };
  hinweise: string[];
  phi_a_w: number | null;
  phi_b_w: number | null;
  phi_c_w: number | null;
  phi_massgeblich_w: number | null;
  abweichung_c: number | null;
  pauschal: { flaeche_m2: number; pauschale_w_m2: number; phi_w: number } | null;
}

export interface Auswertung {
  rechenkern_version: string;
  objekt: { id: number; gebaeudestandard: Gebaeudestandard; gebaeudestandard_text: string };
  hinweise: string[];
  vorgaben: Record<
    'rueckfall_w_m2' | 'hoehe_hinweis_m' | 'delta_u_wb' | 'theta_e',
    Wert
  >;
  raeume: AuswertungRaum[];
  summe: { phi_massgeblich_w: number; raeume_mit_ergebnis: number; raeume_ohne_ergebnis: number };
}

// Vollständiger Projektstand für den Offline-Speicher (GET /offline/projekte/{id})
export interface FlaechePaket extends Flaeche {
  oeffnungen: Oeffnung[];
}
export interface RaumPaket extends Raum {
  flaechen: FlaechePaket[];
}
export interface GeschossPaket extends Geschoss {
  raeume: RaumPaket[];
}
export interface ObjektPaket extends Objekt {
  geschosse: GeschossPaket[];
}
export interface ProjektPaket extends Projekt {
  objekte: ObjektPaket[];
  /** eingefrorene Fachvorgaben des Projekts (wie Fachvorgaben, ohne Texte) */
  vorgaben_stand: Omit<Fachvorgaben, 'gebaeudestandards'> | null;
}

export interface VorgabenUnterschied {
  bereich: 'Einzelwert' | 'Raumtyp' | 'Pauschale';
  bezeichnung: string;
  alt: number | string | null;
  neu: number | string | null;
}

/** GET /projekte/{id}/vorgaben: womit das Projekt rechnet und was sich zentral geändert hat */
export interface ProjektVorgaben {
  stand_am: string | null;
  vorgaben: Fachvorgaben;
  /** null = nicht geprüft (Projekt auf diesem Gerät ausgecheckt) */
  unterschiede: VorgabenUnterschied[] | null;
  auswirkung: {
    summe_alt_w: number;
    summe_neu_w: number;
    raeume: { raum_id: number; bezeichnung: string; alt_w: number | null; neu_w: number | null }[];
  } | null;
}

/** Schnappschuss für das Rechnen ohne Netz (GET /offline/vorgaben) */
export interface OfflineVorgaben {
  stand: string;
  fachvorgaben: Fachvorgaben;
  bauteile: Bauteil[];
  klimadaten: Klimadaten[];
}

export interface ProtokollEintrag {
  id: number;
  zeitpunkt: string;
  benutzer_name: string;
  objektart: string;
  objekt_id: number | null;
  aktion: 'angelegt' | 'geaendert' | 'geloescht';
  aenderungen: Record<string, unknown>;
}

// Netzzugriff in netz.ts; Projekte, die dieses Gerät ausgecheckt hat, bedient der Offline-Speicher (offline/).
export const api = {
  get: <T>(pfad: string) => anfrage<T>('GET', pfad),
  post: <T>(pfad: string, daten: unknown = {}) => anfrage<T>('POST', pfad, daten),
  patch: <T>(pfad: string, daten: unknown) => anfrage<T>('PATCH', pfad, daten),
  put: <T>(pfad: string, daten: unknown) => anfrage<T>('PUT', pfad, daten),
  loeschen: (pfad: string) => anfrage<void>('DELETE', pfad),
};
