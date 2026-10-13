// Zentrale Fachvorgaben: nur für Fachprüfer und Admins sichtbar und von ihnen gepflegt (der Außendienst sieht die Seite nicht).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, hatRolle, type Benutzer, type Fachvorgaben, type FachvorgabenWerte, type Gebaeudestandard, type Raumtyp } from '../api';
import { BEGRIFF, GEBAEUDESTANDARDS, HILFE, HILFE_GEBAEUDESTANDARD, zahl, zeitpunkt } from '../texte';
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
  const werteSetzen = (feld: keyof FachvorgabenWerte) => (wert: unknown) =>
    aendern(() => {
      const { geaendert_am: _, ...rest } = w;
      return api.put('/fachvorgaben/werte', { ...rest, [feld]: wert });
    });
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
                    <Hilfe begriff={GEBAEUDESTANDARDS[gs]} text={HILFE_GEBAEUDESTANDARD[gs]} />
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
                <RaumtypZeile key={t.id} typ={t} vorgaben={vorgaben} darf={darf} aendern={aendern} />
              ))}
            </tbody>
          </table>
        </div>
        {darf && <NeuerRaumtyp aendern={aendern} />}
      </div>

      {darf && <CsvImport />}

      <div className="karte">
        <h2>Änderungsprotokoll der Vorgaben</h2>
        <Protokoll pfad="/fachvorgaben/protokoll" stand={stand} />
      </div>
    </section>
  );
}

function RaumtypZeile({
  typ,
  vorgaben,
  darf,
  aendern,
}: {
  typ: Raumtyp;
  vorgaben: Fachvorgaben;
  darf: boolean;
  aendern: (a: () => Promise<unknown>) => Promise<void>;
}) {
  const setzen = (feld: keyof Raumtyp) => (wert: unknown) => aendern(() => api.patch(`/fachvorgaben/raumtypen/${typ.id}`, { [feld]: wert }));
  return (
    <tr>
      <td>
        <Textfeld wert={typ.bezeichnung} pflicht gesperrt={!darf} onSpeichern={setzen('bezeichnung')} />
      </td>
      {(Object.keys(GEBAEUDESTANDARDS) as Gebaeudestandard[]).map((gs) => {
        if (gs === 'sonstiger_bestand') {
          return (
            <td key={gs} className="leise">
              je Raum
            </td>
          );
        }
        const wert = vorgaben.pauschalen.find((p) => p.raumtyp_id === typ.id && p.gebaeudestandard === gs)?.w_m2 ?? null;
        const rueckfall = vorgaben.werte[`rueckfall_${gs}_w_m2` as const];
        return (
          <td key={gs}>
            <Zahlfeld
              wert={wert}
              platzhalter={rueckfall === null ? 'fehlt' : `(${zahl(rueckfall, 0)})`}
              gesperrt={!darf}
              onSpeichern={(w) =>
                aendern(() => api.put('/fachvorgaben/pauschalen', { raumtyp_id: typ.id, gebaeudestandard: gs, w_m2: w, quelle: vorgaben.werte.quelle }))
              }
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
            onClick={() => window.confirm(`Raumtyp „${typ.bezeichnung}“ löschen?`) && aendern(() => api.loeschen(`/fachvorgaben/raumtypen/${typ.id}`))}
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
