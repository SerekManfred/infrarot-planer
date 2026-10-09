import { useState, type FormEvent } from 'react';
import { api, type Benutzer } from '../api';

export function Anmeldung({ onAngemeldet }: { onAngemeldet: (b: Benutzer) => void }) {
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setFehler('');
    setLaeuft(true);
    try {
      onAngemeldet(await api.anmelden(email, passwort));
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <form className="karte anmeldung" onSubmit={absenden}>
      <h1>Anmelden</h1>
      <label>
        E-Mail
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Passwort
        <input
          type="password"
          autoComplete="current-password"
          value={passwort}
          onChange={(e) => setPasswort(e.target.value)}
          required
        />
      </label>
      {fehler && <p className="fehler">{fehler}</p>}
      <button className="knopf" type="submit" disabled={laeuft}>
        {laeuft ? 'Anmelden …' : 'Anmelden'}
      </button>
    </form>
  );
}
