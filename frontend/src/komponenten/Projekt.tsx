// Projektansicht: Kopf mit Status und Gebäudestandard, darunter Räume, Projektvorgaben und Protokoll.
import { useCallback, useEffect, useState } from 'react';
import { api, type Benutzer, type Fachvorgaben, type Gebaeudestandard, type Objekt, type Projektstatus, type ProjektDetail } from '../api';
import { gehe } from '../navigation';
import { offline, useOffline } from '../offline/daten';
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
  // neu zeichnen, wenn sich der Offline-Speicher ändert (auschecken, einchecken)
  const { projekte: lokaleProjekte } = useOffline();
  const lokal = lokaleProjekte.includes(projektId);

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
  // Ein anderes Gerät hat das Projekt ausgecheckt: hier nur lesen
  const fremdAusgecheckt = projekt.ausgecheckt_am !== null && !lokal;
  const gesperrt = projekt.status === 'freigegeben' || fremdAusgecheckt;

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
        {benutzer.rolle === 'fachpruefer' && !lokal && !fremdAusgecheckt && (
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

      <OfflineKarte projekt={projekt} benutzer={benutzer} lokal={lokal} neuLaden={() => aendern(async () => undefined)} />
      {projekt.status === 'freigegeben' && <Meldung art="hinweis">Das Projekt ist freigegeben und gesperrt. Änderungen erst nach Rücksetzung durch einen Fachprüfer.</Meldung>}
      {projekt.status === 'geprueft' && (
        <Meldung art="hinweis">Fachlich geprüft. Jede Änderung setzt das Projekt zurück auf „Vor-Ort-Entwurf“.</Meldung>
      )}
      {fehler && <Meldung>{fehler}</Meldung>}

      <div className="karte kopfdaten">
        <label>
          Projektnummer
          <Textfeld
            wert={projekt.nummer}
            pflicht
            gesperrt={gesperrt}
            onSpeichern={(v) => aendern(() => api.patch(`/projekte/${projektId}`, { nummer: v }))}
          />
        </label>
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

/** Offline-Bearbeitung: auschecken, einchecken, Sperre anzeigen und (Admin) lösen */
function OfflineKarte({
  projekt,
  benutzer,
  lokal,
  neuLaden,
}: {
  projekt: ProjektDetail;
  benutzer: Benutzer;
  lokal: boolean;
  neuLaden: () => Promise<void>;
}) {
  const { online } = useOffline();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');

  async function ausfuehren(aktion: () => Promise<unknown>) {
    setFehler('');
    setLaeuft(true);
    try {
      await aktion();
      await neuLaden();
    } catch (e) {
      setFehler((e as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  async function auschecken() {
    let geraet = await offline.geraet();
    if (!geraet) {
      geraet = window.prompt('Name dieses Geräts (wird anderen bei der Sperre angezeigt):', `Tablet ${benutzer.name}`)?.trim();
      if (!geraet) return;
      await offline.geraetSetzen(geraet.slice(0, 100));
    }
    await ausfuehren(() => offline.auschecken(projekt.id, geraet!));
  }

  async function einchecken() {
    await ausfuehren(async () => {
      const echteId = await offline.einchecken(projekt.id);
      // offline angelegte Projekte haben jetzt ihre Server-ID
      if (echteId !== projekt.id) gehe(`/projekt/${echteId}`);
    });
  }

  if (lokal) {
    return (
      <div className="karte offline-karte lokal">
        <div>
          <strong>Auf diesem Gerät zur Offline-Bearbeitung ausgecheckt</strong>
          {projekt.ausgecheckt_am && <small className="leise"> seit {zeitpunkt(projekt.ausgecheckt_am)}</small>}
          <br />
          <small>Für alle anderen gesperrt. Änderungen werden gespeichert und automatisch übertragen, sobald eine Verbindung besteht.</small>
        </div>
        <button className="knopf-zweit" disabled={laeuft || !online} onClick={einchecken} title={online ? '' : 'Einchecken braucht eine Verbindung'}>
          {laeuft ? 'Wird eingecheckt …' : 'Einchecken'}
        </button>
        {fehler && <Meldung>{fehler}</Meldung>}
      </div>
    );
  }
  if (projekt.ausgecheckt_am) {
    return (
      <div className="karte offline-karte fremd">
        <div>
          <strong>Gesperrt: zur Offline-Bearbeitung ausgecheckt</strong>
          <br />
          von {projekt.ausgecheckt_von_name} auf Gerät „{projekt.ausgecheckt_geraet}“ seit {zeitpunkt(projekt.ausgecheckt_am)}.
          Änderungen sind erst nach dem Einchecken möglich.
        </div>
        {benutzer.rolle === 'admin' && (
          <button
            className="knopf-gefahr"
            disabled={laeuft}
            onClick={() =>
              window.confirm(
                'Sperre lösen? Änderungen, die auf dem Gerät noch nicht übertragen sind, werden danach nicht mehr angenommen.',
              ) && void ausfuehren(() => api.post(`/projekte/${projekt.id}/einchecken`))
            }
          >
            Sperre lösen
          </button>
        )}
        {fehler && <Meldung>{fehler}</Meldung>}
      </div>
    );
  }
  if (projekt.status === 'freigegeben') return null;
  return (
    <div className="karte offline-karte">
      <span>Ohne Netz weiterarbeiten? Projekt auf dieses Gerät holen und für andere sperren.</span>
      <button className="knopf-zweit" disabled={laeuft || !online} onClick={auschecken}>
        {laeuft ? 'Wird ausgecheckt …' : 'Für Offline-Bearbeitung auschecken'}
      </button>
      {fehler && <Meldung>{fehler}</Meldung>}
    </div>
  );
}
