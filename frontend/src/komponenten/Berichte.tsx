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
  benutzer,
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
  const [preisstand, setPreisstand] = useState<{ eingefroren: boolean; datum: string | null; katalogversion: string | null; aktuelle_katalogversion: string } | null>(null);
  const ladenPreisstand = () => {
    if (online && benutzer.darf_kalkulation) api.get<typeof preisstand>(`/projekte/${projekt.id}/preisstand`).then(setPreisstand).catch(() => setPreisstand(null));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(ladenPreisstand, [online, projekt.id, benutzer.darf_kalkulation]);
  return (
    <div className="karte berichte">
      <h2>Berichte</h2>
      {!online ? (
        <p className="leise">Berichte werden auf dem Server erzeugt – offline nicht möglich. Sobald das Gerät wieder online ist, stehen sie hier bereit.</p>
      ) : (
        <>
        <div className="knopfreihe">
          <a className="knopf" href={`/api/projekte/${projekt.id}/berichte/ergebnis.pdf`} download>
            Ergebnisbericht (PDF)
          </a>
          <a className="knopf-zweit" href={`/api/projekte/${projekt.id}/berichte/bestellliste.xlsx`} download>
            Bestellliste (Excel)
          </a>
          {benutzer.darf_kalkulation && (
            <a className="knopf-zweit" href={`/api/projekte/${projekt.id}/berichte/kalkulation.xlsx`} download onClick={() => setTimeout(ladenPreisstand, 1500)}>
              Kalkulation (Excel, intern)
            </a>
          )}
        </div>
        {lokal && <p className="leise klein-text">Das Projekt ist auf dieses Gerät ausgecheckt: Berichte zeigen den zuletzt übertragenen Stand.</p>}
        {benutzer.darf_kalkulation && preisstand && (
          <p className="klein-text">
            {preisstand.eingefroren
              ? `Preisstand der Kalkulation: ${preisstand.datum} (Katalogversion ${preisstand.katalogversion})`
              : 'Der Preisstand wird beim ersten Erzeugen der Kalkulation eingefroren.'}
            {preisstand.eingefroren && preisstand.katalogversion !== preisstand.aktuelle_katalogversion && ' – im Katalog gibt es neuere Preise.'}{' '}
            {preisstand.eingefroren && (
              <button
                className="knopf-leise klein"
                onClick={() =>
                  window.confirm('Preisstand auf die aktuellen Preise setzen? Die Kalkulation rechnet danach mit den neuen Preisen.') &&
                  void api.post(`/projekte/${projekt.id}/preisstand`).then(ladenPreisstand)
                }
              >
                Preisstand aktualisieren
              </button>
            )}
          </p>
        )}
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
        </>
      )}
    </div>
  );
}
