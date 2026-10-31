// Eigenes Konto: Passwort ändern
import { useState, type FormEvent } from 'react';
import { api, type Benutzer } from '../api';
import { rollenText } from '../texte';
import { Meldung, PasswortFeld } from './Felder';

export function Konto({ benutzer }: { benutzer: Benutzer }) {
  const [alt, setAlt] = useState('');
  const [neu, setNeu] = useState('');
  const [wiederholung, setWiederholung] = useState('');
  const [fehler, setFehler] = useState('');
  const [erfolg, setErfolg] = useState(false);

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setFehler('');
    setErfolg(false);
    if (neu !== wiederholung) return setFehler('Die neuen Passwörter stimmen nicht überein.');
    try {
      await api.post('/auth/passwort', { altes_passwort: alt, neues_passwort: neu });
      setErfolg(true);
      setAlt('');
      setNeu('');
      setWiederholung('');
    } catch (err) {
      setFehler((err as Error).message);
    }
  }

  return (
    <section>
      <h1>Konto</h1>
      <p>
        {benutzer.name} · {benutzer.email} · {rollenText(benutzer.rollen)}
      </p>
      <form className="karte anmeldung" onSubmit={absenden}>
        <h2>Passwort ändern</h2>
        <label>
          Bisheriges Passwort
          <PasswortFeld wert={alt} onAendern={setAlt} autoComplete="current-password" />
        </label>
        <label>
          Neues Passwort (mind. 12 Zeichen)
          <PasswortFeld wert={neu} onAendern={setNeu} autoComplete="new-password" minLength={12} />
        </label>
        <label>
          Neues Passwort wiederholen
          <PasswortFeld wert={wiederholung} onAendern={setWiederholung} autoComplete="new-password" minLength={12} />
        </label>
        {fehler && <Meldung>{fehler}</Meldung>}
        {erfolg && <Meldung art="hinweis">Passwort geändert. Andere angemeldete Geräte wurden abgemeldet.</Meldung>}
        <button className="knopf" type="submit">
          Passwort ändern
        </button>
      </form>
    </section>
  );
}
