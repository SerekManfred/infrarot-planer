// Wärmeverteilung im Deckenplan (Festlegung 01.11.2026): Bestrahlungsstärke in W/m² als halbtransparenter Farbverlauf
// mit fester Skala (in allen Räumen gleich). Gerechnet wird im Browser mit dem Rechenkern (offline möglich).
// Vereinfachte Veranschaulichung der Strahlungsverteilung – keine Behaglichkeitsberechnung nach Norm.
import { waermeverteilung, type Regel, type Sperrflaeche, type StrahlerWerte, type Waermeverteilung as Ergebnis } from '@infrarot/rechenkern';
import type { KatalogModulDaten, PlatziertesModul } from '../api';
import { zahl } from '../texte';
import { Meldung } from './Felder';

export const HINWEIS_WAERME = 'Vereinfachte Veranschaulichung der Strahlungsverteilung – keine Behaglichkeitsberechnung nach Norm.';

/** Feste Skala: Stufen à 25 W/m², einfarbig hell → dunkel (Orange der App); ab 200 W/m² dunkelste Stufe */
export const SKALA_STUFE = 25;
const FARBEN = ['#fff1e6', '#ffe0c7', '#fec79f', '#fca772', '#f5844a', '#e4622a', '#c24a1b', '#943612'];

export function farbe(wert: number): string {
  return FARBEN[Math.min(FARBEN.length - 1, Math.max(0, Math.floor(wert / SKALA_STUFE)))];
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

/** Farbschicht im SVG des Deckenplans (Planeinheiten = Meter); jede Zelle mit Tooltip */
export function WaermeSchicht({ ergebnis }: { ergebnis: Ergebnis }) {
  return (
    <g className="waerme-schicht" aria-hidden="true">
      {ergebnis.zellen.map((z) => (
        <rect key={`${z.x}-${z.y}`} x={z.x} y={z.y} width={z.b + 0.002} height={z.t + 0.002} fill={farbe(z.wert)}>
          <title>
            {`${zahl(z.wert, 0)} W/m² ${z.flaeche === 'moebel' ? `auf Möbeloberseite (${zahl(z.z)} m)` : 'am Boden'} · ${zahl(z.x + z.b / 2, 1)} / ${zahl(z.y + z.t / 2, 1)} m`}
          </title>
        </rect>
      ))}
    </g>
  );
}

/** Legende mit fester Skala, Höchstwert und Hinweisen */
export function WaermeLegende({ ergebnis }: { ergebnis: Ergebnis }) {
  if (ergebnis.fehlt.length > 0) {
    return (
      <Meldung art="warnung">
        Wärmeverteilung nicht darstellbar: {ergebnis.fehlt.join('; ')}.
      </Meldung>
    );
  }
  return (
    <div className="waerme-legende">
      <div className="waerme-skala" role="img" aria-label="Skala Bestrahlungsstärke 0 bis 200 W/m² und mehr">
        {FARBEN.map((f, i) => (
          <span key={f} className="waerme-stufe">
            <span className="waerme-farbe" style={{ background: f }} />
            <small>{i === FARBEN.length - 1 ? `≥ ${i * SKALA_STUFE}` : i * SKALA_STUFE}</small>
          </span>
        ))}
        <small className="waerme-einheit">W/m²</small>
      </div>
      <p className="klein-text">
        Bestrahlungsstärke am Boden bzw. auf der Oberseite von Möbeln (über Sperrflächen wird der Boden nicht dargestellt). Höchstwert in diesem
        Raum: <strong>{zahl(ergebnis.max_w_m2, 0)} W/m²</strong>. Feste Skala, in allen Räumen gleich.
      </p>
      {ergebnis.mit_vorgabewerten && (
        <Meldung art="warnung">
          Mit Vorgabewerten berechnet: Für mindestens ein Modul fehlen Oberflächentemperatur, Emissionsgrad oder Abstrahlwinkel im Modulkatalog.
        </Meldung>
      )}
      <p className="leise klein-text">{HINWEIS_WAERME}</p>
    </div>
  );
}
