// Sammelansicht für Fachprüfer (Festlegung 18.10.2026): alle Projekte, die nach geänderten Fachvorgaben auf eine
// Entscheidung warten – mit Heizlast vorher/nachher und neuen Regelverstößen. Mehrfachauswahl, dann für die
// ausgewählten übernehmen oder bewusst ablehnen (je Projekt protokolliert wie die Einzelentscheidung).
import { useCallback, useEffect, useState } from 'react';
import { api, type AbgleichProjekt } from '../api';
import { HILFE, STATUS, watt } from '../texte';
import { Hilfe, Meldung } from './Felder';

interface SammelErgebnis {
  projekt_id: number;
  ok: boolean;
  meldung: string;
}

/** Ein Projekt kann wegen Fachvorgaben und wegen Moduldaten warten – je Anlass eine Zeile */
const schluessel = (p: AbgleichProjekt) => `${p.art}:${p.projekt_id}`;

export function AbgleichSeite() {
  const [liste, setListe] = useState<AbgleichProjekt[] | null>(null);
  // Auswahl je Projekt und Anlass („vorgaben:12“, „module:12“)
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set());
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  const [bericht, setBericht] = useState<{ text: string; fehler: string[] } | null>(null);

  const laden = useCallback(() => {
    setListe(null);
    api
      .get<AbgleichProjekt[]>('/fachvorgaben/abgleich')
      .then((l) => {
        setListe(l);
        setAuswahl((alt) => new Set([...alt].filter((k) => l.some((p) => schluessel(p) === k))));
      })
      .catch((e) => setFehler((e as Error).message));
  }, []);
  useEffect(laden, [laden]);

  async function entscheiden(aktion: 'uebernehmen' | 'ablehnen') {
    const gewaehlt = (liste ?? []).filter((p) => auswahl.has(schluessel(p)));
    const ids = gewaehlt.map((p) => p.projekt_id);
    let bemerkung = '';
    if (aktion === 'ablehnen') {
      const eingabe = window.prompt(
        `Neue Vorgaben für ${ids.length} Projekt(e) ablehnen? Sie rechnen weiter mit ihrem bisherigen Stand.\n\nBegründung (optional, wird je Projekt protokolliert):`,
        '',
      );
      if (eingabe === null) return;
      bemerkung = eingabe.trim();
    } else if (!window.confirm(`Neue Vorgaben in ${ids.length} Projekt(e) übernehmen? Die Heizlast wird neu berechnet; geprüfte Projekte fallen auf „Vor-Ort-Entwurf“ zurück.`)) {
      return;
    }
    setLaeuft(true);
    setFehler('');
    try {
      // je Anlass eine Anfrage (Fachvorgaben bzw. Moduldaten)
      const ergebnis: SammelErgebnis[] = [];
      for (const art of ['vorgaben', 'module'] as const) {
        const projektIds = gewaehlt.filter((p) => p.art === art).map((p) => p.projekt_id);
        if (projektIds.length) ergebnis.push(...(await api.post<SammelErgebnis[]>('/fachvorgaben/abgleich', { aktion, art, projekt_ids: projektIds, bemerkung })));
      }
      const ok = ergebnis.filter((e) => e.ok).length;
      const namen = new Map((liste ?? []).map((p) => [p.projekt_id, `${p.nummer} ${p.bezeichnung}`]));
      setBericht({
        text: `${ok} von ${ids.length} Projekt(en) ${aktion === 'uebernehmen' ? 'übernommen' : 'abgelehnt'}.`,
        fehler: ergebnis.filter((e) => !e.ok).map((e) => `${namen.get(e.projekt_id) ?? e.projekt_id}: ${e.meldung}`),
      });
    } catch (e) {
      setFehler((e as Error).message);
    } finally {
      setLaeuft(false);
      laden();
    }
  }

  const alle = liste !== null && liste.length > 0 && liste.every((p) => auswahl.has(schluessel(p)));
  const umschalten = (k: string) =>
    setAuswahl((alt) => {
      const neu = new Set(alt);
      if (neu.has(k)) neu.delete(k);
      else neu.add(k);
      return neu;
    });

  return (
    <section>
      <h1>
        Vorgaben-Abgleich
        <Hilfe begriff="Vorgaben-Abgleich" text={HILFE.abgleich} />
      </h1>
      <Meldung art="hinweis">
        Hier stehen nur Projekte, bei denen neue Fachvorgaben oder geänderte Moduldaten aus dem Katalog tatsächlich etwas ändern (Heizlast,
        installierte Leistung, Modulauswahl oder Regelprüfung). Alle anderen
        haben die Änderungen still übernommen; das steht in ihrem Protokoll.
      </Meldung>
      {fehler && <Meldung>{fehler}</Meldung>}
      {bericht && (
        <Meldung art={bericht.fehler.length ? 'warnung' : 'hinweis'}>
          {bericht.text}
          {bericht.fehler.map((f) => (
            <span key={f} className="hilfe-absatz">
              {f}
            </span>
          ))}
        </Meldung>
      )}
      {liste === null ? (
        <p>Wird geladen …</p>
      ) : liste.length === 0 ? (
        <p className="leise">Keine Projekte warten auf eine Entscheidung über neue Fachvorgaben.</p>
      ) : (
        <div className="karte">
          <div className="knopfreihe">
            <button className="knopf" disabled={laeuft || auswahl.size === 0} onClick={() => entscheiden('uebernehmen')}>
              Für ausgewählte übernehmen ({auswahl.size})
            </button>
            <button className="knopf-zweit" disabled={laeuft || auswahl.size === 0} onClick={() => entscheiden('ablehnen')}>
              Für ausgewählte ablehnen
            </button>
          </div>
          <div className="tabelle-rahmen">
            <table className="tabelle">
              <thead>
                <tr>
                  <th>
                    <label className="ankreuzen">
                      <input
                        type="checkbox"
                        checked={alle}
                        onChange={() => setAuswahl(alle ? new Set() : new Set(liste.map(schluessel)))}
                        aria-label="Alle auswählen"
                      />
                    </label>
                  </th>
                  <th>Projekt</th>
                  <th>Anlass</th>
                  <th>Status</th>
                  <th className="zahl">Heizlast vorher</th>
                  <th className="zahl">nachher</th>
                  <th className="zahl">installiert vorher → nachher</th>
                  <th className="zahl">neue Regelverstöße</th>
                  <th>betroffene Räume</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((p) => (
                  <tr key={schluessel(p)}>
                    <td>
                      <label className="ankreuzen">
                        <input type="checkbox" checked={auswahl.has(schluessel(p))} onChange={() => umschalten(schluessel(p))} aria-label={`${p.nummer} auswählen`} />
                      </label>
                    </td>
                    <td>
                      <a href={`#/projekt/${p.projekt_id}`}>
                        {p.nummer} · {p.bezeichnung}
                      </a>
                      {p.ausgecheckt && <small className="leise"> (ausgecheckt – erst nach dem Einchecken)</small>}
                    </td>
                    <td>{p.art === 'module' ? 'Moduldaten' : 'Fachvorgaben'}</td>
                    <td>{STATUS[p.status]}</td>
                    <td className="zahl">{watt(p.summe_alt_w)}</td>
                    <td className="zahl">
                      <strong>{watt(p.summe_neu_w)}</strong>
                    </td>
                    <td className="zahl">
                      {p.installiert_alt_w === p.installiert_neu_w ? watt(p.installiert_alt_w) : `${watt(p.installiert_alt_w)} → ${watt(p.installiert_neu_w)}`}
                    </td>
                    <td className="zahl">{p.neue_verstoesse > 0 ? <span className="verstoss-text">{p.neue_verstoesse}</span> : '0'}</td>
                    <td>
                      {p.raeume.map((r) => (
                        <span key={r.raum_id} className="hilfe-absatz">
                          {r.bezeichnung}: {p.art === 'module' ? `installiert ${watt(r.installiert_alt_w)} → ${watt(r.installiert_neu_w)}` : `${watt(r.alt_w)} → ${watt(r.neu_w)}`}
                          {r.neue_verstoesse > 0 && `, ${r.neue_verstoesse} neue(r) Verstoß/Verstöße`}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
