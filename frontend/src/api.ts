// Zugriff auf die Backend-API. Die Sitzung liegt im HttpOnly-Cookie; das Frontend sieht kein Token.
// Typen der API-Daten; Schlüssel wie im Backend (snake_case).
import type { PlatziertesModul, RaumModulplanung, Regel, Sperrflaeche, TuerFenster } from '@infrarot/rechenkern';
import { anfrage } from './offline/daten';

export type { PlatziertesModul, Sperrflaeche, TuerFenster };

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

/** Volle Fachansicht (Kontrollrechnung, Fachvorgaben) für Fachprüfer und Admins; der Außendienst sieht die vereinfachte */
export function fachansicht(b: Benutzer): boolean {
  return hatRolle(b, 'fachpruefer', 'admin');
}

export interface Projekt {
  id: number;
  nummer: string;
  bezeichnung: string;
  kunde_name: string;
  notizen: string;
  status: Projektstatus;
  ersteller_id: number | null;
  ersteller_name: string | null;
  /** zuständiger Außendienst (Zuweisung durch Admin, z. B. Urlaubsvertretung) */
  zugewiesen_an_id: number | null;
  zugewiesen_an_name: string | null;
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
  /** Altbau mit Räumen ohne W/m²-Wert: wartet auf den Fachprüfer, gesperrt für Prüfung und Angebot (abgeleitet) */
  wartet_auf_fachpruefer: boolean;
  /** neue zentrale Fachvorgaben, über die der Fachprüfer noch nicht entschieden hat (übernehmen oder ablehnen) */
  vorgaben_offen: boolean;
  /** geänderte Katalogdaten verwendeter Module, über die der Fachprüfer noch nicht entschieden hat */
  module_offen: boolean;
  /** kein Angebot möglich: wartet_auf_fachpruefer oder vorgaben_offen */
  angebot_gesperrt: boolean;
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
  /** Draufsicht der Decke (m ab linker oberer Raumecke) */
  sperrflaechen: Sperrflaeche[];
  module: PlatziertesModul[];
  /** Türen und Fenster nur zur Orientierung (keine Sperrflächen) */
  tueren_fenster: TuerFenster[];
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
  /** Orientierung für den Fachprüfer bei Altbau, wird nie automatisch verwendet */
  richtwert_altbau_w_m2: number | null;
}

/** Platzierungsregel (feste Liste, gepflegt werden Wert und Quelle) */
export interface Platzierungsregel extends Regel {
  einheit: string;
  erlaeuterung: string;
  quelle: string;
  reihenfolge: number;
}

/** Modul aus dem Modulkatalog */
export interface KatalogModulDaten {
  id: number;
  artikel_nr: string;
  bezeichnung: string;
  leistung_w: number;
  laenge_mm: number;
  breite_mm: number;
  bauhoehe_mm: number | null;
  gewicht_kg: number | null;
  schutzart: string;
  bad_geeignet: boolean;
  oberflaeche: string;
  ek_netto: number | null;
  vk_netto: number | null;
  montagezeit_min: number | null;
  quelle: string;
  bemerkung: string;
  aktiv: boolean;
  /** nur Wärmeverteilung; leer = Vorgabewert der Fachvorgaben */
  oberflaechentemperatur_c: number | null;
  emissionsgrad: number | null;
  abstrahlwinkel_grad: number | null;
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
  /** fehlt in Projektständen vor dem 14.10.2026 */
  regeln?: Platzierungsregel[];
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
  /** Module, Thermostate, Regelprüfung und Leistungswarnungen */
  modulplanung: RaumModulplanung;
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
  summe: {
    phi_massgeblich_w: number;
    raeume_mit_ergebnis: number;
    raeume_ohne_ergebnis: number;
    module: number;
    installiert_w: number;
    thermostate: number;
  };
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
  bereich: 'Einzelwert' | 'Raumtyp' | 'Pauschale' | 'Platzierungsregel';
  bezeichnung: string;
  alt: number | string | null;
  neu: number | string | null;
}

/** GET /projekte/{id}/vorgaben: womit das Projekt rechnet und was sich zentral geändert hat */
export interface ProjektVorgaben {
  stand_am: string | null;
  vorgaben: Fachvorgaben;
  /** null = nicht geprüft (Projekt auf diesem Gerät ausgecheckt); enthält auch bewusst abgelehnte Unterschiede */
  unterschiede: VorgabenUnterschied[] | null;
  /** der Fachprüfer muss noch übernehmen oder ablehnen; bis dahin kein Angebot */
  offen: boolean;
  /** wann der Fachprüfer den aktuellen zentralen Stand bewusst abgelehnt hat */
  abgelehnt_am: string | null;
  auswirkung: VorgabenAuswirkung | null;
}

/** Auswirkung neuer Fachvorgaben auf ein Projekt (nur Räume mit geänderter Heizlast, Leistung oder Regelprüfung) */
export interface VorgabenAuswirkung {
  summe_alt_w: number;
  summe_neu_w: number;
  raeume: {
    raum_id: number;
    bezeichnung: string;
    alt_w: number | null;
    neu_w: number | null;
    neue_verstoesse: number;
    installiert_alt_w: number;
    installiert_neu_w: number;
  }[];
  neue_verstoesse: number;
  installiert_alt_w: number;
  installiert_neu_w: number;
}

/** GET /projekte/{id}/module-abgleich: geänderte Katalogdaten der verwendeten Module */
export interface ModulAbgleich {
  unterschiede: { modul_id: number; artikel_nr: string; feld: string; bezeichnung: string; alt: number | string | boolean | null; neu: number | string | boolean | null }[];
  offen: boolean;
  auswirkung: VorgabenAuswirkung | null;
}

/** Projekt in der Sammelansicht bzw. in der Vorschau einer Fachvorgaben-Änderung */
export interface AbgleichProjekt extends VorgabenAuswirkung {
  projekt_id: number;
  nummer: string;
  bezeichnung: string;
  status: Projektstatus;
  ausgecheckt: boolean;
  unterschiede: number;
  /** Anlass: geänderte Fachvorgaben oder geänderte Moduldaten */
  art: 'vorgaben' | 'module';
}

/** Geplante Fachvorgaben-Änderung für POST /fachvorgaben/vorschau */
export interface VorschauAnfrage {
  art: 'werte' | 'raumtyp_neu' | 'raumtyp_aendern' | 'raumtyp_loeschen' | 'pauschale' | 'regel';
  ziel?: number | string;
  daten?: Record<string, unknown>;
}

export interface VorschauErgebnis {
  betroffen: AbgleichProjekt[];
  geprueft: number;
}

/** Schnappschuss für das Rechnen ohne Netz (GET /offline/vorgaben) */
export interface OfflineVorgaben {
  stand: string;
  fachvorgaben: Fachvorgaben;
  bauteile: Bauteil[];
  klimadaten: Klimadaten[];
  /** aktive Module des Katalogs (fehlt in Schnappschüssen vor dem 14.10.2026) */
  module?: KatalogModulDaten[];
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
