import { useEffect, useState } from 'react';
import { RECHENKERN_VERSION } from '@infrarot/rechenkern';
import { api, ApiFehler, type Benutzer } from './api';
import { Anmeldung } from './komponenten/Anmeldung';
import { BenutzerVerwaltung } from './komponenten/Benutzer';
import { FachvorgabenSeite } from './komponenten/Fachvorgaben';
import { Konto } from './komponenten/Konto';
import { ProjektSeite } from './komponenten/Projekt';
import { Projektliste } from './komponenten/Projektliste';
import { gehe, useAdresse } from './navigation';
import { ROLLEN } from './texte';

export function App() {
  // undefined = wird noch geprüft, null = nicht angemeldet
  const [benutzer, setBenutzer] = useState<Benutzer | null | undefined>(undefined);
  const [fehler, setFehler] = useState('');
  const adresse = useAdresse();

  useEffect(() => {
    api
      .get<Benutzer>('/auth/ich')
      .then(setBenutzer)
      .catch((e) => {
        setBenutzer(null);
        if (!(e instanceof ApiFehler && e.status === 401)) setFehler(e.message);
      });
  }, []);

  async function abmelden() {
    await api.post('/auth/abmelden').catch(() => undefined);
    setBenutzer(null);
    gehe('/');
  }

  const [seite, id] = adresse;
  const menue: [string, string, boolean][] = benutzer
    ? [
        ['', 'Projekte', true],
        ['fachvorgaben', 'Fachvorgaben', true],
        ['benutzer', 'Benutzer', benutzer.rolle === 'admin'],
        ['konto', 'Konto', true],
      ]
    : [];

  return (
    <div className="seite">
      <header className="kopf">
        <a className="marke" href="#/">
          Infrarot-Planer
        </a>
        {benutzer && (
          <nav className="menue">
            {menue
              .filter(([, , sichtbar]) => sichtbar)
              .map(([pfad, text]) => (
                <a key={pfad} href={`#/${pfad}`} className={(seite ?? '') === pfad || (pfad === '' && seite === 'projekt') ? 'aktiv' : ''}>
                  {text}
                </a>
              ))}
          </nav>
        )}
        {benutzer && (
          <span className="kopf-rechts">
            <span>
              {benutzer.name} <small>({ROLLEN[benutzer.rolle]})</small>
            </span>
            <button className="knopf-leise" onClick={abmelden}>
              Abmelden
            </button>
          </span>
        )}
      </header>
      <main className="inhalt">
        {fehler && <p className="meldung fehler">{fehler}</p>}
        {benutzer === undefined && <p>Wird geladen …</p>}
        {benutzer === null && <Anmeldung onAngemeldet={setBenutzer} />}
        {benutzer && seite === 'projekt' && id && <ProjektSeite key={id} projektId={Number(id)} benutzer={benutzer} />}
        {benutzer && seite === 'fachvorgaben' && <FachvorgabenSeite benutzer={benutzer} />}
        {benutzer && seite === 'benutzer' && benutzer.rolle === 'admin' && <BenutzerVerwaltung benutzer={benutzer} />}
        {benutzer && seite === 'konto' && <Konto benutzer={benutzer} />}
        {benutzer && !seite && <Projektliste />}
      </main>
      <footer className="fuss">Rechenkern {RECHENKERN_VERSION}</footer>
    </div>
  );
}
