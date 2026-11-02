// Deckenplan eines Raums (Festlegungen 14.10., 31.10. und 01.11.2026): maßstäbliche Draufsicht mit Objekten aus der
// Objektbibliothek (Möbel, Deckeneinbauten, Bauliches), Modulen, Türen und Fenstern, bemaßt wie im Bauplan.
// Bedienung per Finger: antippen = auswählen, ziehen = verschieben, Eckpunkte ziehen = Größe ändern (jede Richtung).
// Regelprüfung live mit dem Rechenkern (gleiche Regeln wie Server und Raumliste); gespeichert wird beim Loslassen.
// Türen und Fenster dienen nur der Orientierung – keine Sperrflächen, ohne Einfluss auf die Platzierung.
// Vorerst nur rechteckige Räume; Maße in m ab der linken oberen Raumecke (x = Länge, y = Breite).
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  bevorzugtGedreht,
  FENSTER_BREITE_M,
  formVonRaum,
  istBad,
  istRund,
  istPunkt,
  punktImRaum,
  teilRechteck,
  wandAbstand,
  modulRechteck,
  naechstesSegment,
  objektName,
  objektRegel,
  objektSchluessel,
  oeffnungStrecke,
  platziertesModul,
  raumModulplanung,
  regelnAufloesen,
  TUER_BREITE_M,
  tuerGeometrie,
  vorschlagen,
  wandAbstaende,
  wandLaenge,
  wandLinie,
  zulaessigeModule,
  type KatalogModul,
  type PlatzierungsRaum,
  type Raumform,
  type RaumTeil,
  type TuerFenster,
  type Wand,
} from '@infrarot/rechenkern';
import { api, type AuswertungRaum, type BibliotheksObjekt, type Fachvorgaben, type KatalogModulDaten, type PlatziertesModul, type Raum, type Sperrflaeche } from '../api';
import { HILFE, watt, zahl } from '../texte';
import { Hilfe, Meldung, Schalter, Textfeld, Zahlfeld } from './Felder';
import { KATEGORIE_WAHL, ObjektAuswahl, UMRISSE, type SonstigeAngaben } from './Objektbibliothek';
import { beschriftungEinpassen, kreisAusZeiger, objektDrehen, objektMasse, quadratAusEcke, streifenLage, streifenRechteck } from '../planhilfen';
import {
  berechnen as waermeBerechnen,
  HINWEIS_WAERME,
  skala,
  WaermeLegende,
  WaermeMarke,
  WaermeSchicht,
  type SkalaArt,
} from './Waermeverteilung';

type Aendern = (aktion: () => Promise<unknown>) => Promise<void>;
type Schnappschuss = { sperr: Sperrflaeche[]; module: PlatziertesModul[]; oeffnungen: TuerFenster[] };

interface Props {
  raum: Raum;
  ergebnis: AuswertungRaum | undefined;
  vorgaben: Fachvorgaben;
  gesperrt: boolean;
  aendern: Aendern;
}

const RASTER = 0.05;
const MIN_GROESSE = 0.1;
const WAENDE: Record<Wand, string> = { oben: 'oben', unten: 'unten', links: 'links', rechts: 'rechts' };
const WANDANFANG: Record<Wand, string> = { oben: 'von links', unten: 'von links', links: 'von oben', rechts: 'von oben' };

type Ecke = 'nw' | 'ne' | 'sw' | 'se';
type Art = 'sperr' | 'modul' | 'oeffnung' | 'teil';
type Auswahl = { art: Art; id: string } | null;
/** schieben; Rechteck: Ecke ziehen; Streifen: Kante ziehen (Breite); Tür/Fenster: Anfang oder Ende ziehen (Breite) */
type Zug = { art: Art; id: string; modus: 'schieben' | Ecke | 'kante' | 'anfang' | 'ende' | 'kreis'; dx: number; dy: number; bewegt: boolean };

export function neueId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// auf das 5-cm-Raster, auf mm gerundet (keine Gleitkommareste wie 2,5500000000000003)
const rasten = (w: number) => Math.round(Math.round(w / RASTER) * RASTER * 1000) / 1000;
const begrenzen = (w: number, min: number, max: number) => Math.min(Math.max(w, min), Math.max(min, max));
const m = (w: number) => `${zahl(w)} m`;

function katalogFuerRechenkern(k: KatalogModulDaten[]): KatalogModul[] {
  return k.map(({ id, artikel_nr, bezeichnung, leistung_w, laenge_mm, breite_mm, schutzart, bad_geeignet, aktiv }) => ({
    id, artikel_nr, bezeichnung, leistung_w, laenge_mm, breite_mm, schutzart, bad_geeignet, aktiv,
  }));
}

/** Rechteck aus festem Gegeneck und Zeigerposition (Größe ändern an jeder Ecke) */
function eckeZiehen(s: Sperrflaeche, ecke: Ecke, p: { x: number; y: number }, bb: Raumform['bbox']): Pick<Sperrflaeche, 'x' | 'y' | 'b' | 't'> {
  const fx = ecke === 'nw' || ecke === 'sw' ? s.x + s.b : s.x;
  const fy = ecke === 'nw' || ecke === 'ne' ? s.y + s.t : s.y;
  const px = rasten(begrenzen(p.x, bb.x0, bb.x1));
  const py = rasten(begrenzen(p.y, bb.y0, bb.y1));
  const x0 = Math.min(px, fx);
  const y0 = Math.min(py, fy);
  return {
    x: x0 === fx ? Math.min(fx, bb.x1 - MIN_GROESSE) : x0,
    y: y0 === fy ? Math.min(fy, bb.y1 - MIN_GROESSE) : y0,
    b: Math.max(MIN_GROESSE, Math.abs(px - fx)),
    t: Math.max(MIN_GROESSE, Math.abs(py - fy)),
  };
}

export function Deckenplan({ raum, ergebnis, vorgaben, gesperrt, aendern }: Props) {
  const L = raum.laenge_m ?? 0;
  const B = raum.breite_m ?? 0;
  // Raumform aus Rechtecken (Paket M2): Umrandung kann bei Anbauten oben/links negative Koordinaten haben
  const [teileZug, setTeileZug] = useState<RaumTeil[] | null>(null);
  const teile = teileZug ?? raum.geometrie?.teile ?? [];
  const form = useMemo(() => formVonRaum({ laenge_m: L, breite_m: B, geometrie: { basis: { w: L, h: B }, teile } }), [L, B, teile]);
  const bb = form?.bbox ?? { x0: 0, y0: 0, x1: L, y1: B };
  const [sperr, setSperr] = useState<Sperrflaeche[]>(raum.sperrflaechen ?? []);
  const [module, setModule] = useState<PlatziertesModul[]>(raum.module ?? []);
  const [oeffnungen, setOeffnungen] = useState<TuerFenster[]>(raum.tueren_fenster ?? []);
  const [auswahl, setAuswahl] = useState<Auswahl>(null);
  const [katalog, setKatalog] = useState<KatalogModulDaten[]>([]);
  const [meldung, setMeldung] = useState<{ text: string; art: 'fehler' | 'hinweis' | 'warnung' } | null>(null);
  // Tür/Fenster setzen: wartet auf das Antippen einer Wand
  const [neueOeffnung, setNeueOeffnung] = useState<'tuer' | 'fenster' | null>(null);
  const [zieht, setZieht] = useState<string | null>(null);
  const zug = useRef<Zug | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  // Rückgängig (Paket N1/N2): Stände vor jeder gespeicherten Änderung an Objekten, Modulen, Türen und Fenstern
  const verlauf = useRef<Schnappschuss[]>([]);
  const gespeichert = useRef<Schnappschuss>({ sperr: raum.sperrflaechen ?? [], module: raum.module ?? [], oeffnungen: raum.tueren_fenster ?? [] });
  const [verlaufLaenge, setVerlaufLaenge] = useState(0);
  // Tastatur: R = ausgewähltes Objekt bzw. Modul drehen, Strg+Z = rückgängig (aktuelle Funktionen über eine Referenz)
  const tasten = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    const h = (e: KeyboardEvent) => tasten.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Stand vom Server bzw. Offline-Speicher übernehmen, solange nicht gerade gezogen wird
  useEffect(() => {
    gespeichert.current = { ...gespeichert.current, sperr: raum.sperrflaechen ?? [] };
    if (!zug.current) setSperr(raum.sperrflaechen ?? []);
  }, [raum.sperrflaechen]);
  useEffect(() => {
    gespeichert.current = { ...gespeichert.current, module: raum.module ?? [] };
    if (!zug.current) setModule(raum.module ?? []);
  }, [raum.module]);
  useEffect(() => {
    gespeichert.current = { ...gespeichert.current, oeffnungen: raum.tueren_fenster ?? [] };
    if (!zug.current) setOeffnungen(raum.tueren_fenster ?? []);
  }, [raum.tueren_fenster]);
  useEffect(() => {
    api.get<KatalogModulDaten[]>('/bibliotheken/module').then(setKatalog).catch(() => setKatalog([]));
  }, []);

  // Rand für Bemaßung (in Bildschirmpixeln bemessen, damit Maßzahlen auch auf dem Handy Platz haben)
  // und für nach außen aufschlagende Türen
  const [pxProM, setPxProM] = useState(100);
  const px = (p: number) => p / pxProM;
  const wandStaerke = Math.max(0.08, px(7));
  const masslinie = wandStaerke + px(14);
  const aussenTuer = Math.max(0, ...oeffnungen.filter((o) => o.art === 'tuer' && o.aufschlag === 'aussen').map((o) => o.breite));
  const rand = Math.max(masslinie + px(24), aussenTuer + px(16));
  const vbBreite = bb.x1 - bb.x0 + 2 * rand;

  // Maßstab (Bildschirmpixel je Meter), damit Schrift und Anfasser unabhängig von der Raumgröße fingerfreundlich bleiben
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const messen = () => {
      const r = el.getBoundingClientRect();
      const vbHoehe = bb.y1 - bb.y0 + 2 * rand;
      // preserveAspectRatio meet: der kleinere Maßstab gilt; gerundet, damit sich Rand und Maßstab schnell einpendeln
      if (r.width > 0) setPxProM(Math.round(Math.min(r.width / vbBreite, r.height > 0 ? r.height / vbHoehe : Infinity) * 2) / 2);
    };
    messen();
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, [vbBreite, bb.y0, bb.y1, rand]);

  const objekte = useMemo(() => vorgaben.objekte ?? [], [vorgaben.objekte]);
  const regeln = useMemo(() => regelnAufloesen(vorgaben.regeln, objekte), [vorgaben.regeln, objekte]);
  const objektVon = (s: Sperrflaeche) => objekte.find((o) => o.schluessel === objektSchluessel(s));
  const raumtyp = vorgaben.raumtypen.find((t) => t.id === raum.raumtyp_id)?.bezeichnung ?? null;
  const geometrie: PlatzierungsRaum = { laenge_m: L, breite_m: B, hoehe_m: raum.hoehe_m, ist_bad: istBad(raumtyp), form };
  const heizlast = ergebnis?.phi_massgeblich_w ?? null;
  const planung = raumModulplanung(geometrie, sperr, module, regeln, heizlast);
  // Wärmeverteilung: Schalter je Gerät merken; gerechnet wird nur, wenn nicht gerade gezogen wird
  const [waermeAn, setWaermeAn] = useState(() => {
    try {
      return localStorage.getItem('deckenplan.waerme') === 'ja';
    } catch {
      return false;
    }
  });
  const raumtemperatur = ergebnis?.werte.theta_int.wert ?? null;
  // Stelle unter Zeiger bzw. Finger für die Wertanzeige der Wärmeverteilung
  const [zeiger, setZeiger] = useState<{ x: number; y: number } | null>(null);
  const waerme = useMemo(
    () =>
      waermeAn && zieht === null && L > 0 && B > 0
        ? waermeBerechnen({ laenge_m: L, breite_m: B, hoehe_m: raum.hoehe_m, raumtemperatur_c: raumtemperatur, module, sperrflaechen: sperr, katalog, regeln: vorgaben.regeln, objekte, form })
        : null,
    [waermeAn, zieht, L, B, raum.hoehe_m, raumtemperatur, module, sperr, katalog, vorgaben.regeln, objekte, form],
  );
  const letzteWaerme = useRef(waerme);
  if (waerme) letzteWaerme.current = waerme;
  const waermeAnzeige = waermeAn ? (waerme ?? letzteWaerme.current) : null;
  const [skalaArt, setSkalaArt] = useState<SkalaArt>(() => {
    try {
      return localStorage.getItem('deckenplan.waerme.skala') === 'fest' ? 'fest' : 'auto';
    } catch {
      return 'auto';
    }
  });
  function skalaWaehlen(a: SkalaArt) {
    setSkalaArt(a);
    try {
      localStorage.setItem('deckenplan.waerme.skala', a);
    } catch {
      /* ohne Speicher: gilt nur bis zum Schließen */
    }
  }
  const waermeSkala = useMemo(
    () => (waermeAnzeige && waermeAnzeige.fehlt.length === 0 ? skala(waermeAnzeige, skalaArt) : null),
    [waermeAnzeige, skalaArt],
  );
  // Deckkraft der Farbfläche (Praxistest I): je Gerät gemerkt
  const [deckkraft, setDeckkraft] = useState(() => {
    try {
      const w = Number(localStorage.getItem('deckenplan.waerme.deckkraft'));
      return w >= 0.2 && w <= 1 ? w : 0.75;
    } catch {
      return 0.75;
    }
  });
  function deckkraftSetzen(w: number) {
    setDeckkraft(w);
    try {
      localStorage.setItem('deckenplan.waerme.deckkraft', String(w));
    } catch {
      /* ohne Speicher: gilt nur bis zum Schließen */
    }
  }
  function waermeUmschalten(an: boolean) {
    setWaermeAn(an);
    try {
      localStorage.setItem('deckenplan.waerme', an ? 'ja' : 'nein');
    } catch {
      /* ohne Speicher: gilt nur bis zum Schließen */
    }
  }
  const zulaessig = useMemo(
    () => zulaessigeModule(katalogFuerRechenkern(katalog), { ...geometrie }, regeln),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [katalog, regeln, geometrie.ist_bad],
  );

  if (L <= 0 || B <= 0) return <p className="leise">Für den Deckenplan zuerst Länge und Breite des Raums eingeben.</p>;

  /** Stand vor der Änderung merken (Rückgängig), dann den neuen als gespeichert vormerken */
  function merken(teil: Partial<Schnappschuss>) {
    verlauf.current = [...verlauf.current.slice(-29), gespeichert.current];
    gespeichert.current = { ...gespeichert.current, ...teil };
    setVerlaufLaenge(verlauf.current.length);
  }
  const speichernSperr = (neu: Sperrflaeche[]) => {
    merken({ sperr: neu });
    return aendern(() => api.patch(`/raeume/${raum.id}`, { sperrflaechen: neu }));
  };
  const speichernOeffnungen = (neu: TuerFenster[]) => {
    merken({ oeffnungen: neu });
    return aendern(() => api.patch(`/raeume/${raum.id}`, { tueren_fenster: neu }));
  };
  const speichernModule = (neu: PlatziertesModul[], vorschlagMeldung = false) => {
    // Meldung eines Vorschlags gilt nur, bis von Hand geändert wird
    if (!vorschlagMeldung) setMeldung(null);
    merken({ module: neu });
    return aendern(() => api.patch(`/raeume/${raum.id}`, { module: neu }));
  };
  function rueckgaengig() {
    const vorher = verlauf.current.pop();
    setVerlaufLaenge(verlauf.current.length);
    if (!vorher) return;
    gespeichert.current = vorher;
    setSperr(vorher.sperr);
    setModule(vorher.module);
    setOeffnungen(vorher.oeffnungen);
    setMeldung({ text: 'Letzte Änderung rückgängig gemacht.', art: 'hinweis' });
    void aendern(() => api.patch(`/raeume/${raum.id}`, { sperrflaechen: vorher.sperr, module: vorher.module, tueren_fenster: vorher.oeffnungen }));
  }

  function punkt(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const mat = svg.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(mat);
    return { x: p.x, y: p.y };
  }

  function anfassen(e: ReactPointerEvent, art: Art, id: string, modus: Zug['modus'] = 'schieben') {
    e.stopPropagation();
    // „Tür/Fenster setzen“ aktiv: ein Tippen auf Objekt, Anfasser oder Modul setzt die Öffnung an der nächsten Wand,
    // statt den Modus still zu beenden (Fehler aus dem Praxistest, Paket N2)
    if (neueOeffnung) {
      hintergrund(e);
      return;
    }
    setAuswahl({ art, id });
    if (gesperrt) return;
    const p = punkt(e);
    let dx = 0;
    let dy = 0;
    if (art === 'teil') {
      setTeileZug(teile);
    } else if (art === 'oeffnung') {
      // Versatz entlang der eigenen Wand (nicht der nächstgelegenen – sonst springt die Öffnung an Ecken)
      const o = oeffnungen.find((x) => x.id === id)!;
      dx = (o.wand === 'oben' || o.wand === 'unten' ? p.x : p.y) - o.position;
    } else {
      const obj = art === 'sperr' ? sperr.find((s) => s.id === id)! : module.find((x) => x.id === id)!;
      dx = p.x - obj.x;
      dy = p.y - obj.y;
    }
    zug.current = { art, id, modus, dx, dy, bewegt: false };
    setZieht(id);
    svg.current!.setPointerCapture(e.pointerId);
  }

  function ziehen(e: ReactPointerEvent) {
    const z = zug.current;
    if (waermeAn && !z) {
      const q = punkt(e);
      setZeiger(form && punktImRaum(form, q.x, q.y) ? q : null);
    }
    if (!z) return;
    const p = punkt(e);
    z.bewegt = true;
    if (z.art === 'modul') {
      setModule((alt) =>
        alt.map((x) => {
          if (x.id !== z.id) return x;
          const r = modulRechteck(x);
          return { ...x, x: rasten(begrenzen(p.x - z.dx, bb.x0, bb.x1 - r.b)), y: rasten(begrenzen(p.y - z.dy, bb.y0, bb.y1 - r.t)) };
        }),
      );
      return;
    }
    if (z.art === 'teil') {
      // Anfasser an der äußeren Ecke eines Anbaus/Ausschnitts: Länge entlang der Wand und Tiefe quer dazu
      const i = Number(z.id);
      setTeileZug((alt) =>
        (alt ?? teile).map((t, n) => {
          if (n !== i) return t;
          const entlang = t.wand === 'oben' || t.wand === 'unten' ? p.x : p.y;
          const wandLinie = t.wand === 'oben' ? 0 : t.wand === 'unten' ? B : t.wand === 'links' ? 0 : L;
          const quer = t.wand === 'oben' || t.wand === 'unten' ? p.y : p.x;
          const nachAussen = t.wand === 'oben' || t.wand === 'links' ? -1 : 1;
          const tiefe = (quer - wandLinie) * nachAussen * (t.op === 'add' ? 1 : -1);
          const wandLaengeT = t.wand === 'oben' || t.wand === 'unten' ? L : B;
          return {
            ...t,
            laenge: rasten(begrenzen(entlang - t.versatz, MIN_GROESSE, wandLaengeT - t.versatz)),
            tiefe: rasten(begrenzen(tiefe, MIN_GROESSE, t.op === 'sub' ? (t.wand === 'oben' || t.wand === 'unten' ? B : L) - MIN_GROESSE : 20)),
          };
        }),
      );
      return;
    }
    if (z.art === 'oeffnung') {
      setOeffnungen((alt) =>
        alt.map((o) => {
          if (o.id !== z.id) return o;
          const s = o.wand === 'oben' || o.wand === 'unten' ? p.x : p.y;
          // innerhalb des eigenen Wandsegments (Raumform) bzw. der Wand des Hauptrechtecks
          const [von, bis] = oeffnungBereich(o);
          if (z.modus === 'anfang') {
            // Ende bleibt, Anfang wandert: Lage und Breite ändern sich
            const ende = o.position + o.breite;
            const anfang = rasten(begrenzen(s, von, ende - MIN_GROESSE));
            return { ...o, position: anfang, breite: ende - anfang };
          }
          if (z.modus === 'ende') return { ...o, breite: rasten(begrenzen(s - o.position, MIN_GROESSE, bis - o.position)) };
          return { ...o, position: rasten(begrenzen(s - z.dx, von, bis - o.breite)) };
        }),
      );
      return;
    }
    setSperr((alt) =>
      alt.map((s) => {
        if (s.id !== z.id) return s;
        if (s.wand) {
          // Streifen bleibt von Wand zu Wand: Kante ziehen = Breite ändern, sonst quer zur Wand verschieben
          const w = s.wand;
          const lage = streifenLage(s, L, B);
          const ab = w === 'oben' ? p.y : w === 'unten' ? B - p.y : w === 'links' ? p.x : L - p.x;
          if (z.modus === 'kante') return { ...s, ...streifenRechteck(w, lage.abstand, rasten(ab - lage.abstand), L, B) };
          const versatz = w === 'oben' ? z.dy : w === 'unten' ? s.t - z.dy : w === 'links' ? z.dx : s.b - z.dx;
          return { ...s, ...streifenRechteck(w, rasten(ab - versatz), lage.breite, L, B) };
        }
        if (z.modus === 'kreis') return { ...s, ...kreisAusZeiger(s, p, bb) };
        if (z.modus === 'nw' || z.modus === 'ne' || z.modus === 'sw' || z.modus === 'se') {
          const r = eckeZiehen(s, z.modus, p, bb);
          return { ...s, ...(s.umriss === 'quadrat' ? quadratAusEcke(s, r, z.modus, bb) : r) };
        }
        return { ...s, x: rasten(begrenzen(p.x - z.dx, bb.x0, bb.x1 - s.b)), y: rasten(begrenzen(p.y - z.dy, bb.y0, bb.y1 - s.t)) };
      }),
    );
  }

  function loslassen() {
    const z = zug.current;
    zug.current = null;
    setZieht(null);
    if (z?.art === 'teil' && !z.bewegt) setTeileZug(null);
    if (!z?.bewegt) return;
    if (z.art === 'teil') {
      const neu = teileZug ?? teile;
      const f = formVonRaum({ laenge_m: L, breite_m: B, geometrie: { basis: { w: L, h: B }, teile: neu } });
      void aendern(() => api.patch(`/raeume/${raum.id}`, { geometrie: { basis: { w: L, h: B }, teile: neu }, flaeche_m2: f?.flaeche_m2 ?? null })).then(() =>
        setTeileZug(null),
      );
    } else if (z.art === 'modul') void speichernModule(module);
    else if (z.art === 'oeffnung') void speichernOeffnungen(oeffnungen);
    else void speichernSperr(sperr);
  }

  function oeffnungSetzen(art: 'tuer' | 'fenster') {
    setAuswahl(null);
    setMeldung(null);
    setNeueOeffnung(art);
    // Die Knöpfe stehen unter dem Plan: Plan ganz in den Blick holen, damit jede Wand antippbar ist (Paket N2)
    svg.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Antippen der leeren Fläche: Auswahl aufheben – oder Tür/Fenster an der nächsten Wand setzen */
  function hintergrund(e: ReactPointerEvent) {
    if (waermeAn) {
      const q = punkt(e);
      setZeiger(form && punktImRaum(form, q.x, q.y) ? q : null);
    }
    if (!neueOeffnung) return setAuswahl(null);
    const p = punkt(e);
    // nächstes Wandsegment der Raumform (auch L-, U-Form und Erker)
    const w = form ? naechstesSegment(p, form.segmente, L, B) : null;
    if (!w || w.abstand > Math.max(0.6, px(40))) {
      setMeldung({ text: `Bitte direkt auf eine Wand tippen (${neueOeffnung === 'tuer' ? 'Tür' : 'Fenster'} wird an der nächsten Wand gesetzt).`, art: 'hinweis' });
      return;
    }
    const laenge = w.bis - w.von;
    if (laenge < MIN_GROESSE * 2) {
      setMeldung({ text: 'Dieses Wandstück ist zu kurz für eine Öffnung.', art: 'warnung' });
      return;
    }
    const breite = Math.min(neueOeffnung === 'tuer' ? TUER_BREITE_M : FENSTER_BREITE_M, laenge);
    const neu: TuerFenster = {
      id: neueId(),
      art: neueOeffnung,
      wand: w.wand,
      ...(w.linie !== null ? { linie: w.linie } : {}),
      position: rasten(begrenzen(w.s - breite / 2, w.von, w.bis - breite)),
      breite,
      ...(neueOeffnung === 'tuer' ? { aufschlag: 'innen' as const, band: 'links' as const } : {}),
    };
    setNeueOeffnung(null);
    setMeldung(null);
    setAuswahl({ art: 'oeffnung', id: neu.id });
    setOeffnungen([...oeffnungen, neu]);
    void speichernOeffnungen([...oeffnungen, neu]);
  }

  /** Neues Objekt mit den Standardmaßen der Bibliothek, mittig (Streifen an der oberen Wand) */
  function sperrNeu(o: BibliotheksObjekt, extra?: SonstigeAngaben) {
    let neu: Sperrflaeche;
    if (extra && extra.umriss !== 'rechteck') {
      // Sonstige Sperrfläche rund/quadratisch (Paket N4): Seitenlänge bzw. Durchmesser = Standardbreite
      const d = Math.min(o.breite_m ?? 1, L, B);
      neu = { id: neueId(), objekt: o.schluessel, x: rasten((L - d) / 2), y: rasten((B - d) / 2), b: d, t: d };
    } else if (o.form === 'punkt') {
      neu = { id: neueId(), objekt: o.schluessel, x: rasten(L / 2), y: rasten(B / 2), b: 0, t: 0 };
    } else if (o.form === 'streifen') {
      const breite = rasten(Math.min(o.breite_m ?? 1, B / 2));
      const abstand = o.schluessel === 'dachschraege' ? 0 : rasten((B - breite) / 2);
      neu = { id: neueId(), objekt: o.schluessel, wand: 'oben', ...streifenRechteck('oben', abstand, breite, L, B) };
    } else {
      const bb = Math.min(o.breite_m ?? 1, L);
      const tt = Math.min(o.tiefe_m ?? 1, B);
      neu = { id: neueId(), objekt: o.schluessel, x: rasten((L - bb) / 2), y: rasten((B - tt) / 2), b: bb, t: tt };
    }
    if (extra) neu = { ...neu, bezeichnung: extra.bezeichnung, umriss: extra.umriss, kategorie: extra.kategorie, hoehe: extra.hoehe };
    setAuswahl({ art: 'sperr', id: neu.id });
    void speichernSperr([...sperr, neu]);
  }

  function modulNeu(artikel: string) {
    const k = katalog.find((x) => x.artikel_nr === artikel);
    if (!k) return;
    const gedreht = bevorzugtGedreht(geometrie);
    const neuM = platziertesModul(k, 0, 0, gedreht, neueId());
    const r = modulRechteck(neuM);
    const neu = { ...neuM, x: rasten(Math.max(0, (L - r.b) / 2)), y: rasten(Math.max(0, (B - r.t) / 2)) };
    setAuswahl({ art: 'modul', id: neu.id });
    void speichernModule([...module, neu]);
  }

  function vorschlag() {
    if (module.length > 0 && !window.confirm('Vorhandene Module durch einen neuen Vorschlag ersetzen?')) return;
    const v = vorschlagen(geometrie, sperr, katalogFuerRechenkern(katalog), regeln, heizlast, neueId);
    if (!v.module) {
      setMeldung({ text: v.meldung ?? 'Kein Vorschlag möglich.', art: 'fehler' });
      return;
    }
    setMeldung(
      v.hinweise.length > 0 ? { text: v.hinweise.join(' · '), art: 'warnung' } : { text: `Vorschlag: ${v.module.length} × ${v.module[0].artikel_nr}`, art: 'hinweis' },
    );
    setAuswahl(null);
    void speichernModule(v.module, true);
  }

  const gewaehltesModul = auswahl?.art === 'modul' ? module.find((x) => x.id === auswahl.id) : undefined;
  const gewaehlteSperr = auswahl?.art === 'sperr' ? sperr.find((s) => s.id === auswahl.id) : undefined;
  const gewaehlteOeffnung = auswahl?.art === 'oeffnung' ? oeffnungen.find((o) => o.id === auswahl.id) : undefined;

  function modulAendern(aenderung: Partial<PlatziertesModul>) {
    if (!gewaehltesModul) return;
    void speichernModule(module.map((x) => (x.id === gewaehltesModul.id ? { ...x, ...aenderung } : x)));
  }

  function tauschen(artikel: string) {
    const k = katalog.find((x) => x.artikel_nr === artikel);
    if (!k || !gewaehltesModul) return;
    const neu = platziertesModul(k, gewaehltesModul.x, gewaehltesModul.y, gewaehltesModul.gedreht, gewaehltesModul.id);
    void speichernModule(module.map((x) => (x.id === neu.id ? neu : x)));
  }

  function sperrAendern(neu: Sperrflaeche) {
    setSperr(sperr.map((s) => (s.id === neu.id ? neu : s)));
    void speichernSperr(sperr.map((s) => (s.id === neu.id ? neu : s)));
  }

  /** Ausgewähltes Objekt um 90° drehen (Mitte bleibt, ggf. minimal verschoben); Meldung, wenn nicht möglich */
  function sperrDrehen(): string | null {
    if (!gewaehlteSperr || istPunkt(gewaehlteSperr) || gewaehlteSperr.wand || !form) return null;
    if (gewaehlteSperr.umriss === 'quadrat' || gewaehlteSperr.umriss === 'rund') return null; // Drehen ändert nichts
    const e = objektDrehen(gewaehlteSperr, form);
    if (!e.ok) {
      setMeldung({ text: e.meldung, art: 'warnung' });
      return e.meldung;
    }
    sperrAendern({ ...gewaehlteSperr, ...e.r });
    return null;
  }

  tasten.current = (e: KeyboardEvent) => {
    const ziel = e.target as HTMLElement | null;
    if (ziel && (ziel.tagName === 'INPUT' || ziel.tagName === 'SELECT' || ziel.tagName === 'TEXTAREA')) return;
    if (gesperrt) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      rueckgaengig();
    } else if (e.key === 'r' || e.key === 'R') {
      if (gewaehlteSperr) sperrDrehen();
      else if (gewaehltesModul) modulAendern({ gedreht: !gewaehltesModul.gedreht });
    }
  };

  /** Bereich des Wandsegments einer Öffnung entlang der Wand (Raumform), sonst die ganze Wand des Hauptrechtecks */
  function oeffnungBereich(o: TuerFenster): [number, number] {
    const linie = wandLinie(o, L, B);
    const waagerecht = o.wand === 'oben' || o.wand === 'unten';
    const passend = (form?.segmente ?? [])
      .filter((sg) => (waagerecht ? sg.y1 === sg.y2 && Math.abs(sg.y1 - linie) < 1e-6 : sg.x1 === sg.x2 && Math.abs(sg.x1 - linie) < 1e-6))
      .map((sg): [number, number] => (waagerecht ? [Math.min(sg.x1, sg.x2), Math.max(sg.x1, sg.x2)] : [Math.min(sg.y1, sg.y2), Math.max(sg.y1, sg.y2)]));
    const mitte = o.position + o.breite / 2;
    return passend.find(([a, b]) => mitte >= a - 1e-6 && mitte <= b + 1e-6) ?? passend[0] ?? [0, wandLaenge(o.wand, L, B)];
  }

  /** Tür/Fenster ändern; unzulässige Werte → Meldung am Feld statt stillem Begrenzen (Paket N2) */
  function oeffnungAendern(neu: TuerFenster): string | null {
    const [von, bis] = oeffnungBereich(oeffnungen.find((o) => o.id === neu.id) ?? neu);
    if (neu.breite < MIN_GROESSE) return `Mindestens ${zahl(MIN_GROESSE)} m`;
    if (neu.breite > bis - von + 1e-9) return `Breiter als das Wandstück (höchstens ${zahl(bis - von)} m)`;
    if (neu.position < von - 1e-9 || neu.position + neu.breite > bis + 1e-9) {
      return `Liegt nicht mehr auf der Wand (Abstand höchstens ${zahl(bis - von - neu.breite)} m)`;
    }
    setOeffnungen(oeffnungen.map((o) => (o.id === neu.id ? neu : o)));
    void speichernOeffnungen(oeffnungen.map((o) => (o.id === neu.id ? neu : o)));
    return null;
  }

  const schrift = px(13);
  const griffR = px(10);
  const griffTreffer = px(22); // 44 px Durchmesser

  return (
    <div className="deckenplan">
      <div className="plan-rahmen">
        <svg
          ref={svg}
          className={`plan${neueOeffnung ? ' plan-wand-waehlen' : ''}`}
          viewBox={`${bb.x0 - rand} ${bb.y0 - rand} ${vbBreite} ${bb.y1 - bb.y0 + 2 * rand}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerMove={ziehen}
          onPointerUp={loslassen}
          onPointerCancel={loslassen}
          onPointerDown={hintergrund}
          role="img"
          aria-label={`Deckenplan ${zahl(L)} × ${zahl(B)} m`}
        >
          {form && !form.rechteck ? (
            <>
              {/* Raumform: Umriss mit kräftiger Wandlinie, Fläche weiß */}
              <path className="plan-wand-linie" d={umrissPfad(form)} style={{ strokeWidth: `${Math.max(6, wandStaerke * pxProM * 2)}px` }} />
              <path className="plan-raum" d={umrissPfad(form)} />
            </>
          ) : (
            <>
          {/* Wände als Band außen um den Raum */}
              <path
                className="plan-wand"
                fillRule="evenodd"
                d={`M${-wandStaerke},${-wandStaerke}H${L + wandStaerke}V${B + wandStaerke}H${-wandStaerke}Z M0,0V${B}H${L}V0Z`}
              />
              <rect x={0} y={0} width={L} height={B} className="plan-raum" />
              {regeln.wand_m !== null && L > 2 * regeln.wand_m && B > 2 * regeln.wand_m && (
                <rect x={regeln.wand_m} y={regeln.wand_m} width={L - 2 * regeln.wand_m} height={B - 2 * regeln.wand_m} className="plan-wandabstand" />
              )}

            </>
          )}
          {/* Wärmeverteilung für jede Raumform (Fehler N5: lag nur im Rechteck-Zweig), auf den Umriss zugeschnitten,
              unter Objekten und Modulen – Umrisse und Beschriftungen bleiben obenauf lesbar */}
          {form && (
            <clipPath id={`umriss-${raum.id}`}>
              <path d={umrissPfad(form)} />
            </clipPath>
          )}
          {waermeAnzeige && waermeAnzeige.fehlt.length === 0 && (
            <g clipPath={form ? `url(#umriss-${raum.id})` : undefined}>
              <WaermeSchicht ergebnis={waermeAnzeige} skala={waermeSkala!} deckkraft={deckkraft} />
            </g>
          )}
          {form && !form.rechteck ? (
            <SegmentBemassung form={form} abstand={masslinie} schrift={schrift} />
          ) : (
            <Bemassung L={L} B={B} abstand={masslinie} schrift={schrift} strich={px(6)} />
          )}
          {/* Anfasser je Anbau/Ausschnitt an der äußeren Ecke: Länge und Tiefe ziehen */}
          {!gesperrt &&
            teile.map((t, i) => {
              const r = teilRechteck(t, L, B);
              const ende = t.wand === 'oben' || t.wand === 'unten' ? r.x + r.b : r.y + r.t;
              const fern =
                t.wand === 'oben' ? (t.op === 'add' ? r.y : r.y + r.t) : t.wand === 'unten' ? (t.op === 'add' ? r.y + r.t : r.y) : t.wand === 'links' ? (t.op === 'add' ? r.x : r.x + r.b) : t.op === 'add' ? r.x + r.b : r.x;
              const [cx, cy] = t.wand === 'oben' || t.wand === 'unten' ? [ende, fern] : [fern, ende];
              return (
                <g key={`teil-${i}`} className="plan-griff plan-teil-griff" onPointerDown={(e) => anfassen(e, 'teil', String(i))}>
                  <circle cx={cx} cy={cy} r={griffTreffer} className="plan-tippflaeche" />
                  <circle cx={cx} cy={cy} r={griffR} className="plan-griff-punkt" />
                </g>
              );
            })}

          {oeffnungen.map((o) => (
            <Oeffnung
              key={o.id}
              o={o}
              L={L}
              B={B}
              wandStaerke={wandStaerke}
              gewaehlt={gewaehlteOeffnung?.id === o.id && !gesperrt}
              treffer={griffTreffer}
              griffR={griffR}
              schrift={schrift}
              onAnfassen={(e, modus = 'schieben') => anfassen(e, 'oeffnung', o.id, modus)}
            />
          ))}

          {sperr.map((s) => {
            const punktTyp = istPunkt(s);
            const regel = objektRegel(regeln, s);
            // eigene Kategorie der Sonstigen Sperrfläche (Paket N4) vor der Bibliothek
            const kategorie = s.kategorie ?? regel?.kategorie ?? 'tabu';
            const umrissClip = form ? `url(#umriss-${raum.id})` : undefined;
            const abstandM = kategorie === 'neutral' ? null : (regel?.abstand_m ?? null);
            const name = objektName(regeln, s);
            const gewaehlt = gewaehlteSperr?.id === s.id;
            if (punktTyp) {
              return (
                <g key={s.id} onPointerDown={(e) => anfassen(e, 'sperr', s.id)} className={`plan-punkt kat-${kategorie}${gewaehlt ? ' gewaehlt' : ''}`}>
                  {abstandM !== null && <circle cx={s.x} cy={s.y} r={abstandM} className="plan-halo" clipPath={umrissClip} />}
                  <circle cx={s.x} cy={s.y} r={griffTreffer} className="plan-tippflaeche" />
                  <circle cx={s.x} cy={s.y} r={px(7)} className="plan-punkt-kern" />
                  {(gewaehlt || zieht === s.id) && (
                    <text x={s.x} y={s.y - px(14)} fontSize={schrift} textAnchor="middle" className="plan-beschriftung">
                      {name}
                    </text>
                  )}
                </g>
              );
            }
            const ecken: [Ecke, number, number][] = [
              ['nw', s.x, s.y],
              ['ne', s.x + s.b, s.y],
              ['sw', s.x, s.y + s.t],
              ['se', s.x + s.b, s.y + s.t],
            ];
            const schraege = !!s.wand;
            const kante = schraege
              ? s.wand === 'oben'
                ? [s.x + s.b / 2, s.y + s.t]
                : s.wand === 'unten'
                  ? [s.x + s.b / 2, s.y]
                  : s.wand === 'links'
                    ? [s.x + s.b, s.y + s.t / 2]
                    : [s.x, s.y + s.t / 2]
              : null;
            // Name eingepasst (Paket N6): kleiner, umbrechen, kürzen – nie über das Objekt hinaus
            const rund = istRund(s);
            const marke = beschriftungEinpassen(name, (rund ? s.b * 0.7 : s.b) * pxProM - 6, (rund ? s.t * 0.7 : s.t) * pxProM - 4, 13, 9);
            const beschriftung = (
              <text x={s.x + s.b / 2} y={s.y + s.t / 2} fontSize={px(marke.groesse)} textAnchor="middle" dominantBaseline="middle" className="plan-beschriftung">
                {marke.zeilen.map((z, i) => (
                  <tspan key={i} x={s.x + s.b / 2} dy={i === 0 ? px(-(marke.zeilen.length - 1) * marke.groesse * 0.575) : px(marke.groesse * 1.15)}>
                    {z}
                  </tspan>
                ))}
              </text>
            );
            if (rund) {
              const r = s.b / 2;
              const cx = s.x + r;
              const cy = s.y + r;
              const griffe: [number, number][] = [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]];
              return (
                <g key={s.id} className={`plan-sperr plan-rund kat-${kategorie}${gewaehlt ? ' gewaehlt' : ''}`}>
                  <title>{name}</title>
                  {abstandM !== null && abstandM > 0 && <circle cx={cx} cy={cy} r={r + abstandM} className="plan-halo" clipPath={umrissClip} />}
                  {kategorie === 'abstand' && abstandM !== null && r > abstandM && <circle cx={cx} cy={cy} r={r - abstandM} className="plan-halo-innen" />}
                  <circle cx={cx} cy={cy} r={r} className="plan-kreis" onPointerDown={(e) => anfassen(e, 'sperr', s.id)} />
                  {beschriftung}
                  {(gewaehlt || zieht === s.id) && (
                    <text x={cx} y={cy - r - griffR - px(10)} fontSize={schrift} textAnchor="middle" className="plan-mass-live plan-beschriftung">
                      Ø {zahl(s.b)} m
                    </text>
                  )}
                  {gewaehlt &&
                    !gesperrt &&
                    griffe.map(([x, y], i) => (
                      <g key={i} onPointerDown={(e) => anfassen(e, 'sperr', s.id, 'kreis')} className="plan-griff">
                        <circle cx={x} cy={y} r={griffTreffer} className="plan-tippflaeche" />
                        <circle cx={x} cy={y} r={griffR} className="plan-griff-punkt" />
                      </g>
                    ))}
                </g>
              );
            }
            return (
              <g key={s.id} className={`plan-sperr kat-${kategorie}${gewaehlt ? ' gewaehlt' : ''}`}>
                <title>{name}</title>
                {abstandM !== null && abstandM > 0 && (
                  <rect x={s.x - abstandM} y={s.y - abstandM} width={s.b + 2 * abstandM} height={s.t + 2 * abstandM} rx={abstandM} className="plan-halo" clipPath={umrissClip} />
                )}
                {/* Kategorie „abstand“: Modul darf darüber, aber nur innerhalb dieser Linie */}
                {kategorie === 'abstand' && abstandM !== null && s.b > 2 * abstandM && s.t > 2 * abstandM && (
                  <rect x={s.x + abstandM} y={s.y + abstandM} width={s.b - 2 * abstandM} height={s.t - 2 * abstandM} className="plan-halo-innen" />
                )}
                <rect x={s.x} y={s.y} width={s.b} height={s.t} onPointerDown={(e) => anfassen(e, 'sperr', s.id)} />
                {beschriftung}
                {(gewaehlt || zieht === s.id) && (
                  // Maße oberhalb der Eck-Anfasser (Anfasser 10 px Radius), nie darüber (Paket N1)
                  <text x={s.x + s.b / 2} y={s.y - griffR - px(10)} fontSize={schrift} textAnchor="middle" className="plan-mass-live plan-beschriftung">
                    {schraege ? `Breite ${m(streifenLage(s, L, B).breite)}` : `${zahl(s.b)} × ${zahl(s.t)} m`}
                  </text>
                )}
                {gewaehlt && !gesperrt && !schraege && s.umriss !== 'quadrat' && (
                  <g
                    className="plan-drehen"
                    role="button"
                    aria-label="Objekt um 90° drehen"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      sperrDrehen();
                    }}
                  >
                    <circle cx={s.x + s.b + griffTreffer + px(6)} cy={s.y + s.t / 2} r={griffTreffer} className="plan-tippflaeche" />
                    <circle cx={s.x + s.b + griffTreffer + px(6)} cy={s.y + s.t / 2} r={px(14)} className="plan-drehen-knopf" />
                    <text x={s.x + s.b + griffTreffer + px(6)} y={s.y + s.t / 2} fontSize={px(16)} textAnchor="middle" dominantBaseline="central">
                      ⟳
                    </text>
                  </g>
                )}
                {gewaehlt && !gesperrt && !schraege &&
                  ecken.map(([ecke, x, y]) => (
                    <g key={ecke} onPointerDown={(e) => anfassen(e, 'sperr', s.id, ecke)} className="plan-griff">
                      <circle cx={x} cy={y} r={griffTreffer} className="plan-tippflaeche" />
                      <circle cx={x} cy={y} r={griffR} className="plan-griff-punkt" />
                    </g>
                  ))}
                {gewaehlt && !gesperrt && kante && (
                  <g onPointerDown={(e) => anfassen(e, 'sperr', s.id, 'kante')} className="plan-griff">
                    <circle cx={kante[0]} cy={kante[1]} r={griffTreffer} className="plan-tippflaeche" />
                    <circle cx={kante[0]} cy={kante[1]} r={griffR} className="plan-griff-punkt" />
                  </g>
                )}
              </g>
            );
          })}


          {module.map((x, i) => {
            const r = modulRechteck(x);
            const verstoss = (planung.verstoesse[x.id] ?? []).length > 0;
            return (
              <g
                key={x.id}
                className={`plan-modul${verstoss ? ' verstoss' : ''}${gewaehltesModul?.id === x.id ? ' gewaehlt' : ''}`}
                onPointerDown={(e) => anfassen(e, 'modul', x.id)}
              >
                <rect x={r.x} y={r.y} width={r.b} height={r.t} />
                <text x={r.x + r.b / 2} y={r.y + r.t / 2} fontSize={schrift} textAnchor="middle" dominantBaseline="middle">
                  {i + 1}
                </text>
              </g>
            );
          })}

          {gewaehltesModul &&
            form?.rechteck !== false &&
            wandAbstaende(modulRechteck(gewaehltesModul), L, B).map((a) => {
              const waagerecht = a.wand === 'links' || a.wand === 'rechts';
              const mx = (a.von.x + a.bis.x) / 2;
              const my = (a.von.y + a.bis.y) / 2;
              return (
                <g key={a.wand} className="plan-modulmass">
                  <line x1={a.von.x} y1={a.von.y} x2={a.bis.x} y2={a.bis.y} />
                  <text
                    x={waagerecht ? mx : mx + px(6)}
                    y={waagerecht ? my - px(6) : my}
                    fontSize={schrift}
                    textAnchor={waagerecht ? 'middle' : 'start'}
                    dominantBaseline={waagerecht ? 'auto' : 'middle'}
                  >
                    {m(a.abstand)}
                  </text>
                </g>
              );
            })}
          {waermeAnzeige && waermeAnzeige.fehlt.length === 0 && <WaermeMarke ergebnis={waermeAnzeige} zeiger={zeiger} px={px} />}
        </svg>
      </div>
      <div className="waerme-schalter">
        <label className="inline">
          <input type="checkbox" checked={waermeAn} onChange={(e) => waermeUmschalten(e.target.checked)} /> Wärmeverteilung anzeigen
        </label>
        <Hilfe begriff="Wärmeverteilung" text={`${HILFE.waermeverteilung} ${HINWEIS_WAERME}`} />
        {waermeAn && (
          <Schalter
            wert={skalaArt}
            optionen={{ auto: 'Skala automatisch', fest: 'Skala fest' }}
            onWahl={(a: SkalaArt) => skalaWaehlen(a)}
          />
        )}
        {waermeAn && (
          <label className="waerme-deckkraft">
            Deckkraft
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={deckkraft}
              aria-label="Deckkraft der Farbfläche"
              onChange={(e) => deckkraftSetzen(Number(e.target.value))}
            />
            <span>{Math.round(deckkraft * 100)} %</span>
          </label>
        )}
      </div>
      {waermeAnzeige?.mit_vorgabewerten && waermeAnzeige.fehlt.length === 0 && (
        <p className="waerme-vorgabe" role="status">
          Mit Vorgabewerten berechnet – für mindestens ein Modul fehlen Oberflächentemperatur, Emissionsgrad oder Abstrahlwinkel im Modulkatalog.
        </p>
      )}
      {waermeAnzeige && <WaermeLegende ergebnis={waermeAnzeige} skala={waermeSkala!} zeiger={zeiger} />}
      <p className="leise klein-text">
        {form && !form.rechteck ? `Raumform ${zahl(form.flaeche_m2)} m² (Hauptrechteck ${zahl(L)} × ${zahl(B)} m, Ecke anfassen = Teil ändern)` : `${zahl(L)} × ${zahl(B)} m`}
        {regeln.wand_m !== null && ` · gestrichelt: Wandabstand ${zahl(regeln.wand_m * 100, 0)} cm`} · Raster 5 cm · antippen =
        auswählen, ziehen = verschieben{!gesperrt && ', Eckpunkte ziehen = Größe ändern'}
      </p>
      {neueOeffnung && (
        <Meldung art="hinweis">
          Jetzt auf die Wand tippen, an der {neueOeffnung === 'tuer' ? 'die Tür' : 'das Fenster'} liegt.{' '}
          <button className="knopf-leise klein" onClick={() => setNeueOeffnung(null)}>
            Abbrechen
          </button>
        </Meldung>
      )}

      {!gesperrt && (
        <>
          {gewaehltesModul && (
            <div className="knopfreihe auswahl-leiste">
              <strong>
                Modul {module.indexOf(gewaehltesModul) + 1}: {gewaehltesModul.artikel_nr} ({watt(gewaehltesModul.leistung_w)})
              </strong>
              <span className="leise">
                {form && !form.rechteck
                  ? `nächste Wand ${m(wandAbstand(form, modulRechteck(gewaehltesModul)))}`
                  : wandAbstaende(modulRechteck(gewaehltesModul), L, B)
                      .map((a) => `Wand ${a.wand} ${m(a.abstand)}`)
                      .join(' · ')}
              </span>
              <button className="knopf-zweit" onClick={() => modulAendern({ gedreht: !gewaehltesModul.gedreht })}>
                Drehen
              </button>
              <select aria-label="Modul tauschen" value="" onChange={(e) => tauschen(e.target.value)}>
                <option value="">Tauschen gegen …</option>
                {zulaessig.map((k) => (
                  <option key={k.artikel_nr} value={k.artikel_nr}>
                    {k.artikel_nr} – {k.leistung_w} W ({k.laenge_mm} × {k.breite_mm} mm)
                  </option>
                ))}
              </select>
              <button className="knopf-gefahr" onClick={() => void speichernModule(module.filter((x) => x.id !== gewaehltesModul.id)).then(() => setAuswahl(null))}>
                Löschen
              </button>
            </div>
          )}
          {gewaehlteSperr && (
            <SperrLeiste
              s={gewaehlteSperr}
              L={L}
              B={B}
              form={form!}
              objekt={objektVon(gewaehlteSperr)}
              name={objektName(regeln, gewaehlteSperr)}
              objekte={objekte}
              onAendern={sperrAendern}
              onDrehen={sperrDrehen}
              onLoeschen={() => void speichernSperr(sperr.filter((s) => s.id !== gewaehlteSperr.id)).then(() => setAuswahl(null))}
            />
          )}
          {gewaehlteOeffnung && (
            <OeffnungLeiste
              o={gewaehlteOeffnung}
              bereich={oeffnungBereich(gewaehlteOeffnung)}
              onAendern={oeffnungAendern}
              onLoeschen={() => void speichernOeffnungen(oeffnungen.filter((o) => o.id !== gewaehlteOeffnung.id)).then(() => setAuswahl(null))}
            />
          )}

          <div className="knopfreihe">
            <button className="knopf-leise" disabled={verlaufLaenge === 0} onClick={rueckgaengig} title="Rückgängig (Strg+Z)">
              ↶ Rückgängig
            </button>
          </div>
          <div className="werkzeuge">
            <span className="feldname">
              Möbel und Einbauten
              <Hilfe begriff="Objekte im Raum" text={HILFE.sperrflaeche} />
            </span>
            <ObjektAuswahl objekte={objekte} raumtypId={raum.raumtyp_id} raumtyp={raumtyp} onWahl={sperrNeu} />
            <span className="feldname">
              Tür und Fenster (nur Orientierung)
              <Hilfe begriff="Tür und Fenster" text={HILFE.tuerFenster} />
            </span>
            <div className="knopfreihe">
              <button className={`knopf-leise${neueOeffnung === 'tuer' ? ' aktiv' : ''}`} onClick={() => oeffnungSetzen('tuer')}>
                + Tür
              </button>
              <button className={`knopf-leise${neueOeffnung === 'fenster' ? ' aktiv' : ''}`} onClick={() => oeffnungSetzen('fenster')}>
                + Fenster
              </button>
            </div>
            <span className="feldname">
              Module
              <Hilfe begriff="Modulvorschlag" text={HILFE.modulvorschlag} />
            </span>
            <div className="knopfreihe">
              <button className="knopf" onClick={vorschlag} disabled={katalog.length === 0}>
                Module vorschlagen
              </button>
              <select aria-label="Modul hinzufügen" value="" onChange={(e) => modulNeu(e.target.value)}>
                <option value="">+ Modul hinzufügen …</option>
                {zulaessig.map((k) => (
                  <option key={k.artikel_nr} value={k.artikel_nr}>
                    {k.artikel_nr} – {k.leistung_w} W ({k.laenge_mm} × {k.breite_mm} mm)
                  </option>
                ))}
              </select>
            </div>
            {katalog.length === 0 && <Meldung art="hinweis">Der Modulkatalog ist auf diesem Gerät nicht verfügbar – einmal online öffnen.</Meldung>}
          </div>
        </>
      )}
      {meldung && <Meldung art={meldung.art}>{meldung.text}</Meldung>}


      <PlanErgebnis planung={planung} module={module} />
    </div>
  );
}

/** SVG-Pfad des Umrisses (alle Linienzüge) */
export function umrissPfad(form: Pick<Raumform, 'umriss'>): string {
  return form.umriss.map((ring) => `M${ring.map((p) => `${p.x},${p.y}`).join('L')}Z`).join(' ');
}

/** Bemaßung aller Wandsegmente einer Raumform: Länge außen neben jedem Segment */
function SegmentBemassung({ form, abstand, schrift }: { form: Raumform; abstand: number; schrift: number }) {
  return (
    <g className="plan-bemassung">
      {form.segmente.map((sg, i) => {
        const mx = (sg.x1 + sg.x2) / 2 - sg.innen.x * abstand;
        const my = (sg.y1 + sg.y2) / 2 - sg.innen.y * abstand;
        const senkrecht = sg.x1 === sg.x2;
        return (
          <text
            key={i}
            x={mx}
            y={my}
            fontSize={schrift}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={senkrecht ? `rotate(-90 ${mx} ${my})` : undefined}
          >
            {zahl(sg.laenge)} m
          </text>
        );
      })}
    </g>
  );
}

/** Raummaße an den Wänden wie im Bauplan: Länge oben und unten, Breite links und rechts */
function Bemassung({ L, B, abstand, schrift, strich }: { L: number; B: number; abstand: number; schrift: number; strich: number }) {
  const linie = (x1: number, y1: number, x2: number, y2: number, text: string, senkrecht: boolean, textSeite: number) => {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return (
      <g className="plan-bemassung">
        <line x1={x1} y1={y1} x2={x2} y2={y2} />
        {/* Maßbegrenzung als Schrägstrich wie im Bauplan */}
        {[
          [x1, y1],
          [x2, y2],
        ].map(([x, y], i) => (
          <line key={i} x1={x - strich / 2} y1={y + strich / 2} x2={x + strich / 2} y2={y - strich / 2} />
        ))}
        <text
          x={senkrecht ? mx + textSeite * schrift * 0.3 : mx}
          y={senkrecht ? my : my + textSeite * schrift * 0.3}
          fontSize={schrift}
          textAnchor="middle"
          // außen neben der Linie: links/oben über der Grundlinie, rechts/unten darunter (senkrecht um −90° gedreht)
          dominantBaseline={textSeite < 0 ? 'auto' : 'hanging'}
          transform={senkrecht ? `rotate(-90 ${mx + textSeite * schrift * 0.3} ${my})` : undefined}
        >
          {text}
        </text>
      </g>
    );
  };
  const laenge = `${zahl(L)} m`;
  const breite = `${zahl(B)} m`;
  return (
    <>
      {linie(0, -abstand, L, -abstand, laenge, false, -1)}
      {linie(0, B + abstand, L, B + abstand, laenge, false, 1)}
      {linie(-abstand, 0, -abstand, B, breite, true, -1)}
      {linie(L + abstand, 0, L + abstand, B, breite, true, 1)}
    </>
  );
}

/** Tür (Türblatt und Viertelkreis) bzw. Fenster (Doppellinie in der Wand) */
function Oeffnung({
  o,
  L,
  B,
  wandStaerke,
  gewaehlt,
  treffer,
  griffR,
  schrift,
  onAnfassen,
}: {
  o: TuerFenster;
  L: number;
  B: number;
  wandStaerke: number;
  gewaehlt: boolean;
  /** Radius der unsichtbaren Tippfläche (in Planeinheiten aus Bildschirmpixeln umgerechnet) */
  treffer: number;
  griffR: number;
  schrift: number;
  onAnfassen: (e: ReactPointerEvent, modus?: 'schieben' | 'anfang' | 'ende') => void;
}) {
  const [a, e] = oeffnungStrecke(o, L, B);
  const waagerecht = o.wand === 'oben' || o.wand === 'unten';
  const aussen = o.wand === 'oben' ? -1 : o.wand === 'links' ? -1 : 1;
  // Öffnung im Wandband (vom Raum nach außen)
  const lx = Math.min(a.x, e.x);
  const ly = Math.min(a.y, e.y);
  // Wandausschnitt außen an der Wandlinie (Hauptrechteck oder Segment der Raumform)
  const linie = wandLinie(o, L, B);
  const ausschnitt = waagerecht
    ? { x: lx, y: aussen < 0 ? linie - wandStaerke : linie, width: Math.abs(e.x - a.x), height: wandStaerke }
    : { x: aussen < 0 ? linie - wandStaerke : linie, y: ly, width: wandStaerke, height: Math.abs(e.y - a.y) };
  const klasse = `plan-oeffnung plan-${o.art}${gewaehlt ? ' gewaehlt' : ''}`;
  const tipp = waagerecht
    ? { x: lx, y: ausschnitt.y - treffer / 2, width: ausschnitt.width, height: wandStaerke + treffer }
    : { x: ausschnitt.x - treffer / 2, y: ly, width: wandStaerke + treffer, height: ausschnitt.height };
  // Auswahl: kleine Anfasser an beiden Enden (Trefferfläche 44 px), Breite als Maßzahl
  const mitte = { x: (a.x + e.x) / 2, y: (a.y + e.y) / 2 };
  const n = { x: waagerecht ? 0 : -aussen, y: waagerecht ? -aussen : 0 };
  const auswahl = gewaehlt && (
    <>
      {([
        ['anfang', a],
        ['ende', e],
      ] as const).map(([modus, p]) => (
        <g key={modus} className="plan-griff" onPointerDown={(ev) => onAnfassen(ev, modus)}>
          <circle cx={p.x} cy={p.y} r={treffer} className="plan-tippflaeche" />
          <circle cx={p.x} cy={p.y} r={griffR * 0.8} className="plan-griff-punkt" />
        </g>
      ))}
      <text
        x={mitte.x + n.x * (wandStaerke + schrift * 1.2)}
        y={mitte.y + n.y * (wandStaerke + schrift * 1.2)}
        fontSize={schrift}
        textAnchor="middle"
        dominantBaseline="middle"
        className="plan-mass-live"
      >
        {zahl(o.breite)} m
      </text>
    </>
  );
  if (o.art === 'fenster') {
    const d = wandStaerke / 3;
    return (
      <g className={klasse} onPointerDown={onAnfassen}>
        <rect {...ausschnitt} className="plan-oeffnung-ausschnitt" />
        {waagerecht ? (
          <>
            <line x1={lx} y1={ausschnitt.y + d} x2={lx + ausschnitt.width} y2={ausschnitt.y + d} />
            <line x1={lx} y1={ausschnitt.y + 2 * d} x2={lx + ausschnitt.width} y2={ausschnitt.y + 2 * d} />
          </>
        ) : (
          <>
            <line x1={ausschnitt.x + d} y1={ly} x2={ausschnitt.x + d} y2={ly + ausschnitt.height} />
            <line x1={ausschnitt.x + 2 * d} y1={ly} x2={ausschnitt.x + 2 * d} y2={ly + ausschnitt.height} />
          </>
        )}
        <rect {...tipp} className="plan-tippflaeche" />
        {auswahl}
      </g>
    );
  }
  const g = tuerGeometrie(o, L, B);
  const r = Math.hypot(g.zu.x - g.band.x, g.zu.y - g.band.y);
  return (
    <g className={klasse} onPointerDown={onAnfassen}>
      <rect {...ausschnitt} className="plan-oeffnung-ausschnitt" />
      <line x1={g.band.x} y1={g.band.y} x2={g.blatt.x} y2={g.blatt.y} className="plan-tuerblatt" />
      <path d={`M${g.blatt.x},${g.blatt.y} A${r},${r} 0 0 ${g.sweep} ${g.zu.x},${g.zu.y}`} className="plan-tuerbogen" />
      <rect {...tipp} className="plan-tippflaeche" />
      {auswahl}
    </g>
  );
}

/** Auswahl eines Objekts: anderes Objekt gleicher Form wählen, Maße und Höhe eingeben, löschen */
function SperrLeiste({
  s,
  L,
  B,
  form,
  objekt,
  name,
  objekte,
  onAendern,
  onDrehen,
  onLoeschen,
}: {
  s: Sperrflaeche;
  L: number;
  B: number;
  /** Raumform (Prüfung der Maße gegen Raum und Einsprünge) */
  form: Raumform;
  /** Eintrag der Objektbibliothek (fehlt, wenn das Objekt im Projektstand unbekannt ist) */
  objekt: BibliotheksObjekt | undefined;
  name: string;
  objekte: BibliotheksObjekt[];
  onAendern: (s: Sperrflaeche) => void;
  /** Drehen um 90°; gibt bei Unmöglichkeit eine Meldung zurück */
  onDrehen: () => string | null;
  onLoeschen: () => void;
}) {
  const punkt = istPunkt(s);
  const streifen = !!s.wand;
  const art = punkt ? 'punkt' : streifen ? 'streifen' : 'rechteck';
  const auswahl = objekte.filter((o) => o.form === art && (o.aktiv !== false || o.schluessel === objekt?.schluessel));
  const standardHoehe = objekt?.hoehe_m ?? null;
  const lage = streifen ? streifenLage(s, L, B) : null;
  const wand = s.wand ?? 'oben';
  const quer = wand === 'oben' || wand === 'unten' ? B : L;
  const [drehMeldung, setDrehMeldung] = useState('');
  // Sonstige Sperrfläche (Paket N4): Name, Form und Kategorie frei wählbar
  const sonstige = objektSchluessel(s) === 'sonstiges';
  const umriss = s.umriss ?? 'rechteck';
  /** Breite/Tiefe sofort wirksam: Mitte bleibt, sonst Meldung am Feld (Paket N1) */
  const masse = (b: number, t: number): string | null => {
    const e = objektMasse(s, b, t, form);
    if (!e.ok) return e.meldung;
    onAendern({ ...s, ...e.r });
    return null;
  };
  return (
    <div className="auswahl-leiste objekt-leiste">
      <label className="leiste-feld">
        <span>Objekt</span>
        <select
          aria-label="Objekt"
          value={objektSchluessel(s)}
          onChange={(e) => {
            // anderes Objekt: Lage und Maße bleiben, eine eigene Höhe gilt nicht mehr
            const { typ: _typ, ...rest } = s;
            onAendern({ ...rest, objekt: e.target.value, hoehe: null });
          }}
        >
          {!objekt && <option value={objektSchluessel(s)}>{name}</option>}
          {auswahl.map((o) => (
            <option key={o.schluessel} value={o.schluessel}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      {sonstige && (
        <>
          <label className="leiste-feld">
            <span>Name</span>
            <Textfeld
              wert={s.bezeichnung || name}
              beschriftung="Name der Sperrfläche"
              onSpeichern={(t) => onAendern({ ...s, bezeichnung: t.trim().slice(0, 30) })}
            />
          </label>
          <div className="leiste-feld">
            <span>Form</span>
            <Schalter
              wert={umriss}
              optionen={UMRISSE}
              beschriftung="Form"
              onWahl={(u) => {
                // Quadrat/Rund: gleiche Seiten (kleinere Ausdehnung), Mitte bleibt
                const d = Math.min(s.b, s.t);
                const e = u === 'rechteck' ? null : objektMasse(s, d, d, form);
                onAendern({ ...s, umriss: u, ...(e && e.ok ? e.r : {}) });
              }}
            />
          </div>
          <div className="leiste-feld">
            <span>Kategorie</span>
            <Schalter wert={s.kategorie ?? objekt?.kategorie ?? 'tabu'} optionen={KATEGORIE_WAHL} beschriftung="Kategorie" onWahl={(k) => onAendern({ ...s, kategorie: k })} />
          </div>
        </>
      )}
      {!punkt && !streifen && umriss !== 'rechteck' && (
        <label className="leiste-feld">
          <span>{umriss === 'rund' ? 'Durchmesser' : 'Seitenlänge'}</span>
          <Zahlfeld
            wert={Math.round(s.b * 100) / 100}
            einheit="m"
            beschriftung={umriss === 'rund' ? 'Durchmesser in m' : 'Seitenlänge in m'}
            min={MIN_GROESSE}
            onSpeichern={(w) => (w === null ? 'Bitte ein Maß eingeben' : masse(w, w))}
          />
        </label>
      )}
      {!punkt && !streifen && (
        <>
          {umriss === 'rechteck' && (
          <div className="leiste-feld leiste-masse">
            <span>Breite × Tiefe</span>
            <span className="leiste-paar">
              <Zahlfeld
                wert={Math.round(s.b * 100) / 100}
                einheit="m"
                beschriftung="Breite in m"
                min={MIN_GROESSE}
                onSpeichern={(w) => (w === null ? 'Bitte eine Breite eingeben' : masse(w, s.t))}
              />
              <span className="mal">×</span>
              <Zahlfeld
                wert={Math.round(s.t * 100) / 100}
                einheit="m"
                beschriftung="Tiefe in m"
                min={MIN_GROESSE}
                onSpeichern={(w) => (w === null ? 'Bitte eine Tiefe eingeben' : masse(s.b, w))}
              />
            </span>
          </div>
          )}
          <label className="leiste-feld">
            <span>
              Höhe
              <Hilfe
                begriff="Höhe"
                text={`${standardHoehe === null ? `Für ${name} ist keine Standardhöhe hinterlegt.` : `Standard für ${name}: ${zahl(standardHoehe)} m.`} Leer lassen = Standard. ${HILFE.objektHoehe}`}
              />
            </span>
            <Zahlfeld
              wert={s.hoehe ?? null}
              einheit="m"
              beschriftung="Höhe der Oberseite in m"
              platzhalter={standardHoehe === null ? '–' : zahl(standardHoehe)}
              onSpeichern={(w) => {
                if (w !== null && w > 5) return 'Höchstens 5 m';
                onAendern({ ...s, hoehe: w === null || (standardHoehe !== null && Math.abs(w - standardHoehe) < 1e-9) ? null : w });
                return null;
              }}
            />
          </label>
          {umriss === 'rechteck' && (
          <div className="leiste-feld">
            <span>&nbsp;</span>
            <button
              className="knopf-zweit"
              title="Drehen um 90° (Taste R)"
              onClick={() => setDrehMeldung(onDrehen() ?? '')}
            >
              Drehen 90°
            </button>
          </div>
          )}
        </>
      )}
      {streifen && lage && (
        <>
          <label className="inline">
            parallel zur Wand
            <select
              value={wand}
              onChange={(e) => {
                const w = e.target.value as Wand;
                onAendern({ ...s, wand: w, ...streifenRechteck(w, lage.abstand, lage.breite, L, B) });
              }}
            >
              {(Object.keys(WAENDE) as Wand[]).map((w) => (
                <option key={w} value={w}>
                  {WAENDE[w]}
                </option>
              ))}
            </select>
          </label>
          <label className="inline">
            Abstand zur Wand
            <Zahlfeld
              wert={Math.round(lage.abstand * 100) / 100}
              einheit="m"
              beschriftung="Abstand des Streifens zur Wand in m"
              onSpeichern={(w) => {
                if (w !== null) onAendern({ ...s, ...streifenRechteck(wand, begrenzen(w, 0, quer), lage.breite, L, B) });
              }}
            />
          </label>
          <label className="inline">
            Breite
            <Zahlfeld
              wert={Math.round(lage.breite * 100) / 100}
              einheit="m"
              beschriftung="Breite des Streifens in m"
              min={MIN_GROESSE}
              onSpeichern={(w) => {
                if (w !== null) onAendern({ ...s, ...streifenRechteck(wand, lage.abstand, w, L, B) });
              }}
            />
          </label>
        </>
      )}
      <div className="leiste-feld">
        <span>&nbsp;</span>
        <button className="knopf-gefahr" onClick={onLoeschen}>
          Löschen
        </button>
      </div>
      {drehMeldung && (
        <p className="leiste-meldung" role="alert">
          {drehMeldung}
        </p>
      )}
    </div>
  );
}

/** Auswahl einer Tür bzw. eines Fensters: Lage, Breite, Höhe, Brüstung, Aufschlag, löschen (Paket N2: eine Zeile, Meldungen am Feld) */
function OeffnungLeiste({
  o,
  bereich,
  onAendern,
  onLoeschen,
}: {
  o: TuerFenster;
  /** Wandstück der Öffnung entlang der Wand (von, bis) */
  bereich: [number, number];
  onAendern: (o: TuerFenster) => string | null;
  onLoeschen: () => void;
}) {
  const [von] = bereich;
  return (
    <div className="auswahl-leiste objekt-leiste">
      <div className="leiste-feld">
        <span>{o.art === 'tuer' ? 'Tür' : 'Fenster'}</span>
        <strong className="leiste-wert">Wand {WAENDE[o.wand]}</strong>
      </div>
      <label className="leiste-feld">
        <span>Abstand {WANDANFANG[o.wand]}</span>
        <Zahlfeld
          wert={Math.round((o.position - von) * 100) / 100}
          einheit="m"
          beschriftung="Abstand vom Anfang des Wandstücks in m"
          onSpeichern={(w) => (w === null ? 'Bitte einen Abstand eingeben' : onAendern({ ...o, position: von + w }))}
        />
      </label>
      <label className="leiste-feld">
        <span>Breite</span>
        <Zahlfeld
          wert={Math.round(o.breite * 100) / 100}
          einheit="m"
          beschriftung="Breite in m"
          min={MIN_GROESSE}
          onSpeichern={(w) => (w === null ? 'Bitte eine Breite eingeben' : onAendern({ ...o, breite: w }))}
        />
      </label>
      <label className="leiste-feld">
        <span>Höhe</span>
        <Zahlfeld
          wert={o.hoehe ?? null}
          einheit="m"
          beschriftung="lichte Höhe in m"
          platzhalter="–"
          onSpeichern={(w) => (w !== null && w > 5 ? 'Höchstens 5 m' : onAendern({ ...o, hoehe: w }))}
        />
      </label>
      {o.art === 'fenster' && (
        <label className="leiste-feld">
          <span>Brüstung</span>
          <Zahlfeld
            wert={o.bruestung ?? null}
            einheit="m"
            beschriftung="Brüstungshöhe in m"
            platzhalter="–"
            onSpeichern={(w) => (w !== null && w > 3 ? 'Höchstens 3 m' : onAendern({ ...o, bruestung: w }))}
          />
        </label>
      )}
      {o.art === 'tuer' && (
        <>
          <div className="leiste-feld">
            <span>Aufschlag</span>
            <Schalter
              wert={o.aufschlag ?? 'innen'}
              optionen={{ innen: 'nach innen', aussen: 'nach außen' }}
              onWahl={(a: 'innen' | 'aussen') => void onAendern({ ...o, aufschlag: a })}
            />
          </div>
          <div className="leiste-feld">
            <span>Band</span>
            <Schalter
              wert={o.band ?? 'links'}
              optionen={{ links: 'links', rechts: 'rechts' }}
              onWahl={(b: 'links' | 'rechts') => void onAendern({ ...o, band: b })}
            />
          </div>
        </>
      )}
      <div className="leiste-feld">
        <span>&nbsp;</span>
        <button className="knopf-gefahr" onClick={onLoeschen}>
          Löschen
        </button>
      </div>
    </div>
  );
}

/** Deutliche Warnung zur installierten Leistung (Unter- bzw. Überdimensionierung) */
export function LeistungWarnung({ planung }: { planung: Pick<ReturnType<typeof raumModulplanung>, 'leistung' | 'leistung_hinweis'> }) {
  if (planung.leistung === 'unter') return <Meldung art="fehler">Unterdimensioniert: {planung.leistung_hinweis}</Meldung>;
  if (planung.leistung === 'ueber') return <Meldung art="warnung">Überdimensioniert: {planung.leistung_hinweis}</Meldung>;
  return null;
}

function PlanErgebnis({ planung, module }: { planung: ReturnType<typeof raumModulplanung>; module: PlatziertesModul[] }) {
  return (
    <div className="plan-ergebnis">
      <div className="nebenwerte">
        <span>
          benötigt {watt(planung.benoetigt_w)}
          <Hilfe begriff="benötigte Leistung" text={HILFE.benoetigteLeistung} />
        </span>
        <span>
          installiert <strong>{watt(planung.installiert_w)}</strong> ({planung.anzahl} Module)
        </span>
        <span>
          Thermostat: {planung.thermostate}
          <Hilfe begriff="Thermostat" text={HILFE.thermostat} />
        </span>
      </div>
      <LeistungWarnung planung={planung} />
      {module.some((x) => (planung.verstoesse[x.id] ?? []).length > 0) && (
        <ul className="verstoesse">
          {module.map((x, i) =>
            (planung.verstoesse[x.id] ?? []).map((v) => (
              <li key={`${x.id}-${v}`}>
                Modul {i + 1} ({x.artikel_nr}): {v}
              </li>
            )),
          )}
        </ul>
      )}
      {planung.hinweise.length > 0 && (
        <ul className="hinweise">
          {planung.hinweise.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Kleine Vorschau des Deckenplans für die Raumkarte (nicht bedienbar) */
export function PlanVorschau({ raum }: { raum: Raum }) {
  const L = raum.laenge_m ?? 0;
  const B = raum.breite_m ?? 0;
  if (L <= 0 || B <= 0) return null;
  const form = formVonRaum({ laenge_m: L, breite_m: B, geometrie: raum.geometrie ?? null });
  const bb = form?.bbox ?? { x0: 0, y0: 0, x1: L, y1: B };
  const rand = 0.15 * Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0);
  return (
    <svg className="plan-vorschau" viewBox={`${bb.x0 - rand} ${bb.y0 - rand} ${bb.x1 - bb.x0 + 2 * rand} ${bb.y1 - bb.y0 + 2 * rand}`} aria-hidden="true">
      {form && !form.rechteck ? <path d={umrissPfad(form)} className="plan-raum" /> : <rect x={0} y={0} width={L} height={B} className="plan-raum" />}
      {(raum.tueren_fenster ?? []).map((o) => {
        const [a, e] = oeffnungStrecke(o, L, B);
        return <line key={o.id} x1={a.x} y1={a.y} x2={e.x} y2={e.y} className={`vorschau-${o.art}`} />;
      })}
      {(raum.sperrflaechen ?? []).map((s) =>
        istPunkt(s) ? (
          <circle key={s.id} cx={s.x} cy={s.y} r={0.04 * Math.max(L, B)} className="vorschau-punkt" />
        ) : (
          <rect key={s.id} x={s.x} y={s.y} width={s.b} height={s.t} className={`vorschau-sperr${s.wand ? ' vorschau-streifen' : ''}`} />
        ),
      )}
      {(raum.module ?? []).map((x) => {
        const r = modulRechteck(x);
        return <rect key={x.id} x={r.x} y={r.y} width={r.b} height={r.t} className="vorschau-modul" />;
      })}
    </svg>
  );
}
