// Zentrale Fachvorgaben: nur für Fachprüfer und Admins sichtbar und von ihnen gepflegt (der Außendienst sieht die Seite nicht).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  api,
  hatRolle,
  type Benutzer,
  type Fachvorgaben,
  type FachvorgabenWerte,
  type Gebaeudestandard,
  type Bauteil,
  type Klimadaten,
  type Platzierungsregel,
  type Raumtyp,
  type VorschauAnfrage,
  type VorschauErgebnis,
} from '../api';
import { BEGRIFF, GEBAEUDESTANDARDS, HILFE, HILFE_GEBAEUDESTANDARD, watt, zahl, zeitpunkt } from '../texte';
import { ObjektbibliothekKarte } from './Objektbibliothek';
import { Dialog, Hilfe, Meldung, Textfeld, Zahlfeld } from './Felder';
import { ExcelTabelle } from './ExcelTabelle';
import { VTabelle, zahlText, type VSpalte } from './VTabelle';
import { Protokoll } from './Protokoll';

export function FachvorgabenSeite({ benutzer }: { benutzer: Benutzer }) {
  const [vorgaben, setVorgaben] = useState<Fachvorgaben | null>(null);
  const [fehler, setFehler] = useState('');
  const [stand, setStand] = useState(0);
  const darf = hatRolle(benutzer, 'fachpruefer', 'admin');

  const laden = useCallback(() => {
    api.get<Fachvorgaben>('/fachvorgaben').then(setVorgaben).catch((e) => setFehler(e.message));
  }, []);
  useEffect(laden, [laden]);

  const [hinweis, setHinweis] = useState('');

  /**
   * Vor dem Speichern zeigen, welche Projekte die Änderung betrifft (Festlegung 18.10.2026). Betroffene Projekte
   * warten danach auf die Entscheidung des Fachprüfers; alle anderen übernehmen still.
   */
  async function mitVorschau(anfrage: VorschauAnfrage, aktion: () => Promise<unknown>) {
    setFehler('');
    setHinweis('');
    let vorschau: VorschauErgebnis;
    try {
      vorschau = await api.post<VorschauErgebnis>('/fachvorgaben/vorschau', anfrage);
    } catch (e) {
      setFehler((e as Error).message);
      return;
    }
    const n = vorschau.betroffen.length;
    if (n > 0) {
      const zeilen = vorschau.betroffen.slice(0, 15).map(
        (b) =>
          `• ${b.nummer} ${b.bezeichnung}: ${watt(b.summe_alt_w)} → ${watt(b.summe_neu_w)}` +
          (b.neue_verstoesse > 0 ? `, ${b.neue_verstoesse} neue(r) Regelverstoß/-verstöße` : '') +
          (b.raeume.length > 0 ? ` (${b.raeume.length} Raum/Räume)` : ''),
      );
      if (n > 15) zeilen.push(`… und ${n - 15} weitere`);
      const text =
        `Diese Änderung betrifft ${n} ${n === 1 ? 'Projekt' : 'Projekte'}:\n\n${zeilen.join('\n')}\n\n` +
        'Diese Projekte warten danach auf Ihre Entscheidung (Vorgaben-Abgleich). Alle anderen übernehmen die Änderung still.\n\nSpeichern?';
      if (!window.confirm(text)) return;
    }
    await aendern(aktion);
    setHinweis(
      n > 0
        ? `Gespeichert. ${n} ${n === 1 ? 'Projekt wartet' : 'Projekte warten'} auf Ihre Entscheidung – siehe „Vorgaben-Abgleich“.`
        : `Gespeichert. Die Änderung betrifft keines der ${vorschau.geprueft} offenen Projekte; sie haben sie still übernommen.`,
    );
  }

  async function aendern(aktion: () => Promise<unknown>) {
    setFehler('');
    try {
      await aktion();
    } catch (e) {
      setFehler((e as Error).message);
    }
    laden();
    setStand((s) => s + 1);
  }

  function importFertig(text: string) {
    setFehler('');
    setHinweis(text);
    laden();
    setStand((x) => x + 1);
  }

  if (!vorgaben) return fehler ? <Meldung>{fehler}</Meldung> : <p>Wird geladen …</p>;
  const w = vorgaben.werte;
  const werteSetzen = (feld: keyof FachvorgabenWerte) => (wert: unknown) => {
    const { geaendert_am: _, ...rest } = w;
    const daten = { ...rest, [feld]: wert };
    return mitVorschau({ art: 'werte', daten }, () => api.put('/fachvorgaben/werte', daten));
  };
  const standards = Object.keys(GEBAEUDESTANDARDS) as Gebaeudestandard[];
  // Altbau („sonstiger Bestand“): keine Rückfall- und Tabellenwerte, Pauschale je Raum durch den Fachprüfer (Festlegungen 12./13.10.2026)
  const mitRueckfall = standards.filter((gs): gs is Exclude<Gebaeudestandard, 'sonstiger_bestand'> => gs !== 'sonstiger_bestand');

  return (
    <section>
      <h1>Fachvorgaben</h1>
      <Meldung art="hinweis">
        Leere Felder bedeuten „Vorgabe fehlt“ – das Programm rechnet dann nicht mit geschätzten Werten. {darf ? 'Jede Änderung wird protokolliert.' : 'Pflege durch Fachprüfer und Admins.'}
        <br />
        Bestehende Projekte rechnen mit ihrem eingefrorenen Stand; dort erscheinen Änderungen als Unterschied und werden nur per Klick übernommen.
      </Meldung>
      {fehler && <Meldung>{fehler}</Meldung>}
      {hinweis && <Meldung art="hinweis">{hinweis}</Meldung>}

      <div className="karte">
        <h2>Zentrale Werte</h2>
        <div className="raster">
          {mitRueckfall.map((gs) => (
            <label key={gs}>
              Rückfallwert {GEBAEUDESTANDARDS[gs]}
              <Hilfe begriff="Rückfallwert" text={HILFE.rueckfallwert} />
              <Zahlfeld
                wert={w[`rueckfall_${gs}_w_m2` as const]}
                einheit="W/m²"
                platzhalter="Vorgabe fehlt"
                gesperrt={!darf}
                onSpeichern={werteSetzen(`rueckfall_${gs}_w_m2` as const)}
              />
            </label>
          ))}
          <div>
            <span className="feldname">
              Rückfallwert {GEBAEUDESTANDARDS.sonstiger_bestand}
              <Hilfe begriff={GEBAEUDESTANDARDS.sonstiger_bestand} text={HILFE.altbau} />
            </span>
            <small className="leise">keiner – der Fachprüfer legt die Pauschale je Raum fest</small>
          </div>
          <label>
            Hinweis „Pauschale prüfen“ ab Raumhöhe
            <Hilfe begriff="Hinweis ab Raumhöhe" text={HILFE.hinweisHoehe} />
            <Zahlfeld wert={w.hoehe_hinweis_m} einheit="m" platzhalter="kein Hinweis" gesperrt={!darf} onSpeichern={werteSetzen('hoehe_hinweis_m')} />
          </label>
          <label>
            {BEGRIFF.waermebruecken}, nur Kontrollrechnung
            <Hilfe begriff="Wärmebrückenzuschlag" text={HILFE.waermebruecken} />
            <Zahlfeld wert={w.delta_u_wb} einheit="W/(m²K)" platzhalter="Vorgabe fehlt" gesperrt={!darf} onSpeichern={werteSetzen('delta_u_wb')} />
          </label>
          <label className="ganze-breite">
            {BEGRIFF.quelle} / Festlegung
            <Hilfe begriff={BEGRIFF.quelle} text={HILFE.quelle} />
            <Textfeld wert={w.quelle} gesperrt={!darf} onSpeichern={werteSetzen('quelle')} />
          </label>
        </div>
        <small className="leise">Zuletzt geändert: {zeitpunkt(w.geaendert_am ?? null)}</small>
      </div>

      <RaumtypenKarte vorgaben={vorgaben} darf={darf} pruefen={mitVorschau} aendern={aendern} fertig={importFertig} />
      <RegelnKarte regeln={vorgaben.regeln ?? []} darf={darf} pruefen={mitVorschau} fertig={importFertig} />
      <ObjektbibliothekKarte objekte={vorgaben.objekte ?? []} raumtypen={vorgaben.raumtypen} darf={darf} pruefen={mitVorschau} fertig={importFertig} />
      <div className="karte">
        <h2>Modulkatalog</h2>
        <p>
          Gepflegt wird der Katalog auf der eigenen Seite <a href="#/module">Modulkatalog</a> (anlegen, bearbeiten, deaktivieren).
        </p>
        {darf && <ExcelTabelle name="module" titel="Modulkatalog" onFertig={importFertig} />}
      </div>
      <BibliothekKarten darf={darf} stand={stand} fertig={importFertig} />

      {darf && <CsvImport />}

      <div className="karte">
        <h2>Änderungsprotokoll der Vorgaben</h2>
        <Protokoll pfad="/fachvorgaben/protokoll" stand={stand} />
      </div>
    </section>
  );
}

type Pruefen = (anfrage: VorschauAnfrage, aktion: () => Promise<unknown>) => Promise<void>;

type Aendern = (aktion: () => Promise<unknown>) => Promise<void>;

const MIT_TABELLE = ['neubau', 'effizienzhaus_sanierung'] as const;

/** Raumtypen und Pauschalen (Praxistest J): kompakte Tabelle, alles Weitere im Dialog */
function RaumtypenKarte({
  vorgaben,
  darf,
  pruefen,
  aendern,
  fertig,
}: {
  vorgaben: Fachvorgaben;
  darf: boolean;
  pruefen: Pruefen;
  aendern: Aendern;
  fertig: (text: string) => void;
}) {
  const [bearbeiten, setBearbeiten] = useState<Raumtyp | null>(null);
  const pauschale = (t: Raumtyp, gs: string) => vorgaben.pauschalen.find((p) => p.raumtyp_id === t.id && p.gebaeudestandard === gs);
  const spalten: VSpalte<Raumtyp>[] = [
    { kopf: 'Raumtyp', wert: (t) => <strong>{t.bezeichnung}</strong>, hilfe: { begriff: 'Raumtyp', text: HILFE.raumtyp } },
    ...MIT_TABELLE.map((gs) => ({
      kopf: `${gs === 'neubau' ? 'Neubau' : 'EH-Sanierung'} (W/m²)`,
      zahl: true,
      hilfe: { begriff: GEBAEUDESTANDARDS[gs], text: HILFE_GEBAEUDESTANDARD[gs] },
      wert: (t: Raumtyp) => {
        const w = pauschale(t, gs)?.w_m2;
        const rueckfall = vorgaben.werte[`rueckfall_${gs}_w_m2` as const];
        return w !== undefined ? zahlText(w) : <span className="leise">({rueckfall === null ? 'fehlt' : zahlText(rueckfall)})</span>;
      },
    })),
    {
      kopf: 'Altbau-Richtwert (W/m²)', zahl: true, wert: (t) => zahlText(t.richtwert_altbau_w_m2),
      hilfe: { begriff: 'Richtwert Altbau', text: HILFE.richtwertAltbau },
    },
    { kopf: 'θ int (°C)', zahl: true, wert: (t) => zahlText(t.theta_int, '', 'fehlt'), hilfe: { begriff: 'Raumtemperatur', text: HILFE.raumtemperatur } },
    { kopf: 'n (1/h)', zahl: true, wert: (t) => zahlText(t.luftwechsel, '', 'fehlt'), hilfe: { begriff: 'Luftwechsel', text: HILFE.luftwechsel } },
    { kopf: 'f (–)', zahl: true, wert: (t) => zahlText(t.reduktionsfaktor, '', 'fehlt'), hilfe: { begriff: 'Korrekturfaktor', text: HILFE.korrekturfaktor } },
  ];
  return (
    <div className="karte">
      <h2>
        Raumtypen und Pauschalen
        <Hilfe begriff="Pauschale" text={HILFE.pauschale} />
      </h2>
      <p className="leise">
        In Klammern: leer → Rückfallwert des Gebäudestandards. Für „{GEBAEUDESTANDARDS.sonstiger_bestand}“ gibt es keine Tabellenwerte (nur
        Richtwert); der Fachprüfer legt die Pauschale je Raum fest. θ int, n und f nur für die Kontrollrechnung. Quelle und Bemerkung im Dialog.
      </p>
      <VTabelle
        name="Raumtypen und Pauschalen"
        spalten={spalten}
        zeilen={vorgaben.raumtypen}
        schluessel={(t) => t.id}
        aktion={setBearbeiten}
        aktionText={darf ? 'Bearbeiten' : 'Details'}
      />
      {darf && <NeuerRaumtyp aendern={aendern} />}
      {darf && <ExcelTabelle name="raumtypen" titel="Raumtypen" onFertig={fertig} />}
      {bearbeiten && <RaumtypDialog typ={bearbeiten} vorgaben={vorgaben} darf={darf} pruefen={pruefen} onSchliessen={() => setBearbeiten(null)} />}
    </div>
  );
}

function feldText(w: number | null | undefined): string {
  return w === null || w === undefined ? '' : String(w).replace('.', ',');
}

function leseFeld(t: string): number | null {
  const x = t.trim().replace(',', '.');
  return x === '' ? null : Number(x);
}

function RaumtypDialog({
  typ,
  vorgaben,
  darf,
  pruefen,
  onSchliessen,
}: {
  typ: Raumtyp;
  vorgaben: Fachvorgaben;
  darf: boolean;
  pruefen: Pruefen;
  onSchliessen: () => void;
}) {
  const p = (gs: string) => vorgaben.pauschalen.find((x) => x.raumtyp_id === typ.id && x.gebaeudestandard === gs);
  const [t, setT] = useState({
    bezeichnung: typ.bezeichnung,
    theta_int: feldText(typ.theta_int),
    luftwechsel: feldText(typ.luftwechsel),
    reduktionsfaktor: feldText(typ.reduktionsfaktor),
    richtwert_altbau_w_m2: feldText(typ.richtwert_altbau_w_m2),
    reihenfolge: String(typ.reihenfolge),
    quelle: typ.quelle,
    bemerkung: typ.bemerkung,
    neubau: feldText(p('neubau')?.w_m2),
    quelle_neubau: p('neubau')?.quelle ?? '',
    effizienzhaus_sanierung: feldText(p('effizienzhaus_sanierung')?.w_m2),
    quelle_effizienzhaus_sanierung: p('effizienzhaus_sanierung')?.quelle ?? '',
  });
  const [fehler, setFehler] = useState('');
  const feld = (k: keyof typeof t, name: string, zahl = false, breit = false) => (
    <label className={breit ? 'breit' : undefined}>
      {name}
      <input value={t[k]} disabled={!darf} inputMode={zahl ? 'decimal' : undefined} onChange={(e) => setT({ ...t, [k]: e.target.value })} />
    </label>
  );

  async function speichern() {
    const zahlen = { theta_int: leseFeld(t.theta_int), luftwechsel: leseFeld(t.luftwechsel), reduktionsfaktor: leseFeld(t.reduktionsfaktor),
      richtwert_altbau_w_m2: leseFeld(t.richtwert_altbau_w_m2), reihenfolge: leseFeld(t.reihenfolge) ?? 0 };
    if (Object.values(zahlen).some((w) => w !== null && !Number.isFinite(w))) return setFehler('Bitte Zahlen eingeben (z. B. 20 oder 0,5).');
    if (!t.bezeichnung.trim()) return setFehler('Bitte eine Bezeichnung eingeben.');
    const daten: Record<string, unknown> = { bezeichnung: t.bezeichnung.trim(), quelle: t.quelle.trim(), bemerkung: t.bemerkung, ...zahlen };
    const aenderung = Object.fromEntries(Object.entries(daten).filter(([k, v]) => v !== (typ as unknown as Record<string, unknown>)[k]));
    if (Object.keys(aenderung).length > 0) {
      await pruefen({ art: 'raumtyp_aendern', ziel: typ.id, daten: aenderung }, () => api.patch(`/fachvorgaben/raumtypen/${typ.id}`, aenderung));
    }
    for (const gs of MIT_TABELLE) {
      const w = leseFeld(t[gs]);
      if (w !== null && !Number.isFinite(w)) return setFehler('Pauschale: bitte eine Zahl eingeben.');
      const quelle = t[`quelle_${gs}`].trim();
      const alt = p(gs);
      if ((alt?.w_m2 ?? null) === w && (alt?.quelle ?? '') === quelle) continue;
      if (w !== null && !quelle) return setFehler(`Bitte die Quelle der Pauschale ${GEBAEUDESTANDARDS[gs]} angeben.`);
      const pd = { raumtyp_id: typ.id, gebaeudestandard: gs, w_m2: w, quelle };
      await pruefen({ art: 'pauschale', daten: pd }, () => api.put('/fachvorgaben/pauschalen', pd));
    }
    onSchliessen();
  }

  return (
    <Dialog titel={`Raumtyp: ${typ.bezeichnung}`} onSchliessen={onSchliessen}>
      <div className="raster">
        {feld('bezeichnung', 'Bezeichnung', false, true)}
        {feld('neubau', 'Pauschale Neubau (W/m²)', true)}
        {feld('quelle_neubau', 'Quelle Pauschale Neubau')}
        {feld('effizienzhaus_sanierung', 'Pauschale Effizienzhaus-Sanierung (W/m²)', true)}
        {feld('quelle_effizienzhaus_sanierung', 'Quelle Pauschale EH-Sanierung')}
        {feld('richtwert_altbau_w_m2', 'Richtwert Altbau (W/m², nur Orientierung)', true)}
        {feld('theta_int', `${BEGRIFF.raumtemperatur} (°C)`, true)}
        {feld('luftwechsel', `${BEGRIFF.luftwechsel} (1/h)`, true)}
        {feld('reduktionsfaktor', `${BEGRIFF.korrekturfaktor} (–)`, true)}
        {feld('reihenfolge', 'Reihenfolge', true)}
        {feld('quelle', BEGRIFF.quelle, false, true)}
        {feld('bemerkung', 'Bemerkung', false, true)}
      </div>
      <p className="leise klein-text">Leere Pauschale = Rückfallwert des Gebäudestandards.</p>
      {fehler && <Meldung>{fehler}</Meldung>}
      <div className="knopfreihe">
        {darf && (
          <button className="knopf" onClick={() => void speichern()}>
            Speichern
          </button>
        )}
        <button className="knopf-leise" onClick={onSchliessen}>
          {darf ? 'Abbrechen' : 'Schließen'}
        </button>
        {darf && (
          <button
            className="knopf-gefahr"
            onClick={() =>
              window.confirm(`Raumtyp „${typ.bezeichnung}“ löschen? Das geht nur, wenn ihn kein Projekt verwendet.`) &&
              void pruefen({ art: 'raumtyp_loeschen', ziel: typ.id }, () => api.loeschen(`/fachvorgaben/raumtypen/${typ.id}`)).then(onSchliessen)
            }
          >
            Löschen
          </button>
        )}
      </div>
    </Dialog>
  );
}

function NeuerRaumtyp({ aendern }: { aendern: Aendern }) {
  const [name, setName] = useState('');
  function absenden(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    void aendern(() => api.post('/fachvorgaben/raumtypen', { bezeichnung: name.trim() })).then(() => setName(''));
  }
  return (
    <form className="knopfreihe" onSubmit={absenden}>
      <input aria-label="Neuer Raumtyp" placeholder="Neuer Raumtyp, z. B. Wohnzimmer" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="knopf-zweit" type="submit">
        + Raumtyp
      </button>
    </form>
  );
}

/** U-Werte und Klimadaten (Bibliotheken, über ihre ID verwendet): Tabelle, Details im Dialog, Excel */
function BibliothekKarten({ darf, stand, fertig }: { darf: boolean; stand: number; fertig: (text: string) => void }) {
  const [bauteile, setBauteile] = useState<Bauteil[] | null>(null);
  const [klima, setKlima] = useState<Klimadaten[] | null>(null);
  const [details, setDetails] = useState<{ titel: string; zeilen: [string, string][] } | null>(null);
  useEffect(() => {
    api.get<Bauteil[]>('/bibliotheken/bauteile').then(setBauteile).catch(() => setBauteile([]));
    api.get<Klimadaten[]>('/bibliotheken/klimadaten').then(setKlima).catch(() => setKlima([]));
  }, [stand]);
  return (
    <>
      <div className="karte">
        <h2>U-Werte (Bauteile)</h2>
        <p className="leise">Für die Kontrollrechnung (C). Über ihre ID verwendet, nicht je Projekt eingefroren. Quelle und Bemerkung unter „Details“.</p>
        {bauteile && (
          <VTabelle
            name="U-Werte"
            zeilen={bauteile}
            schluessel={(b) => b.id}
            spalten={[
              { kopf: 'Kategorie', wert: (b) => b.kategorie },
              { kopf: 'Bezeichnung', wert: (b) => b.bezeichnung, umbruch: true },
              { kopf: 'Baualtersklasse', wert: (b) => b.baualtersklasse || '–' },
              { kopf: 'U (W/(m²K))', zahl: true, wert: (b) => zahlText(b.u_wert) },
            ]}
            aktionText="Details"
            aktion={(b) => setDetails({ titel: b.bezeichnung, zeilen: [[BEGRIFF.quelle, b.quelle], ['Bemerkung', b.bemerkung || '–']] })}
            leer="Noch keine U-Werte – per Excel-Import oder CSV anlegen."
          />
        )}
        {darf && <ExcelTabelle name="bauteile" titel="U-Werte" onFertig={fertig} />}
      </div>
      <div className="karte">
        <h2>Klimadaten (Norm-Außentemperatur)</h2>
        <p className="leise">Nach DIN/TS 12831-1, über ihre ID verwendet. Quelle unter „Details“.</p>
        {klima && (
          <VTabelle
            name="Klimadaten"
            zeilen={klima}
            schluessel={(k) => k.id}
            spalten={[
              { kopf: 'PLZ', wert: (k) => k.plz || '–' },
              { kopf: 'Ort', wert: (k) => k.ort, umbruch: true },
              { kopf: 'θe (°C)', zahl: true, wert: (k) => zahlText(k.theta_e) },
              { kopf: 'θm,e (°C)', zahl: true, wert: (k) => zahlText(k.theta_m_e) },
            ]}
            aktionText="Details"
            aktion={(k) => setDetails({ titel: `${k.plz} ${k.ort}`.trim(), zeilen: [[BEGRIFF.quelle, k.quelle]] })}
            leer="Noch keine Klimadaten – per Excel-Import oder CSV anlegen."
          />
        )}
        {darf && <ExcelTabelle name="klimadaten" titel="Klimadaten" onFertig={fertig} />}
      </div>
      {details && (
        <Dialog titel={details.titel} onSchliessen={() => setDetails(null)}>
          <dl className="details">
            {details.zeilen.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <button className="knopf-leise" onClick={() => setDetails(null)}>
            Schließen
          </button>
        </Dialog>
      )}
    </>
  );
}

function CsvImport() {
  const [art, setArt] = useState('bauteile');
  const [datei, setDatei] = useState<File | null>(null);
  const [bericht, setBericht] = useState('');
  const [fehler, setFehler] = useState('');

  async function hochladen(e: FormEvent) {
    e.preventDefault();
    if (!datei) return;
    setBericht('');
    setFehler('');
    const form = new FormData();
    form.append('datei', datei);
    try {
      const r = await api.post<{ neu: number; aktualisiert: number }>(`/bibliotheken/${art}/import`, form);
      setBericht(`Importiert: ${r.neu} neu, ${r.aktualisiert} aktualisiert.`);
    } catch (err) {
      setFehler((err as Error).message);
    }
  }

  return (
    <div className="karte">
      <h2>Bibliotheken per CSV importieren</h2>
      <p className="leise">Format siehe docs/CSV-FORMATE.md. Jede Zeile braucht eine Quelle; bei einem Fehler wird nichts importiert.</p>
      <form className="knopfreihe" onSubmit={hochladen}>
        <select value={art} onChange={(e) => setArt(e.target.value)} aria-label="Bibliothek">
          <option value="bauteile">Bauteile (U-Werte)</option>
          <option value="klimadaten">Klimadaten (Norm-Außentemperatur)</option>
          <option value="raumtypen">Raumtypen</option>
        </select>
        <input type="file" accept=".csv,text/csv" onChange={(e) => setDatei(e.target.files?.[0] ?? null)} />
        <button className="knopf-zweit" type="submit" disabled={!datei}>
          Importieren
        </button>
      </form>
      {bericht && <Meldung art="hinweis">{bericht}</Meldung>}
      {fehler && <Meldung>{fehler}</Meldung>}
    </div>
  );
}

/** Platzierungsregeln (feste Liste): Regel, Wert mit Einheit; Wert und Quelle im Dialog */
function RegelnKarte({ regeln, darf, pruefen, fertig }: { regeln: Platzierungsregel[]; darf: boolean; pruefen: Pruefen; fertig: (text: string) => void }) {
  const [bearbeiten, setBearbeiten] = useState<Platzierungsregel | null>(null);
  return (
    <div className="karte">
      <h2>
        Platzierungsregeln (Deckenmodule)
        <Hilfe begriff="Platzierungsregeln" text={HILFE.regeln} />
      </h2>
      <p className="leise">
        Projekte rechnen mit ihrem eingefrorenen Stand. Abstände und Höhen je Objekt stehen in der Objektbibliothek, die Hinweis-Raumhöhe oben
        bei den zentralen Werten. Quelle und Erläuterung im Dialog.
      </p>
      <VTabelle
        name="Platzierungsregeln"
        zeilen={regeln}
        schluessel={(r) => r.schluessel}
        spalten={[
          {
            kopf: 'Regel',
            umbruch: true,
            wert: (r) => (
              <>
                {r.bezeichnung}
                {r.schluessel === 'strahler_emissionsgrad' && <Hilfe begriff="Emissionsgrad" text={HILFE.emissionsgrad} />}
              </>
            ),
          },
          { kopf: 'Wert', zahl: true, wert: (r) => regelWertText(r) },
          { kopf: 'Einheit', wert: (r) => r.einheit },
        ]}
        aktion={setBearbeiten}
        aktionText={darf ? 'Bearbeiten' : 'Details'}
      />
      {darf && <ExcelTabelle name="regeln" titel="Platzierungsregeln" onFertig={fertig} />}
      {bearbeiten && <RegelDialog regel={bearbeiten} darf={darf} pruefen={pruefen} onSchliessen={() => setBearbeiten(null)} />}
    </div>
  );
}

const TEXTREGEL = (r: Platzierungsregel) => r.einheit === 'ja/nein' || r.einheit === 'Text' || r.einheit === 'min. Schutzart';

function regelWertText(r: Platzierungsregel): string {
  if (TEXTREGEL(r)) return r.wert_text || 'Vorgabe fehlt';
  return r.wert === null ? 'Vorgabe fehlt' : zahlText(r.wert);
}

function RegelDialog({ regel, darf, pruefen, onSchliessen }: { regel: Platzierungsregel; darf: boolean; pruefen: Pruefen; onSchliessen: () => void }) {
  const text = TEXTREGEL(regel);
  const [wert, setWert] = useState(text ? regel.wert_text : feldText(regel.wert));
  const [quelle, setQuelle] = useState(regel.quelle);
  const [fehler, setFehler] = useState('');
  async function speichern() {
    const daten: Record<string, unknown> = {};
    if (text) {
      if (wert.trim() !== regel.wert_text) daten.wert_text = wert.trim();
    } else {
      const w = leseFeld(wert);
      if (w !== null && !Number.isFinite(w)) return setFehler('Bitte eine Zahl eingeben.');
      if (regel.schluessel === 'strahler_emissionsgrad' && w !== null && !(w > 0 && w <= 1)) return setFehler('Emissionsgrad: nur Werte größer als 0 bis höchstens 1.');
      if (w !== regel.wert) daten.wert = w;
    }
    if (quelle.trim() !== regel.quelle) daten.quelle = quelle.trim();
    if (Object.keys(daten).length === 0) return onSchliessen();
    await pruefen({ art: 'regel', ziel: regel.schluessel, daten }, () => api.patch(`/fachvorgaben/regeln/${regel.schluessel}`, daten));
    onSchliessen();
  }
  return (
    <Dialog titel={regel.bezeichnung} onSchliessen={onSchliessen}>
      <div className="raster">
        <label>
          Wert{regel.einheit && ` (${regel.einheit})`}
          {regel.schluessel === 'strahler_emissionsgrad' && <Hilfe begriff="Emissionsgrad" text={HILFE.emissionsgrad} />}
          <input value={wert} disabled={!darf} placeholder="Vorgabe fehlt" inputMode={text ? undefined : 'decimal'} onChange={(e) => setWert(e.target.value)} />
        </label>
        <label className="breit">
          {BEGRIFF.quelle}
          <input value={quelle} disabled={!darf} onChange={(e) => setQuelle(e.target.value)} />
        </label>
      </div>
      {regel.erlaeuterung && <p>{regel.erlaeuterung}</p>}
      <p className="leise klein-text">Leerer Wert = „Vorgabe fehlt“ – dann prüft bzw. plant die App das nicht.</p>
      {fehler && <Meldung>{fehler}</Meldung>}
      <div className="knopfreihe">
        {darf && (
          <button className="knopf" onClick={() => void speichern()}>
            Speichern
          </button>
        )}
        <button className="knopf-leise" onClick={onSchliessen}>
          {darf ? 'Abbrechen' : 'Schließen'}
        </button>
      </div>
    </Dialog>
  );
}
