// Wärmeverteilung im Deckenplan (Festlegungen 01.11. und 02.11.2026): Bestrahlungsstärke in W/m² als Farbverlauf über
// dem Plan. Praxistest 01.11.2026: weich dargestellt (Werte zwischen den Rasterpunkten bilinear interpoliert, Farben
// stufenlos), Deckkraft der Farbfläche einstellbar. Standard ist die Autoskala (kleinster bis größter Wert im Raum); die feste Skala bleibt für Vergleiche
// zwischen Räumen wählbar. Gerechnet wird im Browser mit dem Rechenkern (offline möglich).
// Vereinfachte Veranschaulichung der Strahlungsverteilung – keine Behaglichkeitsberechnung nach Norm.
import { waermeverteilung, type BibObjekt, type Regel, type Sperrflaeche, type StrahlerWerte, type Waermeverteilung as Ergebnis } from '@infrarot/rechenkern';
import { useMemo } from 'react';
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

const RGB = FARBEN.map((f) => [1, 3, 5].map((i) => parseInt(f.slice(i, i + 2), 16)));

/** Lage auf der Farbskala von 0 (hellste) bis FARBEN.length − 1 (kräftigste Farbe), stufenlos */
export function skalaLage(wert: number, s: Skala): number {
  const n = FARBEN.length;
  if (s.art === 'fest') return Math.min(n - 1, Math.max(0, wert / SKALA_STUFE));
  const lo = s.grenzen[0];
  const spanne = (s.oben ?? lo) - lo;
  if (spanne <= 1e-9) return 0;
  return Math.min(n - 1, Math.max(0, ((wert - lo) / spanne) * (n - 1)));
}

/** Stufenlose Farbe (lineare Mischung benachbarter Skalenfarben) als [r, g, b] */
export function farbeStetig(wert: number, s: Skala): [number, number, number] {
  const p = skalaLage(wert, s);
  const i = Math.min(FARBEN.length - 2, Math.floor(p));
  const t = p - i;
  return [0, 1, 2].map((k) => Math.round(RGB[i][k] + (RGB[i + 1][k] - RGB[i][k]) * t)) as [number, number, number];
}

/** Rastergröße aus den Zellen (Zellen liegen spaltenweise: erst alle y zu x = 0, dann x = 1 …) */
export function rasterMasse(ergebnis: Pick<Ergebnis, 'zellen'>): { nx: number; ny: number; laenge: number; breite: number } {
  const z = ergebnis.zellen;
  if (z.length === 0) return { nx: 0, ny: 0, laenge: 0, breite: 0 };
  const ny = z.filter((c) => c.x === z[0].x).length;
  const nx = z.length / ny;
  const letzte = z[z.length - 1];
  return { nx, ny, laenge: letzte.x + letzte.b, breite: letzte.y + letzte.t };
}

/** Interpolation zwischen den Zellmittelpunkten (bilinear, am Rand gehalten); null ohne Zellen */
export function interpolator(ergebnis: Pick<Ergebnis, 'zellen'>): ((x: number, y: number) => number) | null {
  const { nx, ny, laenge, breite } = rasterMasse(ergebnis);
  if (nx === 0) return null;
  const werte = Float64Array.from(ergebnis.zellen, (c) => c.wert);
  return (x, y) => {
    const u = Math.min(nx - 1, Math.max(0, (x / laenge) * nx - 0.5));
    const v = Math.min(ny - 1, Math.max(0, (y / breite) * ny - 0.5));
    const i0 = Math.floor(u);
    const j0 = Math.floor(v);
    const i1 = Math.min(nx - 1, i0 + 1);
    const j1 = Math.min(ny - 1, j0 + 1);
    const fu = u - i0;
    const fv = v - j0;
    return (
      (werte[i0 * ny + j0] * (1 - fu) + werte[i1 * ny + j0] * fu) * (1 - fv) + (werte[i0 * ny + j1] * (1 - fu) + werte[i1 * ny + j1] * fu) * fv
    );
  };
}

/** Wert an einer beliebigen Stelle des Raums (interpoliert) */
export function wertAn(ergebnis: Pick<Ergebnis, 'zellen'>, x: number, y: number): number | null {
  return interpolator(ergebnis)?.(x, y) ?? null;
}

/**
 * Bildpunkte der weichen Darstellung (RGBA, Zeile für Zeile): je Rasterzelle `faktor` × `faktor` Bildpunkte,
 * Werte bilinear interpoliert, Farbe stufenlos – keine Treppenstufen.
 */
export function waermeBild(ergebnis: Pick<Ergebnis, 'zellen'>, s: Skala, faktor = 6): { breite: number; hoehe: number; daten: Uint8ClampedArray } {
  const { nx, ny, laenge, breite } = rasterMasse(ergebnis);
  const wert = interpolator(ergebnis);
  const bw = nx * faktor;
  const bh = ny * faktor;
  const daten = new Uint8ClampedArray(bw * bh * 4);
  if (!wert) return { breite: 0, hoehe: 0, daten };
  for (let py = 0; py < bh; py++) {
    for (let px = 0; px < bw; px++) {
      const w = wert(((px + 0.5) / bw) * laenge, ((py + 0.5) / bh) * breite);
      const [r, g, b] = farbeStetig(w, s);
      const k = (py * bw + px) * 4;
      daten[k] = r;
      daten[k + 1] = g;
      daten[k + 2] = b;
      daten[k + 3] = 255;
    }
  }
  return { breite: bw, hoehe: bh, daten };
}

function regelWert(regeln: Regel[] | undefined, schluessel: string): number | null {
  return regeln?.find((r) => r.schluessel === schluessel)?.wert ?? null;
}

/** Standardhöhen je Objekt aus der (eingefrorenen) Objektbibliothek des Projekts */
export function sperrhoehen(objekte: Pick<BibObjekt, 'schluessel' | 'hoehe_m'>[] | undefined): Record<string, number | null> {
  return Object.fromEntries((objekte ?? []).map((o) => [o.schluessel, o.hoehe_m]));
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
  objekte: Pick<BibObjekt, 'schluessel' | 'hoehe_m'>[] | undefined;
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
    sperrhoehe: sperrhoehen(eingabe.objekte),
    // höchstens etwa 72 Zellen je Richtung (dazwischen interpoliert), damit es auf dem Tablet flüssig bleibt
    raster_m: Math.max(0.08, Math.max(eingabe.laenge_m, eingabe.breite_m) / 72),
  });
}

/**
 * Farbschicht im SVG des Deckenplans (Planeinheiten = Meter) als weiches Bild. Sie nimmt keine Zeigereingaben an,
 * damit Objekte und Module darunter bedienbar bleiben; den Wert an der Zeigerposition zeigt die Legende (wertAn).
 */
export function WaermeSchicht({ ergebnis, skala: s, deckkraft }: { ergebnis: Ergebnis; skala: Skala; deckkraft: number }) {
  const bild = useMemo(() => {
    const b = waermeBild(ergebnis, s);
    if (b.breite === 0 || typeof document === 'undefined') return null;
    const leinwand = document.createElement('canvas');
    leinwand.width = b.breite;
    leinwand.height = b.hoehe;
    const ctx = leinwand.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(new ImageData(b.daten, b.breite, b.hoehe), 0, 0);
    return leinwand.toDataURL('image/png');
  }, [ergebnis, s]);
  const { laenge, breite } = rasterMasse(ergebnis);
  if (!bild) return null;
  return (
    <g className="waerme-schicht" aria-hidden="true" opacity={deckkraft}>
      <image href={bild} x={0} y={0} width={laenge} height={breite} preserveAspectRatio="none" />
    </g>
  );
}

/** Markierung der angetippten Stelle mit Wert im Plan (Größen in Planeinheiten, aus Bildschirmpixeln umgerechnet) */
export function WaermeMarke({ ergebnis, zeiger, px }: { ergebnis: Ergebnis; zeiger: { x: number; y: number } | null; px: (p: number) => number }) {
  const wert = zeiger && wertAn(ergebnis, zeiger.x, zeiger.y);
  if (wert === null || !zeiger) return null;
  const text = `${zahl(wert, wert < 10 ? 1 : 0)} W/m²`;
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

/** Beschriftung des stufenlosen Farbbalkens: feste Skala 0, 10 … ≥ 70; Autoskala fünf Werte von Min bis Max */
export function achse(s: Skala): { lage: number; text: string }[] {
  const n = FARBEN.length;
  if (s.art === 'fest') return FARBEN.map((_, i) => ({ lage: i / (n - 1), text: `${i === n - 1 ? '≥ ' : ''}${i * SKALA_STUFE}` }));
  const lo = s.grenzen[0];
  const hi = s.oben ?? lo;
  return [0, 0.25, 0.5, 0.75, 1].map((f) => ({ lage: f, text: zahl(lo + f * (hi - lo), s.stellen) }));
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
  const wert = zeiger && wertAn(ergebnis, zeiger.x, zeiger.y);
  return (
    <div className="waerme-legende">
      <div
        className="waerme-verlauf"
        role="img"
        aria-label={`Farbskala Bestrahlungsstärke ${w(s.grenzen[0])} bis ${s.oben === null ? `über ${w(SKALA_STUFE * (FARBEN.length - 1))}` : w(s.oben)} W/m²`}
      >
        <div className="waerme-balken" style={{ background: `linear-gradient(to right, ${FARBEN.join(', ')})` }} />
        <div className="waerme-achse">
          {achse(s).map((a) => (
            <span key={a.lage} style={{ left: `${a.lage * 100}%` }}>
              {a.text}
            </span>
          ))}
        </div>
        <small className="waerme-einheit">W/m²</small>
      </div>
      <p className="waerme-kennzahlen">
        Min <strong>{zahl(ergebnis.min_w_m2, 1)}</strong> · Mittel <strong>{zahl(ergebnis.mittel_w_m2, 1)}</strong> · Max{' '}
        <strong>{zahl(ergebnis.max_w_m2, 1)}</strong> W/m² in diesem Raum
      </p>
      <p className="klein-text waerme-zeiger" aria-live="polite">
        {z
          ? `Angetippte Stelle (${zahl(zeiger!.x, 1)} / ${zahl(zeiger!.y, 1)} m): ${zahl(wert ?? z.wert, 1)} W/m² ${z.flaeche === 'moebel' ? `auf der Möbeloberseite in ${zahl(z.z)} m Höhe` : 'am Boden'}`
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
