import { useEffect, useState } from 'react';
import { RECHENKERN_VERSION } from '@infrarot/rechenkern';
import { api, ApiFehler, fachansicht, hatRolle, type Benutzer } from './api';
import { AbgleichSeite } from './komponenten/Abgleich';
import { Aktualisierung } from './komponenten/Aktualisierung';
import { Anmeldung } from './komponenten/Anmeldung';
import { BenutzerVerwaltung } from './komponenten/Benutzer';
import { FachvorgabenSeite } from './komponenten/Fachvorgaben';
import { Konto } from './komponenten/Konto';
import { ProjektSeite } from './komponenten/Projekt';
import { Projektliste } from './komponenten/Projektliste';
import { Verbindung } from './komponenten/Verbindung';
import { gehe, useAdresse } from './navigation';
import { offline, useOffline } from './offline/daten';
import { rollenText } from './texte';

export function App() {
  // undefined = wird noch geprüft, null = nicht angemeldet
  const [benutzer, setBenutzer] = useState<Benutzer | null | undefined>(undefined);
  const [fehler, setFehler] = useState('');
  const adresse = useAdresse();

  const { anmeldungNoetig } = useOffline();
  const [abmeldung, setAbmeldung] = useState(false);

  useEffect(() => {
    api
      .get<Benutzer>('/auth/ich')
      .then((b) => {
        setBenutzer(b);
        // Fachvorgaben-Schnappschuss für das Rechnen ohne Netz auffrischen (ohne Netz bleibt der alte)
        offline.vorgabenAktualisieren().catch(() => undefined);
        offline.synchronisierenBald(0);
      })
      .catch((e) => {
        setBenutzer(null);
        if (!(e instanceof ApiFehler && e.status === 401)) setFehler(e.message);
      });
  }, []);

  async function angemeldet(b: Benutzer) {
    // Offline-Daten eines anderen Benutzers nicht unter neuem Namen übertragen
    const vorher = await offline.lokalerBenutzer();
    if (vorher && vorher.id !== b.id && offline.hatLokaleDaten()) {
      const loeschen = window.confirm(
        `Auf diesem Gerät liegen noch Offline-Daten von ${vorher.name} (${offline.zustand.ausstehend} Änderungen nicht übertragen). ` +
          'Diese Daten löschen und fortfahren?\n\nAbbrechen meldet wieder ab; dann kann sich ' + vorher.name + ' anmelden und übertragen.',
      );
      if (!loeschen) {
        await api.post('/auth/abmelden').catch(() => undefined);
        return;
      }
      await offline.allesLoeschen();
    }
    setBenutzer(b);
    await offline.angemeldet(b);
    offline.vorgabenAktualisieren().catch(() => undefined);
  }

  async function abmelden() {
    setAbmeldung(true);
    try {
      // Online: alles übertragen und die Projekte einchecken; was übrig bleibt, ginge verloren
      const rest = await offline.abmeldenVorbereiten();
      if (rest.ausstehend > 0 || rest.projekte.length > 0) {
        const teile = [
          rest.ausstehend > 0 && `${rest.ausstehend} Änderung(en) sind noch nicht übertragen und gehen verloren.`,
          rest.projekte.length > 0 &&
            `Diese Projekte bleiben auf dem Server gesperrt, bis ein Admin die Sperre löst: ${rest.projekte.join(', ')}.`,
        ].filter(Boolean);
        if (!window.confirm(`${teile.join('\n\n')}\n\nTrotzdem abmelden und die Offline-Daten auf diesem Gerät löschen?`)) return;
      }
      await api.post('/auth/abmelden').catch(() => undefined);
      await offline.allesLoeschen();
      setBenutzer(null);
      gehe('/');
    } finally {
      setAbmeldung(false);
    }
  }

  const [seite, id] = adresse;
  const menue: [string, string, boolean][] = benutzer
    ? [
        ['', 'Projekte', true],
        // Fachvorgaben (Raumtypen und Pauschalen) nur für Fachprüfer und Admins, nicht für den Außendienst
        ['fachvorgaben', 'Fachvorgaben', fachansicht(benutzer)],
        // Sammelansicht: Entscheidungen über neue Fachvorgaben, nur Fachprüfer
        ['abgleich', 'Vorgaben-Abgleich', hatRolle(benutzer, 'fachpruefer')],
        ['benutzer', 'Benutzer', hatRolle(benutzer, 'admin')],
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
            <Verbindung />
            <span>
              {benutzer.name} <small>({rollenText(benutzer.rollen)})</small>
            </span>
            <button className="knopf-leise" onClick={abmelden} disabled={abmeldung}>
              {abmeldung ? 'Abmelden …' : 'Abmelden'}
            </button>
          </span>
        )}
      </header>
      <Aktualisierung />
      <main className="inhalt">
        {fehler && <p className="meldung fehler">{fehler}</p>}
        {benutzer === undefined && <p>Wird geladen …</p>}
        {benutzer === null && <Anmeldung onAngemeldet={angemeldet} />}
        {benutzer && anmeldungNoetig && (
          <>
            <p className="meldung warnung">Die Anmeldung ist abgelaufen. Bitte neu anmelden, damit die Änderungen übertragen werden.</p>
            <Anmeldung onAngemeldet={angemeldet} />
          </>
        )}
        {benutzer && seite === 'projekt' && id && <ProjektSeite key={id} projektId={Number(id)} benutzer={benutzer} />}
        {benutzer && seite === 'fachvorgaben' && fachansicht(benutzer) && <FachvorgabenSeite benutzer={benutzer} />}
        {benutzer && seite === 'abgleich' && hatRolle(benutzer, 'fachpruefer') && <AbgleichSeite />}
        {benutzer && seite === 'benutzer' && hatRolle(benutzer, 'admin') && <BenutzerVerwaltung benutzer={benutzer} />}
        {benutzer && seite === 'konto' && <Konto benutzer={benutzer} />}
        {benutzer && !seite && <Projektliste />}
      </main>
      <footer className="fuss">Rechenkern {RECHENKERN_VERSION}</footer>
    </div>
  );
}
