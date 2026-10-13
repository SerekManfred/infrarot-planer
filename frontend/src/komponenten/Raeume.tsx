// Schnellerfassung vor Ort: Geschoss wählen, Räume als Rechteck (Länge × Breite, Höhe, Raumtyp) erfassen.
// Fläche und Heizlast erscheinen sofort; Bauteile nur bei Bedarf für die Kontrollrechnung (Gegenprobe C).
// Der Außendienst sieht eine vereinfachte Karte (Raumtyp, Maße, W/m² nur zur Ansicht, Heizlast); Fachprüfer und Admins alles.
import { useEffect, useState } from 'react';
import {
  api,
  fachansicht,
  hatRolle,
  type Auswertung,
  type Benutzer,
  type AuswertungRaum,
  type Fachvorgaben,
  type Geschoss,
  type Heizlastquelle,
  type Objekt,
  type Raum,
  type Wert,
} from '../api';
import {
  BEGRIFF,
  GEBAEUDESTANDARDS,
  HERKUNFT,
  HILFE,
  hinweisFuerAussendienst,
  PAUSCHALE_DURCH_FACHPRUEFER,
  prozent,
  QUELLEN,
  watt,
  zahl,
} from '../texte';
import { Bauteile } from './Bauteile';
import { Hilfe, Meldung, Schalter, Textfeld, Zahlfeld } from './Felder';

type Aendern = (aktion: () => Promise<unknown>) => Promise<void>;

interface Props {
  objekt: Objekt;
  vorgaben: Fachvorgaben;
  benutzer: Benutzer;
  gesperrt: boolean;
  aendern: Aendern;
  stand: number;
}

const GESCHOSS_VORSCHLAEGE = ['KG', 'EG', 'OG', 'DG'];

export function Raeume({ objekt, vorgaben, benutzer, gesperrt, aendern, stand }: Props) {
  const [geschosse, setGeschosse] = useState<Geschoss[] | null>(null);
  const [aktiv, setAktiv] = useState<number | null>(null);
  const [raeume, setRaeume] = useState<Raum[]>([]);
  const [auswertung, setAuswertung] = useState<Auswertung | null>(null);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    let abgebrochen = false;
    (async () => {
      try {
        const g = await api.get<Geschoss[]>(`/objekte/${objekt.id}/geschosse`);
        const gewaehlt = g.find((x) => x.id === aktiv)?.id ?? g[0]?.id ?? null;
        const [r, a] = await Promise.all([
          gewaehlt ? api.get<Raum[]>(`/geschosse/${gewaehlt}/raeume`) : Promise.resolve([]),
          api.get<Auswertung>(`/objekte/${objekt.id}/auswertung`),
        ]);
        if (abgebrochen) return;
        setGeschosse(g);
        setAktiv(gewaehlt);
        setRaeume(r);
        setAuswertung(a);
      } catch (e) {
        if (!abgebrochen) setFehler((e as Error).message);
      }
    })();
    return () => {
      abgebrochen = true;
    };
    // aktiv absichtlich nicht: Geschosswechsel lädt über waehleGeschoss
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objekt.id, stand]);

  async function waehleGeschoss(id: number) {
    setAktiv(id);
    setRaeume(await api.get<Raum[]>(`/geschosse/${id}/raeume`));
  }

  if (fehler) return <Meldung>{fehler}</Meldung>;
  if (!geschosse || !auswertung) return <p>Wird geladen …</p>;

  const neuesGeschoss = (bezeichnung: string) =>
    aendern(async () => {
      const g = await api.post<Geschoss>(`/objekte/${objekt.id}/geschosse`, {
        bezeichnung,
        reihenfolge: GESCHOSS_VORSCHLAEGE.includes(bezeichnung) ? GESCHOSS_VORSCHLAEGE.indexOf(bezeichnung) : geschosse.length,
      });
      setAktiv(g.id);
    });

  const neuerRaum = () =>
    aendern(() =>
      api.post(`/geschosse/${aktiv}/raeume`, {
        bezeichnung: `Raum ${raeume.length + 1}`,
        // Höhe vom zuletzt erfassten Raum übernehmen – meist gleich im Geschoss
        hoehe_m: raeume.at(-1)?.hoehe_m ?? null,
        raumtyp_id: null,
      }),
    );

  const fehlendeGeschosse = GESCHOSS_VORSCHLAEGE.filter((v) => !geschosse.some((g) => g.bezeichnung === v));
  const ergebnisse = new Map(auswertung.raeume.map((r) => [r.raum_id, r]));

  return (
    <div>
      <div className="geschosse">
        {geschosse.map((g) => (
          <button key={g.id} className={g.id === aktiv ? 'aktiv' : ''} onClick={() => waehleGeschoss(g.id)}>
            {g.bezeichnung}
          </button>
        ))}
        {!gesperrt &&
          fehlendeGeschosse.map((v) => (
            <button key={v} className="neu" onClick={() => neuesGeschoss(v)}>
              + {v}
            </button>
          ))}
      </div>

      {geschosse.length === 0 && <p className="leise">Zuerst ein Geschoss anlegen.</p>}

      {aktiv && (
        <>
          {raeume.map((raum) => (
            <RaumKarte
              key={raum.id}
              raum={raum}
              ergebnis={ergebnisse.get(raum.id)}
              objekt={objekt}
              vorgaben={vorgaben}
              benutzer={benutzer}
              gesperrt={gesperrt}
              aendern={aendern}
              stand={stand}
            />
          ))}
          {raeume.length === 0 && <p className="leise">Noch keine Räume in diesem Geschoss.</p>}
          {!gesperrt && (
            <div className="knopfreihe">
              <button className="knopf gross" onClick={neuerRaum}>
                + Raum
              </button>
              {raeume.length === 0 && (
                <button
                  className="knopf-zweit"
                  onClick={() =>
                    window.confirm('Leeres Geschoss löschen?') && aendern(() => api.loeschen(`/geschosse/${aktiv}`).then(() => setAktiv(null)))
                  }
                >
                  Geschoss löschen
                </button>
              )}
            </div>
          )}
        </>
      )}

      <Summe auswertung={auswertung} />
    </div>
  );
}

function RaumKarte({
  raum,
  ergebnis,
  objekt,
  vorgaben,
  benutzer,
  gesperrt,
  aendern,
  stand,
}: {
  raum: Raum;
  ergebnis: AuswertungRaum | undefined;
  objekt: Objekt;
  vorgaben: Fachvorgaben;
  benutzer: Benutzer;
  gesperrt: boolean;
  aendern: Aendern;
  stand: number;
}) {
  const [details, setDetails] = useState(false);
  const altbau = objekt.gebaeudestandard === 'sonstiger_bestand';
  // Außendienst: vereinfachte Karte; W/m² setzt nur der Fachprüfer (Festlegung 13.10.2026, Server prüft ebenso)
  const fach = fachansicht(benutzer);
  const pauschaleGesperrt = gesperrt || !hatRolle(benutzer, 'fachpruefer');
  const speichern = (feld: keyof Raum) => (wert: unknown) => aendern(() => api.patch(`/raeume/${raum.id}`, { [feld]: wert }));
  const pauschale = ergebnis?.werte.pauschale_w_m2.wert ?? null;

  return (
    <article className="karte raum">
      <div className="raum-kopf">
        <label>
          Raum
          <Textfeld wert={raum.bezeichnung} pflicht gesperrt={gesperrt} beschriftung="Raumbezeichnung" onSpeichern={speichern('bezeichnung')} />
        </label>
        <label>
          Raumtyp
          <Hilfe begriff="Raumtyp" text={HILFE.raumtyp} />
          <select
            value={raum.raumtyp_id ?? ''}
            disabled={gesperrt}
            onChange={(e) => speichern('raumtyp_id')(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">– bitte wählen –</option>
            {vorgaben.raumtypen.map((t) => (
              <option key={t.id} value={t.id}>
                {t.bezeichnung}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="masse">
        <label>
          Länge
          <Zahlfeld wert={raum.laenge_m} einheit="m" gesperrt={gesperrt} onSpeichern={speichern('laenge_m')} />
        </label>
        <span className="mal">×</span>
        <label>
          Breite
          <Zahlfeld wert={raum.breite_m} einheit="m" gesperrt={gesperrt} onSpeichern={speichern('breite_m')} />
        </label>
        <span className="mal">=</span>
        <span className="flaeche">
          <small>Fläche</small>
          {zahl(raum.flaeche_m2)} m²
        </span>
        <label>
          Höhe
          <Hilfe begriff="Höhe" text={HILFE.hoehe} />
          <Zahlfeld wert={raum.hoehe_m} einheit="m" gesperrt={gesperrt} onSpeichern={speichern('hoehe_m')} />
        </label>
        {altbau && !pauschaleGesperrt ? (
          // Altbau: keine Vorgabe, die Pauschale legt der Fachprüfer je Raum fest (Pflicht)
          <label>
            Pauschale (Pflicht)
            <Hilfe begriff={GEBAEUDESTANDARDS.sonstiger_bestand} text={HILFE.altbau} />
            <Zahlfeld wert={raum.pauschale_w_m2} einheit="W/m²" pflicht gesperrt={false} onSpeichern={speichern('pauschale_w_m2')} />
          </label>
        ) : (
          (altbau || !fach) && (
            <span className="flaeche">
              <small>
                Pauschale
                <Hilfe begriff="Pauschale" text={altbau ? HILFE.altbau : HILFE.pauschale} />
              </small>
              {pauschale !== null ? `${zahl(pauschale, 0)} W/m²` : altbau ? <span className="fehlt-text">{PAUSCHALE_DURCH_FACHPRUEFER}</span> : '–'}
            </span>
          )
        )}
      </div>

      {fach && (
        <div className="quelle">
          <span className="feldname">
            Heizlastquelle
            <Hilfe begriff="Heizlastquelle" text={HILFE.heizlastquelle} />
          </span>
          <Schalter wert={raum.heizlastquelle} optionen={QUELLEN} gesperrt={gesperrt} onWahl={(q: Heizlastquelle) => speichern('heizlastquelle')(q)} />
          {raum.heizlastquelle === 'B' && (
            <label className="inline">
              Hottgenroth
              <Hilfe begriff="Hottgenroth" text={HILFE.hottgenroth} />
              <Zahlfeld wert={raum.hottgenroth_w} einheit="W" gesperrt={gesperrt} onSpeichern={speichern('hottgenroth_w')} />
            </label>
          )}
        </div>
      )}

      {ergebnis && (fach ? <Ergebnis e={ergebnis} /> : <ErgebnisEinfach e={ergebnis} />)}

      {fach && (
        <button className="aufklapper" onClick={() => setDetails(!details)} aria-expanded={details}>
          {details ? '▾' : '▸'} Abweichungen und Kontrollrechnung (Bauteile)
        </button>
      )}
      {fach && details && (
        <div className="details">
          <div className="raster">
            {!altbau && (
              <label>
                Pauschale nur für diesen Raum
                <Hilfe begriff="Pauschale" text={HILFE.pauschale} />
                <Zahlfeld
                  wert={raum.pauschale_w_m2}
                  einheit="W/m²"
                  hervorheben={raum.pauschale_w_m2 !== null}
                  platzhalter={ergebnis && ergebnis.werte.pauschale_w_m2.herkunft !== 'raum' ? zahl(ergebnis.werte.pauschale_w_m2.wert, 0) : ''}
                  gesperrt={pauschaleGesperrt}
                  onSpeichern={speichern('pauschale_w_m2')}
                />
              </label>
            )}
            <label>
              {BEGRIFF.raumtemperatur}
              <Hilfe begriff="Raumtemperatur" text={HILFE.raumtemperatur} />
              <Zahlfeld
                wert={raum.theta_int}
                einheit="°C"
                hervorheben={raum.theta_int !== null}
                platzhalter={vorgabeText(ergebnis?.werte.theta_int)}
                gesperrt={gesperrt}
                onSpeichern={speichern('theta_int')}
              />
            </label>
            <label>
              {BEGRIFF.luftwechsel}
              <Hilfe begriff="Luftwechsel" text={HILFE.luftwechsel} />
              <Zahlfeld
                wert={raum.luftwechsel}
                einheit="1/h"
                hervorheben={raum.luftwechsel !== null}
                platzhalter={vorgabeText(ergebnis?.werte.luftwechsel)}
                gesperrt={gesperrt}
                onSpeichern={speichern('luftwechsel')}
              />
            </label>
          </div>
          <Bauteile raum={raum} objekt={objekt} vorgaben={vorgaben} gesperrt={gesperrt} aendern={aendern} stand={stand} />
        </div>
      )}
      {!gesperrt && (fach ? details : true) && (
        <button
          className="knopf-gefahr"
          onClick={() => window.confirm(`Raum „${raum.bezeichnung}“ löschen?`) && aendern(() => api.loeschen(`/raeume/${raum.id}`))}
        >
          Raum löschen
        </button>
      )}
    </article>
  );
}

function vorgabeText(w: Wert | undefined): string {
  if (!w || w.herkunft === 'raum') return '';
  return w.wert === null ? 'Vorgabe fehlt' : String(w.wert).replace('.', ',');
}

function HerkunftMarke({ w }: { w: Wert }) {
  return <span className={`herkunft herkunft-${w.herkunft}`}>{HERKUNFT[w.herkunft]}</span>;
}

function Ergebnis({ e }: { e: AuswertungRaum }) {
  const q = e.werte.pauschale_w_m2;
  return (
    <div className="ergebnis">
      <div className="hauptwert">
        <small>
          Heizlast ({QUELLEN[e.quelle]})
          <Hilfe begriff="Heizlast" text={HILFE.heizlast} />
        </small>
        <strong>{watt(e.phi_massgeblich_w)}</strong>
      </div>
      <div className="nebenwerte">
        <span>
          A: {watt(e.phi_a_w)} · {q.wert === null ? '–' : `${zahl(q.wert, 0)} W/m²`} <HerkunftMarke w={q} />
          <Hilfe begriff="Herkunft des W/m²-Werts" text={HILFE.herkunft} />
        </span>
        {e.phi_b_w !== null && <span>B: {watt(e.phi_b_w)}</span>}
        {e.phi_c_w !== null && (
          <span>
            C: {watt(e.phi_c_w)}
            {e.abweichung_c !== null && (
              <>
                <span className={Math.abs(e.abweichung_c) > 0.2 ? 'abweichung-gross' : ''}> · Abweichung {prozent(e.abweichung_c)}</span>
                <Hilfe begriff="Abweichung" text={HILFE.abweichung} />
              </>
            )}
          </span>
        )}
      </div>
      <Hinweise liste={e.hinweise} />
    </div>
  );
}

/** Außendienst: nur die Heizlast und verständliche Hinweise (ohne Quellen A/B/C und Kontrollrechnung) */
function ErgebnisEinfach({ e }: { e: AuswertungRaum }) {
  return (
    <div className="ergebnis">
      <div className="hauptwert">
        <small>
          Heizlast
          <Hilfe begriff="Heizlast" text={HILFE.heizlast} />
        </small>
        <strong>{watt(e.phi_massgeblich_w)}</strong>
      </div>
      <Hinweise liste={e.hinweise.map(hinweisFuerAussendienst).filter((h): h is string => h !== null)} />
    </div>
  );
}

function Hinweise({ liste }: { liste: string[] }) {
  if (liste.length === 0) return null;
  return (
    <ul className="hinweise">
      {liste.map((h) => (
        <li key={h}>{h}</li>
      ))}
    </ul>
  );
}

function Summe({ auswertung }: { auswertung: Auswertung }) {
  const { summe } = auswertung;
  if (summe.raeume_mit_ergebnis + summe.raeume_ohne_ergebnis === 0) return null;
  return (
    <div className="karte summe">
      <span>
        Summe Raumheizlasten ({summe.raeume_mit_ergebnis} Räume)
        <Hilfe begriff="Summe Raumheizlasten" text={HILFE.heizlastSumme} />
        <strong>{watt(summe.phi_massgeblich_w)}</strong>
      </span>
      {summe.raeume_ohne_ergebnis > 0 && (
        <Meldung art="warnung">{summe.raeume_ohne_ergebnis} Raum/Räume ohne Ergebnis – siehe Hinweise.</Meldung>
      )}
    </div>
  );
}
