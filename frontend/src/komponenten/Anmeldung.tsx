import { useState, type FormEvent } from 'react';
import { api, type Benutzer } from '../api';
import { PasswortFeld } from './Felder';

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
      onAngemeldet(await api.post<Benutzer>('/auth/anmelden', { email, passwort }));
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
        <PasswortFeld wert={passwort} onAendern={setPasswort} autoComplete="current-password" />
      </label>
      {fehler && <p className="meldung fehler">{fehler}</p>}
      <button className="knopf" type="submit" disabled={laeuft}>
        {laeuft ? 'Anmelden …' : 'Anmelden'}
      </button>
    </form>
  );
}
