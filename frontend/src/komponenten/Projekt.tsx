// Projektansicht: Kopf mit Status und Gebäudestandard, darunter Räume, Projektvorgaben und Protokoll.
import { useCallback, useEffect, useState } from 'react';
import { api, type Benutzer, type Fachvorgaben, type Gebaeudestandard, type Objekt, type Projektstatus, type ProjektDetail } from '../api';
import { GEBAEUDESTANDARDS, HINWEIS_SONSTIGER_BESTAND, STATUS, zeitpunkt } from '../texte';
import { Meldung, Schalter, Textfeld } from './Felder';
import { Projektvorgaben } from './Projektvorgaben';
import { Protokoll } from './Protokoll';
import { Raeume } from './Raeume';

type Reiter = 'raeume' | 'vorgaben' | 'protokoll';
const REITER: Record<Reiter, string> = { raeume: 'Räume', vorgaben: 'Projektvorgaben', protokoll: 'Protokoll' };

export function ProjektSeite({ projektId, benutzer }: { projektId: number; benutzer: Benutzer }) {
  const [projekt, setProjekt] = useState<ProjektDetail | null>(null);
  const [vorgaben, setVorgaben] = useState<Fachvorgaben | null>(null);
  const [reiter, setReiter] = useState<Reiter>('raeume');
  const [fehler, setFehler] = useState('');
  // Zähler, damit Unteransichten nach Änderungen neu laden (z. B. Status, Auswertung)
  const [stand, setStand] = useState(0);

  const laden = useCallback(async () => {
    try {
      const [p, v] = await Promise.all([
        api.get<ProjektDetail>(`/projekte/${projektId}`),
        api.get<Fachvorgaben>('/fachvorgaben'),
      ]);
      setProjekt(p);
      setVorgaben(v);
    } catch (e) {
      setFehler((e as Error).message);
    }
  }, [projektId]);

  useEffect(() => void laden(), [laden]);

  /** Für alle Änderungen: Fehler anzeigen, danach Projekt (Status!) neu laden */
  const aendern = useCallback(
    async (aktion: () => Promise<unknown>) => {
      setFehler('');
      try {
        await aktion();
      } catch (e) {
        setFehler((e as Error).message);
      }
      await laden();
      setStand((s) => s + 1);
    },
    [laden],
  );

  if (!projekt || !vorgaben) return fehler ? <Meldung>{fehler}</Meldung> : <p>Wird geladen …</p>;
  const objekt: Objekt = projekt.objekte[0];
  const gesperrt = projekt.status === 'freigegeben';

  function status(neu: Projektstatus) {
    void aendern(() => api.post(`/projekte/${projektId}/status`, { status: neu }));
  }

  return (
    <section>
      <div className="projektkopf">
        <div>
          <a href="#/" className="zurueck">
            ← Projekte
          </a>
          <h1>
            {projekt.nummer} · {projekt.bezeichnung}
          </h1>
          <span className={`status status-${projekt.status}`}>{STATUS[projekt.status]}</span>
          {projekt.status === 'geprueft' && <small className="leise"> am {zeitpunkt(projekt.geprueft_am)}</small>}
          {projekt.status === 'freigegeben' && <small className="leise"> am {zeitpunkt(projekt.freigegeben_am)}</small>}
        </div>
        {benutzer.rolle === 'fachpruefer' && (
          <div className="knopfreihe">
            {projekt.status === 'entwurf' && (
              <button className="knopf" onClick={() => status('geprueft')}>
                Als fachlich geprüft markieren
              </button>
            )}
            {projekt.status === 'geprueft' && (
              <button className="knopf" onClick={() => status('freigegeben')}>
                Freigeben
              </button>
            )}
            {projekt.status !== 'entwurf' && (
              <button className="knopf-zweit" onClick={() => status('entwurf')}>
                Zurück auf Entwurf
              </button>
            )}
          </div>
        )}
      </div>

      {gesperrt && <Meldung art="hinweis">Das Projekt ist freigegeben und gesperrt. Änderungen erst nach Rücksetzung durch einen Fachprüfer.</Meldung>}
      {projekt.status === 'geprueft' && (
        <Meldung art="hinweis">Fachlich geprüft. Jede Änderung setzt das Projekt zurück auf „Vor-Ort-Entwurf“.</Meldung>
      )}
      {fehler && <Meldung>{fehler}</Meldung>}

      <div className="karte kopfdaten">
        <label>
          Kunde
          <Textfeld
            wert={projekt.kunde_name}
            gesperrt={gesperrt}
            onSpeichern={(v) => aendern(() => api.patch(`/projekte/${projektId}`, { kunde_name: v }))}
          />
        </label>
        <div>
          <span className="feldname">Gebäudestandard</span>
          <Schalter
            wert={objekt.gebaeudestandard}
            optionen={GEBAEUDESTANDARDS}
            gesperrt={gesperrt}
            onWahl={(v: Gebaeudestandard) => aendern(() => api.patch(`/objekte/${objekt.id}`, { gebaeudestandard: v }))}
          />
        </div>
      </div>
      {objekt.gebaeudestandard === 'sonstiger_bestand' && <Meldung art="warnung">{HINWEIS_SONSTIGER_BESTAND}</Meldung>}

      <div className="reiter" role="tablist">
        {(Object.keys(REITER) as Reiter[]).map((r) => (
          <button key={r} role="tab" aria-selected={r === reiter} className={r === reiter ? 'aktiv' : ''} onClick={() => setReiter(r)}>
            {REITER[r]}
          </button>
        ))}
      </div>

      {reiter === 'raeume' && <Raeume objekt={objekt} vorgaben={vorgaben} gesperrt={gesperrt} aendern={aendern} stand={stand} />}
      {reiter === 'vorgaben' && <Projektvorgaben objekt={objekt} vorgaben={vorgaben} gesperrt={gesperrt} aendern={aendern} stand={stand} />}
      {reiter === 'protokoll' && <Protokoll pfad={`/projekte/${projektId}/protokoll`} stand={stand} />}
    </section>
  );
}
