// Deutlich sichtbarer Verbindungs- und Synchronisierungsstatus im Kopf, mit Details zum Aufklappen.
import { useState } from 'react';
import { offline, useOffline } from '../offline/daten';
import { zeitpunkt } from '../texte';

export function Verbindung() {
  const z = useOffline();
  const [offen, setOffen] = useState(false);

  let art: 'online' | 'offline' | 'ausstehend' | 'problem';
  let text: string;
  if (z.problem || z.anmeldungNoetig) {
    art = 'problem';
    text = z.anmeldungNoetig ? 'Anmeldung nötig' : 'Übertragung angehalten';
  } else if (!z.online) {
    art = 'offline';
    text = z.ausstehend > 0 ? `Offline · ${z.ausstehend} ausstehend` : 'Offline';
  } else if (z.ausstehend > 0) {
    art = 'ausstehend';
    text = `${z.ausstehend} ${z.ausstehend === 1 ? 'Änderung' : 'Änderungen'} ausstehend`;
  } else {
    art = 'online';
    text = 'Online';
  }

  return (
    <span className="verbindung-rahmen">
      <button className={`verbindung verbindung-${art}`} onClick={() => setOffen(!offen)} aria-expanded={offen}>
        <span className="punkt" aria-hidden="true" />
        {text}
        {z.laeuft && ' …'}
      </button>
      {offen && (
        <div className="verbindung-details" role="dialog" aria-label="Verbindung und Synchronisierung">
          <p>
            <strong>{z.online ? 'Server erreichbar' : 'Keine Verbindung zum Server'}</strong>
            <br />
            {z.ausstehend === 0 ? 'Alle Änderungen sind übertragen.' : `${z.ausstehend} Änderung(en) warten auf Übertragung.`}
          </p>
          {z.anmeldungNoetig && <p className="meldung warnung">Die Anmeldung ist abgelaufen. Bitte neu anmelden – die Änderungen auf diesem Gerät bleiben erhalten.</p>}
          {z.problem && (
            <div className="meldung fehler">
              <p>
                Übertragung angehalten bei: <strong>{z.problem.eintrag.beschreibung}</strong> ({zeitpunkt(z.problem.eintrag.zeit)})
                <br />
                {z.problem.meldung}
              </p>
              <div className="knopfreihe">
                <button className="knopf klein" onClick={() => void offline.erneutVersuchen()}>
                  Erneut versuchen
                </button>
                <button
                  className="knopf-gefahr klein"
                  onClick={() =>
                    window.confirm('Diese eine Änderung verwerfen? Sie geht verloren; die übrigen werden weiter übertragen.') &&
                    void offline.eintragVerwerfen(z.problem!.eintrag.nr!)
                  }
                >
                  Änderung verwerfen
                </button>
              </div>
            </div>
          )}
          <p className="leise">
            Offline auf diesem Gerät: {z.projekte.length} Projekt(e)
            <br />
            Fachvorgaben-Stand: {z.vorgabenStand ? zeitpunkt(z.vorgabenStand) : 'noch nicht gespeichert'}
            <br />
            Zuletzt übertragen: {zeitpunkt(z.letzteSynchronisierung)}
          </p>
          {z.online && z.ausstehend > 0 && !z.problem && (
            <button className="knopf klein" onClick={() => void offline.synchronisieren()}>
              Jetzt übertragen
            </button>
          )}
        </div>
      )}
    </span>
  );
}
