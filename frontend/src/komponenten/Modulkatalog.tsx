// Modulkatalog (Festlegung 31.10.2026): lesen alle, pflegen Admin und Fachprüfer – im Dialog „Bearbeiten“ (alle Felder),
// neue Module, deaktivieren (bleibt in bestehenden Planungen gültig), löschen nur unbenutzte, Export als Excel.
// Die Tabelle zeigt die Werte kompakt, damit sie am Laptop ohne waagrechtes Scrollen passt (Praxistest 01.11.2026).
// Plausibilität prüft der Server (Leistung und Maße > 0, Schutzart IPxx, „Bad geeignet“ nur ab IP44).
// Ändern sich Daten verwendeter Module, warten betroffene Projekte auf den Fachprüfer (Vorgaben-Abgleich).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, fachansicht, hatRolle, type AbgleichProjekt, type Benutzer, type KatalogModulDaten } from '../api';
import { BEGRIFF, HILFE } from '../texte';
import { Dialog, Hilfe, Meldung } from './Felder';

type Feld = keyof Omit<KatalogModulDaten, 'id'>;

/** Zahl deutsch formatiert (ohne unnötige Nachkommastellen); leer → Ersatztext */
export function zahlText(w: number | null | undefined, einheit = '', leer = '–'): string {
  if (w === null || w === undefined) return leer;
  return `${w.toLocaleString('de-DE', { maximumFractionDigits: 2 })}${einheit}`;
}

/** Strahlerkennwerte kompakt: „90 °C · ε 0,3 · 120°“; fehlende als „Vorgabe“ */
export function strahlerText(m: Pick<KatalogModulDaten, 'oberflaechentemperatur_c' | 'emissionsgrad' | 'abstrahlwinkel_grad'>): string {
  const werte = [
    zahlText(m.oberflaechentemperatur_c, ' °C', ''),
    m.emissionsgrad === null ? '' : `ε ${zahlText(m.emissionsgrad)}`,
    zahlText(m.abstrahlwinkel_grad, '°', ''),
  ];
  return werte.every((w) => w === '') ? 'Vorgabe' : werte.map((w) => w || 'Vorgabe').join(' · ');
}

/** Felder des Bearbeiten-Dialogs (Reihenfolge wie im Excel-Export) */
const DIALOG_FELDER: { feld: Feld; name: string; art: 'text' | 'zahl' | 'janein'; pflicht?: boolean; hilfe?: string }[] = [
  { feld: 'artikel_nr', name: 'Artikel-Nr.', art: 'text', pflicht: true },
  { feld: 'bezeichnung', name: 'Bezeichnung', art: 'text', pflicht: true },
  { feld: 'leistung_w', name: 'Leistung (W)', art: 'zahl', pflicht: true },
  { feld: 'laenge_mm', name: 'Länge (mm)', art: 'zahl', pflicht: true },
  { feld: 'breite_mm', name: 'Breite (mm)', art: 'zahl', pflicht: true },
  { feld: 'bauhoehe_mm', name: 'Bauhöhe (mm)', art: 'zahl' },
  { feld: 'gewicht_kg', name: 'Gewicht (kg)', art: 'zahl' },
  { feld: 'schutzart', name: 'Schutzart (IP)', art: 'text', pflicht: true },
  { feld: 'bad_geeignet', name: 'Bad geeignet', art: 'janein', hilfe: HILFE.badGeeignet },
  { feld: 'oberflaeche', name: 'Oberfläche / Farbe', art: 'text' },
  { feld: 'ek_netto', name: 'EK netto (€)', art: 'zahl' },
  { feld: 'vk_netto', name: 'VK netto (€)', art: 'zahl' },
  { feld: 'montagezeit_min', name: 'Montagezeit (min)', art: 'zahl' },
  { feld: 'oberflaechentemperatur_c', name: 'Oberflächentemperatur (°C)', art: 'zahl', hilfe: HILFE.strahlerkennwerte },
  { feld: 'emissionsgrad', name: 'Emissionsgrad (0–1)', art: 'zahl' },
  { feld: 'abstrahlwinkel_grad', name: 'Abstrahlwinkel (°)', art: 'zahl' },
  { feld: 'quelle', name: `${BEGRIFF.quelle} (Produktseite)`, art: 'text', pflicht: true },
  { feld: 'bemerkung', name: 'Bemerkung', art: 'text' },
];

function ModulDialog({
  modul,
  darf,
  onSchliessen,
  aendern,
}: {
  modul: KatalogModulDaten;
  darf: boolean;
  onSchliessen: () => void;
  aendern: (aktion: () => Promise<unknown>, erfolg?: string) => Promise<void>;
}) {
  const [texte, setTexte] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      DIALOG_FELDER.map(({ feld, art }) => {
        const w = modul[feld];
        return [feld, art === 'janein' ? (w ? 'ja' : 'nein') : w === null || w === undefined ? '' : String(w).replace('.', art === 'zahl' ? ',' : '.')];
      }),
    ),
  );
  const [fehler, setFehler] = useState('');

  function speichern() {
    const aenderung: Record<string, unknown> = {};
    for (const { feld, art, name, pflicht } of DIALOG_FELDER) {
      const t = texte[feld].trim();
      let wert: unknown;
      if (art === 'janein') wert = t === 'ja';
      else if (art === 'zahl') {
        wert = t === '' ? null : Number(t.replace(',', '.'));
        if (typeof wert === 'number' && !Number.isFinite(wert)) return setFehler(`${name}: bitte eine Zahl eingeben.`);
      } else wert = feld === 'schutzart' ? t.toUpperCase().replace(/\s/g, '') : t;
      if (pflicht && (wert === null || wert === '')) return setFehler(`${name} darf nicht leer sein.`);
      if (wert !== (modul[feld] ?? (art === 'text' ? '' : null))) aenderung[feld] = wert;
    }
    if (Object.keys(aenderung).length === 0) return onSchliessen();
    void aendern(() => api.patch(`/bibliotheken/module/${modul.id}`, aenderung), `Modul ${modul.artikel_nr} gespeichert.`);
  }

  return (
    <Dialog titel={`${darf ? 'Modul bearbeiten' : 'Modul'}: ${modul.artikel_nr}`} onSchliessen={onSchliessen}>
      <div className="raster">
        {DIALOG_FELDER.map(({ feld, name, art, hilfe }) => (
          <label key={feld} className={feld === 'quelle' || feld === 'bemerkung' || feld === 'bezeichnung' ? 'breit' : undefined}>
            <span>
              {name}
              {hilfe && <Hilfe begriff={name} text={hilfe} />}
            </span>
            {art === 'janein' ? (
              <select value={texte[feld]} disabled={!darf} onChange={(e) => setTexte({ ...texte, [feld]: e.target.value })}>
                <option value="ja">ja</option>
                <option value="nein">nein</option>
              </select>
            ) : (
              <input
                value={texte[feld]}
                inputMode={art === 'zahl' ? 'decimal' : undefined}
                disabled={!darf}
                placeholder={art === 'zahl' && !['leistung_w', 'laenge_mm', 'breite_mm'].includes(feld) ? 'fehlt' : undefined}
                onChange={(e) => setTexte({ ...texte, [feld]: e.target.value })}
              />
            )}
          </label>
        ))}
      </div>
      {!darf && /^https:\/\//.test(modul.quelle) && (
        <p>
          <a href={modul.quelle} target="_blank" rel="noopener noreferrer">
            Produktseite öffnen
          </a>
        </p>
      )}
      {fehler && <Meldung>{fehler}</Meldung>}
      <div className="knopfreihe">
        {darf && (
          <button className="knopf" onClick={speichern}>
            Speichern
          </button>
        )}
        <button className="knopf-leise" onClick={onSchliessen}>
          {darf ? 'Abbrechen' : 'Schließen'}
        </button>
        {darf && (
          <>
            <button
              className="knopf-leise"
              onClick={() => void aendern(() => api.patch(`/bibliotheken/module/${modul.id}`, { aktiv: !modul.aktiv }), `Modul ${modul.artikel_nr} ${modul.aktiv ? 'deaktiviert' : 'aktiviert'}.`)}
            >
              {modul.aktiv ? 'Deaktivieren' : 'Aktivieren'}
            </button>
            <button
              className="knopf-gefahr"
              onClick={() =>
                window.confirm(`Modul ${modul.artikel_nr} löschen? Das geht nur, wenn es in keinem Projekt verwendet wird.`) &&
                void aendern(() => api.loeschen(`/bibliotheken/module/${modul.id}`), `Modul ${modul.artikel_nr} gelöscht.`)
              }
            >
              Löschen
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}

export function ModulkatalogSeite({ benutzer }: { benutzer: Benutzer }) {
  const darf = fachansicht(benutzer); // Admin und Fachprüfer
  const [module, setModule] = useState<KatalogModulDaten[] | null>(null);
  const [fehler, setFehler] = useState('');
  const [hinweis, setHinweis] = useState('');
  const [inaktiveZeigen, setInaktiveZeigen] = useState(true);

  const laden = useCallback(() => {
    api.get<KatalogModulDaten[]>('/bibliotheken/module').then(setModule).catch((e) => setFehler((e as Error).message));
  }, []);
  useEffect(laden, [laden]);

  async function aendern(aktion: () => Promise<unknown>, erfolg = '') {
    setFehler('');
    setHinweis('');
    try {
      await aktion();
      let text = erfolg;
      // Fachprüfer: wartende Projekte nach geänderten Moduldaten nennen
      if (hatRolle(benutzer, 'fachpruefer')) {
        const warten = (await api.get<AbgleichProjekt[]>('/fachvorgaben/abgleich')).filter((x) => x.art === 'module').length;
        if (warten > 0) text = `${text} ${warten} Projekt(e) warten wegen geänderter Moduldaten auf Ihre Entscheidung (Vorgaben-Abgleich).`.trim();
      }
      setHinweis(text);
    } catch (e) {
      setFehler((e as Error).message);
    }
    laden();
  }

  const [bearbeiten, setBearbeiten] = useState<KatalogModulDaten | null>(null);

  const sichtbar = (module ?? []).filter((m) => inaktiveZeigen || m.aktiv);

  return (
    <section>
      <h1>Modulkatalog</h1>
      <Meldung art="hinweis">
        {darf
          ? 'Bearbeiten über den Knopf in der Zeile; Bauhöhe, Schutzart, Quelle und Bemerkung stehen im Dialog und im Excel-Export. Änderungen werden je Feld protokolliert. Laufende Projekte arbeiten mit dem Moduldatenstand ihrer Planung; ändern sich Daten eines verwendeten Moduls, entscheidet der Fachprüfer (Vorgaben-Abgleich).'
          : 'Nur zur Ansicht. Gepflegt wird der Katalog von Fachprüfer und Admin.'}
      </Meldung>
      {fehler && <Meldung>{fehler}</Meldung>}
      {hinweis && <Meldung art="hinweis">{hinweis}</Meldung>}
      <div className="knopfreihe">
        <a className="knopf-zweit" href="/api/bibliotheken/module/export.xlsx" download>
          Als Excel exportieren
        </a>
        <label className="inline">
          <input type="checkbox" checked={inaktiveZeigen} onChange={(e) => setInaktiveZeigen(e.target.checked)} /> inaktive Module zeigen
        </label>
      </div>
      {module === null ? (
        <p>Wird geladen …</p>
      ) : (
        // Kopfzeile bleibt beim Scrollen stehen (eigener Scrollbereich, CSS „sticky“). Bauhöhe, Schutzart, Quelle und
        // Bemerkung nur im Dialog und im Excel-Export (Praxistest 01.11.2026) – so passt die Tabelle auf den Laptop.
        <div className="tabelle-rahmen katalog-rahmen">
          <table className="tabelle modulkatalog">
            <thead>
              <tr>
                <th>Artikel-Nr.</th>
                <th>Bezeichnung</th>
                <th className="zahl">Leistung</th>
                <th className="zahl">L × B (mm)</th>
                <th className="zahl">Gewicht</th>
                <th>
                  Bad
                  <Hilfe begriff="Bad geeignet" text={HILFE.badGeeignet} />
                </th>
                <th>Oberfläche</th>
                <th className="zahl">EK / VK netto</th>
                <th className="zahl">Montage</th>
                <th className="zahl">
                  Strahler
                  <Hilfe begriff="Strahlerkennwerte" text={HILFE.strahlerkennwerte} />
                </th>
                <th aria-label="Bearbeiten" />
              </tr>
            </thead>
            <tbody>
              {sichtbar.map((m) => (
                <tr key={m.id} className={m.aktiv ? '' : 'inaktiv'}>
                  <td>
                    <strong>{m.artikel_nr}</strong>
                    {!m.aktiv && <small className="inaktiv-marke">inaktiv</small>}
                  </td>
                  <td className="umbruch">{m.bezeichnung}</td>
                  <td className="zahl">{zahlText(m.leistung_w, ' W')}</td>
                  <td className="zahl">
                    {zahlText(m.laenge_mm)} × {zahlText(m.breite_mm)}
                  </td>
                  <td className="zahl">{zahlText(m.gewicht_kg, ' kg')}</td>
                  <td>{m.bad_geeignet ? 'ja' : 'nein'}</td>
                  <td className="umbruch">{m.oberflaeche || '–'}</td>
                  <td className="zahl">
                    {zahlText(m.ek_netto, ' €', 'fehlt')} / {zahlText(m.vk_netto, ' €', 'fehlt')}
                  </td>
                  <td className="zahl">{zahlText(m.montagezeit_min, ' min', 'fehlt')}</td>
                  <td className="zahl umbruch-zahl">{strahlerText(m)}</td>
                  <td className="aktionen">
                    <button className="knopf-leise klein" onClick={() => setBearbeiten(m)}>
                      {darf ? 'Bearbeiten' : 'Details'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {bearbeiten && (
        <ModulDialog
          modul={bearbeiten}
          darf={darf}
          onSchliessen={() => setBearbeiten(null)}
          aendern={async (aktion, erfolg) => {
            await aendern(aktion, erfolg);
            setBearbeiten(null);
          }}
        />
      )}
      {darf && <NeuesModul onAngelegt={(nr) => aendern(async () => undefined, `Modul ${nr} angelegt.`)} />}
      {darf && <KatalogImport onFertig={(text) => aendern(async () => undefined, text)} />}
    </section>
  );
}

const LEER = {
  artikel_nr: '', bezeichnung: '', leistung_w: '', laenge_mm: '', breite_mm: '', schutzart: 'IP44', bad_geeignet: false, quelle: '',
};

function NeuesModul({ onAngelegt }: { onAngelegt: (artikelNr: string) => void }) {
  const [daten, setDaten] = useState(LEER);
  const [fehler, setFehler] = useState('');
  const feld = (f: keyof typeof LEER) => (e: { target: { value: string } }) => setDaten({ ...daten, [f]: e.target.value });
  const zahl = (t: string) => Number(t.replace(',', '.'));

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setFehler('');
    try {
      await api.post('/bibliotheken/module', {
        ...daten,
        schutzart: daten.schutzart.toUpperCase().replace(/\s/g, ''),
        leistung_w: zahl(daten.leistung_w),
        laenge_mm: zahl(daten.laenge_mm),
        breite_mm: zahl(daten.breite_mm),
      });
      onAngelegt(daten.artikel_nr);
      setDaten(LEER);
    } catch (err) {
      setFehler((err as Error).message);
    }
  }

  return (
    <form className="karte formular" onSubmit={absenden}>
      <h2 className="ganze-breite">Neues Modul</h2>
      <label>
        Artikel-Nr.
        <input value={daten.artikel_nr} onChange={feld('artikel_nr')} required maxLength={50} />
      </label>
      <label>
        Bezeichnung
        <input value={daten.bezeichnung} onChange={feld('bezeichnung')} required maxLength={300} />
      </label>
      <label>
        Leistung (W)
        <input inputMode="decimal" value={daten.leistung_w} onChange={feld('leistung_w')} required />
      </label>
      <label>
        Länge (mm)
        <input inputMode="decimal" value={daten.laenge_mm} onChange={feld('laenge_mm')} required />
      </label>
      <label>
        Breite (mm)
        <input inputMode="decimal" value={daten.breite_mm} onChange={feld('breite_mm')} required />
      </label>
      <label>
        Schutzart
        <input value={daten.schutzart} onChange={feld('schutzart')} required maxLength={6} placeholder="IP44" />
      </label>
      <label className="inline">
        <input type="checkbox" checked={daten.bad_geeignet} onChange={(e) => setDaten({ ...daten, bad_geeignet: e.target.checked })} /> Bad
        geeignet (nur ab IP44)
      </label>
      <label className="ganze-breite">
        {BEGRIFF.quelle} (Pflicht, z. B. Link zur Produktseite)
        <input value={daten.quelle} onChange={feld('quelle')} required maxLength={500} />
      </label>
      {fehler && <Meldung>{fehler}</Meldung>}
      <p className="leise ganze-breite">Weitere Angaben (Bauhöhe, Gewicht, Preise, Montagezeit …) nach dem Anlegen über „Bearbeiten“.</p>
      <button className="knopf" type="submit">
        Modul anlegen
      </button>
    </form>
  );
}

interface ImportVorschau {
  neu: string[];
  geaendert: string[];
  unveraendert: number;
  aenderungen: { zeile: number; artikel_nr: string; feld: string; feldname: string; alt: number | string | boolean | null; neu: number | string | boolean | null }[];
  fehler: { zeile: number; artikel_nr: string; text: string }[];
  pruefsumme: string;
}

function importWert(w: number | string | boolean | null): string {
  if (w === null || w === '') return '–';
  if (typeof w === 'boolean') return w ? 'ja' : 'nein';
  return typeof w === 'number' ? String(w).replace('.', ',') : w;
}

/**
 * Excel-Reimport (02.11.2026): exportierten Katalog in Excel bearbeiten und wieder einlesen. Erst Vorschau (neu,
 * geändert, unverändert, Änderungen, Fehler mit Zeile), Übernahme nur fehlerfrei und nach Bestätigung; der Server
 * sichert vorher die Datenbank. Gelöscht wird über den Import nie.
 */
function KatalogImport({ onFertig }: { onFertig: (text: string) => void }) {
  const [datei, setDatei] = useState<File | null>(null);
  const [vorschau, setVorschau] = useState<ImportVorschau | null>(null);
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
      setVorschau(await api.post<ImportVorschau>('/bibliotheken/module/import/vorschau', form));
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  async function uebernehmen() {
    if (!datei || !vorschau) return;
    const n = vorschau.neu.length + vorschau.geaendert.length;
    if (!window.confirm(`${vorschau.geaendert.length} Modul(e) ändern und ${vorschau.neu.length} neu anlegen? Vorher wird die Datenbank gesichert; jede Änderung wird protokolliert.`)) return;
    setLaeuft(true);
    setFehler('');
    try {
      const form = new FormData();
      form.append('datei', datei);
      form.append('pruefsumme', vorschau.pruefsumme);
      const e = await api.post<{ neu: number; geaendert: number; sicherung: string | null; projekte_warten: number }>('/bibliotheken/module/import', form);
      setVorschau(null);
      setDatei(null);
      onFertig(
        `Import übernommen: ${e.geaendert} geändert, ${e.neu} neu (${n} insgesamt).` +
          (e.sicherung ? ` Sicherung vorher: ${e.sicherung}.` : '') +
          (e.projekte_warten > 0 ? ` ${e.projekte_warten} Projekt(e) warten wegen geänderter Moduldaten auf den Fachprüfer.` : ''),
      );
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  const ok = vorschau !== null && vorschau.fehler.length === 0 && vorschau.neu.length + vorschau.geaendert.length > 0;
  return (
    <div className="karte">
      <h2>Katalog aus Excel importieren</h2>
      <p className="leise">
        Den exportierten Katalog in Excel bearbeiten und hier wieder einlesen. Zuordnung über die Artikel-Nr., neue Artikel-Nr. = neues Modul.
        Gelöscht wird nie – deaktivieren über die Spalte „aktiv“ = nein. Erst prüfen, dann übernehmen.
      </p>
      <form className="knopfreihe" onSubmit={pruefen}>
        <input
          type="file"
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
      {vorschau && (
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
                    {f.artikel_nr && ` (${f.artikel_nr})`}: {f.text}
                  </li>
                ))}
              </ul>
            </>
          )}
          {vorschau.neu.length > 0 && <p>Neue Module: {vorschau.neu.join(', ')}</p>}
          {vorschau.aenderungen.length > 0 && (
            <div className="tabelle-rahmen">
              <table className="tabelle">
                <thead>
                  <tr>
                    <th>Zeile</th>
                    <th>Artikel-Nr.</th>
                    <th>Feld</th>
                    <th>alt</th>
                    <th>neu</th>
                  </tr>
                </thead>
                <tbody>
                  {vorschau.aenderungen.map((a) => (
                    <tr key={`${a.zeile}-${a.feld}`}>
                      <td>{a.zeile}</td>
                      <td>{a.artikel_nr}</td>
                      <td>{a.feldname}</td>
                      <td>{importWert(a.alt)}</td>
                      <td>
                        <strong>{importWert(a.neu)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {vorschau.fehler.length === 0 && vorschau.neu.length + vorschau.geaendert.length === 0 && (
            <Meldung art="hinweis">Keine Änderungen gegenüber dem Katalog.</Meldung>
          )}
          <button className="knopf" disabled={!ok || laeuft} onClick={() => void uebernehmen()}>
            {laeuft ? 'Wird übernommen …' : 'Änderungen übernehmen'}
          </button>
        </div>
      )}
    </div>
  );
}
