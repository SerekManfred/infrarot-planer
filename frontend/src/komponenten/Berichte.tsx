// Berichte eines Projekts (Pakete M3/M4, 02.11.2026): Berichtsfirma wählen und Dokumente erzeugen. Erzeugt wird auf
// dem Server – offline ist das nicht möglich (Hinweis statt Fehler).
import { useEffect, useState } from 'react';
import { api, type Benutzer, type Firma, type ProjektDetail } from '../api';
import { Hilfe } from './Felder';

export function Berichte({
  projekt,
  gesperrt,
  online,
  lokal,
  aendern,
}: {
  projekt: ProjektDetail;
  gesperrt: boolean;
  online: boolean;
  /** auf dieses Gerät ausgecheckt: Berichte zeigen den zuletzt übertragenen Stand */
  lokal: boolean;
  benutzer: Benutzer;
  aendern: (aktion: () => Promise<unknown>) => Promise<void>;
}) {
  const [firmen, setFirmen] = useState<Firma[]>([]);
  useEffect(() => {
    if (online) api.get<Firma[]>('/firmen').then(setFirmen).catch(() => setFirmen([]));
  }, [online]);
  const standard = firmen.find((f) => f.standard);
  return (
    <div className="karte berichte">
      <h2>Berichte</h2>
      {!online ? (
        <p className="leise">Berichte werden auf dem Server erzeugt – bitte online gehen (bzw. das Projekt einchecken), dann stehen sie hier bereit.</p>
      ) : (
        <div className="knopfreihe">
          <label className="inline">
            Berichtsfirma
            <Hilfe begriff="Berichtsfirma" text="Firma für Logo, Kopf- und Fußzeile der Berichte. Ohne Auswahl gilt die Standardfirma (Firmendaten, Admin)." />
            <select
              value={projekt.berichtsfirma_id ?? ''}
              disabled={gesperrt}
              aria-label="Berichtsfirma"
              onChange={(e) => void aendern(() => api.patch(`/projekte/${projekt.id}`, { berichtsfirma_id: e.target.value ? Number(e.target.value) : null }))}
            >
              <option value="">Standard{standard ? ` (${standard.name})` : ''}</option>
              {firmen
                .filter((f) => !f.standard)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
