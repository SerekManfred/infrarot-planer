// Modulkatalog (Festlegung 31.10.2026): lesen alle, pflegen Admin und Fachprüfer – jedes Feld direkt in der Tabelle,
// neue Module, deaktivieren (bleibt in bestehenden Planungen gültig), löschen nur unbenutzte, Export als Excel.
// Plausibilität prüft der Server (Leistung und Maße > 0, Schutzart IPxx, „Bad geeignet“ nur ab IP44).
// Ändern sich Daten verwendeter Module, warten betroffene Projekte auf den Fachprüfer (Vorgaben-Abgleich).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, fachansicht, hatRolle, type AbgleichProjekt, type Benutzer, type KatalogModulDaten } from '../api';
import { BEGRIFF, HILFE } from '../texte';
import { Hilfe, Meldung, Textfeld, Zahlfeld } from './Felder';

type Feld = keyof Omit<KatalogModulDaten, 'id'>;

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

  const setzen = (m: KatalogModulDaten, feld: Feld) => (wert: unknown) =>
    aendern(() => api.patch(`/bibliotheken/module/${m.id}`, { [feld]: wert }));

  const sichtbar = (module ?? []).filter((m) => inaktiveZeigen || m.aktiv);

  return (
    <section>
      <h1>Modulkatalog</h1>
      <Meldung art="hinweis">
        {darf
          ? 'Änderungen werden je Feld protokolliert. Laufende Projekte arbeiten mit dem Moduldatenstand ihrer Planung; ändern sich Daten eines verwendeten Moduls, entscheidet der Fachprüfer (Vorgaben-Abgleich).'
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
        <div className="tabelle-rahmen">
          <table className="tabelle modulkatalog">
            <thead>
              <tr>
                <th>Artikel-Nr.</th>
                <th>Bezeichnung</th>
                <th className="zahl">Leistung (W)</th>
                <th className="zahl">Länge (mm)</th>
                <th className="zahl">Breite (mm)</th>
                <th className="zahl">Bauhöhe (mm)</th>
                <th className="zahl">Gewicht (kg)</th>
                <th>Schutzart</th>
                <th>
                  Bad geeignet
                  <Hilfe begriff="Bad geeignet" text={HILFE.badGeeignet} />
                </th>
                <th>Oberfläche / Farbe</th>
                <th className="zahl">EK netto (€)</th>
                <th className="zahl">VK netto (€)</th>
                <th className="zahl">Montage (min)</th>
                <th>{BEGRIFF.quelle}</th>
                <th>Bemerkung</th>
                <th className="zahl">
                  Oberfl.-Temp. (°C)
                  <Hilfe begriff="Strahlerkennwerte" text={HILFE.strahlerkennwerte} />
                </th>
                <th className="zahl">Emissionsgrad</th>
                <th className="zahl">Abstrahlwinkel (°)</th>
                <th>Status</th>
                {darf && <th />}
              </tr>
            </thead>
            <tbody>
              {sichtbar.map((m) => (
                <tr key={m.id} className={m.aktiv ? '' : 'inaktiv'}>
                  <td>
                    <Textfeld wert={m.artikel_nr} pflicht gesperrt={!darf} beschriftung="Artikel-Nr." onSpeichern={setzen(m, 'artikel_nr')} />
                  </td>
                  <td>
                    <Textfeld wert={m.bezeichnung} pflicht gesperrt={!darf} beschriftung="Bezeichnung" onSpeichern={setzen(m, 'bezeichnung')} />
                  </td>
                  {(['leistung_w', 'laenge_mm', 'breite_mm'] as const).map((f) => (
                    <td key={f}>
                      <Zahlfeld wert={m[f]} pflicht gesperrt={!darf} beschriftung={f} onSpeichern={(w) => (w === null ? undefined : setzen(m, f)(w))} />
                    </td>
                  ))}
                  {(['bauhoehe_mm', 'gewicht_kg'] as const).map((f) => (
                    <td key={f}>
                      <Zahlfeld wert={m[f]} gesperrt={!darf} beschriftung={f} onSpeichern={setzen(m, f)} />
                    </td>
                  ))}
                  <td>
                    <Textfeld wert={m.schutzart} pflicht gesperrt={!darf} beschriftung="Schutzart" onSpeichern={(w) => setzen(m, 'schutzart')(w.toUpperCase().replace(/\s/g, ''))} />
                  </td>
                  <td>
                    <select
                      aria-label="Bad geeignet"
                      value={m.bad_geeignet ? 'ja' : 'nein'}
                      disabled={!darf}
                      onChange={(e) => setzen(m, 'bad_geeignet')(e.target.value === 'ja')}
                    >
                      <option value="ja">ja</option>
                      <option value="nein">nein</option>
                    </select>
                  </td>
                  <td>
                    <Textfeld wert={m.oberflaeche} gesperrt={!darf} beschriftung="Oberfläche" onSpeichern={setzen(m, 'oberflaeche')} />
                  </td>
                  {(['ek_netto', 'vk_netto', 'montagezeit_min'] as const).map((f) => (
                    <td key={f}>
                      <Zahlfeld wert={m[f]} platzhalter="fehlt" gesperrt={!darf} beschriftung={f} onSpeichern={setzen(m, f)} />
                    </td>
                  ))}
                  <td>
                    {darf ? (
                      <Textfeld wert={m.quelle} pflicht beschriftung="Quelle" onSpeichern={setzen(m, 'quelle')} />
                    ) : /^https:\/\//.test(m.quelle) ? (
                      <a href={m.quelle} target="_blank" rel="noopener noreferrer">
                        Produktseite
                      </a>
                    ) : (
                      m.quelle
                    )}
                  </td>
                  <td>
                    <Textfeld wert={m.bemerkung} gesperrt={!darf} beschriftung="Bemerkung" onSpeichern={setzen(m, 'bemerkung')} />
                  </td>
                  {(['oberflaechentemperatur_c', 'emissionsgrad', 'abstrahlwinkel_grad'] as const).map((f) => (
                    <td key={f}>
                      <Zahlfeld wert={m[f]} platzhalter="Vorgabe" gesperrt={!darf} beschriftung={f} onSpeichern={setzen(m, f)} />
                    </td>
                  ))}
                  <td>{m.aktiv ? 'aktiv' : 'inaktiv'}</td>
                  {darf && (
                    <td className="aktionen">
                      <button className="knopf-leise klein" onClick={() => aendern(() => api.patch(`/bibliotheken/module/${m.id}`, { aktiv: !m.aktiv }))}>
                        {m.aktiv ? 'Deaktivieren' : 'Aktivieren'}
                      </button>
                      <button
                        className="knopf-leise klein"
                        onClick={() =>
                          window.confirm(`Modul ${m.artikel_nr} löschen? Das geht nur, wenn es in keinem Projekt verwendet wird.`) &&
                          aendern(() => api.loeschen(`/bibliotheken/module/${m.id}`), `Modul ${m.artikel_nr} gelöscht.`)
                        }
                      >
                        Löschen
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {darf && <NeuesModul onAngelegt={(nr) => aendern(async () => undefined, `Modul ${nr} angelegt.`)} />}
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
      <p className="leise ganze-breite">Weitere Angaben (Bauhöhe, Gewicht, Preise, Montagezeit …) nach dem Anlegen direkt in der Tabelle.</p>
      <button className="knopf" type="submit">
        Modul anlegen
      </button>
    </form>
  );
}
