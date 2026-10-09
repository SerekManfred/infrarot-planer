import { useEffect, useState, type FormEvent } from 'react';
import { api, type Projekt } from '../api';

const datum = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

export function Projektliste() {
  const [projekte, setProjekte] = useState<Projekt[] | null>(null);
  const [fehler, setFehler] = useState('');
  const [neuOffen, setNeuOffen] = useState(false);

  function laden() {
    api
      .projekte()
      .then(setProjekte)
      .catch((e) => setFehler(e.message));
  }

  useEffect(laden, []);

  return (
    <section>
      <div className="zeile">
        <h1>Projekte</h1>
        <button className="knopf" onClick={() => setNeuOffen(!neuOffen)}>
          {neuOffen ? 'Abbrechen' : 'Neues Projekt'}
        </button>
      </div>
      {neuOffen && (
        <NeuesProjekt
          onAngelegt={() => {
            setNeuOffen(false);
            laden();
          }}
        />
      )}
      {fehler && <p className="fehler">{fehler}</p>}
      {projekte === null && !fehler && <p>Wird geladen …</p>}
      {projekte?.length === 0 && <p className="hinweis">Noch keine Projekte angelegt.</p>}
      {projekte && projekte.length > 0 && (
        <table className="tabelle">
          <thead>
            <tr>
              <th>Nr.</th>
              <th>Bezeichnung</th>
              <th>Kunde</th>
              <th>Geändert</th>
            </tr>
          </thead>
          <tbody>
            {projekte.map((p) => (
              <tr key={p.id}>
                <td>{p.nummer}</td>
                <td>{p.bezeichnung}</td>
                <td>{p.kunde_name}</td>
                <td>{datum.format(new Date(p.geaendert_am))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function NeuesProjekt({ onAngelegt }: { onAngelegt: () => void }) {
  const [nummer, setNummer] = useState('');
  const [bezeichnung, setBezeichnung] = useState('');
  const [kunde, setKunde] = useState('');
  const [fehler, setFehler] = useState('');

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setFehler('');
    try {
      await api.projektAnlegen({ nummer, bezeichnung, kunde_name: kunde });
      onAngelegt();
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
      {fehler && <p className="fehler">{fehler}</p>}
      <button className="knopf" type="submit">
        Anlegen
      </button>
    </form>
  );
}
