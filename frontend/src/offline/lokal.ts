// Lokale Bearbeitung eines ausgecheckten Projekts – ohne Netz, ohne IndexedDB (reine Logik, getestet).
//
// Die Oberfläche spricht weiter dieselben API-Pfade an (z. B. PATCH /raeume/5). Für Projekte im Offline-Speicher
// beantwortet ausfuehren() die Anfrage aus dem lokalen Projektstand, ändert ihn und liefert den Eintrag für die
// Warteschlange. Neu angelegte Daten bekommen vorläufige negative IDs; die Synchronisierung ersetzt sie
// beim Übertragen durch die IDs des Servers (pfadAufloesen).

import { berechneObjekt, type ObjektPlanung } from '@infrarot/rechenkern';
import type { Fachvorgaben, Gebaeudestandard, ObjektPaket, OfflineVorgaben, ProjektPaket, ProjektVorgaben } from '../api';
import { GEBAEUDESTANDARDS } from '../texte';

export type Methode = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface LokalesProjekt {
  /** Server-ID oder vorläufige (negative) ID bei offline angelegten Projekten */
  id: number;
  paket: ProjektPaket;
  /** Sperr-Token vom Auschecken; null, solange ein offline angelegtes Projekt noch nicht übertragen ist */
  sperre: string | null;
  geraet: string;
}

/** Änderung, die beim nächsten Verbindungsaufbau an den Server geht */
export interface Eintrag {
  nr?: number;
  projekt_id: number;
  methode: 'POST' | 'PATCH' | 'DELETE';
  pfad: string;
  daten?: unknown;
  /** vorläufige ID des angelegten Datensatzes (POST) */
  temp_id?: number;
  /** POST /projekte: vorläufige ID des mit angelegten Gebäudes */
  temp_objekt_id?: number;
  zeit: string;
  beschreibung: string;
}

export class LokalFehler extends Error {
  constructor(
    public readonly status: number,
    meldung: string,
  ) {
    super(meldung);
  }
}

type Art = 'projekte' | 'objekte' | 'geschosse' | 'raeume' | 'flaechen' | 'oeffnungen';
type Knoten = Record<string, unknown> & { id: number };

const KINDER: Partial<Record<Art, Art>> = {
  projekte: 'objekte',
  objekte: 'geschosse',
  geschosse: 'raeume',
  raeume: 'flaechen',
  flaechen: 'oeffnungen',
};
const FREMDSCHLUESSEL: Record<Exclude<Art, 'projekte'>, string> = {
  objekte: 'projekt_id',
  geschosse: 'objekt_id',
  raeume: 'geschoss_id',
  flaechen: 'raum_id',
  oeffnungen: 'bauteilflaeche_id',
};
const ARTEN = new Set<string>(['projekte', 'objekte', 'geschosse', 'raeume', 'flaechen', 'oeffnungen']);

// Standardwerte wie in den Schemas des Backends (…Neu)
const NEU: Record<Exclude<Art, 'projekte'>, Record<string, unknown>> = {
  objekte: {
    strasse: '', plz: '', ort: '', baujahr: null, klimadaten_id: null, delta_u_wb: null,
    pauschale_abweichungen: {},
  },
  geschosse: { reihenfolge: 0 },
  raeume: {
    raumtyp_id: null, laenge_m: null, breite_m: null, flaeche_m2: null, hoehe_m: null, volumen_m3: null,
    heizlastquelle: 'A', hottgenroth_w: null, pauschale_w_m2: null, theta_int: null, luftwechsel: null,
    sperrflaechen: [], module: [], tueren_fenster: [],
  },
  flaechen: {
    bezeichnung: '', bauteil_id: null, u_wert: null, orientierung: '', angrenzung: 'aussen',
    angrenzender_raumtyp_id: null, theta_angrenzend: null, f_korrektur: null, delta_u_wb: null,
  },
  oeffnungen: { bezeichnung: '', bauteil_id: null, u_wert: null, anzahl: 1 },
};

const BESCHRIFTUNG: Record<Art, string> = {
  projekte: 'Projekt',
  objekte: 'Gebäude',
  geschosse: 'Geschoss',
  raeume: 'Raum',
  flaechen: 'Bauteilfläche',
  oeffnungen: 'Öffnung',
};

interface Fund {
  art: Art;
  knoten: Knoten;
  /** Liste, in der der Knoten steht (null beim Projekt selbst) */
  liste: Knoten[] | null;
}

function* alleKnoten(paket: ProjektPaket): Generator<Fund> {
  yield { art: 'projekte', knoten: paket as unknown as Knoten, liste: null };
  function* kinder(art: Art, knoten: Knoten): Generator<Fund> {
    const kinderArt = KINDER[art];
    if (!kinderArt) return;
    const liste = knoten[kinderArt] as Knoten[];
    for (const kind of liste) {
      yield { art: kinderArt, knoten: kind, liste };
      yield* kinder(kinderArt, kind);
    }
  }
  yield* kinder('projekte', paket as unknown as Knoten);
}

function finde(paket: ProjektPaket, art: Art, id: number): Fund | null {
  for (const f of alleKnoten(paket)) if (f.art === art && f.knoten.id === id) return f;
  return null;
}

/** Zerlegt /raeume/5/flaechen in ['raeume', 5, 'flaechen'] (Rest mit „/“); null, wenn der Pfad keine Projektdaten betrifft */
function zerlege(pfad: string): [Art, number, string | undefined] | null {
  const teile = pfad.split('?')[0].split('/').filter(Boolean);
  if (teile.length < 2 || teile.length > 4 || !ARTEN.has(teile[0]) || !/^-?\d+$/.test(teile[1])) return null;
  return [teile[0] as Art, Number(teile[1]), teile.length > 2 ? teile.slice(2).join('/') : undefined];
}

/** Lokales Projekt, zu dem der Pfad gehört – oder null (dann geht die Anfrage ans Netz) */
export function projektFuerPfad(pfad: string, projekte: LokalesProjekt[]): LokalesProjekt | null {
  const teile = zerlege(pfad);
  if (!teile) return null;
  const [art, id] = teile;
  return projekte.find((lp) => finde(lp.paket, art, id) !== null) ?? null;
}

/** Datensatz ohne seine Kinderliste, wie ihn die API liefert */
function flach(art: Art, knoten: Knoten): Record<string, unknown> {
  const kinderArt = KINDER[art];
  if (!kinderArt) return { ...knoten };
  const { [kinderArt]: _kinder, ...rest } = knoten;
  if (art === 'projekte') {
    // GET /projekte/{id} liefert die Gebäude mit, aber ohne Geschosse
    return {
      ...rest,
      ...abgeleitet(knoten as unknown as ProjektPaket),
      objekte: (knoten.objekte as Knoten[]).map((o) => flach('objekte', o)),
    };
  }
  return rest;
}

/** Geschosse wie auf dem Server nach Reihenfolge; bei Gleichstand in der Reihenfolge des Anlegens */
function sortiert(art: Art, liste: Knoten[]): Knoten[] {
  if (art !== 'geschosse') return liste;
  return [...liste].sort((a, b) => (a.reihenfolge as number) - (b.reihenfolge as number));
}

function raumFlaeche(raum: Knoten) {
  // wie app/routers/hierarchie.py: Fläche des Rechteckraums aus Länge × Breite
  if (raum.laenge_m !== null && raum.breite_m !== null && raum.laenge_m !== undefined && raum.breite_m !== undefined) {
    raum.flaeche_m2 = (raum.laenge_m as number) * (raum.breite_m as number);
  }
}

function name(knoten: Knoten): string {
  const b = knoten.bezeichnung ?? knoten.nummer;
  return typeof b === 'string' && b ? `„${b}“` : '';
}

/**
 * Wie Projekt.wartet_auf_fachpruefer im Backend (app/models.py): Altbau mit mindestens einem Raum ohne W/m²-Wert.
 * Offline aus dem lokalen Stand berechnet, damit neue Räume den Status sofort ändern.
 */
export function wartetAufFachpruefer(paket: ProjektPaket): boolean {
  return paket.objekte.some(
    (o) =>
      o.gebaeudestandard === 'sonstiger_bestand' &&
      o.geschosse.some((g) => g.raeume.some((r) => r.pauschale_w_m2 === null || r.pauschale_w_m2 === undefined)),
  );
}

/**
 * Abgeleitete Kennzeichen wie im Backend. Ob neue zentrale Vorgaben offen sind, weiß nur der Server; offline gilt der
 * Stand vom Auschecken (vorgaben_offen im Paket).
 */
export function abgeleitet(paket: ProjektPaket): Pick<ProjektPaket, 'wartet_auf_fachpruefer' | 'angebot_gesperrt'> {
  const wartet = wartetAufFachpruefer(paket);
  return { wartet_auf_fachpruefer: wartet, angebot_gesperrt: wartet || paket.vorgaben_offen || !!paket.module_offen };
}

/** Fachvorgaben, mit denen das Projekt rechnet: sein eingefrorener Stand (sonst der Schnappschuss des Geräts) */
export function projektStand(paket: ProjektPaket, vorgaben: OfflineVorgaben | null): Fachvorgaben | null {
  if (paket.vorgaben_stand) return { ...paket.vorgaben_stand, gebaeudestandards: GEBAEUDESTANDARDS };
  return vorgaben ? vorgaben.fachvorgaben : null;
}

/** Rechenkern-Eingabe: eingefrorene Fachvorgaben des Projekts, Bibliotheken (U-Werte, Klimadaten) vom Gerät */
export function planungAus(objekt: ObjektPaket, fv: Fachvorgaben, vorgaben: OfflineVorgaben | null): ObjektPlanung {
  const klima = vorgaben?.klimadaten.find((k) => k.id === objekt.klimadaten_id);
  return {
    objekt: {
      id: objekt.id,
      bezeichnung: objekt.bezeichnung,
      gebaeudestandard: objekt.gebaeudestandard,
      gebaeudestandard_text: GEBAEUDESTANDARDS[objekt.gebaeudestandard],
      delta_u_wb: objekt.delta_u_wb,
      pauschale_abweichungen: objekt.pauschale_abweichungen ?? {},
      theta_e: klima ? klima.theta_e : null,
    },
    vorgaben: {
      rueckfall_neubau_w_m2: fv.werte.rueckfall_neubau_w_m2,
      rueckfall_effizienzhaus_sanierung_w_m2: fv.werte.rueckfall_effizienzhaus_sanierung_w_m2,
      // bewusst kein Rückfallwert für „sonstiger Bestand“ (Pauschale je Raum Pflicht)
      rueckfall_sonstiger_bestand_w_m2: null,
      hoehe_hinweis_m: fv.werte.hoehe_hinweis_m,
      delta_u_wb: fv.werte.delta_u_wb,
    },
    pauschalen: fv.pauschalen.map((p) => ({ raumtyp_id: p.raumtyp_id, gebaeudestandard: p.gebaeudestandard, w_m2: p.w_m2 })),
    raumtypen: fv.raumtypen.map((t) => ({
      id: t.id, bezeichnung: t.bezeichnung, theta_int: t.theta_int, luftwechsel: t.luftwechsel, reduktionsfaktor: t.reduktionsfaktor,
    })),
    bauteile: (vorgaben?.bauteile ?? []).map((b) => ({ id: b.id, u_wert: b.u_wert })),
    // Platzierungsregeln im Stand des Projekts
    regeln: fv.regeln ?? [],
    geschosse: (sortiert('geschosse', objekt.geschosse as unknown as Knoten[]) as unknown as ObjektPaket['geschosse']).map((g) => ({
      id: g.id,
      bezeichnung: g.bezeichnung,
      raeume: g.raeume,
    })),
  };
}

export interface Ergebnis {
  antwort: unknown;
  /** Änderung für die Warteschlange; null bei Lesezugriffen */
  eintrag: Omit<Eintrag, 'zeit'> | null;
}

/**
 * Führt eine API-Anfrage auf dem lokalen Projektstand aus (ändert lp.paket).
 * Gibt null zurück, wenn die Anfrage lokal nicht beantwortet werden kann (z. B. Protokoll) – dann ans Netz.
 */
export function ausfuehren(
  lp: LokalesProjekt,
  vorgaben: OfflineVorgaben | null,
  methode: Methode,
  pfad: string,
  daten: unknown,
  neueId: () => number,
): Ergebnis | null {
  const teile = zerlege(pfad);
  if (!teile) return null;
  const [art, id, unterpfad] = teile;
  const fund = finde(lp.paket, art, id);
  if (!fund) throw new LokalFehler(404, `${BESCHRIFTUNG[art]} ${id} nicht gefunden`);
  const eintrag = (beschreibung: string, extra: Partial<Eintrag> = {}): Omit<Eintrag, 'zeit'> => ({
    projekt_id: lp.id, methode: methode as Eintrag['methode'], pfad, daten, beschreibung, ...extra,
  });

  if (unterpfad === undefined) {
    if (methode === 'GET') return { antwort: flach(art, fund.knoten), eintrag: null };
    if (methode === 'PATCH') {
      if (lp.paket.status === 'freigegeben') throw new LokalFehler(409, 'Projekt ist freigegeben und gesperrt.');
      Object.assign(fund.knoten, daten as object);
      if (art === 'raeume') raumFlaeche(fund.knoten);
      if (lp.paket.status === 'geprueft') lp.paket.status = 'entwurf';
      const felder = Object.keys(daten as object).join(', ');
      return { antwort: flach(art, fund.knoten), eintrag: eintrag(`${BESCHRIFTUNG[art]} ${name(fund.knoten)} geändert (${felder})`) };
    }
    if (methode === 'DELETE' && art !== 'projekte' && fund.liste) {
      fund.liste.splice(fund.liste.indexOf(fund.knoten), 1);
      if (lp.paket.status === 'geprueft') lp.paket.status = 'entwurf';
      return { antwort: undefined, eintrag: eintrag(`${BESCHRIFTUNG[art]} ${name(fund.knoten)} gelöscht`) };
    }
    return null;
  }

  if (art === 'objekte' && unterpfad === 'auswertung' && methode === 'GET') {
    const fv = projektStand(lp.paket, vorgaben);
    if (!fv) throw new LokalFehler(503, 'Fachvorgaben sind auf diesem Gerät noch nicht gespeichert – bitte einmal online öffnen.');
    return { antwort: berechneObjekt(planungAus(fund.knoten as unknown as ObjektPaket, fv, vorgaben)).auswertung, eintrag: null };
  }
  if (art === 'projekte' && unterpfad === 'vorgaben' && methode === 'GET') {
    const fv = projektStand(lp.paket, vorgaben);
    if (!fv) throw new LokalFehler(503, 'Fachvorgaben sind auf diesem Gerät noch nicht gespeichert – bitte einmal online öffnen.');
    // Vergleich mit den zentralen Vorgaben macht der Server – erst nach dem Einchecken
    const antwort: ProjektVorgaben = {
      stand_am: lp.paket.vorgaben_stand_am,
      vorgaben: fv,
      unterschiede: null,
      auswirkung: null,
      offen: lp.paket.vorgaben_offen,
      abgelehnt_am: null,
    };
    return { antwort, eintrag: null };
  }
  if (art === 'projekte' && (unterpfad === 'vorgaben/uebernehmen' || unterpfad === 'vorgaben/ablehnen')) {
    throw new LokalFehler(409, 'Über neue Fachvorgaben wird erst nach dem Einchecken entschieden.');
  }
  if (art === 'projekte' && unterpfad === 'status') {
    throw new LokalFehler(409, 'Statuswechsel erst, nachdem das Projekt eingecheckt ist.');
  }

  const kinderArt = KINDER[art];
  if (!kinderArt || kinderArt !== unterpfad) return null;
  const liste = fund.knoten[kinderArt] as Knoten[];
  if (methode === 'GET') return { antwort: sortiert(kinderArt, liste).map((k) => flach(kinderArt, k)), eintrag: null };
  if (methode === 'POST') {
    if (lp.paket.status === 'freigegeben') throw new LokalFehler(409, 'Projekt ist freigegeben und gesperrt.');
    const enkelArt = KINDER[kinderArt];
    const neu: Knoten = {
      ...NEU[kinderArt as Exclude<Art, 'projekte'>],
      ...(daten as object),
      id: neueId(),
      [FREMDSCHLUESSEL[kinderArt as Exclude<Art, 'projekte'>]]: id,
      ...(enkelArt ? { [enkelArt]: [] } : {}),
    };
    if (kinderArt === 'raeume') raumFlaeche(neu);
    liste.push(neu);
    if (lp.paket.status === 'geprueft') lp.paket.status = 'entwurf';
    return {
      antwort: flach(kinderArt, neu),
      eintrag: eintrag(`${BESCHRIFTUNG[kinderArt]} ${name(neu)} angelegt`, { temp_id: neu.id }),
    };
  }
  return null;
}

/** Vorläufige Anzeige, bis der Server die Projektnummer vergibt (Festlegung 31.10.2026) */
export const NUMMER_FOLGT = 'Nr. folgt';

export interface ProjektNeuDaten {
  bezeichnung: string;
  kunde_name?: string;
  notizen?: string;
  gebaeudestandard: Gebaeudestandard;
  strasse?: string;
  plz?: string;
  ort?: string;
}

/** Offline angelegtes Projekt samt Gebäude; die Warteschlange legt es an und checkt es für dieses Gerät aus */
export function neuesProjekt(
  daten: ProjektNeuDaten,
  neueId: () => number,
  benutzer: { id: number; name: string },
  geraet: string,
  jetzt: string,
  /** Fachvorgaben-Schnappschuss des Geräts: damit rechnet das Projekt bis zur Übertragung */
  vorgaben: OfflineVorgaben | null = null,
): { lp: LokalesProjekt; eintraege: Omit<Eintrag, 'zeit'>[] } {
  const id = neueId();
  const objektId = neueId();
  const paket: ProjektPaket = {
    id,
    nummer: NUMMER_FOLGT,
    bezeichnung: daten.bezeichnung,
    kunde_name: daten.kunde_name ?? '',
    notizen: daten.notizen ?? '',
    status: 'entwurf',
    ersteller_id: benutzer.id,
    ersteller_name: benutzer.name,
    zugewiesen_an_id: null,
    zugewiesen_an_name: null,
    geprueft_von_id: null,
    geprueft_am: null,
    freigegeben_von_id: null,
    freigegeben_am: null,
    ausgecheckt_von_id: benutzer.id,
    ausgecheckt_von_name: benutzer.name,
    ausgecheckt_geraet: geraet,
    ausgecheckt_am: jetzt,
    vorgaben_stand_am: vorgaben ? vorgaben.stand : null,
    wartet_auf_fachpruefer: false,
    vorgaben_offen: false,
    module_offen: false,
    angebot_gesperrt: false,
    vorgaben_stand: vorgaben
      ? {
          werte: vorgaben.fachvorgaben.werte,
          raumtypen: vorgaben.fachvorgaben.raumtypen,
          pauschalen: vorgaben.fachvorgaben.pauschalen,
          regeln: vorgaben.fachvorgaben.regeln ?? [],
        }
      : null,
    erstellt_am: jetzt,
    geaendert_am: jetzt,
    objekte: [
      {
        ...(NEU.objekte as Omit<ObjektPaket, 'id' | 'projekt_id' | 'bezeichnung' | 'gebaeudestandard' | 'geschosse'>),
        id: objektId,
        projekt_id: id,
        bezeichnung: 'Gebäude',
        gebaeudestandard: daten.gebaeudestandard,
        strasse: daten.strasse ?? '',
        plz: daten.plz ?? '',
        ort: daten.ort ?? '',
        geschosse: [],
      },
    ],
  };
  return {
    lp: { id, paket, sperre: null, geraet },
    eintraege: [
      { projekt_id: id, methode: 'POST', pfad: '/projekte', temp_id: id, temp_objekt_id: objektId, beschreibung: `Projekt „${daten.bezeichnung}“ angelegt` },
      { projekt_id: id, methode: 'POST', pfad: `/projekte/${id}/auschecken`, daten: { geraet }, beschreibung: 'Projekt für dieses Gerät ausgecheckt' },
    ],
  };
}

/** Anlagedaten eines offline angelegten Projekts – aus dem aktuellen lokalen Stand, damit spätere Korrekturen mitgehen.
 *  Die Projektnummer vergibt der Server. */
export function projektAnlageDaten(paket: ProjektPaket): ProjektNeuDaten {
  const o = paket.objekte[0];
  return {
    bezeichnung: paket.bezeichnung,
    kunde_name: paket.kunde_name,
    notizen: paket.notizen,
    gebaeudestandard: o.gebaeudestandard,
    strasse: o.strasse,
    plz: o.plz,
    ort: o.ort,
  };
}

/** Ersetzt vorläufige IDs im Pfad durch die IDs des Servers; null, wenn eine Zuordnung (noch) fehlt */
export function pfadAufloesen(pfad: string, zuordnung: Record<string, number>): string | null {
  let fehlt = false;
  const aufgeloest = pfad.replace(/\/(-\d+)(?=\/|$)/g, (_, temp: string) => {
    const echt = zuordnung[temp];
    if (echt === undefined) fehlt = true;
    return `/${echt}`;
  });
  return fehlt ? null : aufgeloest;
}

/** ID nach Zuordnung (für vorläufige IDs die des Servers, sobald bekannt) */
export function aufgeloesteId(id: number, zuordnung: Record<string, number>): number {
  return id < 0 ? (zuordnung[String(id)] ?? id) : id;
}
