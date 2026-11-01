// Deckenplan eines Raums (Festlegungen 14.10. und 31.10.2026): maßstäbliche Draufsicht mit Sperrflächen, Modulen,
// Türen und Fenstern, bemaßt wie im Bauplan.
// Bedienung per Finger: antippen = auswählen, ziehen = verschieben, Eckpunkte ziehen = Größe ändern (jede Richtung).
// Regelprüfung live mit dem Rechenkern (gleiche Regeln wie Server und Raumliste); gespeichert wird beim Loslassen.
// Türen und Fenster dienen nur der Orientierung – keine Sperrflächen, ohne Einfluss auf die Platzierung.
// Vorerst nur rechteckige Räume; Maße in m ab der linken oberen Raumecke (x = Länge, y = Breite).
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  bevorzugtGedreht,
  FENSTER_BREITE_M,
  istBad,
  modulRechteck,
  naechsteWand,
  oeffnungStrecke,
  platziertesModul,
  PUNKT_TYPEN,
  raumModulplanung,
  regelnAufloesen,
  SPERR_TYPEN,
  TUER_BREITE_M,
  tuerGeometrie,
  vorschlagen,
  wandAbstaende,
  wandLaenge,
  zulaessigeModule,
  type KatalogModul,
  type PlatzierungsRaum,
  type SperrTyp,
  type TuerFenster,
  type Wand,
} from '@infrarot/rechenkern';
import { api, type AuswertungRaum, type Fachvorgaben, type KatalogModulDaten, type PlatziertesModul, type Raum, type Sperrflaeche } from '../api';
import { HILFE, watt, zahl } from '../texte';
import { Hilfe, Meldung, Schalter, Zahlfeld } from './Felder';
import { berechnen as waermeBerechnen, HINWEIS_WAERME, sperrhoehen, WaermeLegende, WaermeSchicht } from './Waermeverteilung';

type Aendern = (aktion: () => Promise<unknown>) => Promise<void>;

interface Props {
  raum: Raum;
  ergebnis: AuswertungRaum | undefined;
  vorgaben: Fachvorgaben;
  gesperrt: boolean;
  aendern: Aendern;
}

const RASTER = 0.05;
const MIN_GROESSE = 0.1;
/** Startgrößen neuer Sperrflächen in m (nur Bedienkomfort, danach per Finger oder Eingabe anpassen) */
const STARTGROESSE: Record<Exclude<SperrTyp, 'leuchte' | 'rauchmelder' | 'dachschraege'>, [number, number]> = {
  sitzplatz: [2.0, 1.0],
  bett: [1.6, 2.0],
  hochschrank: [1.2, 0.6],
  dusche: [0.9, 0.9],
  sonstiges: [1.0, 1.0],
};
const RECHTECK_TYPEN = ['sitzplatz', 'bett', 'hochschrank', 'dusche', 'sonstiges'] as const;
const WAENDE: Record<Wand, string> = { oben: 'oben', unten: 'unten', links: 'links', rechts: 'rechts' };
const WANDANFANG: Record<Wand, string> = { oben: 'von links', unten: 'von links', links: 'von oben', rechts: 'von oben' };

type Ecke = 'nw' | 'ne' | 'sw' | 'se';
type Art = 'sperr' | 'modul' | 'oeffnung';
type Auswahl = { art: Art; id: string } | null;
/** schieben; Sperrfläche: Ecke ziehen; Tür/Fenster: Anfang oder Ende ziehen (Breite ändern) */
type Zug = { art: Art; id: string; modus: 'schieben' | Ecke | 'anfang' | 'ende'; dx: number; dy: number; bewegt: boolean };

export function neueId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const rasten = (w: number) => Math.round(w / RASTER) * RASTER;
const begrenzen = (w: number, min: number, max: number) => Math.min(Math.max(w, min), Math.max(min, max));
const m = (w: number) => `${zahl(w)} m`;

/** Dachschräge als Streifen entlang einer Wand mit der Tiefe t (bzw. b bei links/rechts) */
function schraegeStreifen(wand: Wand, tiefe: number, L: number, B: number): Pick<Sperrflaeche, 'x' | 'y' | 'b' | 't'> {
  if (wand === 'oben') return { x: 0, y: 0, b: L, t: tiefe };
  if (wand === 'unten') return { x: 0, y: B - tiefe, b: L, t: tiefe };
  if (wand === 'links') return { x: 0, y: 0, b: tiefe, t: B };
  return { x: L - tiefe, y: 0, b: tiefe, t: B };
}

function schraegeTiefe(s: Sperrflaeche): number {
  return s.wand === 'links' || s.wand === 'rechts' ? s.b : s.t;
}

function katalogFuerRechenkern(k: KatalogModulDaten[]): KatalogModul[] {
  return k.map(({ id, artikel_nr, bezeichnung, leistung_w, laenge_mm, breite_mm, schutzart, bad_geeignet, aktiv }) => ({
    id, artikel_nr, bezeichnung, leistung_w, laenge_mm, breite_mm, schutzart, bad_geeignet, aktiv,
  }));
}

/** Rechteck aus festem Gegeneck und Zeigerposition (Größe ändern an jeder Ecke) */
function eckeZiehen(s: Sperrflaeche, ecke: Ecke, p: { x: number; y: number }, L: number, B: number): Pick<Sperrflaeche, 'x' | 'y' | 'b' | 't'> {
  const fx = ecke === 'nw' || ecke === 'sw' ? s.x + s.b : s.x;
  const fy = ecke === 'nw' || ecke === 'ne' ? s.y + s.t : s.y;
  const px = rasten(begrenzen(p.x, 0, L));
  const py = rasten(begrenzen(p.y, 0, B));
  const x0 = Math.min(px, fx);
  const y0 = Math.min(py, fy);
  return {
    x: x0 === fx ? Math.min(fx, L - MIN_GROESSE) : x0,
    y: y0 === fy ? Math.min(fy, B - MIN_GROESSE) : y0,
    b: Math.max(MIN_GROESSE, Math.abs(px - fx)),
    t: Math.max(MIN_GROESSE, Math.abs(py - fy)),
  };
}

export function Deckenplan({ raum, ergebnis, vorgaben, gesperrt, aendern }: Props) {
  const L = raum.laenge_m ?? 0;
  const B = raum.breite_m ?? 0;
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

  // Stand vom Server bzw. Offline-Speicher übernehmen, solange nicht gerade gezogen wird
  useEffect(() => {
    if (!zug.current) setSperr(raum.sperrflaechen ?? []);
  }, [raum.sperrflaechen]);
  useEffect(() => {
    if (!zug.current) setModule(raum.module ?? []);
  }, [raum.module]);
  useEffect(() => {
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
  const vbBreite = L + 2 * rand;

  // Maßstab (Bildschirmpixel je Meter), damit Schrift und Anfasser unabhängig von der Raumgröße fingerfreundlich bleiben
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const messen = () => {
      const r = el.getBoundingClientRect();
      const vbHoehe = B + 2 * rand;
      // preserveAspectRatio meet: der kleinere Maßstab gilt; gerundet, damit sich Rand und Maßstab schnell einpendeln
      if (r.width > 0) setPxProM(Math.round(Math.min(r.width / vbBreite, r.height > 0 ? r.height / vbHoehe : Infinity) * 2) / 2);
    };
    messen();
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, [vbBreite, B, rand]);

  const regeln = useMemo(() => regelnAufloesen(vorgaben.regeln), [vorgaben.regeln]);
  const raumtyp = vorgaben.raumtypen.find((t) => t.id === raum.raumtyp_id)?.bezeichnung ?? null;
  const geometrie: PlatzierungsRaum = { laenge_m: L, breite_m: B, hoehe_m: raum.hoehe_m, ist_bad: istBad(raumtyp) };
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
  const waerme = useMemo(
    () =>
      waermeAn && zieht === null && L > 0 && B > 0
        ? waermeBerechnen({ laenge_m: L, breite_m: B, hoehe_m: raum.hoehe_m, raumtemperatur_c: raumtemperatur, module, sperrflaechen: sperr, katalog, regeln: vorgaben.regeln })
        : null,
    [waermeAn, zieht, L, B, raum.hoehe_m, raumtemperatur, module, sperr, katalog, vorgaben.regeln],
  );
  const letzteWaerme = useRef(waerme);
  if (waerme) letzteWaerme.current = waerme;
  const waermeAnzeige = waermeAn ? (waerme ?? letzteWaerme.current) : null;
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

  const speichernSperr = (neu: Sperrflaeche[]) => aendern(() => api.patch(`/raeume/${raum.id}`, { sperrflaechen: neu }));
  const speichernOeffnungen = (neu: TuerFenster[]) => aendern(() => api.patch(`/raeume/${raum.id}`, { tueren_fenster: neu }));
  const speichernModule = (neu: PlatziertesModul[], vorschlagMeldung = false) => {
    // Meldung eines Vorschlags gilt nur, bis von Hand geändert wird
    if (!vorschlagMeldung) setMeldung(null);
    return aendern(() => api.patch(`/raeume/${raum.id}`, { module: neu }));
  };

  function punkt(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const mat = svg.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(mat);
    return { x: p.x, y: p.y };
  }

  function anfassen(e: ReactPointerEvent, art: Art, id: string, modus: Zug['modus'] = 'schieben') {
    e.stopPropagation();
    setAuswahl({ art, id });
    setNeueOeffnung(null);
    if (gesperrt) return;
    const p = punkt(e);
    let dx = 0;
    let dy = 0;
    if (art === 'oeffnung') {
      const o = oeffnungen.find((x) => x.id === id)!;
      const w = naechsteWand(p, L, B);
      dx = (w.wand === o.wand ? w.s : o.position) - o.position;
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
    if (!z) return;
    const p = punkt(e);
    z.bewegt = true;
    if (z.art === 'modul') {
      setModule((alt) =>
        alt.map((x) => {
          if (x.id !== z.id) return x;
          const r = modulRechteck(x);
          return { ...x, x: rasten(begrenzen(p.x - z.dx, 0, L - r.b)), y: rasten(begrenzen(p.y - z.dy, 0, B - r.t)) };
        }),
      );
      return;
    }
    if (z.art === 'oeffnung') {
      setOeffnungen((alt) =>
        alt.map((o) => {
          if (o.id !== z.id) return o;
          const s = o.wand === 'oben' || o.wand === 'unten' ? p.x : p.y;
          const laenge = wandLaenge(o.wand, L, B);
          if (z.modus === 'anfang') {
            // Ende bleibt, Anfang wandert: Lage und Breite ändern sich
            const ende = o.position + o.breite;
            const anfang = rasten(begrenzen(s, 0, ende - MIN_GROESSE));
            return { ...o, position: anfang, breite: ende - anfang };
          }
          if (z.modus === 'ende') return { ...o, breite: rasten(begrenzen(s - o.position, MIN_GROESSE, laenge - o.position)) };
          return { ...o, position: rasten(begrenzen(s - z.dx, 0, laenge - o.breite)) };
        }),
      );
      return;
    }
    setSperr((alt) =>
      alt.map((s) => {
        if (s.id !== z.id) return s;
        if (s.typ === 'dachschraege') {
          // nur die Tiefe ändert sich; der Streifen bleibt an seiner Wand
          const w = s.wand ?? 'oben';
          const tiefe = rasten(
            begrenzen(w === 'oben' ? p.y : w === 'unten' ? B - p.y : w === 'links' ? p.x : L - p.x, RASTER * 2, w === 'oben' || w === 'unten' ? B : L),
          );
          return { ...s, ...schraegeStreifen(w, tiefe, L, B) };
        }
        if (z.modus === 'nw' || z.modus === 'ne' || z.modus === 'sw' || z.modus === 'se') return { ...s, ...eckeZiehen(s, z.modus, p, L, B) };
        return { ...s, x: rasten(begrenzen(p.x - z.dx, 0, L - s.b)), y: rasten(begrenzen(p.y - z.dy, 0, B - s.t)) };
      }),
    );
  }

  function loslassen() {
    const z = zug.current;
    zug.current = null;
    setZieht(null);
    if (!z?.bewegt) return;
    if (z.art === 'modul') void speichernModule(module);
    else if (z.art === 'oeffnung') void speichernOeffnungen(oeffnungen);
    else void speichernSperr(sperr);
  }

  function oeffnungSetzen(art: 'tuer' | 'fenster') {
    setAuswahl(null);
    setMeldung(null);
    setNeueOeffnung(art);
  }

  /** Antippen der leeren Fläche: Auswahl aufheben – oder Tür/Fenster an der nächsten Wand setzen */
  function hintergrund(e: ReactPointerEvent) {
    if (!neueOeffnung) return setAuswahl(null);
    const p = punkt(e);
    const w = naechsteWand(p, L, B);
    if (w.abstand > Math.max(0.6, px(40))) {
      setMeldung({ text: 'Bitte direkt auf eine Wand tippen.', art: 'hinweis' });
      return;
    }
    const breite = Math.min(neueOeffnung === 'tuer' ? TUER_BREITE_M : FENSTER_BREITE_M, wandLaenge(w.wand, L, B));
    const neu: TuerFenster = {
      id: neueId(),
      art: neueOeffnung,
      wand: w.wand,
      position: rasten(begrenzen(w.s - breite / 2, 0, wandLaenge(w.wand, L, B) - breite)),
      breite,
      ...(neueOeffnung === 'tuer' ? { aufschlag: 'innen' as const, band: 'links' as const } : {}),
    };
    setNeueOeffnung(null);
    setMeldung(null);
    setAuswahl({ art: 'oeffnung', id: neu.id });
    setOeffnungen([...oeffnungen, neu]);
    void speichernOeffnungen([...oeffnungen, neu]);
  }

  function sperrNeu(typ: SperrTyp) {
    let neu: Sperrflaeche;
    if (PUNKT_TYPEN.includes(typ)) {
      neu = { id: neueId(), typ, x: rasten(L / 2), y: rasten(B / 2), b: 0, t: 0 };
    } else if (typ === 'dachschraege') {
      neu = { id: neueId(), typ, wand: 'oben', ...schraegeStreifen('oben', rasten(Math.min(1, B / 3)), L, B) };
    } else {
      const [b, t] = STARTGROESSE[typ as keyof typeof STARTGROESSE];
      const bb = Math.min(b, L);
      const tt = Math.min(t, B);
      neu = { id: neueId(), typ, x: rasten((L - bb) / 2), y: rasten((B - tt) / 2), b: bb, t: tt };
    }
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

  function oeffnungAendern(neu: TuerFenster) {
    const laenge = wandLaenge(neu.wand, L, B);
    const breite = begrenzen(neu.breite, MIN_GROESSE, laenge);
    const korrigiert = { ...neu, breite, position: begrenzen(neu.position, 0, laenge - breite) };
    setOeffnungen(oeffnungen.map((o) => (o.id === neu.id ? korrigiert : o)));
    void speichernOeffnungen(oeffnungen.map((o) => (o.id === neu.id ? korrigiert : o)));
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
          viewBox={`${-rand} ${-rand} ${vbBreite} ${B + 2 * rand}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerMove={ziehen}
          onPointerUp={loslassen}
          onPointerCancel={loslassen}
          onPointerDown={hintergrund}
          role="img"
          aria-label={`Deckenplan ${zahl(L)} × ${zahl(B)} m`}
        >
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

          <Bemassung L={L} B={B} abstand={masslinie} schrift={schrift} strich={px(6)} />

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
            const punktTyp = PUNKT_TYPEN.includes(s.typ);
            const abstandM = punktTyp ? regeln.punkt_m[s.typ as 'leuchte' | 'rauchmelder'] : regeln.flaeche_m[s.typ as keyof typeof regeln.flaeche_m];
            const gewaehlt = gewaehlteSperr?.id === s.id;
            if (punktTyp) {
              return (
                <g key={s.id} onPointerDown={(e) => anfassen(e, 'sperr', s.id)} className={`plan-punkt plan-${s.typ}${gewaehlt ? ' gewaehlt' : ''}`}>
                  {abstandM !== null && <circle cx={s.x} cy={s.y} r={abstandM} className="plan-halo" />}
                  <circle cx={s.x} cy={s.y} r={griffTreffer} className="plan-tippflaeche" />
                  <circle cx={s.x} cy={s.y} r={px(7)} className="plan-punkt-kern" />
                </g>
              );
            }
            const ecken: [Ecke, number, number][] = [
              ['nw', s.x, s.y],
              ['ne', s.x + s.b, s.y],
              ['sw', s.x, s.y + s.t],
              ['se', s.x + s.b, s.y + s.t],
            ];
            const schraege = s.typ === 'dachschraege';
            const kante = schraege
              ? s.wand === 'oben'
                ? [s.x + s.b / 2, s.y + s.t]
                : s.wand === 'unten'
                  ? [s.x + s.b / 2, s.y]
                  : s.wand === 'links'
                    ? [s.x + s.b, s.y + s.t / 2]
                    : [s.x, s.y + s.t / 2]
              : null;
            return (
              <g key={s.id} className={`plan-sperr plan-${s.typ}${gewaehlt ? ' gewaehlt' : ''}`}>
                {abstandM !== null && abstandM > 0 && (
                  <rect x={s.x - abstandM} y={s.y - abstandM} width={s.b + 2 * abstandM} height={s.t + 2 * abstandM} rx={abstandM} className="plan-halo" />
                )}
                <rect x={s.x} y={s.y} width={s.b} height={s.t} onPointerDown={(e) => anfassen(e, 'sperr', s.id)} />
                <text x={s.x + s.b / 2} y={s.y + s.t / 2} fontSize={schrift} textAnchor="middle" dominantBaseline="middle">
                  {SPERR_TYPEN[s.typ]}
                </text>
                {(gewaehlt || zieht === s.id) && (
                  <text x={s.x + s.b / 2} y={s.y - px(8)} fontSize={schrift} textAnchor="middle" className="plan-mass-live">
                    {schraege ? `Tiefe ${m(schraegeTiefe(s))}` : `${zahl(s.b)} × ${zahl(s.t)} m`}
                  </text>
                )}
                {gewaehlt && !gesperrt && !schraege &&
                  ecken.map(([ecke, x, y]) => (
                    <g key={ecke} onPointerDown={(e) => anfassen(e, 'sperr', s.id, ecke)} className="plan-griff">
                      <circle cx={x} cy={y} r={griffTreffer} className="plan-tippflaeche" />
                      <circle cx={x} cy={y} r={griffR} className="plan-griff-punkt" />
                    </g>
                  ))}
                {gewaehlt && !gesperrt && kante && (
                  <g onPointerDown={(e) => anfassen(e, 'sperr', s.id)} className="plan-griff">
                    <circle cx={kante[0]} cy={kante[1]} r={griffTreffer} className="plan-tippflaeche" />
                    <circle cx={kante[0]} cy={kante[1]} r={griffR} className="plan-griff-punkt" />
                  </g>
                )}
              </g>
            );
          })}

          {waermeAnzeige && waermeAnzeige.fehlt.length === 0 && <WaermeSchicht ergebnis={waermeAnzeige} />}

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
        </svg>
      </div>
      <p className="leise klein-text">
        {zahl(L)} × {zahl(B)} m{regeln.wand_m !== null && ` · gestrichelt: Wandabstand ${zahl(regeln.wand_m * 100, 0)} cm`} · Raster 5 cm · antippen =
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
                {wandAbstaende(modulRechteck(gewaehltesModul), L, B)
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
              vorgabeHoehe={sperrhoehen(vorgaben.regeln)[gewaehlteSperr.typ] ?? null}
              onAendern={sperrAendern}
              onLoeschen={() => void speichernSperr(sperr.filter((s) => s.id !== gewaehlteSperr.id)).then(() => setAuswahl(null))}
            />
          )}
          {gewaehlteOeffnung && (
            <OeffnungLeiste
              o={gewaehlteOeffnung}
              onAendern={oeffnungAendern}
              onLoeschen={() => void speichernOeffnungen(oeffnungen.filter((o) => o.id !== gewaehlteOeffnung.id)).then(() => setAuswahl(null))}
            />
          )}

          <div className="werkzeuge">
            <span className="feldname">
              Sperrfläche einzeichnen
              <Hilfe begriff="Sperrfläche" text={HILFE.sperrflaeche} />
            </span>
            <div className="knopfreihe">
              {(Object.keys(SPERR_TYPEN) as SperrTyp[]).map((t) => (
                <button key={t} className="knopf-leise" onClick={() => sperrNeu(t)}>
                  + {SPERR_TYPEN[t]}
                </button>
              ))}
            </div>
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

      <div className="waerme-schalter">
        <label className="inline">
          <input type="checkbox" checked={waermeAn} onChange={(e) => waermeUmschalten(e.target.checked)} /> Wärmeverteilung anzeigen
        </label>
        <Hilfe begriff="Wärmeverteilung" text={`${HILFE.waermeverteilung} ${HINWEIS_WAERME}`} />
      </div>
      {waermeAnzeige && <WaermeLegende ergebnis={waermeAnzeige} />}

      <PlanErgebnis planung={planung} module={module} />
    </div>
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
  const ausschnitt = waagerecht
    ? { x: lx, y: aussen < 0 ? -wandStaerke : B, width: Math.abs(e.x - a.x), height: wandStaerke }
    : { x: aussen < 0 ? -wandStaerke : L, y: ly, width: wandStaerke, height: Math.abs(e.y - a.y) };
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

/** Auswahl einer Sperrfläche: Typ ändern, Maße eingeben, löschen */
function SperrLeiste({
  s,
  L,
  B,
  vorgabeHoehe,
  onAendern,
  onLoeschen,
}: {
  s: Sperrflaeche;
  L: number;
  B: number;
  /** Vorgabe-Höhe des Typs aus den Fachvorgaben (Wärmeverteilung) */
  vorgabeHoehe: number | null;
  onAendern: (s: Sperrflaeche) => void;
  onLoeschen: () => void;
}) {
  const punkt = PUNKT_TYPEN.includes(s.typ);
  const schraege = s.typ === 'dachschraege';
  const typen: SperrTyp[] = punkt ? ['leuchte', 'rauchmelder'] : schraege ? ['dachschraege'] : [...RECHTECK_TYPEN];
  return (
    <div className="knopfreihe auswahl-leiste">
      <select aria-label="Typ der Sperrfläche" value={s.typ} disabled={typen.length === 1} onChange={(e) => onAendern({ ...s, typ: e.target.value as SperrTyp })}>
        {typen.map((t) => (
          <option key={t} value={t}>
            {SPERR_TYPEN[t]}
          </option>
        ))}
      </select>
      {!punkt && !schraege && (
        <>
          <label className="inline">
            Breite
            <Zahlfeld
              wert={Math.round(s.b * 100) / 100}
              einheit="m"
              beschriftung="Breite in m"
              min={MIN_GROESSE}
              onSpeichern={(w) => {
                if (w !== null) onAendern({ ...s, b: begrenzen(w, MIN_GROESSE, L - s.x) });
              }}
            />
          </label>
          <span className="mal">×</span>
          <label className="inline">
            Tiefe
            <Zahlfeld
              wert={Math.round(s.t * 100) / 100}
              einheit="m"
              beschriftung="Tiefe in m"
              min={MIN_GROESSE}
              onSpeichern={(w) => {
                if (w !== null) onAendern({ ...s, t: begrenzen(w, MIN_GROESSE, B - s.y) });
              }}
            />
          </label>
          <label className="inline">
            Höhe
            <Zahlfeld
              wert={s.hoehe ?? null}
              einheit="m"
              beschriftung="Höhe der Oberseite in m"
              platzhalter={vorgabeHoehe === null ? 'fehlt' : `${zahl(vorgabeHoehe)} (Vorgabe)`}
              hervorheben={s.hoehe !== undefined && s.hoehe !== null}
              onSpeichern={(w) => {
                if (w === null || w <= 5) onAendern({ ...s, hoehe: w });
              }}
            />
          </label>
        </>
      )}
      {schraege && (
        <>
          <label className="inline">
            an der Wand
            <select
              value={s.wand ?? 'oben'}
              onChange={(e) => {
                const w = e.target.value as Wand;
                onAendern({ ...s, wand: w, ...schraegeStreifen(w, Math.min(schraegeTiefe(s), w === 'oben' || w === 'unten' ? B : L), L, B) });
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
            Tiefe
            <Zahlfeld
              wert={Math.round(schraegeTiefe(s) * 100) / 100}
              einheit="m"
              beschriftung="Tiefe der Dachschräge in m"
              min={MIN_GROESSE}
              onSpeichern={(w) => {
                if (w === null) return;
                const wand = s.wand ?? 'oben';
                onAendern({ ...s, ...schraegeStreifen(wand, begrenzen(w, MIN_GROESSE, wand === 'oben' || wand === 'unten' ? B : L), L, B) });
              }}
            />
          </label>
        </>
      )}
      <button className="knopf-gefahr" onClick={onLoeschen}>
        Löschen
      </button>
    </div>
  );
}

/** Auswahl einer Tür bzw. eines Fensters: Lage, Breite, Aufschlag, löschen */
function OeffnungLeiste({ o, onAendern, onLoeschen }: { o: TuerFenster; onAendern: (o: TuerFenster) => void; onLoeschen: () => void }) {
  return (
    <div className="knopfreihe auswahl-leiste">
      <strong>
        {o.art === 'tuer' ? 'Tür' : 'Fenster'}, Wand {WAENDE[o.wand]}
      </strong>
      <label className="inline">
        Abstand {WANDANFANG[o.wand]}
        <Zahlfeld wert={Math.round(o.position * 100) / 100} einheit="m" beschriftung="Abstand vom Wandanfang in m" onSpeichern={(w) => {
                if (w !== null) onAendern({ ...o, position: w });
              }} />
      </label>
      <label className="inline">
        Breite
        <Zahlfeld wert={Math.round(o.breite * 100) / 100} einheit="m" beschriftung="Breite in m" min={MIN_GROESSE} onSpeichern={(w) => {
                if (w !== null) onAendern({ ...o, breite: w });
              }} />
      </label>
      {o.art === 'tuer' && (
        <>
          <Schalter
            wert={o.aufschlag ?? 'innen'}
            optionen={{ innen: 'öffnet nach innen', aussen: 'nach außen' }}
            onWahl={(a: 'innen' | 'aussen') => onAendern({ ...o, aufschlag: a })}
          />
          <Schalter
            wert={o.band ?? 'links'}
            optionen={{ links: 'Band links', rechts: 'Band rechts' }}
            onWahl={(b: 'links' | 'rechts') => onAendern({ ...o, band: b })}
          />
        </>
      )}
      <button className="knopf-gefahr" onClick={onLoeschen}>
        Löschen
      </button>
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
  const rand = 0.15 * Math.max(L, B);
  return (
    <svg className="plan-vorschau" viewBox={`${-rand} ${-rand} ${L + 2 * rand} ${B + 2 * rand}`} aria-hidden="true">
      <rect x={0} y={0} width={L} height={B} className="plan-raum" />
      {(raum.tueren_fenster ?? []).map((o) => {
        const [a, e] = oeffnungStrecke(o, L, B);
        return <line key={o.id} x1={a.x} y1={a.y} x2={e.x} y2={e.y} className={`vorschau-${o.art}`} />;
      })}
      {(raum.sperrflaechen ?? []).map((s) =>
        PUNKT_TYPEN.includes(s.typ) ? (
          <circle key={s.id} cx={s.x} cy={s.y} r={0.04 * Math.max(L, B)} className="vorschau-punkt" />
        ) : (
          <rect key={s.id} x={s.x} y={s.y} width={s.b} height={s.t} className={`vorschau-sperr vorschau-${s.typ}`} />
        ),
      )}
      {(raum.module ?? []).map((x) => {
        const r = modulRechteck(x);
        return <rect key={x.id} x={r.x} y={r.y} width={r.b} height={r.t} className="vorschau-modul" />;
      })}
    </svg>
  );
}
