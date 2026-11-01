// Wärmeverteilung im Deckenplan (Festlegungen 01.11. und 02.11.2026): Bestrahlungsstärke in W/m² als Farbverlauf über
// dem Plan. Standard ist die Autoskala (kleinster bis größter Wert im Raum); die feste Skala bleibt für Vergleiche
// zwischen Räumen wählbar. Gerechnet wird im Browser mit dem Rechenkern (offline möglich).
// Vereinfachte Veranschaulichung der Strahlungsverteilung – keine Behaglichkeitsberechnung nach Norm.
import { waermeverteilung, type Regel, type Sperrflaeche, type StrahlerWerte, type Waermeverteilung as Ergebnis } from '@infrarot/rechenkern';
import type { KatalogModulDaten, PlatziertesModul } from '../api';
import { zahl } from '../texte';
import { Meldung } from './Felder';

export const HINWEIS_WAERME = 'Vereinfachte Veranschaulichung der Strahlungsverteilung – keine Behaglichkeitsberechnung nach Norm.';

/** Feste Skala: Stufen à 10 W/m², ab 70 W/m² dunkelste Stufe – in allen Räumen gleich, für Vergleiche */
export const SKALA_STUFE = 10;
/** 8 Stufen, hell = wenig → kräftig rot = viel (eine Farbfamilie, keine Regenbogenfarben) */
export const FARBEN = ['#fff3e0', '#fdd49e', '#fdbb84', '#fc8d59', '#ef6548', '#d7301f', '#b30000', '#7f0000'];

export type SkalaArt = 'auto' | 'fest';

export interface Skala {
  art: SkalaArt;
  /** Untergrenze je Stufe (FARBEN.length Werte) */
  grenzen: number[];
  /** Obergrenze der letzten Stufe; null = offen („≥“) */
  oben: number | null;
  /** Nachkommastellen für die Legende */
  stellen: number;
}

/** Autoskala: vom kleinsten bis zum größten Wert des Raums in gleichen Stufen; feste Skala: 0, 10, … ≥ 70 W/m² */
export function skala(ergebnis: Pick<Ergebnis, 'min_w_m2' | 'max_w_m2'>, art: SkalaArt): Skala {
  const n = FARBEN.length;
  if (art === 'fest') return { art, grenzen: FARBEN.map((_, i) => i * SKALA_STUFE), oben: null, stellen: 0 };
  const lo = ergebnis.min_w_m2;
  const hi = Math.max(ergebnis.max_w_m2, lo);
  const spanne = hi - lo;
  const stellen = spanne >= 40 ? 0 : spanne >= 4 ? 1 : 2;
  return { art, grenzen: FARBEN.map((_, i) => lo + (i * spanne) / n), oben: hi, stellen };
}

export function stufe(wert: number, s: Skala): number {
  const n = FARBEN.length;
  if (s.art === 'fest') return Math.min(n - 1, Math.max(0, Math.floor(wert / SKALA_STUFE)));
  const lo = s.grenzen[0];
  const spanne = (s.oben ?? lo) - lo;
  if (spanne <= 1e-9) return 0;
  return Math.min(n - 1, Math.max(0, Math.floor(((wert - lo) / spanne) * n)));
}

export function farbe(wert: number, s: Skala): string {
  return FARBEN[stufe(wert, s)];
}

const SPERRHOEHE: Partial<Record<Sperrflaeche['typ'], string>> = {
  sitzplatz: 'hoehe_sitzplatz_m',
  bett: 'hoehe_bett_m',
  hochschrank: 'hoehe_hochschrank_m',
  dusche: 'hoehe_dusche_m',
  sonstiges: 'hoehe_sonstiges_m',
};

function regelWert(regeln: Regel[] | undefined, schluessel: string): number | null {
  return regeln?.find((r) => r.schluessel === schluessel)?.wert ?? null;
}

/** Vorgabe-Höhen je Sperrflächen-Typ aus den (eingefrorenen) Fachvorgaben des Projekts */
export function sperrhoehen(regeln: Regel[] | undefined): Partial<Record<Sperrflaeche['typ'], number | null>> {
  return Object.fromEntries(Object.entries(SPERRHOEHE).map(([typ, s]) => [typ, regelWert(regeln, s)]));
}

export function berechnen(eingabe: {
  laenge_m: number;
  breite_m: number;
  hoehe_m: number | null;
  raumtemperatur_c: number | null;
  module: PlatziertesModul[];
  sperrflaechen: Sperrflaeche[];
  katalog: KatalogModulDaten[];
  regeln: Regel[] | undefined;
}): Ergebnis {
  const kennwerte = new Map<number, StrahlerWerte>(
    eingabe.katalog.map((k) => [k.id, { temperatur_c: k.oberflaechentemperatur_c, emissionsgrad: k.emissionsgrad, abstrahlwinkel_grad: k.abstrahlwinkel_grad }]),
  );
  return waermeverteilung({
    laenge_m: eingabe.laenge_m,
    breite_m: eingabe.breite_m,
    hoehe_m: eingabe.hoehe_m,
    raumtemperatur_c: eingabe.raumtemperatur_c,
    module: eingabe.module,
    kennwerte,
    vorgaben: {
      temperatur_c: regelWert(eingabe.regeln, 'strahler_temperatur_c'),
      emissionsgrad: regelWert(eingabe.regeln, 'strahler_emissionsgrad'),
      abstrahlwinkel_grad: regelWert(eingabe.regeln, 'strahler_abstrahlwinkel_grad'),
    },
    sperrflaechen: eingabe.sperrflaechen,
    sperrhoehe: sperrhoehen(eingabe.regeln),
    // höchstens etwa 60 Zellen je Richtung, damit es auf dem Tablet flüssig bleibt
    raster_m: Math.max(0.1, Math.max(eingabe.laenge_m, eingabe.breite_m) / 60),
  });
}

/**
 * Farbschicht im SVG des Deckenplans (Planeinheiten = Meter). Sie nimmt keine Zeigereingaben an, damit Sperrflächen
 * und Module darunter bedienbar bleiben; den Wert an der Zeigerposition zeigt die Legende (zelleAn).
 */
export function WaermeSchicht({ ergebnis, skala: s }: { ergebnis: Ergebnis; skala: Skala }) {
  return (
    <g className="waerme-schicht" aria-hidden="true">
      {ergebnis.zellen.map((z) => (
        <rect key={`${z.x}-${z.y}`} x={z.x} y={z.y} width={z.b + 0.002} height={z.t + 0.002} fill={farbe(z.wert, s)} />
      ))}
    </g>
  );
}

/** Markierung der angetippten Stelle mit Wert im Plan (Größen in Planeinheiten, aus Bildschirmpixeln umgerechnet) */
export function WaermeMarke({ ergebnis, zeiger, px }: { ergebnis: Ergebnis; zeiger: { x: number; y: number } | null; px: (p: number) => number }) {
  const z = zeiger && zelleAn(ergebnis, zeiger.x, zeiger.y);
  if (!z || !zeiger) return null;
  const text = `${zahl(z.wert, z.wert < 10 ? 1 : 0)} W/m²`;
  const breite = px(8 + text.length * 7.5);
  const links = zeiger.x + px(10) + breite > ergebnis.zellen.reduce((m, c) => Math.max(m, c.x + c.b), 0);
  const x = links ? zeiger.x - px(10) - breite : zeiger.x + px(10);
  return (
    <g className="waerme-marke" aria-hidden="true">
      <circle cx={zeiger.x} cy={zeiger.y} r={px(6)} />
      <rect x={x} y={zeiger.y - px(11)} width={breite} height={px(22)} rx={px(4)} />
      <text x={x + breite / 2} y={zeiger.y} fontSize={px(13)} textAnchor="middle" dominantBaseline="middle">
        {text}
      </text>
    </g>
  );
}

/** Rasterzelle an einer Stelle des Plans (für die Anzeige unter dem Zeiger bzw. Finger) */
export function zelleAn(ergebnis: Ergebnis, x: number, y: number) {
  return ergebnis.zellen.find((z) => x >= z.x && x < z.x + z.b && y >= z.y && y < z.y + z.t) ?? null;
}

/** Legende passend zur gewählten Skala mit echten Zahlenwerten, Min/Mittel/Max, Wert an der angetippten Stelle */
export function WaermeLegende({
  ergebnis,
  skala: s,
  zeiger,
}: {
  ergebnis: Ergebnis;
  skala: Skala;
  zeiger: { x: number; y: number } | null;
}) {
  if (ergebnis.fehlt.length > 0) {
    return <Meldung art="warnung">Wärmeverteilung nicht darstellbar: {ergebnis.fehlt.join('; ')}.</Meldung>;
  }
  const w = (x: number) => zahl(x, s.stellen);
  const spanneNull = s.art === 'auto' && (s.oben ?? 0) - s.grenzen[0] < 0.05;
  const z = zeiger && zelleAn(ergebnis, zeiger.x, zeiger.y);
  return (
    <div className="waerme-legende">
      <div className="waerme-skala" role="img" aria-label={`Farbskala Bestrahlungsstärke ${w(s.grenzen[0])} bis ${s.oben === null ? `über ${w(s.grenzen.at(-1)!)}` : w(s.oben)} W/m²`}>
        {FARBEN.map((f, i) => (
          <span key={f} className="waerme-stufe">
            <span className="waerme-farbe" style={{ background: f }} />
            <small>
              {s.oben === null && i === FARBEN.length - 1
                ? `≥ ${w(s.grenzen[i])}`
                : `${w(s.grenzen[i])}–${w(i === FARBEN.length - 1 ? (s.oben ?? 0) : s.grenzen[i + 1])}`}
            </small>
          </span>
        ))}
        <small className="waerme-einheit">W/m²</small>
      </div>
      <p className="waerme-kennzahlen">
        Min <strong>{zahl(ergebnis.min_w_m2, 1)}</strong> · Mittel <strong>{zahl(ergebnis.mittel_w_m2, 1)}</strong> · Max{' '}
        <strong>{zahl(ergebnis.max_w_m2, 1)}</strong> W/m² in diesem Raum
      </p>
      <p className="klein-text waerme-zeiger" aria-live="polite">
        {z
          ? `Angetippte Stelle (${zahl(zeiger!.x, 1)} / ${zahl(zeiger!.y, 1)} m): ${zahl(z.wert, 1)} W/m² ${z.flaeche === 'moebel' ? `auf der Möbeloberseite in ${zahl(z.z)} m Höhe` : 'am Boden'}`
          : 'Eine Stelle im Plan antippen (oder mit der Maus darüberfahren), um den Wert dort zu sehen.'}
      </p>
      <p className="leise klein-text">
        {s.art === 'auto'
          ? 'Skala automatisch: vom kleinsten bis zum größten Wert in diesem Raum – Farben sind zwischen Räumen nicht vergleichbar.'
          : 'Feste Skala: in allen Räumen gleich (Stufen zu 10 W/m²) – für Vergleiche zwischen Räumen.'}
        {spanneNull && ' Im Raum gibt es kaum Unterschiede.'} Bestrahlungsstärke am Boden bzw. auf der Oberseite von Möbeln (über
        Sperrflächen wird der Boden nicht dargestellt).
      </p>
      <p className="leise klein-text">{HINWEIS_WAERME}</p>
    </div>
  );
}
