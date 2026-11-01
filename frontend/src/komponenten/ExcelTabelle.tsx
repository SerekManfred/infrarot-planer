// Excel-Export und -Import je Tabelle der Fachvorgaben (Paket L, 01.11.2026): erst prüfen (Vorschau mit neu / geändert /
// unverändert, Änderungen alt → neu, Fehler mit Zeile, betroffene Projekte), dann nach Bestätigung übernehmen.
// Der Server sichert vorher die Datenbank, protokolliert jede Änderung und gleicht die Projekte ab. Gelöscht wird nie.
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { watt } from '../texte';
import { Meldung } from './Felder';

export type TabellenName = 'raumtypen' | 'regeln' | 'objekte' | 'bauteile' | 'klimadaten' | 'module';

interface Vorschau {
  neu: string[];
  geaendert: string[];
  unveraendert: number;
  aenderungen: { zeile: number; schluessel: string; feld: string; feldname: string; alt: number | string | boolean | null; neu: number | string | boolean | null }[];
  fehler: { zeile: number; schluessel: string; text: string }[];
  pruefsumme: string;
  betroffen: { projekt_id: number; nummer: string; bezeichnung: string; summe_alt_w: number; summe_neu_w: number; neue_verstoesse: number }[];
}

export function importWert(w: number | string | boolean | null): string {
  if (w === null || w === '') return '–';
  if (typeof w === 'boolean') return w ? 'ja' : 'nein';
  return typeof w === 'number' ? w.toLocaleString('de-DE', { maximumFractionDigits: 3 }) : w;
}

export function ExcelTabelle({ name, titel, onFertig }: { name: TabellenName; titel: string; onFertig: (text: string) => void }) {
  const [offen, setOffen] = useState(false);
  const [datei, setDatei] = useState<File | null>(null);
  const [vorschau, setVorschau] = useState<Vorschau | null>(null);
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  async function pruefen(e: FormEvent) {
    e.preventDefault();
    if (!datei) return;
    setFehler('');
    setVorschau(null);
    setLaeuft(true);
    try {
      const form = new FormData();
      form.append('datei', datei);
      setVorschau(await api.post<Vorschau>(`/tabellen/${name}/import/vorschau`, form));
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  async function uebernehmen() {
    if (!datei || !vorschau) return;
    const betroffen = vorschau.betroffen.length > 0 ? ` ${vorschau.betroffen.length} Projekt(e) warten danach auf Ihre Entscheidung.` : '';
    if (!window.confirm(`${vorschau.geaendert.length} Eintrag/Einträge ändern und ${vorschau.neu.length} neu anlegen?${betroffen} Vorher wird die Datenbank gesichert; jede Änderung wird protokolliert.`)) return;
    setLaeuft(true);
    setFehler('');
    try {
      const form = new FormData();
      form.append('datei', datei);
      form.append('pruefsumme', vorschau.pruefsumme);
      const e = await api.post<{ neu: number; geaendert: number; sicherung: string | null; projekte_warten: number }>(`/tabellen/${name}/import`, form);
      setVorschau(null);
      setDatei(null);
      setOffen(false);
      onFertig(
        `${titel}: Import übernommen – ${e.geaendert} geändert, ${e.neu} neu.` +
          (e.sicherung ? ` Sicherung vorher: ${e.sicherung}.` : '') +
          (e.projekte_warten > 0 ? ` ${e.projekte_warten} Projekt(e) warten auf den Fachprüfer (Vorgaben-Abgleich).` : ''),
      );
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  const ok = vorschau !== null && vorschau.fehler.length === 0 && vorschau.neu.length + vorschau.geaendert.length > 0;
  return (
    <div className="excel-tabelle">
      <div className="knopfreihe">
        <a className="knopf-zweit" href={`/api/tabellen/${name}/export.xlsx`} download>
          Als Excel exportieren
        </a>
        <button className="knopf-zweit" onClick={() => setOffen(!offen)} aria-expanded={offen}>
          Aus Excel importieren …
        </button>
      </div>
      {offen && (
        <div className="import-bereich">
          <p className="leise">
            Die exportierte Datei in Excel bearbeiten und hier wieder einlesen. Zuordnung über den Schlüssel (siehe Blatt „Hinweise“); gelöscht
            wird nie. Erst prüfen, dann übernehmen.
          </p>
          <form className="knopfreihe" onSubmit={pruefen}>
            <input
              type="file"
              aria-label={`Excel-Datei ${titel}`}
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                setDatei(e.target.files?.[0] ?? null);
                setVorschau(null);
              }}
            />
            <button className="knopf-zweit" type="submit" disabled={!datei || laeuft}>
              {laeuft && !vorschau ? 'Wird geprüft …' : 'Prüfen (Vorschau)'}
            </button>
          </form>
          {fehler && <Meldung>{fehler}</Meldung>}
          {vorschau && <ImportVorschau vorschau={vorschau} />}
          {vorschau && (
            <button className="knopf" disabled={!ok || laeuft} onClick={() => void uebernehmen()}>
              {laeuft ? 'Wird übernommen …' : 'Änderungen übernehmen'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ImportVorschau({ vorschau }: { vorschau: Vorschau }) {
  return (
    <div className="import-vorschau">
      <p className="waerme-kennzahlen">
        <strong>{vorschau.geaendert.length}</strong> geändert · <strong>{vorschau.neu.length}</strong> neu · <strong>{vorschau.unveraendert}</strong>{' '}
        unverändert · <strong className={vorschau.fehler.length ? 'verstoss-text' : ''}>{vorschau.fehler.length}</strong> Fehler
      </p>
      {vorschau.fehler.length > 0 && (
        <>
          <Meldung>Die Datei enthält Fehler – bitte in Excel korrigieren und erneut prüfen. Übernommen wird nur eine fehlerfreie Datei.</Meldung>
          <ul className="verstoesse">
            {vorschau.fehler.map((f) => (
              <li key={`${f.zeile}-${f.text}`}>
                Zeile {f.zeile}
                {f.schluessel && ` (${f.schluessel})`}: {f.text}
              </li>
            ))}
          </ul>
        </>
      )}
      {vorschau.neu.length > 0 && <p>Neu: {vorschau.neu.join(', ')}</p>}
      {vorschau.aenderungen.length > 0 && (
        <div className="vtabelle-rahmen">
          <table className="vtabelle" aria-label="Änderungen">
            <thead>
              <tr>
                <th className="zahl">Zeile</th>
                <th>Eintrag</th>
                <th>Feld</th>
                <th>alt</th>
                <th>neu</th>
              </tr>
            </thead>
            <tbody>
              {vorschau.aenderungen.map((a) => (
                <tr key={`${a.zeile}-${a.feld}`}>
                  <td className="zahl" data-label="Zeile">{a.zeile}</td>
                  <td data-label="Eintrag">{a.schluessel}</td>
                  <td data-label="Feld">{a.feldname}</td>
                  <td data-label="alt">{importWert(a.alt)}</td>
                  <td data-label="neu">
                    <strong>{importWert(a.neu)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {vorschau.betroffen.length > 0 && (
        <Meldung art="warnung">
          Betroffene Projekte (warten nach der Übernahme auf Ihre Entscheidung):{' '}
          {vorschau.betroffen
            .map((b) => `${b.nummer} ${b.bezeichnung} (${watt(b.summe_alt_w)} → ${watt(b.summe_neu_w)}${b.neue_verstoesse ? `, ${b.neue_verstoesse} neue Regelverstöße` : ''})`)
            .join('; ')}
        </Meldung>
      )}
      {vorschau.fehler.length === 0 && vorschau.neu.length + vorschau.geaendert.length === 0 && (
        <Meldung art="hinweis">Keine Änderungen gegenüber der Tabelle.</Meldung>
      )}
    </div>
  );
}
