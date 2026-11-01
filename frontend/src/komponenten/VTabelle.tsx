// Einheitliche Tabelle der Fachvorgaben (Praxistest J, 01.11.2026): kurze Überschriften mit Einheit, Zahlen rechtsbündig,
// fixierte Kopfzeile in eigenem Scrollbereich, kontrastreiche Schrift; am Tablet/Handy als Kartenansicht (CSS).
// Selten gebrauchte Felder (Quelle, Bemerkung …) stehen nicht in der Tabelle, sondern im Bearbeiten-Dialog.
import { Fragment, type ReactNode } from 'react';
import { Hilfe } from './Felder';

export interface VSpalte<T> {
  kopf: string;
  wert: (zeile: T) => ReactNode;
  zahl?: boolean;
  hilfe?: { begriff: string; text: string };
  /** darf umbrechen (lange Texte) */
  umbruch?: boolean;
}

export function VTabelle<T>({
  spalten,
  zeilen,
  schluessel,
  gruppe,
  inaktiv,
  aktion,
  aktionText = 'Bearbeiten',
  leer = 'Noch keine Einträge.',
  name,
}: {
  spalten: VSpalte<T>[];
  zeilen: T[];
  schluessel: (z: T) => string | number;
  gruppe?: (z: T) => string;
  inaktiv?: (z: T) => boolean;
  /** Knopf je Zeile (z. B. Bearbeiten / Details) */
  aktion?: (z: T) => void;
  aktionText?: string;
  leer?: string;
  /** Bezeichnung für Bildschirmleser */
  name: string;
}) {
  if (zeilen.length === 0) return <p className="leise">{leer}</p>;
  const breite = spalten.length + (aktion ? 1 : 0);
  let letzteGruppe: string | null = null;
  return (
    <div className="vtabelle-rahmen">
      <table className="vtabelle" aria-label={name}>
        <thead>
          <tr>
            {spalten.map((s) => (
              <th key={s.kopf} className={s.zahl ? 'zahl' : undefined}>
                {s.kopf}
                {s.hilfe && <Hilfe begriff={s.hilfe.begriff} text={s.hilfe.text} />}
              </th>
            ))}
            {aktion && <th aria-label={aktionText} />}
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z) => {
            const g = gruppe?.(z) ?? null;
            const kopfzeile = g !== null && g !== letzteGruppe;
            letzteGruppe = g;
            return (
              <Fragment key={schluessel(z)}>
                {kopfzeile && (
                  <tr className="gruppenzeile">
                    <th colSpan={breite}>{g}</th>
                  </tr>
                )}
                <tr className={inaktiv?.(z) ? 'inaktiv' : undefined}>
                  {spalten.map((s) => (
                    <td key={s.kopf} data-label={s.kopf} className={[s.zahl ? 'zahl' : '', s.umbruch ? 'umbruch' : ''].join(' ').trim() || undefined}>
                      {s.wert(z)}
                    </td>
                  ))}
                  {aktion && (
                    <td className="aktionen">
                      <button className="knopf-leise klein" onClick={() => aktion(z)}>
                        {aktionText}
                      </button>
                    </td>
                  )}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Zahl deutsch, ohne unnötige Nachkommastellen; leer → Ersatztext */
export function zahlText(w: number | null | undefined, einheit = '', leer = '–'): string {
  if (w === null || w === undefined) return leer;
  return `${w.toLocaleString('de-DE', { maximumFractionDigits: 3 })}${einheit}`;
}
