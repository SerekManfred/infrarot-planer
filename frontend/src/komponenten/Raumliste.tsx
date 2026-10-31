// Raumliste: alle Räume mit Heizlast, Modulen (Typ, Anzahl), installierter Leistung und Thermostaten.
// Rechnet wie die Raumkarten über die Auswertung (Server bzw. offline der Rechenkern auf dem Gerät).
// Angebot und PDF-Platzierungsplan folgen in Teil E.
import { useEffect, useState } from 'react';
import { api, type Auswertung, type Objekt } from '../api';
import { HILFE, watt, zahl } from '../texte';
import { Hilfe, Meldung } from './Felder';

export function Raumliste({ objekt, stand }: { objekt: Objekt; stand: number }) {
  const [auswertung, setAuswertung] = useState<Auswertung | null>(null);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    api.get<Auswertung>(`/objekte/${objekt.id}/auswertung`).then(setAuswertung).catch((e) => setFehler((e as Error).message));
  }, [objekt.id, stand]);

  if (fehler) return <Meldung>{fehler}</Meldung>;
  if (!auswertung) return <p>Wird geladen …</p>;
  if (auswertung.raeume.length === 0) return <p className="leise">Noch keine Räume erfasst.</p>;
  const { summe } = auswertung;

  return (
    <div className="karte">
      <h2>
        Raumliste
        <Hilfe begriff="Raumliste" text={HILFE.raumliste} />
      </h2>
      <div className="tabelle-rahmen">
        <table className="tabelle">
          <thead>
            <tr>
              <th>Geschoss</th>
              <th>Raum</th>
              <th>Raumtyp</th>
              <th className="zahl">Fläche</th>
              <th className="zahl">Heizlast</th>
              <th className="zahl">benötigt</th>
              <th>Module</th>
              <th className="zahl">installiert</th>
              <th className="zahl">Thermostat</th>
              <th>Prüfung</th>
            </tr>
          </thead>
          <tbody>
            {auswertung.raeume.map((r) => {
              const m = r.modulplanung;
              return (
                <tr key={r.raum_id} className={m.module_mit_verstoss > 0 || m.leistung === 'unter' ? 'verstoss' : ''}>
                  <td>{r.geschoss}</td>
                  <td>{r.bezeichnung}</td>
                  <td>{r.raumtyp ?? '–'}</td>
                  <td className="zahl">{r.flaeche_m2 === null ? '–' : `${zahl(r.flaeche_m2)} m²`}</td>
                  <td className="zahl">{watt(r.phi_massgeblich_w)}</td>
                  <td className="zahl">{watt(m.benoetigt_w)}</td>
                  <td>{m.anzahl === 0 ? '–' : m.typen.map((t) => `${t.anzahl} × ${t.artikel_nr} (${t.leistung_w} W)`).join(', ')}</td>
                  <td className="zahl">{m.anzahl === 0 ? '–' : watt(m.installiert_w)}</td>
                  <td className="zahl">{m.thermostate}</td>
                  <td>
                    {m.anzahl === 0
                      ? 'noch nicht geplant'
                      : m.module_mit_verstoss > 0
                        ? `${m.module_mit_verstoss} Modul${m.module_mit_verstoss === 1 ? '' : 'e'} mit Regelverstoß`
                        : m.leistung === 'unter'
                          ? `Unterdimensioniert: ${watt(m.installiert_w)} < ${watt(m.benoetigt_w)}`
                          : m.leistung === 'ueber'
                            ? `Überdimensioniert (${m.leistung_hinweis?.replace(/^.* um /, 'um ')})`
                            : 'in Ordnung'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={4}>Summe</th>
              <th className="zahl">{watt(summe.phi_massgeblich_w)}</th>
              <th />
              <th>{summe.module} Module</th>
              <th className="zahl">{watt(summe.installiert_w)}</th>
              <th className="zahl">{summe.thermostate}</th>
              <th />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="leise klein-text">Angebot und PDF-Platzierungsplan folgen in einem späteren Schritt.</p>
    </div>
  );
}
