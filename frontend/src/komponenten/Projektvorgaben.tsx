// Abweichungen dieses Projekts von den zentralen Fachvorgaben und Klimadaten des Gebäudes.
import { useEffect, useState } from 'react';
import { api, type Fachvorgaben, type Klimadaten, type Objekt } from '../api';
import { GEBAEUDESTANDARDS, zahl } from '../texte';
import { Meldung, Zahlfeld } from './Felder';

type Aendern = (aktion: () => Promise<unknown>) => Promise<void>;

interface Props {
  objekt: Objekt;
  vorgaben: Fachvorgaben;
  gesperrt: boolean;
  aendern: Aendern;
  stand: number;
}

function zentral(wert: number | null, einheit: string, stellen = 2): string {
  return wert === null ? 'Vorgabe fehlt' : `${zahl(wert, stellen)} ${einheit}`;
}

export function Projektvorgaben({ objekt, vorgaben, gesperrt, aendern }: Props) {
  const v = vorgaben.werte;
  const gs = objekt.gebaeudestandard;
  const rueckfall = v[`rueckfall_${gs}_w_m2` as const];
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
        Leere Felder = zentrale Fachvorgabe gilt. Eingetragene Projektwerte sind Abweichungen und werden in der Raumliste als „Projektwert“
        gekennzeichnet.
      </Meldung>

      <div className="karte">
        <h2>Allgemein</h2>
        <table className="tabelle schmal">
          <thead>
            <tr>
              <th>Vorgabe</th>
              <th>zentral</th>
              <th>dieses Projekt</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Höhenzuschlag ab Raumhöhe</td>
              <td>{zentral(v.hoehenzuschlag_grenzhoehe_m, 'm')}</td>
              <td>
                <Zahlfeld wert={objekt.hoehenzuschlag_grenzhoehe_m} einheit="m" hervorheben={objekt.hoehenzuschlag_grenzhoehe_m !== null} gesperrt={gesperrt} onSpeichern={setzen('hoehenzuschlag_grenzhoehe_m')} />
              </td>
            </tr>
            <tr>
              <td>Höhenzuschlag je Meter Mehrhöhe</td>
              <td>{zentral(v.hoehenzuschlag_prozent_je_m, '%/m', 1)}</td>
              <td>
                <Zahlfeld wert={objekt.hoehenzuschlag_prozent_je_m} einheit="%/m" hervorheben={objekt.hoehenzuschlag_prozent_je_m !== null} gesperrt={gesperrt} onSpeichern={setzen('hoehenzuschlag_prozent_je_m')} />
              </td>
            </tr>
            <tr>
              <td>Wärmebrückenzuschlag ΔU_WB (für C)</td>
              <td>{zentral(v.delta_u_wb, 'W/(m²K)')}</td>
              <td>
                <Zahlfeld wert={objekt.delta_u_wb} einheit="W/(m²K)" hervorheben={objekt.delta_u_wb !== null} gesperrt={gesperrt} onSpeichern={setzen('delta_u_wb')} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="karte">
        <h2>Heizlast-Pauschalen ({GEBAEUDESTANDARDS[gs]})</h2>
        {vorgaben.raumtypen.length === 0 && <p className="leise">Noch keine Raumtypen gepflegt.</p>}
        <table className="tabelle schmal">
          <thead>
            <tr>
              <th>Raumtyp</th>
              <th>zentral</th>
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
                    <Zahlfeld wert={eigener} einheit="W/m²" hervorheben={eigener !== null} gesperrt={gesperrt} onSpeichern={(w) => pauschaleSetzen(t.id, w)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
      <h2>Klimadaten (für Gegenprobe C)</h2>
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
