import { useEffect, useState } from 'react';
import { api, type ProtokollEintrag } from '../api';
import { zeitpunkt } from '../texte';
import { Meldung } from './Felder';

const OBJEKTART: Record<string, string> = {
  Projekt: 'Projekt',
  Objekt: 'Gebäude',
  Geschoss: 'Geschoss',
  Raum: 'Raum',
  Bauteilflaeche: 'Bauteilfläche',
  Oeffnung: 'Öffnung',
  Berechnung: 'Berechnung',
  Fachvorgaben: 'Fachvorgaben',
  BibRaumtyp: 'Raumtyp',
  HeizlastPauschale: 'Pauschale',
  BibBauteil: 'Bauteil',
  BibKlimadaten: 'Klimadaten',
  Benutzer: 'Benutzer',
};
const AKTION = { angelegt: 'angelegt', geaendert: 'geändert', geloescht: 'gelöscht' };

function wert(w: unknown): string {
  if (w === null || w === undefined || w === '') return '–';
  if (typeof w === 'number') return String(w).replace('.', ',');
  if (typeof w === 'object') return JSON.stringify(w);
  return String(w);
}

function beschreibung(e: ProtokollEintrag): string {
  return Object.entries(e.aenderungen)
    .map(([feld, w]) => {
      const name = feld.replace(/_/g, ' ');
      return e.aktion === 'geaendert' && Array.isArray(w) && w.length === 2 ? `${name}: ${wert(w[0])} → ${wert(w[1])}` : `${name}: ${wert(w)}`;
    })
    .join(' · ');
}

export function Protokoll({ pfad, stand }: { pfad: string; stand: number }) {
  const [eintraege, setEintraege] = useState<ProtokollEintrag[] | null>(null);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    api.get<ProtokollEintrag[]>(pfad).then(setEintraege).catch((e) => setFehler(e.message));
  }, [pfad, stand]);

  if (fehler) return <Meldung>{fehler}</Meldung>;
  if (!eintraege) return <p>Wird geladen …</p>;
  if (eintraege.length === 0) return <p className="leise">Noch keine Einträge.</p>;
  return (
    <div className="tabelle-rahmen">
      <table className="tabelle protokoll">
        <thead>
          <tr>
            <th>Zeit</th>
            <th>Benutzer</th>
            <th>Was</th>
            <th>Änderung</th>
          </tr>
        </thead>
        <tbody>
          {eintraege.map((e) => (
            <tr key={e.id}>
              <td>{zeitpunkt(e.zeitpunkt)}</td>
              <td>{e.benutzer_name}</td>
              <td>
                {OBJEKTART[e.objektart] ?? e.objektart} {AKTION[e.aktion]}
              </td>
              <td className="aenderung">{beschreibung(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
