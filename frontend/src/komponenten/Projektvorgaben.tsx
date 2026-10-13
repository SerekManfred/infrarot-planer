// Abweichungen dieses Projekts von seinen Fachvorgaben und Klimadaten des Gebäudes.
// „Vorgabe“ meint hier den im Projekt eingefrorenen Stand der Fachvorgaben (siehe VorgabenStand in Projekt.tsx).
import { useEffect, useState } from 'react';
import { api, type Fachvorgaben, type Klimadaten, type Objekt } from '../api';
import { BEGRIFF, GEBAEUDESTANDARDS, HILFE, zahl } from '../texte';
import { Hilfe, Meldung, Zahlfeld } from './Felder';

type Aendern = (aktion: () => Promise<unknown>) => Promise<void>;

interface Props {
  objekt: Objekt;
  vorgaben: Fachvorgaben;
  gesperrt: boolean;
  /** W/m²-Pauschalen des Projekts setzt nur die Rolle Fachprüfer */
  pauschaleGesperrt: boolean;
  aendern: Aendern;
  stand: number;
}

function zentral(wert: number | null, einheit: string, stellen = 2): string {
  return wert === null ? 'Vorgabe fehlt' : `${zahl(wert, stellen)} ${einheit}`;
}

export function Projektvorgaben({ objekt, vorgaben, gesperrt, pauschaleGesperrt, aendern }: Props) {
  const v = vorgaben.werte;
  const gs = objekt.gebaeudestandard;
  const rueckfall = gs === 'sonstiger_bestand' ? null : v[`rueckfall_${gs}_w_m2` as const];
  const setzen = (feld: keyof Objekt) => (wert: unknown) => aendern(() => api.patch(`/objekte/${objekt.id}`, { [feld]: wert }));

  function pauschaleSetzen(raumtypId: number, wert: number | null) {
    const neu = { ...objekt.pauschale_abweichungen };
    if (wert === null) delete neu[String(raumtypId)];
    else neu[String(raumtypId)] = wert;
    return setzen('pauschale_abweichungen')(neu);
  }

  return (
    <div>
      <Meldung art="hinweis">
        Leere Felder = Fachvorgabe des Projekts gilt. Eingetragene Projektwerte sind Abweichungen und werden in der Raumliste als
        „Projektwert“ gekennzeichnet.
      </Meldung>

      <div className="karte">
        <h2>Allgemein</h2>
        <table className="tabelle schmal">
          <thead>
            <tr>
              <th>Vorgabe</th>
              <th>Vorgabe</th>
              <th>dieses Projekt</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Hinweis „Pauschale prüfen“ ab Raumhöhe (kein Zuschlag)
                <Hilfe begriff="Hinweis ab Raumhöhe" text={HILFE.hinweisHoehe} />
              </td>
              <td>{zentral(v.hoehe_hinweis_m, 'm')}</td>
              <td className="leise">–</td>
            </tr>
            <tr>
              <td>
                {BEGRIFF.waermebruecken}, nur Kontrollrechnung
                <Hilfe begriff="Wärmebrückenzuschlag" text={HILFE.waermebruecken} />
              </td>
              <td>{zentral(v.delta_u_wb, 'W/(m²K)')}</td>
              <td>
                <Zahlfeld wert={objekt.delta_u_wb} einheit="W/(m²K)" hervorheben={objekt.delta_u_wb !== null} gesperrt={gesperrt} onSpeichern={setzen('delta_u_wb')} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {gs === 'sonstiger_bestand' ? (
        <div className="karte">
          <h2>Heizlast-Pauschalen ({GEBAEUDESTANDARDS[gs]})</h2>
          <p>
            Für „{GEBAEUDESTANDARDS.sonstiger_bestand}“ gibt es keine Tabellen- oder Rückfallwerte. Der Fachprüfer legt die Pauschale in W/m²
            bei jedem Raum fest (Pflicht).
            <Hilfe begriff={GEBAEUDESTANDARDS.sonstiger_bestand} text={HILFE.altbau} />
          </p>
        </div>
      ) : (
      <div className="karte">
        <h2>
          Heizlast-Pauschalen ({GEBAEUDESTANDARDS[gs]})
          <Hilfe begriff="Pauschale" text={HILFE.pauschale} />
        </h2>
        {vorgaben.raumtypen.length === 0 && <p className="leise">Noch keine Raumtypen gepflegt – es gilt der Rückfallwert.</p>}
        <table className="tabelle schmal">
          <thead>
            <tr>
              <th>Raumtyp</th>
              <th>Vorgabe</th>
              <th>dieses Projekt</th>
            </tr>
          </thead>
          <tbody>
            {vorgaben.raumtypen.map((t) => {
              const tabellenwert = vorgaben.pauschalen.find((p) => p.raumtyp_id === t.id && p.gebaeudestandard === gs)?.w_m2 ?? null;
              const eigener = objekt.pauschale_abweichungen[String(t.id)] ?? null;
              return (
                <tr key={t.id}>
                  <td>{t.bezeichnung}</td>
                  <td>
                    {tabellenwert !== null
                      ? `${zahl(tabellenwert, 0)} W/m²`
                      : rueckfall !== null
                        ? `${zahl(rueckfall, 0)} W/m² (Rückfallwert)`
                        : 'Vorgabe fehlt'}
                  </td>
                  <td>
                    <Zahlfeld wert={eigener} einheit="W/m²" hervorheben={eigener !== null} gesperrt={pauschaleGesperrt} onSpeichern={(w) => pauschaleSetzen(t.id, w)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      <KlimadatenWahl objekt={objekt} gesperrt={gesperrt} onWahl={setzen('klimadaten_id')} />
    </div>
  );
}

function KlimadatenWahl({ objekt, gesperrt, onWahl }: { objekt: Objekt; gesperrt: boolean; onWahl: (id: number | null) => void }) {
  const [plz, setPlz] = useState(objekt.plz);
  const [treffer, setTreffer] = useState<Klimadaten[]>([]);
  const [aktuell, setAktuell] = useState<Klimadaten | null>(null);

  useEffect(() => {
    if (objekt.klimadaten_id === null) return setAktuell(null);
    api.get<Klimadaten[]>('/bibliotheken/klimadaten').then((alle) => setAktuell(alle.find((k) => k.id === objekt.klimadaten_id) ?? null));
  }, [objekt.klimadaten_id]);

  async function suchen() {
    setTreffer(await api.get<Klimadaten[]>(`/bibliotheken/klimadaten?plz=${encodeURIComponent(plz.trim())}`));
  }

  return (
    <div className="karte">
      <h2>
        Klimadaten (nur Kontrollrechnung)
        <Hilfe begriff="Klimadaten" text={HILFE.klimadaten} />
      </h2>
      <p>
        {aktuell
          ? `${aktuell.plz} ${aktuell.ort}: Norm-Außentemperatur ${zahl(aktuell.theta_e, 1)} °C`
          : 'Keine Klimadaten zugeordnet – Quelle C ist so nicht möglich.'}
      </p>
      {!gesperrt && (
        <div className="knopfreihe">
          <input aria-label="Postleitzahl" inputMode="numeric" placeholder="PLZ" value={plz} onChange={(e) => setPlz(e.target.value)} />
          <button className="knopf-zweit" onClick={suchen} disabled={!plz.trim()}>
            Suchen
          </button>
          {treffer.map((k) => (
            <button key={k.id} className="knopf-leise" onClick={() => onWahl(k.id)}>
              {k.plz} {k.ort} ({zahl(k.theta_e, 1)} °C)
            </button>
          ))}
          {treffer.length === 0 && plz && <small className="leise">Bibliothek leer oder PLZ nicht gefunden? Import unter „Fachvorgaben“.</small>}
        </div>
      )}
    </div>
  );
}
