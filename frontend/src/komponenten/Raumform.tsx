// Raumform aus Rechtecken (Paket M2, 02.11.2026): Hauptrechteck aus der Schnellerfassung (Länge × Breite) plus
// Anbauten bzw. minus Ausschnitte – je Teil Wand, Versatz entlang der Wand, Länge und Tiefe. Vorlagen: Rechteck,
// L-Form, U-Form, Erker. Fläche, Umfang und alle Prüfungen rechnet der Rechenkern auf der Form.
import { raumform, type RaumTeil, type Wand } from '@infrarot/rechenkern';
import { useState } from 'react';
import type { Raum } from '../api';
import { neuesTeil, VORLAGEN, vorlageTeile, type Vorlage } from '../raumvorlagen';
import { zahl } from '../texte';
import { Hilfe, Meldung, Zahlfeld } from './Felder';

const WAND: Record<Wand, string> = { oben: 'oben', rechts: 'rechts', unten: 'unten', links: 'links' };

export function Raumform({ raum, gesperrt, speichern }: { raum: Raum; gesperrt: boolean; speichern: (daten: Partial<Raum>) => Promise<void> }) {
  const [offen, setOffen] = useState((raum.geometrie?.teile ?? []).length > 0);
  const w = raum.laenge_m ?? 0;
  const h = raum.breite_m ?? 0;
  const teile = raum.geometrie?.teile ?? [];
  if (w <= 0 || h <= 0) return null;
  const form = raumform({ basis: { w, h }, teile });

  function setzen(neu: RaumTeil[]) {
    const f = raumform({ basis: { w, h }, teile: neu });
    if (f.umriss.length !== 1) {
      window.alert('Diese Teile würden den Raum in mehrere Stücke teilen – bitte Maße prüfen.');
      return;
    }
    void speichern({ geometrie: { basis: { w, h }, teile: neu }, flaeche_m2: f.flaeche_m2 });
  }
  const aendern = (i: number, teil: Partial<RaumTeil>) => setzen(teile.map((t, n) => (n === i ? { ...t, ...teil } : t)));

  if (!offen) {
    return (
      <div className="raumform-zu">
        <button className="knopf-leise klein" disabled={gesperrt} onClick={() => setOffen(true)}>
          Raumform ändern (L, U, Erker …)
        </button>
      </div>
    );
  }
  return (
    <div className="raumform">
      <span className="feldname">
        Raumform
        <Hilfe
          begriff="Raumform"
          text="Hauptrechteck = Länge × Breite. Anbau: Rechteck außen an einer Wand; Ausschnitt: Rechteck von einer Wand nach innen. Versatz = Abstand vom Wandanfang (oben/unten von links, links/rechts von oben). Fläche und Wandabstände rechnet die App auf der ganzen Form."
        />
      </span>
      <div className="knopfreihe">
        {(Object.keys(VORLAGEN) as Vorlage[]).map((v) => (
          <button key={v} className="knopf-leise klein" disabled={gesperrt} onClick={() => setzen(vorlageTeile(v, w, h))}>
            {VORLAGEN[v]}
          </button>
        ))}
      </div>
      {teile.map((t, i) => (
        <div key={i} className="raumteil">
          <strong>{t.op === 'add' ? 'Anbau' : 'Ausschnitt'}</strong>
          <label className="inline">
            Wand
            <select value={t.wand} disabled={gesperrt} onChange={(e) => aendern(i, { wand: e.target.value as Wand })}>
              {(Object.keys(WAND) as Wand[]).map((x) => (
                <option key={x} value={x}>
                  {WAND[x]}
                </option>
              ))}
            </select>
          </label>
          {(['versatz', 'laenge', 'tiefe'] as const).map((f) => (
            <label key={f} className="inline">
              {f === 'versatz' ? 'Versatz' : f === 'laenge' ? 'Länge' : 'Tiefe'}
              <Zahlfeld
                wert={t[f]}
                einheit="m"
                min={f === 'versatz' ? 0 : 0.05}
                gesperrt={gesperrt}
                beschriftung={`${t.op === 'add' ? 'Anbau' : 'Ausschnitt'} ${i + 1}: ${f}`}
                onSpeichern={(v) => {
                  if (v !== null) aendern(i, { [f]: v });
                }}
              />
            </label>
          ))}
          <button className="knopf-leise klein" disabled={gesperrt} onClick={() => setzen(teile.filter((_, n) => n !== i))}>
            Entfernen
          </button>
        </div>
      ))}
      <div className="knopfreihe">
        <button className="knopf-zweit" disabled={gesperrt || teile.length >= 12} onClick={() => setzen([...teile, neuesTeil('add', w, h)])}>
          + Anbau hinzufügen
        </button>
        <button className="knopf-zweit" disabled={gesperrt || teile.length >= 12} onClick={() => setzen([...teile, neuesTeil('sub', w, h)])}>
          − Ausschnitt abziehen
        </button>
      </div>
      <small>
        Fläche {zahl(form.flaeche_m2)} m² · Umfang {zahl(form.umfang_m)} m · {form.segmente.length} Wandsegmente
      </small>
      {!form.rechteck && form.flaeche_m2 <= 0 && <Meldung>Die Teile lassen keine Fläche übrig.</Meldung>}
    </div>
  );
}
