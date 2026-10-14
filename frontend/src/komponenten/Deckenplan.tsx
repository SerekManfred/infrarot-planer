// Deckenplan eines Raums (Festlegung 14.10.2026): maßstäbliche Draufsicht mit Sperrflächen und Infrarot-Deckenmodulen.
// Bedienung per Finger: antippen = auswählen, ziehen = verschieben, Eckpunkt ziehen = Größe ändern.
// Regelprüfung live mit dem Rechenkern (gleiche Regeln wie Server und Raumliste); gespeichert wird beim Loslassen.
// Vorerst nur rechteckige Räume; Maße in m ab der linken oberen Raumecke (x = Länge, y = Breite).
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  bevorzugtGedreht,
  istBad,
  modulRechteck,
  platziertesModul,
  PUNKT_TYPEN,
  raumModulplanung,
  regelnAufloesen,
  SPERR_TYPEN,
  vorschlagen,
  zulaessigeModule,
  type KatalogModul,
  type PlatzierungsRaum,
  type SperrTyp,
  type Wand,
} from '@infrarot/rechenkern';
import { api, type AuswertungRaum, type Fachvorgaben, type KatalogModulDaten, type PlatziertesModul, type Raum, type Sperrflaeche } from '../api';
import { HILFE, watt, zahl } from '../texte';
import { Hilfe, Meldung } from './Felder';

type Aendern = (aktion: () => Promise<unknown>) => Promise<void>;

interface Props {
  raum: Raum;
  ergebnis: AuswertungRaum | undefined;
  vorgaben: Fachvorgaben;
  gesperrt: boolean;
  aendern: Aendern;
}

const RASTER = 0.05;
/** Startgrößen neuer Sperrflächen in m (nur Bedienkomfort, danach per Finger anpassen) */
const STARTGROESSE: Record<Exclude<SperrTyp, 'leuchte' | 'rauchmelder' | 'dachschraege'>, [number, number]> = {
  sitzplatz: [2.0, 1.0],
  bett: [1.6, 2.0],
  hochschrank: [1.2, 0.6],
  dusche: [0.9, 0.9],
  sonstiges: [1.0, 1.0],
};
const WAENDE: Record<Wand, string> = { oben: 'oben', unten: 'unten', links: 'links', rechts: 'rechts' };

type Auswahl = { art: 'sperr' | 'modul'; id: string } | null;
type Zug = { art: 'sperr' | 'modul'; id: string; modus: 'schieben' | 'groesse'; dx: number; dy: number; bewegt: boolean } | null;

function neueId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const rasten = (w: number) => Math.round(w / RASTER) * RASTER;
const begrenzen = (w: number, min: number, max: number) => Math.min(Math.max(w, min), Math.max(min, max));

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

export function Deckenplan({ raum, ergebnis, vorgaben, gesperrt, aendern }: Props) {
  const L = raum.laenge_m ?? 0;
  const B = raum.breite_m ?? 0;
  const [sperr, setSperr] = useState<Sperrflaeche[]>(raum.sperrflaechen ?? []);
  const [module, setModule] = useState<PlatziertesModul[]>(raum.module ?? []);
  const [auswahl, setAuswahl] = useState<Auswahl>(null);
  const [katalog, setKatalog] = useState<KatalogModulDaten[]>([]);
  const [meldung, setMeldung] = useState<{ text: string; art: 'fehler' | 'hinweis' | 'warnung' } | null>(null);
  const zug = useRef<Zug>(null);
  const svg = useRef<SVGSVGElement>(null);

  // Stand vom Server bzw. Offline-Speicher übernehmen, solange nicht gerade gezogen wird
  useEffect(() => {
    if (!zug.current) setSperr(raum.sperrflaechen ?? []);
  }, [raum.sperrflaechen]);
  useEffect(() => {
    if (!zug.current) setModule(raum.module ?? []);
  }, [raum.module]);
  useEffect(() => {
    api.get<KatalogModulDaten[]>('/bibliotheken/module').then(setKatalog).catch(() => setKatalog([]));
  }, []);

  const regeln = useMemo(() => regelnAufloesen(vorgaben.regeln), [vorgaben.regeln]);
  const raumtyp = vorgaben.raumtypen.find((t) => t.id === raum.raumtyp_id)?.bezeichnung ?? null;
  const geometrie: PlatzierungsRaum = { laenge_m: L, breite_m: B, hoehe_m: raum.hoehe_m, ist_bad: istBad(raumtyp) };
  const heizlast = ergebnis?.phi_massgeblich_w ?? null;
  const planung = raumModulplanung(geometrie, sperr, module, regeln, heizlast);
  const zulaessig = useMemo(
    () => zulaessigeModule(katalogFuerRechenkern(katalog), { ...geometrie }, regeln),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [katalog, regeln, geometrie.ist_bad],
  );

  if (L <= 0 || B <= 0) return <p className="leise">Für den Deckenplan zuerst Länge und Breite des Raums eingeben.</p>;

  const speichernSperr = (neu: Sperrflaeche[]) => aendern(() => api.patch(`/raeume/${raum.id}`, { sperrflaechen: neu }));
  const speichernModule = (neu: PlatziertesModul[]) => aendern(() => api.patch(`/raeume/${raum.id}`, { module: neu }));

  function punkt(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const m = svg.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: p.x, y: p.y };
  }

  function anfassen(e: ReactPointerEvent, art: 'sperr' | 'modul', id: string, modus: 'schieben' | 'groesse' = 'schieben') {
    e.stopPropagation();
    setAuswahl({ art, id });
    if (gesperrt) return;
    const p = punkt(e);
    const obj = art === 'sperr' ? sperr.find((s) => s.id === id)! : module.find((m) => m.id === id)!;
    zug.current = { art, id, modus, dx: p.x - obj.x, dy: p.y - obj.y, bewegt: false };
    svg.current!.setPointerCapture(e.pointerId);
  }

  function ziehen(e: ReactPointerEvent) {
    const z = zug.current;
    if (!z) return;
    const p = punkt(e);
    z.bewegt = true;
    if (z.art === 'modul') {
      setModule((alt) =>
        alt.map((m) => {
          if (m.id !== z.id) return m;
          const r = modulRechteck(m);
          return { ...m, x: rasten(begrenzen(p.x - z.dx, 0, L - r.b)), y: rasten(begrenzen(p.y - z.dy, 0, B - r.t)) };
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
        if (z.modus === 'groesse') {
          return { ...s, b: rasten(begrenzen(p.x - s.x, RASTER * 2, L - s.x)), t: rasten(begrenzen(p.y - s.y, RASTER * 2, B - s.y)) };
        }
        return { ...s, x: rasten(begrenzen(p.x - z.dx, 0, L - s.b)), y: rasten(begrenzen(p.y - z.dy, 0, B - s.t)) };
      }),
    );
  }

  function loslassen() {
    const z = zug.current;
    zug.current = null;
    if (!z?.bewegt) return;
    if (z.art === 'modul') void speichernModule(module);
    else void speichernSperr(sperr);
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
    const k = katalog.find((m) => m.artikel_nr === artikel);
    if (!k) return;
    const gedreht = bevorzugtGedreht(geometrie);
    const m = platziertesModul(k, 0, 0, gedreht, neueId());
    const r = modulRechteck(m);
    const neu = { ...m, x: rasten(Math.max(0, (L - r.b) / 2)), y: rasten(Math.max(0, (B - r.t) / 2)) };
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
    void speichernModule(v.module);
  }

  const gewaehltesModul = auswahl?.art === 'modul' ? module.find((m) => m.id === auswahl.id) : undefined;
  const gewaehlteSperr = auswahl?.art === 'sperr' ? sperr.find((s) => s.id === auswahl.id) : undefined;

  function modulAendern(aenderung: Partial<PlatziertesModul>) {
    if (!gewaehltesModul) return;
    void speichernModule(module.map((m) => (m.id === gewaehltesModul.id ? { ...m, ...aenderung } : m)));
  }

  function tauschen(artikel: string) {
    const k = katalog.find((m) => m.artikel_nr === artikel);
    if (!k || !gewaehltesModul) return;
    const neu = platziertesModul(k, gewaehltesModul.x, gewaehltesModul.y, gewaehltesModul.gedreht, gewaehltesModul.id);
    void speichernModule(module.map((m) => (m.id === neu.id ? neu : m)));
  }

  const wand = regeln.wand_m;
  const randStrich = 0.02 * Math.max(L, B);
  const schrift = Math.max(0.12, Math.min(L, B) / 22);

  return (
    <div className="deckenplan">
      <div className="plan-rahmen">
        <svg
          ref={svg}
          className="plan"
          viewBox={`${-0.15} ${-0.15} ${L + 0.3} ${B + 0.3}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerMove={ziehen}
          onPointerUp={loslassen}
          onPointerCancel={loslassen}
          onPointerDown={() => setAuswahl(null)}
          role="img"
          aria-label={`Deckenplan ${zahl(L)} × ${zahl(B)} m`}
        >
          <rect x={0} y={0} width={L} height={B} className="plan-raum" strokeWidth={randStrich} />
          {wand !== null && L > 2 * wand && B > 2 * wand && (
            <rect x={wand} y={wand} width={L - 2 * wand} height={B - 2 * wand} className="plan-wandabstand" />
          )}
          {sperr.map((s) => {
            const punktTyp = PUNKT_TYPEN.includes(s.typ);
            const abstandM = punktTyp ? regeln.punkt_m[s.typ as 'leuchte' | 'rauchmelder'] : regeln.flaeche_m[s.typ as keyof typeof regeln.flaeche_m];
            const gewaehlt = gewaehlteSperr?.id === s.id;
            if (punktTyp) {
              return (
                <g key={s.id} onPointerDown={(e) => anfassen(e, 'sperr', s.id)} className={`plan-punkt plan-${s.typ}${gewaehlt ? ' gewaehlt' : ''}`}>
                  {abstandM !== null && <circle cx={s.x} cy={s.y} r={abstandM} className="plan-halo" />}
                  {/* große, unsichtbare Tippfläche */}
                  <circle cx={s.x} cy={s.y} r={Math.max(0.2, schrift * 1.5)} className="plan-tippflaeche" />
                  <circle cx={s.x} cy={s.y} r={schrift * 0.6} className="plan-punkt-kern" />
                </g>
              );
            }
            return (
              <g key={s.id} className={`plan-sperr plan-${s.typ}${gewaehlt ? ' gewaehlt' : ''}`}>
                {abstandM !== null && abstandM > 0 && (
                  <rect x={s.x - abstandM} y={s.y - abstandM} width={s.b + 2 * abstandM} height={s.t + 2 * abstandM} rx={abstandM} className="plan-halo" />
                )}
                <rect x={s.x} y={s.y} width={s.b} height={s.t} onPointerDown={(e) => anfassen(e, 'sperr', s.id)} />
                <text x={s.x + s.b / 2} y={s.y + s.t / 2} fontSize={schrift} textAnchor="middle" dominantBaseline="middle">
                  {SPERR_TYPEN[s.typ]}
                </text>
                {gewaehlt && !gesperrt && s.typ !== 'dachschraege' && (
                  <circle cx={s.x + s.b} cy={s.y + s.t} r={Math.max(0.12, schrift)} className="plan-griff" onPointerDown={(e) => anfassen(e, 'sperr', s.id, 'groesse')} />
                )}
              </g>
            );
          })}
          {module.map((m, i) => {
            const r = modulRechteck(m);
            const verstoss = (planung.verstoesse[m.id] ?? []).length > 0;
            return (
              <g
                key={m.id}
                className={`plan-modul${verstoss ? ' verstoss' : ''}${gewaehltesModul?.id === m.id ? ' gewaehlt' : ''}`}
                onPointerDown={(e) => anfassen(e, 'modul', m.id)}
              >
                <rect x={r.x} y={r.y} width={r.b} height={r.t} />
                <text x={r.x + r.b / 2} y={r.y + r.t / 2} fontSize={schrift} textAnchor="middle" dominantBaseline="middle">
                  {i + 1}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="leise klein-text">
        {zahl(L)} × {zahl(B)} m{wand !== null && ` · gestrichelt: Wandabstand ${zahl(wand * 100, 0)} cm`} · Raster 5 cm · antippen = auswählen,
        ziehen = verschieben{!gesperrt && ', Eckpunkt ziehen = Größe ändern'}
      </p>

      {!gesperrt && (
        <>
          {gewaehltesModul && (
            <div className="knopfreihe auswahl-leiste">
              <strong>
                Modul {module.indexOf(gewaehltesModul) + 1}: {gewaehltesModul.artikel_nr} ({watt(gewaehltesModul.leistung_w)})
              </strong>
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
              <button className="knopf-gefahr" onClick={() => void speichernModule(module.filter((m) => m.id !== gewaehltesModul.id)).then(() => setAuswahl(null))}>
                Löschen
              </button>
            </div>
          )}
          {gewaehlteSperr && (
            <div className="knopfreihe auswahl-leiste">
              <strong>{SPERR_TYPEN[gewaehlteSperr.typ]}</strong>
              {gewaehlteSperr.typ === 'dachschraege' && (
                <label className="inline">
                  an der Wand
                  <select
                    value={gewaehlteSperr.wand ?? 'oben'}
                    onChange={(e) => {
                      const w = e.target.value as Wand;
                      const neu = { ...gewaehlteSperr, wand: w, ...schraegeStreifen(w, schraegeTiefe(gewaehlteSperr), L, B) };
                      void speichernSperr(sperr.map((s) => (s.id === neu.id ? neu : s)));
                    }}
                  >
                    {(Object.keys(WAENDE) as Wand[]).map((w) => (
                      <option key={w} value={w}>
                        {WAENDE[w]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button className="knopf-gefahr" onClick={() => void speichernSperr(sperr.filter((s) => s.id !== gewaehlteSperr.id)).then(() => setAuswahl(null))}>
                Löschen
              </button>
            </div>
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
      {module.some((m) => (planung.verstoesse[m.id] ?? []).length > 0) && (
        <ul className="verstoesse">
          {module.map((m, i) =>
            (planung.verstoesse[m.id] ?? []).map((v) => (
              <li key={`${m.id}-${v}`}>
                Modul {i + 1} ({m.artikel_nr}): {v}
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
