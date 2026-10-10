// Benutzerverwaltung (nur Admin)
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Benutzer, type Rolle } from '../api';
import { ROLLEN } from '../texte';
import { Meldung, Textfeld } from './Felder';

export function BenutzerVerwaltung({ benutzer: ich }: { benutzer: Benutzer }) {
  const [liste, setListe] = useState<Benutzer[] | null>(null);
  const [fehler, setFehler] = useState('');
  const [hinweis, setHinweis] = useState('');

  const laden = useCallback(() => {
    api.get<Benutzer[]>('/benutzer').then(setListe).catch((e) => setFehler(e.message));
  }, []);
  useEffect(laden, [laden]);

  async function aendern(aktion: () => Promise<unknown>, erfolg = '') {
    setFehler('');
    setHinweis('');
    try {
      await aktion();
      setHinweis(erfolg);
    } catch (e) {
      setFehler((e as Error).message);
    }
    laden();
  }

  function passwortSetzen(b: Benutzer) {
    const neu = window.prompt(`Neues Passwort für ${b.name} (mind. 12 Zeichen):`);
    if (neu) void aendern(() => api.post(`/benutzer/${b.id}/passwort`, { neues_passwort: neu }), `Passwort für ${b.name} gesetzt.`);
  }

  return (
    <section>
      <h1>Benutzer</h1>
      {fehler && <Meldung>{fehler}</Meldung>}
      {hinweis && <Meldung art="hinweis">{hinweis}</Meldung>}
      {liste && (
        <div className="tabelle-rahmen">
          <table className="tabelle">
            <thead>
              <tr>
                <th>Name</th>
                <th>E-Mail</th>
                <th>Rolle</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {liste.map((b) => (
                <tr key={b.id} className={b.aktiv ? '' : 'inaktiv'}>
                  <td>
                    <Textfeld wert={b.name} pflicht onSpeichern={(name) => aendern(() => api.patch(`/benutzer/${b.id}`, { name }))} />
                  </td>
                  <td>{b.email}</td>
                  <td>
                    <select
                      value={b.rolle}
                      disabled={b.id === ich.id}
                      onChange={(e) => aendern(() => api.patch(`/benutzer/${b.id}`, { rolle: e.target.value }))}
                    >
                      {(Object.keys(ROLLEN) as Rolle[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLLEN[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      className="knopf-leise klein"
                      disabled={b.id === ich.id}
                      onClick={() => aendern(() => api.patch(`/benutzer/${b.id}`, { aktiv: !b.aktiv }))}
                    >
                      {b.aktiv ? 'aktiv – deaktivieren' : 'inaktiv – aktivieren'}
                    </button>
                  </td>
                  <td>
                    <button className="knopf-leise klein" onClick={() => passwortSetzen(b)}>
                      Passwort setzen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NeuerBenutzer onAngelegt={(name) => aendern(async () => undefined, `${name} angelegt.`)} />
    </section>
  );
}

function NeuerBenutzer({ onAngelegt }: { onAngelegt: (name: string) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [passwort, setPasswort] = useState('');
  const [rolle, setRolle] = useState<Rolle>('aussendienst');
  const [fehler, setFehler] = useState('');

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setFehler('');
    try {
      await api.post('/benutzer', { email, name, passwort, rolle });
      onAngelegt(name);
      setEmail('');
      setName('');
      setPasswort('');
    } catch (err) {
      setFehler((err as Error).message);
    }
  }

  return (
    <form className="karte formular" onSubmit={absenden}>
      <h2 className="ganze-breite">Neuer Benutzer</h2>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        E-Mail
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Erstes Passwort (mind. 12 Zeichen)
        <input type="password" autoComplete="new-password" minLength={12} value={passwort} onChange={(e) => setPasswort(e.target.value)} required />
      </label>
      <label>
        Rolle
        <select value={rolle} onChange={(e) => setRolle(e.target.value as Rolle)}>
          {(Object.keys(ROLLEN) as Rolle[]).map((r) => (
            <option key={r} value={r}>
              {ROLLEN[r]}
            </option>
          ))}
        </select>
      </label>
      {fehler && <Meldung>{fehler}</Meldung>}
      <button className="knopf" type="submit">
        Anlegen
      </button>
    </form>
  );
}
