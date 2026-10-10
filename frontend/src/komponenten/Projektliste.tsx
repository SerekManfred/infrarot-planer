import { useEffect, useState, type FormEvent } from 'react';
import { api, type Gebaeudestandard, type Projekt, type ProjektDetail } from '../api';
import { gehe } from '../navigation';
import { GEBAEUDESTANDARDS, HINWEIS_SONSTIGER_BESTAND, STATUS, zeitpunkt } from '../texte';
import { Meldung, Schalter } from './Felder';

export function Projektliste() {
  const [projekte, setProjekte] = useState<Projekt[] | null>(null);
  const [fehler, setFehler] = useState('');
  const [neuOffen, setNeuOffen] = useState(false);

  useEffect(() => {
    api
      .get<Projekt[]>('/projekte')
      .then(setProjekte)
      .catch((e) => setFehler(e.message));
  }, []);

  return (
    <section>
      <div className="zeile">
        <h1>Projekte</h1>
        <button className="knopf" onClick={() => setNeuOffen(!neuOffen)}>
          {neuOffen ? 'Abbrechen' : '+ Neues Projekt'}
        </button>
      </div>
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
                  <td>
                    <span className={`status status-${p.status}`}>{STATUS[p.status]}</span>
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
  const [nummer, setNummer] = useState('');
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
        nummer, bezeichnung, kunde_name: kunde, ort, gebaeudestandard: standard,
      });
      gehe(`/projekt/${p.id}`);
    } catch (err) {
      setFehler((err as Error).message);
    }
  }

  return (
    <form className="karte formular" onSubmit={absenden}>
      <label>
        Projektnummer
        <input value={nummer} onChange={(e) => setNummer(e.target.value)} required maxLength={50} />
      </label>
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
        <span className="feldname">Gebäudestandard (Pflicht)</span>
        <Schalter wert={standard as Gebaeudestandard} optionen={GEBAEUDESTANDARDS} onWahl={setStandard} />
        {standard === 'sonstiger_bestand' && <Meldung art="warnung">{HINWEIS_SONSTIGER_BESTAND}</Meldung>}
      </div>
      {fehler && <Meldung>{fehler}</Meldung>}
      <button className="knopf" type="submit">
        Anlegen und erfassen
      </button>
    </form>
  );
}
