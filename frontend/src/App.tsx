import { useEffect, useState } from 'react';
import { RECHENKERN_VERSION } from '@infrarot/rechenkern';
import { api, ApiFehler, type Benutzer } from './api';
import { Anmeldung } from './komponenten/Anmeldung';
import { Projektliste } from './komponenten/Projektliste';

export function App() {
  // undefined = wird noch geprüft, null = nicht angemeldet
  const [benutzer, setBenutzer] = useState<Benutzer | null | undefined>(undefined);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    api
      .ich()
      .then(setBenutzer)
      .catch((e) => {
        setBenutzer(null);
        if (!(e instanceof ApiFehler && e.status === 401)) setFehler(e.message);
      });
  }, []);

  async function abmelden() {
    await api.abmelden().catch(() => undefined);
    setBenutzer(null);
  }

  return (
    <div className="seite">
      <header className="kopf">
        <span className="marke">Infrarot-Planer</span>
        {benutzer && (
          <span className="kopf-rechts">
            {benutzer.name} ({benutzer.rolle === 'admin' ? 'Admin' : 'Berater'})
            <button className="knopf-leise" onClick={abmelden}>
              Abmelden
            </button>
          </span>
        )}
      </header>
      <main className="inhalt">
        {fehler && <p className="fehler">{fehler}</p>}
        {benutzer === undefined && <p>Wird geladen …</p>}
        {benutzer === null && <Anmeldung onAngemeldet={setBenutzer} />}
        {benutzer && <Projektliste />}
      </main>
      <footer className="fuss">Rechenkern {RECHENKERN_VERSION}</footer>
    </div>
  );
}
