import { useEffect, useState, type FormEvent } from 'react';
import { api, type Gebaeudestandard, type Projekt, type ProjektDetail } from '../api';
import { gehe } from '../navigation';
import { useOffline } from '../offline/daten';
import { GEBAEUDESTANDARDS, HINWEIS_SONSTIGER_BESTAND, PAUSCHALE_DURCH_FACHPRUEFER, statusAnzeige, zeitpunkt } from '../texte';
import { GebaeudestandardHilfe, Meldung, Schalter } from './Felder';

export function Projektliste() {
  const [projekte, setProjekte] = useState<Projekt[] | null>(null);
  const [fehler, setFehler] = useState('');
  const [neuOffen, setNeuOffen] = useState(false);
  const { online, projekte: lokal } = useOffline();

  useEffect(() => {
    api
      .get<Projekt[]>('/projekte')
      .then(setProjekte)
      .catch((e) => setFehler(e.message));
  }, [lokal.length, online]);

  return (
    <section>
      <div className="zeile">
        <h1>Projekte</h1>
        <button className="knopf" onClick={() => setNeuOffen(!neuOffen)}>
          {neuOffen ? 'Abbrechen' : '+ Neues Projekt'}
        </button>
      </div>
      {!online && (
        <Meldung art="hinweis">
          Keine Verbindung: Die Liste zeigt den zuletzt geladenen Stand. Bearbeiten lassen sich nur Projekte, die auf diesem Gerät
          ausgecheckt sind; neue Projekte werden auf dem Gerät angelegt und später übertragen.
        </Meldung>
      )}
      {neuOffen && <NeuesProjekt />}
      {fehler && <Meldung>{fehler}</Meldung>}
      {projekte === null && !fehler && <p>Wird geladen …</p>}
      {projekte?.length === 0 && <p className="leise">Noch keine Projekte angelegt.</p>}
      {projekte && projekte.length > 0 && (
        <div className="tabelle-rahmen">
          <table className="tabelle klickbar">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Bezeichnung</th>
                <th>Kunde</th>
                <th>Zuständig</th>
                <th>Status</th>
                <th>Geändert</th>
              </tr>
            </thead>
            <tbody>
              {projekte.map((p) => (
                <tr key={p.id} onClick={() => gehe(`/projekt/${p.id}`)}>
                  <td>{p.nummer}</td>
                  <td>
                    <a href={`#/projekt/${p.id}`}>{p.bezeichnung}</a>
                  </td>
                  <td>{p.kunde_name}</td>
                  <td>{p.zugewiesen_an_name ?? p.ersteller_name ?? '–'}</td>
                  <td>
                    <span className={`status ${statusAnzeige(p).klasse}`}>{statusAnzeige(p).text}</span>
                    {lokal.includes(p.id) ? (
                      <span className="sperre eigen">auf diesem Gerät</span>
                    ) : (
                      p.ausgecheckt_am && (
                        <span className="sperre" title={`seit ${zeitpunkt(p.ausgecheckt_am)}`}>
                          gesperrt: {p.ausgecheckt_von_name}, {p.ausgecheckt_geraet}
                        </span>
                      )
                    )}
                  </td>
                  <td>{zeitpunkt(p.geaendert_am)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function NeuesProjekt() {
  const [bezeichnung, setBezeichnung] = useState('');
  const [kunde, setKunde] = useState('');
  const [ort, setOrt] = useState('');
  const [standard, setStandard] = useState<Gebaeudestandard | ''>('');
  const [fehler, setFehler] = useState('');

  async function absenden(e: FormEvent) {
    e.preventDefault();
    if (!standard) return setFehler('Bitte den Gebäudestandard wählen.');
    setFehler('');
    try {
      const p = await api.post<ProjektDetail>('/projekte', {
        bezeichnung, kunde_name: kunde, ort, gebaeudestandard: standard,
      });
      gehe(`/projekt/${p.id}`);
    } catch (err) {
      setFehler((err as Error).message);
    }
  }

  return (
    <form className="karte formular" onSubmit={absenden}>
      <p className="leise ganze-breite">Die Projektnummer wird automatisch vergeben (fortlaufend, z. B. 2026-0004).</p>
      <label>
        Bezeichnung
        <input value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} required maxLength={300} />
      </label>
      <label>
        Kunde
        <input value={kunde} onChange={(e) => setKunde(e.target.value)} maxLength={300} />
      </label>
      <label>
        Ort
        <input value={ort} onChange={(e) => setOrt(e.target.value)} maxLength={200} />
      </label>
      <div className="ganze-breite">
        <span className="feldname">
          Gebäudestandard (Pflicht)
          <GebaeudestandardHilfe />
        </span>
        <Schalter wert={standard as Gebaeudestandard} optionen={GEBAEUDESTANDARDS} onWahl={setStandard} />
        {standard === 'sonstiger_bestand' && (
          <Meldung art="warnung">
            {HINWEIS_SONSTIGER_BESTAND} {PAUSCHALE_DURCH_FACHPRUEFER}; bis dahin ist das Projekt für Angebote gesperrt.
          </Meldung>
        )}
      </div>
      {fehler && <Meldung>{fehler}</Meldung>}
      <button className="knopf" type="submit">
        Anlegen und erfassen
      </button>
    </form>
  );
}
