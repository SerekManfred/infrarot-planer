// Modulauswahl und Platzierung von Infrarot-Deckenmodulen (Festlegung Auftraggeber 14.10.2026).
//
// Draufsicht der Decke eines rechteckigen Raums: Ursprung linke obere Ecke, x entlang der Raumlänge, y entlang der
// Raumbreite, alles in Metern. Module und Sperrflächen sind achsparallele Rechtecke, Leuchten und Rauchmelder Punkte.
// Abstände werden als kürzeste (euklidische) Entfernung zwischen den Kanten gemessen.
//
// Regeln kommen aus der Regeltabelle des Projekts (eingefroren wie die übrigen Fachvorgaben). Fehlt eine Regel,
// wird nichts geschätzt: Der Hinweis „Vorgabe fehlt“ erscheint, und was davon abhängt, wird nicht geprüft
// bzw. nicht automatisch geplant.
//
// Objekte im Raum (Möbel, Deckeneinbauten, Bauliches) kommen aus der Objektbibliothek des Projekts
// (Festlegung 01.11.2026, ebenfalls eingefroren). Je Objekt bestimmt die Kategorie die Regelprüfung:
// - tabu: kein Modul darüber, dazu Mindestabstand zum Objekt,
// - abstand: Modul darf auch darüber liegen, muss aber den Mindestabstand zur Kante des Objekts einhalten
//   (ein Modul, das über die Kante ragt, verstößt immer),
// - neutral: nur Darstellung und Wärmeverteilung, keine Regel.
// Punkte (Deckeneinbauten wie Leuchten) werden nie überdeckt, ihr Abstand zählt zur nächsten Modulkante.

/** Frühere feste Sperrflächen-Typen (bis 01.11.2026); ihre Schlüssel sind zugleich Schlüssel der Objektbibliothek */
import { enthaeltRechteck, rechteckForm, wandAbstand, type Raumform } from './raumform';

export type SperrTyp = 'sitzplatz' | 'bett' | 'hochschrank' | 'dachschraege' | 'dusche' | 'sonstiges' | 'leuchte' | 'rauchmelder';
export type Wand = 'oben' | 'unten' | 'links' | 'rechts';

export type ObjektGruppe = 'moebel' | 'decke' | 'baulich';
export type ObjektForm = 'rechteck' | 'punkt' | 'streifen';
export type ObjektKategorie = 'tabu' | 'abstand' | 'neutral';

export const OBJEKT_GRUPPEN: Record<ObjektGruppe, string> = { moebel: 'Möbel', decke: 'Deckeneinbauten', baulich: 'Bauliches' };
export const OBJEKT_FORMEN: Record<ObjektForm, string> = { rechteck: 'Rechteck', punkt: 'Punkt', streifen: 'Streifen entlang Wand' };
export const OBJEKT_KATEGORIEN: Record<ObjektKategorie, string> = {
  tabu: 'tabu – kein Modul darüber',
  abstand: 'Abstand – Modul erlaubt, Mindestabstand zur Kante',
  neutral: 'neutral – nur Darstellung',
};

/** Eintrag der Objektbibliothek (Fachvorgaben) */
export interface BibObjekt {
  schluessel: string;
  name: string;
  gruppe: ObjektGruppe;
  /** passende Raumtypen (IDs); leer = alle */
  raumtyp_ids: number[];
  form: ObjektForm;
  /** Standardmaße in m (Streifen: breite = Tiefe ab der Wand) */
  breite_m: number | null;
  tiefe_m: number | null;
  /** Höhe der Oberseite über dem Fußboden in m (Wärmeverteilung); leer = keine Empfangsfläche */
  hoehe_m: number | null;
  kategorie: ObjektKategorie;
  /** Mindestabstand in cm; leer = Vorgabe fehlt (bei neutral ohne Bedeutung) */
  abstand_cm: number | null;
  quelle?: string;
  aktiv?: boolean;
  reihenfolge?: number;
}

/** Für die Prüfung aufgelöstes Objekt */
export interface ObjektRegel {
  name: string;
  form: ObjektForm;
  kategorie: ObjektKategorie;
  abstand_m: number | null;
  hoehe_m: number | null;
}

export const HINWEIS_BAD = 'Schutzbereiche nach DIN VDE 0100-701 durch Elektrofachkraft prüfen';

export interface Rechteck {
  x: number;
  y: number;
  /** Ausdehnung in x */
  b: number;
  /** Ausdehnung in y */
  t: number;
}

/** Objekt im Raum (früher „Sperrfläche“); Punkt: b = t = 0, Streifen: wand gesetzt */
export interface Sperrflaeche extends Rechteck {
  id: string;
  /** Schlüssel des Objekts in der Objektbibliothek */
  objekt?: string;
  /** veraltet: fester Typ vor dem 01.11.2026 (wird wie der gleichnamige Objektschlüssel behandelt) */
  typ?: SperrTyp;
  wand?: Wand | null;
  bezeichnung?: string;
  /** Höhe der Oberseite über dem Fußboden in m (Wärmeverteilung); leer = Standard des Objekts */
  hoehe?: number | null;
  /** Form (Paket N4, „Sonstige Sperrfläche“): Rechteck, Quadrat oder rund (Kreis mit Durchmesser b = t); leer = Rechteck */
  umriss?: 'rechteck' | 'quadrat' | 'rund' | null;
  /** Kategorie abweichend von der Objektbibliothek (Paket N4, „Sonstige Sperrfläche“); leer = laut Bibliothek */
  kategorie?: ObjektKategorie | null;
}

/** Runde Sperrfläche: Kreis im Quadrat x, y, b (= t) */
export function istRund(s: Pick<Sperrflaeche, 'umriss'>): boolean {
  return s.umriss === 'rund';
}

/** Kürzeste Entfernung Rechteck ↔ Kreisfläche (0 bei Überlappung) – nicht über die umschließende Box (Paket N4) */
export function kreisAbstand(a: Rechteck, s: Rechteck): number {
  const r = s.b / 2;
  const cx = s.x + r;
  const cy = s.y + s.t / 2;
  const dx = Math.max(a.x - cx, 0, cx - (a.x + a.b));
  const dy = Math.max(a.y - cy, 0, cy - (a.y + a.t));
  return Math.max(0, Math.hypot(dx, dy) - r);
}

/** Abstand eines Moduls zum Kreisrand: außen wie kreisAbstand, ganz innen Radius − weiteste Modulecke, über den Rand 0 */
export function kreisKantenAbstand(a: Rechteck, s: Rechteck): number {
  const aussen = kreisAbstand(a, s);
  if (aussen > 0) return aussen;
  const r = s.b / 2;
  const cx = s.x + r;
  const cy = s.y + s.t / 2;
  const weiteste = Math.max(...[[a.x, a.y], [a.x + a.b, a.y], [a.x, a.y + a.t], [a.x + a.b, a.y + a.t]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
  return Math.max(0, r - weiteste);
}

/** Schlüssel des Bibliotheksobjekts einer Sperrfläche (auch für ältere Daten mit festem Typ) */
export function objektSchluessel(s: Pick<Sperrflaeche, 'objekt' | 'typ'>): string {
  return s.objekt ?? s.typ ?? '';
}

/** Punktobjekt (Deckeneinbau): keine Ausdehnung */
export function istPunkt(s: Rechteck): boolean {
  // fehlende Ausdehnung (ältere bzw. per Schnittstelle gespeicherte Punkte ohne b/t) zählt als Punkt
  return !((s.b ?? 0) > EPS) && !((s.t ?? 0) > EPS);
}

export interface KatalogModul {
  id: number;
  artikel_nr: string;
  bezeichnung: string;
  leistung_w: number;
  laenge_mm: number;
  breite_mm: number;
  schutzart: string;
  bad_geeignet: boolean;
  aktiv?: boolean;
}

export interface PlatziertesModul {
  id: string;
  modul_id: number | null;
  artikel_nr: string;
  bezeichnung: string;
  leistung_w: number;
  laenge_m: number;
  breite_m: number;
  schutzart: string;
  bad_geeignet: boolean;
  /** linke obere Ecke */
  x: number;
  y: number;
  /** false: Modullänge entlang der Raumlänge (x) */
  gedreht: boolean;
}

/** Regel wie in der Regeltabelle (Fachvorgaben) */
export interface Regel {
  schluessel: string;
  bezeichnung: string;
  wert: number | null;
  wert_text: string;
  einheit?: string;
}

/** Aufgelöste Regeln in Metern bzw. Prozent; null = Vorgabe fehlt */
export interface Regeln {
  wand_m: number | null;
  modul_m: number | null;
  /** Objektbibliothek nach Schlüssel */
  objekte: Record<string, ObjektRegel>;
  mindesthoehe_m: number | null;
  reserve_prozent: number | null;
  ueberdimensionierung_prozent: number | null;
  thermostat_je_raum: boolean | null;
  bad_min_ip: number | null;
  /** Bezeichnung je Schlüssel für Meldungen „Vorgabe fehlt: …“ */
  bezeichnung: Record<string, string>;
}

export interface PlatzierungsRaum {
  laenge_m: number;
  breite_m: number;
  hoehe_m: number | null;
  ist_bad: boolean;
  /** zusammengesetzte Raumform (Paket M2); fehlt sie, gilt das Rechteck Länge × Breite */
  form?: Raumform | null;
}

/** Raumform für Prüfung und Platzierung: angegebene Form oder Rechteck */
function formVon(raum: PlatzierungsRaum): Raumform {
  return raum.form ?? rechteckForm(raum.laenge_m, raum.breite_m);
}

const EPS = 1e-6;
const RASTER_M = 0.05;
export const MAX_ANZAHL = 12;

/** Regeltabelle und Objektbibliothek → Regeln in Metern; fehlende Werte bleiben null */
export function regelnAufloesen(regeln: Regel[] | undefined, objekte: BibObjekt[] = []): Regeln {
  const nach = new Map((regeln ?? []).map((r) => [r.schluessel, r]));
  const zahl = (s: string) => nach.get(s)?.wert ?? null;
  const cm = (s: string) => {
    const w = zahl(s);
    return w === null ? null : w / 100;
  };
  const janein = (s: string) => {
    const t = (nach.get(s)?.wert_text ?? '').trim().toLowerCase();
    return t === 'ja' ? true : t === 'nein' ? false : null;
  };
  const ip = schutzartZahl(nach.get('bad_min_schutzart')?.wert_text ?? '');
  const bezeichnung: Record<string, string> = {};
  for (const r of regeln ?? []) bezeichnung[r.schluessel] = r.bezeichnung;
  return {
    wand_m: cm('abstand_wand_cm'),
    modul_m: cm('abstand_modul_cm'),
    objekte: Object.fromEntries(
      objekte.map((o) => [
        o.schluessel,
        { name: o.name, form: o.form, kategorie: o.kategorie, abstand_m: o.abstand_cm === null ? null : o.abstand_cm / 100, hoehe_m: o.hoehe_m },
      ]),
    ),
    mindesthoehe_m: zahl('mindesthoehe_m'),
    reserve_prozent: zahl('leistungsreserve_prozent'),
    ueberdimensionierung_prozent: zahl('ueberdimensionierung_prozent'),
    thermostat_je_raum: janein('thermostat_je_raum'),
    bad_min_ip: ip,
    bezeichnung,
  };
}

/** „IP44“ → 44; unbekannt → null */
export function schutzartZahl(schutzart: string): number | null {
  const t = /^IP\s*(\d{2})$/i.exec(schutzart.trim());
  return t ? Number(t[1]) : null;
}

function fehlt(r: Regeln, schluessel: string, fallback: string): string {
  return `Vorgabe fehlt: ${r.bezeichnung[schluessel] ?? fallback}`;
}

// ── Geometrie ──

/** Kürzeste Entfernung zwischen zwei Rechtecken (0 bei Berührung oder Überlappung) */
export function abstand(a: Rechteck, b: Rechteck): number {
  const dx = Math.max(0, b.x - (a.x + a.b), a.x - (b.x + b.b));
  const dy = Math.max(0, b.y - (a.y + a.t), a.y - (b.y + b.t));
  return Math.hypot(dx, dy);
}

/** Echte Überlappung (mehr als Berührung); ein Punkt (b = t = 0) überlappt, wenn er im Inneren liegt */
export function ueberlappt(a: Rechteck, b: Rechteck): boolean {
  return a.x < b.x + b.b - EPS && b.x < a.x + a.b - EPS && a.y < b.y + b.t - EPS && b.y < a.y + a.t - EPS;
}

/**
 * Abstand eines Moduls zur Kante eines Objekts: außerhalb die kürzeste Entfernung, ganz innerhalb der kleinste
 * Abstand zu den Objektkanten, über die Kante ragend 0.
 */
export function kantenAbstand(modul: Rechteck, objekt: Rechteck): number {
  if (!ueberlappt(modul, objekt)) return abstand(modul, objekt);
  const innen =
    modul.x >= objekt.x - EPS && modul.y >= objekt.y - EPS && modul.x + modul.b <= objekt.x + objekt.b + EPS && modul.y + modul.t <= objekt.y + objekt.t + EPS;
  if (!innen) return 0;
  return Math.max(0, Math.min(modul.x - objekt.x, modul.y - objekt.y, objekt.x + objekt.b - (modul.x + modul.b), objekt.y + objekt.t - (modul.y + modul.t)));
}

export function modulRechteck(m: Pick<PlatziertesModul, 'x' | 'y' | 'laenge_m' | 'breite_m' | 'gedreht'>): Rechteck {
  return m.gedreht ? { x: m.x, y: m.y, b: m.breite_m, t: m.laenge_m } : { x: m.x, y: m.y, b: m.laenge_m, t: m.breite_m };
}

function cm(m: number): string {
  return `${Math.round(m * 100)} cm`;
}

function meterText(m: number): string {
  return m.toFixed(2).replace('.', ',');
}

/** Bevorzugte Ausrichtung: Modul-Längsseite parallel zur langen Raumseite */
export function bevorzugtGedreht(raum: Pick<PlatzierungsRaum, 'laenge_m' | 'breite_m'>): boolean {
  return raum.breite_m > raum.laenge_m;
}

// ── Objekte im Raum ──

/** Objekt der Bibliothek zu einer Sperrfläche; null = nicht in der Objektbibliothek des Projekts */
export function objektRegel(r: Regeln, s: Sperrflaeche): ObjektRegel | null {
  return r.objekte[objektSchluessel(s)] ?? null;
}

export function objektName(r: Regeln, s: Sperrflaeche): string {
  // eigener Name (z. B. Sonstige Sperrfläche „Kamin“, Paket N4) vor dem Bibliotheksnamen
  return s.bezeichnung?.trim() || objektRegel(r, s)?.name || `Objekt „${objektSchluessel(s) || 'ohne Angabe'}“`;
}

/** Wie ein Objekt für Prüfung und Platzierung zählt; unbekannte Objekte vorsichtshalber als tabu ohne Mindestabstand */
function objektWirkung(r: Regeln, s: Sperrflaeche): { name: string; kategorie: ObjektKategorie; min: number | null; bekannt: boolean } {
  const o = objektRegel(r, s);
  // eigene Kategorie (Sonstige Sperrfläche, Paket N4) vor der Bibliothek; Mindestabstand bleibt der der Bibliothek
  return { name: objektName(r, s), kategorie: s.kategorie ?? o?.kategorie ?? 'tabu', min: o?.abstand_m ?? null, bekannt: o !== null };
}

/** Maßgeblicher Abstand Modul ↔ Objekt (0 = liegt darüber bzw. ragt über die Kante) */
function objektAbstand(a: Rechteck, s: Sperrflaeche, kategorie: ObjektKategorie): number {
  if (istPunkt(s)) return abstand(a, s);
  if (istRund(s)) return kategorie === 'abstand' ? kreisKantenAbstand(a, s) : kreisAbstand(a, s);
  if (kategorie === 'abstand') return kantenAbstand(a, s);
  return ueberlappt(a, s) ? 0 : abstand(a, s);
}

function fehltObjekt(name: string, bekannt: boolean): string {
  return bekannt ? `Vorgabe fehlt: Mindestabstand zu ${name} (Objektbibliothek)` : `Vorgabe fehlt: ${name} ist nicht in der Objektbibliothek des Projekts`;
}

// ── Regelprüfung ──

export interface Pruefung {
  /** je Modul-ID die Verstöße im Klartext (leer = regelkonform) */
  verstoesse: Record<string, string[]>;
  /** Hinweise zum Raum (z. B. Vorgabe fehlt, Bad) */
  hinweise: string[];
}

function modulName(module: PlatziertesModul[], i: number): string {
  return `Modul ${i + 1} (${module[i].artikel_nr})`;
}

/** Prüft alle Module eines Raums gegen Wand, Sperrflächen, Leuchten, Rauchmelder, andere Module, Bad und Raumhöhe */
export function pruefeModule(raum: PlatzierungsRaum, sperr: Sperrflaeche[], module: PlatziertesModul[], r: Regeln): Pruefung {
  const verstoesse: Record<string, string[]> = {};
  const hinweise = new Set<string>();
  const form = formVon(raum);
  const zuNiedrig = r.mindesthoehe_m !== null && raum.hoehe_m !== null && raum.hoehe_m < r.mindesthoehe_m - EPS;
  if (module.length > 0) {
    if (r.wand_m === null) hinweise.add(`${fehlt(r, 'abstand_wand_cm', 'Mindestabstand Modul – Wand')} – nicht geprüft`);
    if (module.length > 1 && r.modul_m === null) hinweise.add(`${fehlt(r, 'abstand_modul_cm', 'Mindestabstand Modul – Modul')} – nicht geprüft`);
    if (r.mindesthoehe_m === null) hinweise.add(`${fehlt(r, 'mindesthoehe_m', 'Mindestraumhöhe für Deckenmontage')} – nicht geprüft`);
    if (raum.ist_bad) {
      hinweise.add(HINWEIS_BAD);
      if (r.bad_min_ip === null) hinweise.add(`${fehlt(r, 'bad_min_schutzart', 'Bad: zulässige Module')} – geprüft wird nur „Bad geeignet“`);
    }
  }

  module.forEach((m, i) => {
    const liste: string[] = [];
    const a = modulRechteck(m);
    if (!enthaeltRechteck(form, a)) {
      liste.push('ragt über den Raum hinaus');
    } else if (r.wand_m !== null) {
      const zurWand = wandAbstand(form, a);
      if (zurWand < r.wand_m - EPS) liste.push(`Abstand zur Wand ${cm(zurWand)} (mind. ${cm(r.wand_m)})`);
    }
    for (const s of sperr) {
      const { name, kategorie, min, bekannt } = objektWirkung(r, s);
      if (kategorie === 'neutral') continue;
      if (!bekannt) hinweise.add(`${fehltObjekt(name, false)} – geprüft wird nur, dass kein Modul darüber liegt`);
      const punkt = istPunkt(s);
      const d = objektAbstand(a, s, kategorie);
      if (punkt || kategorie === 'tabu') {
        const darueber = punkt || istRund(s) ? d <= EPS : ueberlappt(a, s);
        if (darueber) {
          liste.push(punkt ? `liegt über ${name}` : `liegt über ${name} – dort ist kein Modul zulässig`);
          continue;
        }
        if (min === null) {
          if (bekannt) hinweise.add(`${fehltObjekt(name, true)} – ${punkt ? 'nicht geprüft' : 'geprüft wird nur, dass kein Modul darüber liegt'}`);
          continue;
        }
        if (d < min - EPS) liste.push(`Abstand zu ${name} ${cm(d)} (mind. ${cm(min)})`);
        continue;
      }
      // Kategorie „abstand“: darüber erlaubt, aber mit Mindestabstand zur Kante
      if (min === null) {
        hinweise.add(`${fehltObjekt(name, bekannt)} – nicht geprüft`);
        continue;
      }
      if (d < min - EPS) liste.push(`Abstand zur Kante ${name} ${cm(d)} (mind. ${cm(min)})`);
    }
    module.forEach((n, j) => {
      if (j === i) return;
      const b = modulRechteck(n);
      if (ueberlappt(a, b)) liste.push(`überdeckt ${modulName(module, j)}`);
      else if (r.modul_m !== null) {
        const d = abstand(a, b);
        if (d < r.modul_m - EPS) liste.push(`Abstand zu ${modulName(module, j)} ${cm(d)} (mind. ${cm(r.modul_m)})`);
      }
    });
    if (raum.ist_bad) {
      const ip = schutzartZahl(m.schutzart);
      if (!m.bad_geeignet) liste.push(`nicht für das Bad geeignet (${m.schutzart || 'Schutzart unbekannt'})`);
      else if (r.bad_min_ip !== null && (ip === null || ip < r.bad_min_ip)) {
        liste.push(`Schutzart ${m.schutzart || 'unbekannt'} unter IP${r.bad_min_ip} (Bad)`);
      }
    }
    if (zuNiedrig) liste.push(`Raumhöhe ${meterText(raum.hoehe_m!)} m unter der Mindesthöhe ${meterText(r.mindesthoehe_m!)} m für Deckenmontage`);
    verstoesse[m.id] = liste;
  });
  return { verstoesse, hinweise: [...hinweise] };
}

// ── Leistung ──

/** Benötigte Leistung = Raumheizlast × (1 + Leistungsreserve); null, wenn Heizlast oder Reserve fehlt */
export function benoetigteLeistung(heizlastW: number | null, r: Regeln): number | null {
  if (heizlastW === null || r.reserve_prozent === null) return null;
  return heizlastW * (1 + r.reserve_prozent / 100);
}

export type Leistungsstatus = 'unter' | 'ueber' | 'passend';

/** Bewertung der installierten Leistung; null, wenn nicht prüfbar (keine Module, keine benötigte Leistung) */
export function leistungsstatus(benoetigtW: number | null, installiertW: number, r: Regeln): Leistungsstatus | null {
  if (benoetigtW === null || installiertW === 0) return null;
  if (installiertW < benoetigtW - EPS) return 'unter';
  if (r.ueberdimensionierung_prozent === null) return null;
  return (installiertW / benoetigtW - 1) * 100 > r.ueberdimensionierung_prozent + EPS ? 'ueber' : 'passend';
}

/** Warnungen zur installierten Leistung (Unterschreitung, Überdimensionierung) */
export function leistungPruefen(benoetigtW: number | null, installiertW: number, r: Regeln): string[] {
  if (benoetigtW === null || installiertW === 0) return [];
  const w = (x: number) => `${Math.round(x).toLocaleString('de-DE')} W`;
  if (installiertW < benoetigtW - EPS) {
    return [`Installierte Leistung ${w(installiertW)} unterschreitet die benötigte Leistung ${w(benoetigtW)}`];
  }
  if (r.ueberdimensionierung_prozent === null) {
    return [`${fehlt(r, 'ueberdimensionierung_prozent', 'Maximale Überdimensionierung')} – Überdimensionierung nicht geprüft`];
  }
  const ueber = (installiertW / benoetigtW - 1) * 100;
  if (ueber > r.ueberdimensionierung_prozent + EPS) {
    return [
      `Installierte Leistung ${w(installiertW)} übersteigt die benötigte ${w(benoetigtW)} um ${Math.round(ueber)} % (max. ${r.ueberdimensionierung_prozent} %)`,
    ];
  }
  return [];
}

// ── Zulässige Module ──

export function zulaessigeModule(katalog: KatalogModul[], raum: PlatzierungsRaum, r: Regeln): KatalogModul[] {
  return katalog.filter((m) => {
    if (m.aktiv === false) return false;
    if (!raum.ist_bad) return true;
    if (!m.bad_geeignet) return false;
    const ip = schutzartZahl(m.schutzart);
    return r.bad_min_ip === null || (ip !== null && ip >= r.bad_min_ip);
  });
}

// ── Automatische Platzierung ──

interface Kandidat {
  x: number;
  y: number;
  /** Mittelpunkt */
  mx: number;
  my: number;
  /** Abstand zur nächsten Sperrfläche (Vorzug für freie Bewegungsflächen) */
  frei: number;
}

/** Für die automatische Planung nötige Regeln; fehlt eine, wird nicht automatisch platziert */
export function fehlendeRegelnFuerPlanung(sperr: Sperrflaeche[], r: Regeln): string[] {
  const liste: string[] = [];
  if (r.wand_m === null) liste.push(fehlt(r, 'abstand_wand_cm', 'Mindestabstand Modul – Wand'));
  if (r.modul_m === null) liste.push(fehlt(r, 'abstand_modul_cm', 'Mindestabstand Modul – Modul'));
  // Punkte (Leuchten, Rauchmelder …) brauchen ihren Mindestabstand, sonst wird nicht automatisch geplant
  for (const s of sperr) {
    if (!istPunkt(s)) continue;
    const { name, kategorie, min, bekannt } = objektWirkung(r, s);
    const text = fehltObjekt(name, bekannt);
    if (kategorie !== 'neutral' && min === null && !liste.includes(text)) liste.push(text);
  }
  return liste;
}

function kandidaten(raum: PlatzierungsRaum, sperr: Sperrflaeche[], r: Regeln, w: number, h: number): Kandidat[] {
  const wand = r.wand_m ?? 0;
  const form = formVon(raum);
  const { x0, y0, x1, y1 } = form.bbox;
  const liste: Kandidat[] = [];
  const nx = Math.floor((x1 - x0 - 2 * wand - w) / RASTER_M + EPS);
  const ny = Math.floor((y1 - y0 - 2 * wand - h) / RASTER_M + EPS);
  if (nx < 0 || ny < 0) return liste;
  // Rest gleichmäßig verteilen, damit das Raster mittig sitzt
  const rx = (x1 - x0 - 2 * wand - w - nx * RASTER_M) / 2;
  const ry = (y1 - y0 - 2 * wand - h - ny * RASTER_M) / 2;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const a = { x: x0 + wand + rx + i * RASTER_M, y: y0 + wand + ry + j * RASTER_M, b: w, t: h };
      // nicht rechteckige Räume: ganz im Raum und mit Wandabstand zu allen Wandsegmenten (auch Innenecken)
      if (!form.rechteck && (!enthaeltRechteck(form, a) || wandAbstand(form, a) < wand - EPS)) continue;
      let frei = Infinity;
      let ok = true;
      for (const s of sperr) {
        const { kategorie, min } = objektWirkung(r, s);
        if (kategorie === 'neutral') continue;
        const d = objektAbstand(a, s, kategorie);
        if (d <= EPS || d < (min ?? 0) - EPS) {
          ok = false;
          break;
        }
        if (!istPunkt(s)) frei = Math.min(frei, d);
      }
      if (ok) liste.push({ x: a.x, y: a.y, mx: a.x + w / 2, my: a.y + h / 2, frei });
    }
  }
  return liste;
}

function vertraeglich(k: Kandidat, gewaehlt: Kandidat[], w: number, h: number, modulM: number): boolean {
  const a = { x: k.x, y: k.y, b: w, t: h };
  return gewaehlt.every((g) => abstand(a, { x: g.x, y: g.y, b: w, t: h }) >= modulM - EPS);
}

/** Zielpunkte für eine gleichmäßige Verteilung von n Modulen in einem Bereich (Raster mit passender Spaltenzahl) */
function ziele(n: number, x0: number, x1: number, y0: number, y1: number): { x: number; y: number }[] {
  const bx = Math.max(x1 - x0, EPS);
  const by = Math.max(y1 - y0, EPS);
  const spalten = Math.min(n, Math.max(1, Math.round(Math.sqrt((n * bx) / by))));
  const zeilen = Math.ceil(n / spalten);
  const punkte: { x: number; y: number }[] = [];
  let rest = n;
  for (let z = 0; z < zeilen; z++) {
    const inZeile = Math.ceil(rest / (zeilen - z));
    rest -= inZeile;
    for (let s = 0; s < inZeile; s++) {
      punkte.push({ x: x0 + ((s + 0.5) / inZeile) * (x1 - x0), y: y0 + ((z + 0.5) / zeilen) * (y1 - y0) });
    }
  }
  return punkte;
}

function auswahlNachZielen(kand: Kandidat[], n: number, w: number, h: number, modulM: number): Kandidat[] | null {
  const xs = kand.map((k) => k.mx);
  const ys = kand.map((k) => k.my);
  const gewaehlt: Kandidat[] = [];
  for (const z of ziele(n, Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys))) {
    let bester: Kandidat | null = null;
    let besteWertung = Infinity;
    for (const k of kand) {
      // nah am Zielpunkt; bei Gleichstand lieber mit mehr Abstand zu Möbeln (Bewegungsfläche)
      const wertung = Math.hypot(k.mx - z.x, k.my - z.y) - Math.min(k.frei, 1) * 0.01;
      if (wertung < besteWertung && vertraeglich(k, gewaehlt, w, h, modulM)) {
        bester = k;
        besteWertung = wertung;
      }
    }
    if (!bester) return null;
    gewaehlt.push(bester);
  }
  return gewaehlt;
}

function auswahlWeitestePunkte(kand: Kandidat[], n: number, w: number, h: number, modulM: number): Kandidat[] | null {
  const cx = kand.reduce((s, k) => s + k.mx, 0) / kand.length;
  const cy = kand.reduce((s, k) => s + k.my, 0) / kand.length;
  const gewaehlt: Kandidat[] = [];
  while (gewaehlt.length < n) {
    let bester: Kandidat | null = null;
    let besteWertung = -Infinity;
    for (const k of kand) {
      if (!vertraeglich(k, gewaehlt, w, h, modulM)) continue;
      const wertung =
        gewaehlt.length === 0
          ? -Math.hypot(k.mx - cx, k.my - cy)
          : Math.min(...gewaehlt.map((g) => Math.hypot(k.mx - g.mx, k.my - g.my)));
      if (wertung > besteWertung + EPS) {
        bester = k;
        besteWertung = wertung;
      }
    }
    if (!bester) return null;
    gewaehlt.push(bester);
  }
  return gewaehlt;
}

export function platziertesModul(m: KatalogModul, x: number, y: number, gedreht: boolean, id: string): PlatziertesModul {
  return {
    id,
    modul_id: m.id,
    artikel_nr: m.artikel_nr,
    bezeichnung: m.bezeichnung,
    leistung_w: m.leistung_w,
    laenge_m: Math.max(m.laenge_mm, m.breite_mm) / 1000,
    breite_m: Math.min(m.laenge_mm, m.breite_mm) / 1000,
    schutzart: m.schutzart,
    bad_geeignet: m.bad_geeignet,
    x: runden(x),
    y: runden(y),
    gedreht,
  };
}

function runden(m: number): number {
  return Math.round(m * 1000) / 1000;
}

type Cache = Map<string, Kandidat[]>;

/**
 * Platziert n gleiche Module regelkonform und möglichst gleichmäßig verteilt; null, wenn es nicht geht.
 * Bevorzugt die Längsseite parallel zur langen Raumseite; erst wenn das nicht passt, quer.
 */
export function platzieren(
  raum: PlatzierungsRaum,
  sperr: Sperrflaeche[],
  r: Regeln,
  modul: KatalogModul,
  n: number,
  neueId: () => string,
  cache: Cache = new Map(),
): PlatziertesModul[] | null {
  if (r.wand_m === null || r.modul_m === null) return null;
  const lang = Math.max(modul.laenge_mm, modul.breite_mm) / 1000;
  const kurz = Math.min(modul.laenge_mm, modul.breite_mm) / 1000;
  const bevorzugt = bevorzugtGedreht(raum);
  for (const gedreht of lang === kurz ? [bevorzugt] : [bevorzugt, !bevorzugt]) {
    const w = gedreht ? kurz : lang;
    const h = gedreht ? lang : kurz;
    const schluessel = `${w}x${h}`;
    if (!cache.has(schluessel)) cache.set(schluessel, kandidaten(raum, sperr, r, w, h));
    const kand = cache.get(schluessel)!;
    if (kand.length < 1) continue;
    const auswahl = auswahlNachZielen(kand, n, w, h, r.modul_m) ?? auswahlWeitestePunkte(kand, n, w, h, r.modul_m);
    if (auswahl) return auswahl.map((k) => platziertesModul(modul, k.x, k.y, gedreht, neueId()));
  }
  return null;
}

export interface Vorschlag {
  /** null: keine gültige Lösung (siehe meldung) */
  module: PlatziertesModul[] | null;
  benoetigt_w: number | null;
  installiert_w: number;
  /** Erklärung, wenn nichts vorgeschlagen werden kann */
  meldung: string | null;
  /** Warnungen und Hinweise (Leistung, Bad, quer gedreht …) */
  hinweise: string[];
}

function wText(x: number): string {
  return `${Math.round(x).toLocaleString('de-DE')} W`;
}

/**
 * Modulauswahl: möglichst wenige gleiche Module aus dem Katalog, die zusammen mindestens die benötigte Leistung
 * bringen und regelkonform in die freie Deckenfläche passen. Bei gleicher Anzahl gewinnt die kleinste ausreichende
 * Leistung (geringste Überdimensionierung), dann die kleinere Modulfläche.
 */
export function vorschlagen(
  raum: PlatzierungsRaum,
  sperr: Sperrflaeche[],
  katalog: KatalogModul[],
  r: Regeln,
  heizlastW: number | null,
  neueId: () => string,
): Vorschlag {
  const ohne = (meldung: string, hinweise: string[] = []): Vorschlag => ({
    module: null, benoetigt_w: benoetigt, installiert_w: 0, meldung, hinweise,
  });
  const benoetigt = benoetigteLeistung(heizlastW, r);
  const hinweise = raum.ist_bad ? [HINWEIS_BAD] : [];
  if (heizlastW === null) return ohne('Keine Heizlast für diesen Raum – zuerst Maße, Raumtyp und W/m² vervollständigen.', hinweise);
  if (benoetigt === null) return ohne(`${fehlt(r, 'leistungsreserve_prozent', 'Leistungsreserve')} – keine Modulauswahl.`, hinweise);
  const fehlend = fehlendeRegelnFuerPlanung(sperr, r);
  if (fehlend.length > 0) return ohne(`${fehlend.join('; ')} – keine automatische Platzierung.`, hinweise);
  if (r.mindesthoehe_m !== null && raum.hoehe_m !== null && raum.hoehe_m < r.mindesthoehe_m - EPS) {
    return ohne(`Raumhöhe ${meterText(raum.hoehe_m)} m unter der Mindesthöhe ${meterText(r.mindesthoehe_m)} m – keine Deckenmontage.`, hinweise);
  }
  const auswahl = zulaessigeModule(katalog, raum, r);
  if (auswahl.length === 0) {
    return ohne(raum.ist_bad ? 'Kein Modul im Katalog ist für das Bad zugelassen.' : 'Der Modulkatalog ist leer.', hinweise);
  }

  const grenze = r.ueberdimensionierung_prozent === null ? Infinity : benoetigt * (1 + r.ueberdimensionierung_prozent / 100);
  // Kandidaten hängen nur von den Modulmaßen ab (Schlüssel in platzieren): ein Zwischenspeicher für alle Module
  const cache: Cache = new Map();
  for (let n = 1; n <= MAX_ANZAHL; n++) {
    const passend = auswahl
      .filter((m) => n * m.leistung_w >= benoetigt - EPS)
      .sort((a, b) => a.leistung_w - b.leistung_w || a.laenge_mm * a.breite_mm - b.laenge_mm * b.breite_mm);
    // innerhalb der Überdimensionierungsgrenze zuerst
    const reihenfolge = [...passend.filter((m) => n * m.leistung_w <= grenze + EPS), ...passend.filter((m) => n * m.leistung_w > grenze + EPS)];
    for (const m of reihenfolge) {
      const module = platzieren(raum, sperr, r, m, n, neueId, cache);
      if (!module) continue;
      const installiert = n * m.leistung_w;
      const extra = [...leistungPruefen(benoetigt, installiert, r)];
      if (module[0].gedreht !== bevorzugtGedreht(raum)) extra.push('Module quer zur langen Raumseite – längs war kein Platz.');
      return { module, benoetigt_w: benoetigt, installiert_w: installiert, meldung: null, hinweise: [...extra, ...hinweise] };
    }
  }

  // Keine Lösung: größte mögliche Leistung ermitteln, damit der Vorschlag konkret wird
  let beste: { n: number; m: KatalogModul } | null = null;
  for (const m of auswahl) {
    for (let n = 1; n <= MAX_ANZAHL; n++) {
      if (!platzieren(raum, sperr, r, m, n, neueId, cache)) break;
      if (!beste || n * m.leistung_w > beste.n * beste.m.leistung_w) beste = { n, m };
    }
  }
  if (!beste) {
    return ohne(
      `Kein Modul passt in die freie Deckenfläche (Wandabstand ${cm(r.wand_m!)}, Sperrflächen und ihre Abstände). Vorschlag: Sperrflächen prüfen oder kleinere Module manuell setzen.`,
      hinweise,
    );
  }
  return ohne(
    `Keine gültige Lösung: benötigt ${wText(benoetigt)}, in die freie Deckenfläche passen höchstens ${wText(beste.n * beste.m.leistung_w)} (${beste.n} × ${beste.m.artikel_nr}). Vorschlag: kleinere oder mehr Module wählen, Sperrflächen prüfen.`,
    hinweise,
  );
}

// ── Raumergebnis für die Raumliste ──

export interface ModulZusammenfassung {
  artikel_nr: string;
  bezeichnung: string;
  leistung_w: number;
  anzahl: number;
}

/** Grenze für den Berichtsstatus „Prüfen“ (Festlegung Auftraggeber 02.11.2026, Paket M4): Reserve über 20 % */
export const BERICHT_RESERVE_GRENZE_PROZENT = 20;

export type BerichtStatus = 'ok' | 'pruefen' | 'unterdeckt';

export const BERICHT_STATUS_TEXT: Record<BerichtStatus, string> = { ok: 'OK', pruefen: 'Prüfen', unterdeckt: 'Unterdeckt' };

/**
 * Status je Raum für den Ergebnisbericht: Unterdeckt = Modulleistung unter der Heizlast; Prüfen = Reserve über 20 %;
 * OK = Reserve 0 bis 20 %. Reserve = installierte Leistung / Heizlast − 1. Ohne Heizlast oder Module: null.
 */
export function berichtStatus(heizlastW: number | null, installiertW: number): { reserve_prozent: number | null; status: BerichtStatus | null } {
  if (heizlastW === null || heizlastW <= 0 || installiertW <= 0) return { reserve_prozent: null, status: null };
  const reserve = (installiertW / heizlastW - 1) * 100;
  if (installiertW < heizlastW - EPS) return { reserve_prozent: reserve, status: 'unterdeckt' };
  return { reserve_prozent: reserve, status: reserve > BERICHT_RESERVE_GRENZE_PROZENT + EPS ? 'pruefen' : 'ok' };
}

export interface RaumModulplanung {
  /** Reserve der installierten Leistung gegenüber der Raumheizlast in % (Bericht); null ohne Heizlast/Module */
  reserve_prozent: number | null;
  /** Status für den Ergebnisbericht (OK / Prüfen / Unterdeckt) */
  bericht_status: BerichtStatus | null;
  benoetigt_w: number | null;
  installiert_w: number;
  anzahl: number;
  typen: ModulZusammenfassung[];
  thermostate: number;
  verstoesse: Record<string, string[]>;
  /** Anzahl Module mit Regelverstoß */
  module_mit_verstoss: number;
  /** Unter-/Überdimensionierung (deutlich anzeigen); null = nicht prüfbar */
  leistung: Leistungsstatus | null;
  /** Warnung zur Leistung im Klartext, sonst null */
  leistung_hinweis: string | null;
  hinweise: string[];
}

/** Zusammenfassung der Module eines Raums inklusive Regelprüfung und Leistungswarnungen */
export function raumModulplanung(
  raum: PlatzierungsRaum,
  sperr: Sperrflaeche[],
  module: PlatziertesModul[],
  r: Regeln,
  heizlastW: number | null,
): RaumModulplanung {
  const benoetigt = benoetigteLeistung(heizlastW, r);
  const installiert = module.reduce((s, m) => s + m.leistung_w, 0);
  const typen = new Map<string, ModulZusammenfassung>();
  for (const m of module) {
    const t = typen.get(m.artikel_nr) ?? { artikel_nr: m.artikel_nr, bezeichnung: m.bezeichnung, leistung_w: m.leistung_w, anzahl: 0 };
    t.anzahl += 1;
    typen.set(m.artikel_nr, t);
  }
  const pruefung = pruefeModule(raum, sperr, module, r);
  const hinweise = [...pruefung.hinweise];
  if (module.length > 0) {
    if (heizlastW !== null && benoetigt === null) hinweise.push(`${fehlt(r, 'leistungsreserve_prozent', 'Leistungsreserve')} – Leistung nicht geprüft`);
    // „Vorgabe fehlt“ zur Überdimensionierung bleibt Hinweis; echte Unter-/Überdimensionierung steht in leistung_hinweis
    hinweise.push(...leistungPruefen(benoetigt, installiert, r).filter((h) => h.startsWith('Vorgabe fehlt')));
    if (r.thermostat_je_raum === null) hinweise.push(fehlt(r, 'thermostat_je_raum', 'Thermostat je Raum'));
  }
  const bericht = berichtStatus(heizlastW, installiert);
  return {
    reserve_prozent: bericht.reserve_prozent,
    bericht_status: bericht.status,
    benoetigt_w: benoetigt,
    installiert_w: installiert,
    anzahl: module.length,
    typen: [...typen.values()].sort((a, b) => b.leistung_w - a.leistung_w),
    // ein Thermostat je Raum mit Modulen (Regel „Thermostat je Raum“)
    thermostate: module.length > 0 && r.thermostat_je_raum ? 1 : 0,
    verstoesse: pruefung.verstoesse,
    module_mit_verstoss: Object.values(pruefung.verstoesse).filter((v) => v.length > 0).length,
    leistung: leistungsstatus(benoetigt, installiert, r),
    leistung_hinweis: leistungPruefen(benoetigt, installiert, r).find((h) => h.startsWith('Installierte Leistung')) ?? null,
    hinweise,
  };
}
