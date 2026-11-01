// Zentrale Fachvorgaben: nur für Fachprüfer und Admins sichtbar und von ihnen gepflegt (der Außendienst sieht die Seite nicht).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  api,
  hatRolle,
  type Benutzer,
  type Fachvorgaben,
  type FachvorgabenWerte,
  type Gebaeudestandard,
  type Platzierungsregel,
  type Raumtyp,
  type VorschauAnfrage,
  type VorschauErgebnis,
} from '../api';
import { BEGRIFF, GEBAEUDESTANDARDS, HILFE, HILFE_GEBAEUDESTANDARD, watt, zahl, zeitpunkt } from '../texte';
import { ObjektbibliothekKarte } from './Objektbibliothek';
import { Hilfe, Meldung, Textfeld, Zahlfeld } from './Felder';
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

      <div className="karte">
        <h2>
          Raumtypen und Pauschalen (W/m²)
          <Hilfe begriff="Pauschale" text={HILFE.pauschale} />
        </h2>
        <p className="leise">
          Leere Pauschale → Rückfallwert des Gebäudestandards. Für „{GEBAEUDESTANDARDS.sonstiger_bestand}“ gibt es keine Tabellenwerte; der
          Fachprüfer legt die Pauschale je Raum fest. Raumtemperatur, Luftwechsel und Korrekturfaktor werden nur für die Kontrollrechnung
          gebraucht.
        </p>
        <div className="tabelle-rahmen">
          <table className="tabelle vorgaben">
            <thead>
              <tr>
                <th>
                  Raumtyp
                  <Hilfe begriff="Raumtyp" text={HILFE.raumtyp} />
                </th>
                {standards.map((gs) => (
                  <th key={gs}>
                    {GEBAEUDESTANDARDS[gs]}
                    {gs === 'sonstiger_bestand' && ' – Richtwert, je Raum'}
                    <Hilfe
                      begriff={GEBAEUDESTANDARDS[gs]}
                      text={gs === 'sonstiger_bestand' ? `${HILFE_GEBAEUDESTANDARD[gs]} ${HILFE.richtwertAltbau}` : HILFE_GEBAEUDESTANDARD[gs]}
                    />
                  </th>
                ))}
                <th>
                  {BEGRIFF.raumtemperatur}
                  <Hilfe begriff="Raumtemperatur" text={HILFE.raumtemperatur} />
                </th>
                <th>
                  {BEGRIFF.luftwechsel}
                  <Hilfe begriff="Luftwechsel" text={HILFE.luftwechsel} />
                </th>
                <th>
                  {BEGRIFF.korrekturfaktor}
                  <Hilfe begriff="Korrekturfaktor angrenzender Raum" text={HILFE.korrekturfaktor} />
                </th>
                <th>
                  {BEGRIFF.quelle}
                  <Hilfe begriff={BEGRIFF.quelle} text={HILFE.quelle} />
                </th>
                {darf && <th />}
              </tr>
            </thead>
            <tbody>
              {vorgaben.raumtypen.map((t) => (
                <RaumtypZeile key={t.id} typ={t} vorgaben={vorgaben} darf={darf} pruefen={mitVorschau} />
              ))}
            </tbody>
          </table>
        </div>
        {darf && <NeuerRaumtyp aendern={aendern} />}
      </div>

      <RegelnKarte regeln={vorgaben.regeln ?? []} darf={darf} pruefen={mitVorschau} />
      <ObjektbibliothekKarte objekte={vorgaben.objekte ?? []} raumtypen={vorgaben.raumtypen} darf={darf} pruefen={mitVorschau} />
      <div className="karte">
        <h2>Modulkatalog</h2>
        <p>
          Gepflegt wird der Katalog auf der eigenen Seite <a href="#/module">Modulkatalog</a> (anlegen, jedes Feld ändern, deaktivieren, Export
          als Excel).
        </p>
      </div>

      {darf && <CsvImport />}

      <div className="karte">
        <h2>Änderungsprotokoll der Vorgaben</h2>
        <Protokoll pfad="/fachvorgaben/protokoll" stand={stand} />
      </div>
    </section>
  );
}

type Pruefen = (anfrage: VorschauAnfrage, aktion: () => Promise<unknown>) => Promise<void>;

function RaumtypZeile({
  typ,
  vorgaben,
  darf,
  pruefen,
}: {
  typ: Raumtyp;
  vorgaben: Fachvorgaben;
  darf: boolean;
  pruefen: Pruefen;
}) {
  const setzen = (feld: keyof Raumtyp) => (wert: unknown) =>
    pruefen({ art: 'raumtyp_aendern', ziel: typ.id, daten: { [feld]: wert } }, () =>
      api.patch(`/fachvorgaben/raumtypen/${typ.id}`, { [feld]: wert }),
    );
  return (
    <tr>
      <td>
        <Textfeld wert={typ.bezeichnung} pflicht gesperrt={!darf} onSpeichern={setzen('bezeichnung')} />
      </td>
      {(Object.keys(GEBAEUDESTANDARDS) as Gebaeudestandard[]).map((gs) => {
        if (gs === 'sonstiger_bestand') {
          // kein Tabellenwert: nur Richtwert als Orientierung für den Fachprüfer (Pauschale je Raum)
          return (
            <td key={gs}>
              <Zahlfeld wert={typ.richtwert_altbau_w_m2} platzhalter="Richtwert" gesperrt={!darf} onSpeichern={setzen('richtwert_altbau_w_m2')} />
            </td>
          );
        }
        const bestehend = vorgaben.pauschalen.find((p) => p.raumtyp_id === typ.id && p.gebaeudestandard === gs);
        const wert = bestehend?.w_m2 ?? null;
        const rueckfall = vorgaben.werte[`rueckfall_${gs}_w_m2` as const];
        return (
          <td key={gs}>
            <Zahlfeld
              wert={wert}
              platzhalter={rueckfall === null ? 'fehlt' : `(${zahl(rueckfall, 0)})`}
              gesperrt={!darf}
              onSpeichern={(w) => {
                // eigene Quelle der Pauschale behalten (seit dem Import je Pauschale), sonst die allgemeine
                const daten = { raumtyp_id: typ.id, gebaeudestandard: gs, w_m2: w, quelle: bestehend?.quelle || vorgaben.werte.quelle };
                return pruefen({ art: 'pauschale', daten }, () => api.put('/fachvorgaben/pauschalen', daten));
              }}
            />
          </td>
        );
      })}
      <td>
        <Zahlfeld wert={typ.theta_int} platzhalter="fehlt" gesperrt={!darf} onSpeichern={setzen('theta_int')} />
      </td>
      <td>
        <Zahlfeld wert={typ.luftwechsel} platzhalter="fehlt" gesperrt={!darf} onSpeichern={setzen('luftwechsel')} />
      </td>
      <td>
        <Zahlfeld wert={typ.reduktionsfaktor} platzhalter="fehlt" min={-1} gesperrt={!darf} onSpeichern={setzen('reduktionsfaktor')} />
      </td>
      <td>
        <Textfeld wert={typ.quelle} gesperrt={!darf} onSpeichern={setzen('quelle')} />
      </td>
      {darf && (
        <td>
          <button
            className="knopf-leise klein"
            onClick={() =>
              window.confirm(`Raumtyp „${typ.bezeichnung}“ löschen?`) &&
              pruefen({ art: 'raumtyp_loeschen', ziel: typ.id }, () => api.loeschen(`/fachvorgaben/raumtypen/${typ.id}`))
            }
          >
            Löschen
          </button>
        </td>
      )}
    </tr>
  );
}

function NeuerRaumtyp({ aendern }: { aendern: (a: () => Promise<unknown>) => Promise<void> }) {
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

function RegelnKarte({
  regeln,
  darf,
  pruefen,
}: {
  regeln: Platzierungsregel[];
  darf: boolean;
  pruefen: Pruefen;
}) {
  const setzen = (schluessel: string, feld: 'wert' | 'wert_text' | 'quelle') => (wert: unknown) =>
    pruefen({ art: 'regel', ziel: schluessel, daten: { [feld]: wert } }, () =>
      api.patch(`/fachvorgaben/regeln/${schluessel}`, { [feld]: wert }),
    );
  return (
    <div className="karte">
      <h2>
        Platzierungsregeln (Deckenmodule)
        <Hilfe begriff="Platzierungsregeln" text={HILFE.regeln} />
      </h2>
      <p className="leise">
        Projekte rechnen mit ihrem eingefrorenen Stand; geänderte Regeln erscheinen dort als Unterschied. Die Hinweis-Raumhöhe steht oben bei
        den zentralen Werten.
      </p>
      <div className="tabelle-rahmen">
        <table className="tabelle vorgaben">
          <thead>
            <tr>
              <th>Regel</th>
              <th>Wert</th>
              <th>Einheit</th>
              <th>
                {BEGRIFF.quelle}
                <Hilfe begriff={BEGRIFF.quelle} text={HILFE.quelle} />
              </th>
            </tr>
          </thead>
          <tbody>
            {regeln.map((r) => (
              <tr key={r.schluessel}>
                <td>
                  {r.bezeichnung}
                  {r.erlaeuterung && <Hilfe begriff={r.bezeichnung} text={r.erlaeuterung} />}
                </td>
                <td>
                  {r.einheit === 'ja/nein' || r.einheit === 'Text' || r.einheit === 'min. Schutzart' ? (
                    <Textfeld wert={r.wert_text} platzhalter="Vorgabe fehlt" gesperrt={!darf} onSpeichern={setzen(r.schluessel, 'wert_text')} />
                  ) : (
                    <Zahlfeld wert={r.wert} platzhalter="Vorgabe fehlt" gesperrt={!darf} onSpeichern={setzen(r.schluessel, 'wert')} />
                  )}
                </td>
                <td>{r.einheit}</td>
                <td>
                  <Textfeld wert={r.quelle} gesperrt={!darf} onSpeichern={setzen(r.schluessel, 'quelle')} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
