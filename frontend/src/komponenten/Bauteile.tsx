// Detaillierte Bauteilmasken eines Raums – nur nötig für die Gegenprobe C.
import { useEffect, useState } from 'react';
import { api, type Angrenzung, type Bauteil, type Fachvorgaben, type Flaeche, type Objekt, type Oeffnung, type Raum } from '../api';
import { ANGRENZUNG } from '../texte';
import { Meldung, Textfeld, Zahlfeld } from './Felder';

type Aendern = (aktion: () => Promise<unknown>) => Promise<void>;

interface Props {
  raum: Raum;
  objekt: Objekt;
  vorgaben: Fachvorgaben;
  gesperrt: boolean;
  aendern: Aendern;
  stand: number;
}

export function Bauteile({ raum, objekt, vorgaben, gesperrt, aendern, stand }: Props) {
  const [bibliothek, setBibliothek] = useState<Bauteil[]>([]);
  const [flaechen, setFlaechen] = useState<(Flaeche & { oeffnungen: Oeffnung[] })[] | null>(null);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [b, f] = await Promise.all([
          api.get<Bauteil[]>('/bibliotheken/bauteile'),
          api.get<Flaeche[]>(`/raeume/${raum.id}/flaechen`),
        ]);
        const mitOeffnungen = await Promise.all(
          f.map(async (fl) => ({ ...fl, oeffnungen: await api.get<Oeffnung[]>(`/flaechen/${fl.id}/oeffnungen`) })),
        );
        setBibliothek(b);
        setFlaechen(mitOeffnungen);
      } catch (e) {
        setFehler((e as Error).message);
      }
    })();
  }, [raum.id, stand]);

  if (fehler) return <Meldung>{fehler}</Meldung>;
  if (!flaechen) return <p>Bauteile werden geladen …</p>;

  const fl = (id: number) => (feld: string) => (wert: unknown) => aendern(() => api.patch(`/flaechen/${id}`, { [feld]: wert }));
  const oe = (id: number) => (feld: string) => (wert: unknown) => aendern(() => api.patch(`/oeffnungen/${id}`, { [feld]: wert }));

  return (
    <div className="bauteile">
      <h3>Bauteile für die Gegenprobe C</h3>
      {objekt.klimadaten_id === null && <Meldung art="warnung">Für C fehlen noch die Klimadaten des Gebäudes (Reiter „Projektvorgaben“).</Meldung>}
      {bibliothek.length === 0 && <Meldung art="hinweis">Die Bauteilbibliothek ist leer – U-Werte bitte direkt eingeben oder Bibliothek importieren.</Meldung>}
      {flaechen.map((f) => (
        <div key={f.id} className="bauteil">
          <div className="raster">
            <label>
              Bezeichnung
              <Textfeld wert={f.bezeichnung} gesperrt={gesperrt} onSpeichern={fl(f.id)('bezeichnung')} />
            </label>
            <label>
              Bauteil
              <BauteilAuswahl bibliothek={bibliothek} wert={f.bauteil_id} gesperrt={gesperrt} onWahl={fl(f.id)('bauteil_id')} />
            </label>
            <label>
              U-Wert eigener
              <Zahlfeld wert={f.u_wert} einheit="W/m²K" hervorheben={f.u_wert !== null} gesperrt={gesperrt} onSpeichern={fl(f.id)('u_wert')} />
            </label>
            <label>
              Fläche brutto
              <Zahlfeld wert={f.flaeche_brutto_m2} einheit="m²" gesperrt={gesperrt} onSpeichern={(w) => (w === null ? undefined : fl(f.id)('flaeche_brutto_m2')(w))} />
            </label>
            <label>
              grenzt an
              <select value={f.angrenzung} disabled={gesperrt} onChange={(e) => fl(f.id)('angrenzung')(e.target.value as Angrenzung)}>
                {(Object.keys(ANGRENZUNG) as Angrenzung[]).map((a) => (
                  <option key={a} value={a}>
                    {ANGRENZUNG[a]}
                  </option>
                ))}
              </select>
            </label>
            {f.angrenzung !== 'aussen' && (
              <>
                <label>
                  angrenzender Raumtyp
                  <select
                    value={f.angrenzender_raumtyp_id ?? ''}
                    disabled={gesperrt}
                    onChange={(e) => fl(f.id)('angrenzender_raumtyp_id')(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">–</option>
                    {vorgaben.raumtypen.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.bezeichnung} {t.reduktionsfaktor === null ? '(f fehlt)' : `(f = ${String(t.reduktionsfaktor).replace('.', ',')})`}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Faktor f eigener
                  <Zahlfeld wert={f.f_korrektur} hervorheben={f.f_korrektur !== null} min={-1} gesperrt={gesperrt} onSpeichern={fl(f.id)('f_korrektur')} />
                </label>
              </>
            )}
          </div>

          {f.oeffnungen.map((o) => (
            <div key={o.id} className="oeffnung raster">
              <label>
                Öffnung
                <Textfeld wert={o.bezeichnung} gesperrt={gesperrt} onSpeichern={oe(o.id)('bezeichnung')} />
              </label>
              <label>
                Bauteil
                <BauteilAuswahl bibliothek={bibliothek} wert={o.bauteil_id} gesperrt={gesperrt} onWahl={oe(o.id)('bauteil_id')} />
              </label>
              <label>
                U-Wert eigener
                <Zahlfeld wert={o.u_wert} einheit="W/m²K" hervorheben={o.u_wert !== null} gesperrt={gesperrt} onSpeichern={oe(o.id)('u_wert')} />
              </label>
              <label>
                Fläche je Stück
                <Zahlfeld wert={o.flaeche_m2} einheit="m²" gesperrt={gesperrt} onSpeichern={(w) => (w === null ? undefined : oe(o.id)('flaeche_m2')(w))} />
              </label>
              <label>
                Anzahl
                <Zahlfeld wert={o.anzahl} min={1} gesperrt={gesperrt} onSpeichern={(w) => (w === null ? undefined : oe(o.id)('anzahl')(Math.round(w)))} />
              </label>
              {!gesperrt && (
                <button className="knopf-leise klein" onClick={() => aendern(() => api.loeschen(`/oeffnungen/${o.id}`))}>
                  Öffnung entfernen
                </button>
              )}
            </div>
          ))}

          {!gesperrt && (
            <div className="knopfreihe">
              <button className="knopf-zweit" onClick={() => aendern(() => api.post(`/flaechen/${f.id}/oeffnungen`, { bezeichnung: 'Fenster', flaeche_m2: 0 }))}>
                + Fenster/Tür
              </button>
              <button className="knopf-leise klein" onClick={() => window.confirm('Bauteilfläche löschen?') && aendern(() => api.loeschen(`/flaechen/${f.id}`))}>
                Fläche entfernen
              </button>
            </div>
          )}
        </div>
      ))}
      {!gesperrt && (
        <button
          className="knopf-zweit"
          onClick={() => aendern(() => api.post(`/raeume/${raum.id}/flaechen`, { bezeichnung: `Bauteil ${flaechen.length + 1}`, flaeche_brutto_m2: 0 }))}
        >
          + Bauteilfläche
        </button>
      )}
    </div>
  );
}

function BauteilAuswahl({
  bibliothek,
  wert,
  gesperrt,
  onWahl,
}: {
  bibliothek: Bauteil[];
  wert: number | null;
  gesperrt: boolean;
  onWahl: (id: number | null) => void;
}) {
  const kategorien = [...new Set(bibliothek.map((b) => b.kategorie))];
  return (
    <select value={wert ?? ''} disabled={gesperrt} onChange={(e) => onWahl(e.target.value ? Number(e.target.value) : null)}>
      <option value="">– eigener U-Wert –</option>
      {kategorien.map((k) => (
        <optgroup key={k} label={k}>
          {bibliothek
            .filter((b) => b.kategorie === k)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.bezeichnung}
                {b.baualtersklasse ? ` (${b.baualtersklasse})` : ''} – U {String(b.u_wert).replace('.', ',')}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
