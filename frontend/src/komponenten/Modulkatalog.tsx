// Modulkatalog (Festlegung 31.10.2026): lesen alle, pflegen Admin und Fachprüfer – im Dialog „Bearbeiten“ (alle Felder),
// neue Module, deaktivieren (bleibt in bestehenden Planungen gültig), löschen nur unbenutzte, Export als Excel.
// Die Tabelle zeigt die Werte kompakt, damit sie am Laptop ohne waagrechtes Scrollen passt (Praxistest 01.11.2026).
// Plausibilität prüft der Server (Leistung und Maße > 0, Schutzart IPxx, „Bad geeignet“ nur ab IP44).
// Ändern sich Daten verwendeter Module, warten betroffene Projekte auf den Fachprüfer (Vorgaben-Abgleich).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, fachansicht, hatRolle, type AbgleichProjekt, type Artikel, type Benutzer, type KatalogModulDaten } from '../api';
import { BEGRIFF, HILFE } from '../texte';
import { Dialog, Hilfe, Meldung, Textfeld, Zahlfeld } from './Felder';
import { ExcelTabelle } from './ExcelTabelle';
import { VTabelle, zahlText } from './VTabelle';

type Feld = keyof Omit<KatalogModulDaten, 'id'>;

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
  { feld: 'emissionsgrad', name: 'Emissionsgrad (0–1, ohne Einheit)', art: 'zahl', hilfe: HILFE.emissionsgrad },
  { feld: 'abstrahlwinkel_grad', name: 'Abstrahlwinkel (°)', art: 'zahl' },
  { feld: 'quelle', name: `${BEGRIFF.quelle} (Produktseite)`, art: 'text', pflicht: true },
  { feld: 'bemerkung', name: 'Bemerkung', art: 'text' },
];

function ModulDialog({
  modul,
  darf,
  preise,
  onSchliessen,
  aendern,
}: {
  modul: KatalogModulDaten;
  darf: boolean;
  preise: boolean;
  onSchliessen: () => void;
  aendern: (aktion: () => Promise<unknown>, erfolg?: string) => Promise<void>;
}) {
  const felder = DIALOG_FELDER.filter((f) => preise || (f.feld !== 'ek_netto' && f.feld !== 'vk_netto'));
  const [texte, setTexte] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      felder.map(({ feld, art }) => {
        const w = modul[feld];
        return [feld, art === 'janein' ? (w ? 'ja' : 'nein') : w === null || w === undefined ? '' : String(w).replace('.', art === 'zahl' ? ',' : '.')];
      }),
    ),
  );
  const [fehler, setFehler] = useState('');

  function speichern() {
    const aenderung: Record<string, unknown> = {};
    for (const { feld, art, name, pflicht } of felder) {
      const t = texte[feld].trim();
      let wert: unknown;
      if (art === 'janein') wert = t === 'ja';
      else if (art === 'zahl') {
        wert = t === '' ? null : Number(t.replace(',', '.'));
        if (typeof wert === 'number' && !Number.isFinite(wert)) return setFehler(`${name}: bitte eine Zahl eingeben.`);
        if (feld === 'emissionsgrad' && typeof wert === 'number' && !(wert > 0 && wert <= 1)) {
          return setFehler('Emissionsgrad: nur Werte größer als 0 bis höchstens 1 (Verhältniszahl ohne Einheit, z. B. 0,93).');
        }
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
        {felder.map(({ feld, name, art, hilfe }) => (
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
  const preise = !!benutzer.darf_kalkulation;
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
        {!darf && (
          <a className="knopf-zweit" href="/api/bibliotheken/module/export.xlsx" download>
            Als Excel exportieren
          </a>
        )}
        <label className="inline">
          <input type="checkbox" checked={inaktiveZeigen} onChange={(e) => setInaktiveZeigen(e.target.checked)} /> inaktive Module zeigen
        </label>
      </div>
      {module === null ? (
        <p>Wird geladen …</p>
      ) : (
        // Einheitliche Tabelle (fixierte Kopfzeile, Kartenansicht am Handy). Bauhöhe, Schutzart, Quelle und Bemerkung nur
        // im Dialog und im Excel-Export (Praxistest 01.11.2026) – so passt die Tabelle auf den Laptop.
        <VTabelle
          name="Modulkatalog"
          zeilen={sichtbar}
          schluessel={(m) => m.id}
          inaktiv={(m) => !m.aktiv}
          spalten={[
            { kopf: 'Artikel-Nr.', wert: (m) => <><strong>{m.artikel_nr}</strong>{!m.aktiv && <small className="inaktiv-marke">inaktiv</small>}</> },
            { kopf: 'Bezeichnung', wert: (m) => m.bezeichnung, umbruch: true },
            { kopf: 'Leistung (W)', zahl: true, wert: (m) => zahlText(m.leistung_w) },
            { kopf: 'L × B (mm)', zahl: true, wert: (m) => `${zahlText(m.laenge_mm)} × ${zahlText(m.breite_mm)}` },
            { kopf: 'Gewicht (kg)', zahl: true, wert: (m) => zahlText(m.gewicht_kg) },
            { kopf: 'Bad', wert: (m) => (m.bad_geeignet ? 'ja' : 'nein'), hilfe: { begriff: 'Bad geeignet', text: HILFE.badGeeignet } },
            { kopf: 'Oberfläche', wert: (m) => m.oberflaeche || '–', umbruch: true },
            // Preise nur mit Recht „Kalkulation sehen“ (Paket M4c, Standard: nur Admin)
            ...(preise ? [{ kopf: 'EK / VK (€)', zahl: true, wert: (m: KatalogModulDaten) => `${zahlText(m.ek_netto, '', 'fehlt')} / ${zahlText(m.vk_netto, '', 'fehlt')}` }] : []),
            { kopf: 'Montage (min)', zahl: true, wert: (m) => zahlText(m.montagezeit_min, '', 'fehlt') },
            { kopf: 'Strahler', zahl: true, umbruch: true, wert: (m) => strahlerText(m), hilfe: { begriff: 'Strahlerkennwerte', text: HILFE.strahlerkennwerte } },
          ]}
          aktion={setBearbeiten}
          aktionText={darf ? 'Bearbeiten' : 'Details'}
        />
      )}
      {bearbeiten && (
        <ModulDialog
          modul={bearbeiten}
          darf={darf}
          preise={preise}
          onSchliessen={() => setBearbeiten(null)}
          aendern={async (aktion, erfolg) => {
            await aendern(aktion, erfolg);
            setBearbeiten(null);
          }}
        />
      )}
      {darf && <NeuesModul onAngelegt={(nr) => aendern(async () => undefined, `Modul ${nr} angelegt.`)} />}
      {preise && <Artikelstamm admin={hatRolle(benutzer, 'admin')} />}
      {darf && (
        <div className="karte">
          <h2>Katalog als Excel</h2>
          <ExcelTabelle name="module" titel="Modulkatalog" onFertig={(text) => aendern(async () => undefined, text)} />
        </div>
      )}
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


/** Artikelstamm für Pauschalen der Kalkulation (Paket M4c): Raumthermostat, Elektroanschluss je Raum, Anfahrt je Projekt.
 *  Sichtbar mit Recht „Kalkulation sehen“, Preise pflegt der Admin. Leer = „Preis fehlt“ (nie 0 €). */
function Artikelstamm({ admin }: { admin: boolean }) {
  const [liste, setListe] = useState<Artikel[]>([]);
  const [fehler, setFehler] = useState('');
  const laden = () => api.get<Artikel[]>('/artikel').then(setListe).catch((e) => setFehler((e as Error).message));
  useEffect(() => void laden(), []);
  const setzen = (a: Artikel, feld: keyof Artikel) => (wert: unknown) =>
    api.patch(`/artikel/${a.schluessel}`, { [feld]: wert }).then(laden).catch((e) => setFehler((e as Error).message));
  return (
    <div className="karte">
      <h2>Artikelstamm (Pauschalen der Kalkulation)</h2>
      <p className="leise">Preise netto. Leer = „Preis fehlt“ in der Kalkulation. Modulpreise stehen im Modulkatalog (Bearbeiten).</p>
      {fehler && <Meldung>{fehler}</Meldung>}
      <VTabelle
        name="Artikelstamm"
        zeilen={liste}
        schluessel={(a) => a.schluessel}
        spalten={[
          { kopf: 'Artikel', wert: (a) => <strong>{a.bezeichnung}</strong> },
          { kopf: 'Bezug', wert: (a) => (a.bezug === 'projekt' ? 'je Projekt' : 'je Raum mit Modulen') },
          { kopf: 'Art.-Nr.', wert: (a) => (admin ? <Textfeld wert={a.art_nr} beschriftung={`Art.-Nr. ${a.bezeichnung}`} onSpeichern={setzen(a, 'art_nr')} /> : a.art_nr || '–') },
          { kopf: 'EK netto (€)', zahl: true, wert: (a) => (admin ? <Zahlfeld wert={a.ek_netto} platzhalter="Preis fehlt" beschriftung={`EK ${a.bezeichnung}`} onSpeichern={setzen(a, 'ek_netto')} /> : zahlText(a.ek_netto, '', 'Preis fehlt')) },
          { kopf: 'VK netto (€)', zahl: true, wert: (a) => (admin ? <Zahlfeld wert={a.vk_netto} platzhalter="Preis fehlt" beschriftung={`VK ${a.bezeichnung}`} onSpeichern={setzen(a, 'vk_netto')} /> : zahlText(a.vk_netto, '', 'Preis fehlt')) },
        ]}
      />
    </div>
  );
}
