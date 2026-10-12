// Benutzerverwaltung (nur Admin). Rollen sind kombinierbar, z. B. Admin + Fachprüfer.
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
                <th>Rollen</th>
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
                    <RollenWahl
                      rollen={b.rollen}
                      // das eigene Konto kann die Admin-Rolle nicht abgeben
                      fest={b.id === ich.id ? ['admin'] : []}
                      onWahl={(rollen) => aendern(() => api.patch(`/benutzer/${b.id}`, { rollen }))}
                    />
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
  const [rollen, setRollen] = useState<Rolle[]>(['aussendienst']);
  const [fehler, setFehler] = useState('');

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setFehler('');
    try {
      await api.post('/benutzer', { email, name, passwort, rollen });
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
      <div>
        <span className="feldname">Rollen</span>
        <RollenWahl rollen={rollen} onWahl={setRollen} />
      </div>
      {fehler && <Meldung>{fehler}</Meldung>}
      <button className="knopf" type="submit">
        Anlegen
      </button>
    </form>
  );
}

/** Rollen als Umschaltknöpfe (mehrere möglich, mindestens eine) */
function RollenWahl({ rollen, fest = [], onWahl }: { rollen: Rolle[]; fest?: Rolle[]; onWahl: (rollen: Rolle[]) => void }) {
  function umschalten(r: Rolle) {
    const neu = rollen.includes(r) ? rollen.filter((x) => x !== r) : [...rollen, r];
    if (neu.length > 0) onWahl((Object.keys(ROLLEN) as Rolle[]).filter((x) => neu.includes(x)));
  }
  return (
    <span className="rollenwahl" role="group" aria-label="Rollen">
      {(Object.keys(ROLLEN) as Rolle[]).map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={rollen.includes(r)}
          className={rollen.includes(r) ? 'aktiv' : ''}
          disabled={fest.includes(r) || (rollen.length === 1 && rollen.includes(r))}
          onClick={() => umschalten(r)}
        >
          {ROLLEN[r]}
        </button>
      ))}
    </span>
  );
}
