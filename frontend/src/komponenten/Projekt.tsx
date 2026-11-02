// Projektansicht: Kopf mit Status und Gebäudestandard, darunter Räume, Projektvorgaben und Protokoll.
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  fachansicht,
  hatRolle,
  type Benutzer,
  type Gebaeudestandard,
  type Objekt,
  type ProjektDetail,
  type Projektstatus,
  type ModulAbgleich,
  type ProjektVorgaben,
} from '../api';
import { gehe } from '../navigation';
import { offline, useOffline } from '../offline/daten';
import { GEBAEUDESTANDARDS, HILFE, HINWEIS_MODULE_AKTUALISIERT, HINWEIS_VORGABEN_AKTUALISIERT, PAUSCHALE_DURCH_FACHPRUEFER, statusAnzeige, watt, zahl, zeitpunkt } from '../texte';
import { Hilfe, Meldung, StandardAuswahl, Textfeld } from './Felder';
import { Berichte } from './Berichte';
import { Projektvorgaben } from './Projektvorgaben';
import { Protokoll } from './Protokoll';
import { Raeume } from './Raeume';
import { Raumliste } from './Raumliste';

type Reiter = 'raeume' | 'raumliste' | 'vorgaben' | 'protokoll';
const REITER: Record<Reiter, string> = { raeume: 'Räume', raumliste: 'Raumliste', vorgaben: 'Projektvorgaben', protokoll: 'Protokoll' };

export function ProjektSeite({ projektId, benutzer }: { projektId: number; benutzer: Benutzer }) {
  const [projekt, setProjekt] = useState<ProjektDetail | null>(null);
  // Fachvorgaben im Stand des Projekts (eingefroren) und Unterschiede zu den zentralen
  const [projektVorgaben, setProjektVorgaben] = useState<ProjektVorgaben | null>(null);
  const [reiter, setReiter] = useState<Reiter>('raeume');
  const [fehler, setFehler] = useState('');
  // Zähler, damit Unteransichten nach Änderungen neu laden (z. B. Status, Auswertung)
  const [stand, setStand] = useState(0);
  // neu zeichnen, wenn sich der Offline-Speicher ändert (auschecken, einchecken)
  const { projekte: lokaleProjekte, online } = useOffline();
  const lokal = lokaleProjekte.includes(projektId);

  const laden = useCallback(async () => {
    try {
      const [p, v] = await Promise.all([
        api.get<ProjektDetail>(`/projekte/${projektId}`),
        api.get<ProjektVorgaben>(`/projekte/${projektId}/vorgaben`),
      ]);
      setProjekt(p);
      setProjektVorgaben(v);
    } catch (e) {
      setFehler((e as Error).message);
    }
  }, [projektId]);

  useEffect(() => void laden(), [laden]);

  /** Für alle Änderungen: Fehler anzeigen, danach Projekt (Status!) neu laden */
  const aendern = useCallback(
    async (aktion: () => Promise<unknown>) => {
      setFehler('');
      try {
        await aktion();
      } catch (e) {
        setFehler((e as Error).message);
      }
      await laden();
      setStand((s) => s + 1);
    },
    [laden],
  );

  if (!projekt || !projektVorgaben) return fehler ? <Meldung>{fehler}</Meldung> : <p>Wird geladen …</p>;
  const vorgaben = projektVorgaben.vorgaben;
  const objekt: Objekt = projekt.objekte[0];
  // Ein anderes Gerät hat das Projekt ausgecheckt: hier nur lesen
  const fremdAusgecheckt = projekt.ausgecheckt_am !== null && !lokal;
  const gesperrt = projekt.status === 'freigegeben' || fremdAusgecheckt;
  const fach = fachansicht(benutzer);
  const status_ = statusAnzeige(projekt);
  // Projektvorgaben (Pauschalen je Projekt, Kontrollrechnung) nur in der Fachansicht
  const reiterListe = (Object.keys(REITER) as Reiter[]).filter((r) => r !== 'vorgaben' || fach);

  /** Gebäudestandard ändern; mit erfassten Räumen erst nach Bestätigung (Heizlasten werden neu berechnet) */
  async function standardAendern(neu: Gebaeudestandard) {
    let raeume = 0;
    try {
      raeume = (await api.get<{ raeume: unknown[] }>(`/objekte/${objekt.id}/auswertung`)).raeume.length;
    } catch {
      raeume = 0;
    }
    if (
      raeume > 0 &&
      !window.confirm(
        `Gebäudestandard auf „${GEBAEUDESTANDARDS[neu]}“ ändern?\n\nDie Heizlasten aller ${raeume} erfassten Räume werden danach neu berechnet ` +
          '(Pauschalen und Rückfallwerte des neuen Standards). Module bleiben, die Leistungsprüfung kann sich ändern.',
      )
    )
      return;
    await aendern(() => api.patch(`/objekte/${objekt.id}`, { gebaeudestandard: neu }));
  }

  function status(neu: Projektstatus) {
    void aendern(() => api.post(`/projekte/${projektId}/status`, { status: neu }));
  }

  return (
    <section>
      <div className="projektkopf">
        <div>
          <a href="#/" className="zurueck">
            ← Projekte
          </a>
          <h1>
            {projekt.nummer} · {projekt.bezeichnung}
          </h1>
          <span className={`status ${status_.klasse}`}>{status_.text}</span>
          {projekt.angebot_gesperrt && <Hilfe begriff="wartet auf Fachprüfer" text={HILFE.wartet} />}
          {projekt.status === 'geprueft' && <small className="leise"> am {zeitpunkt(projekt.geprueft_am)}</small>}
          {projekt.status === 'freigegeben' && <small className="leise"> am {zeitpunkt(projekt.freigegeben_am)}</small>}
        </div>
        {/* Prüfen und Freigeben nur mit Rolle Fachprüfer (auch kombiniert mit Admin) */}
        {hatRolle(benutzer, 'fachpruefer') && !lokal && !fremdAusgecheckt && (
          <div className="knopfreihe">
            {projekt.status === 'entwurf' && (
              <button
                className="knopf"
                disabled={projekt.angebot_gesperrt}
                title={
                  projekt.wartet_auf_fachpruefer
                    ? 'Erst bei allen Räumen die W/m²-Pauschale festlegen'
                    : projekt.vorgaben_offen
                      ? 'Erst die neuen Fachvorgaben übernehmen oder ablehnen'
                      : ''
                }
                onClick={() => status('geprueft')}
              >
                Als fachlich geprüft markieren
              </button>
            )}
            {projekt.status === 'geprueft' && (
              <button className="knopf" onClick={() => status('freigegeben')}>
                Freigeben
              </button>
            )}
            {projekt.status !== 'entwurf' && (
              <button className="knopf-zweit" onClick={() => status('entwurf')}>
                Zurück auf Entwurf
              </button>
            )}
          </div>
        )}
      </div>

      <OfflineKarte projekt={projekt} benutzer={benutzer} lokal={lokal} neuLaden={() => aendern(async () => undefined)} />
      {projekt.status === 'freigegeben' && <Meldung art="hinweis">Das Projekt ist freigegeben und gesperrt. Änderungen erst nach Rücksetzung durch einen Fachprüfer.</Meldung>}
      {projekt.status === 'geprueft' && (
        <Meldung art="hinweis">Fachlich geprüft. Jede Änderung setzt das Projekt zurück auf „Vor-Ort-Entwurf“.</Meldung>
      )}
      {fehler && <Meldung>{fehler}</Meldung>}

      <VorgabenStand
        pv={projektVorgaben}
        freigegeben={projekt.status === 'freigegeben'}
        fachpruefer={hatRolle(benutzer, 'fachpruefer')}
        offenLautProjekt={projekt.vorgaben_offen}
        entscheidbar={!gesperrt && !lokal}
        uebernehmen={() => aendern(() => api.post(`/projekte/${projektId}/vorgaben/uebernehmen`))}
        ablehnen={(bemerkung) => aendern(() => api.post(`/projekte/${projektId}/vorgaben/ablehnen`, { bemerkung }))}
      />
      <ModulStand
        projektId={projektId}
        stand={stand}
        offenLautProjekt={projekt.module_offen}
        freigegeben={projekt.status === 'freigegeben'}
        fachpruefer={hatRolle(benutzer, 'fachpruefer')}
        entscheidbar={!gesperrt && !lokal}
        uebernehmen={() => aendern(() => api.post(`/projekte/${projektId}/module/uebernehmen`))}
        ablehnen={(bemerkung) => aendern(() => api.post(`/projekte/${projektId}/module/ablehnen`, { bemerkung }))}
      />

      {/* Projektkopf kompakt (Paket M1, 02.11.2026): Zeile 1 Nummer (Chip), Kunde, Zuständig; Zeile 2 Gebäudestandard */}
      <div className="karte projektmaske">
        <div className="maske-zeile">
          <div className="maske-feld nummer-feld">
            <span className="feldname">Projektnummer</span>
            <span className="chip" title="wird automatisch vergeben">{projekt.nummer}</span>
          </div>
          <label className="maske-feld">
            <span className="feldname">Kunde</span>
            <Textfeld
              wert={projekt.kunde_name}
              gesperrt={gesperrt}
              beschriftung="Kunde"
              onSpeichern={(v) => aendern(() => api.patch(`/projekte/${projektId}`, { kunde_name: v }))}
            />
          </label>
          <Zustaendig projekt={projekt} benutzer={benutzer} onZuweisen={(id) => aendern(() => api.put(`/projekte/${projektId}/zuweisung`, { benutzer_id: id }))} />
        </div>
        <div className="maske-zeile2">
          <StandardAuswahl
            wert={objekt.gebaeudestandard}
            gesperrt={gesperrt}
            onWahl={(v) => void standardAendern(v)}
          />
          <small className="metazeile">Fachvorgaben-Stand: {zeitpunkt(projektVorgaben.stand_am)}</small>
        </div>
      </div>
      <Berichte projekt={projekt} gesperrt={gesperrt} online={online} lokal={lokal} benutzer={benutzer} aendern={aendern} />
      {projekt.wartet_auf_fachpruefer && (
        <Meldung art="hinweis">
          {hatRolle(benutzer, 'fachpruefer')
            ? 'Wartet auf Fachprüfer: Bitte bei allen Räumen die W/m²-Pauschale festlegen. Bis dahin kann das Projekt nicht geprüft und nicht angeboten werden.'
            : `Wartet auf Fachprüfer: ${PAUSCHALE_DURCH_FACHPRUEFER}. Bis dahin ist das Projekt für Angebote gesperrt. Die Räume können Sie wie gewohnt erfassen.`}
        </Meldung>
      )}

      <div className="reiter" role="tablist">
        {reiterListe.map((r) => (
          <button key={r} role="tab" aria-selected={r === reiter} className={r === reiter ? 'aktiv' : ''} onClick={() => setReiter(r)}>
            {REITER[r]}
          </button>
        ))}
      </div>

      {reiter === 'raeume' && (
        <Raeume objekt={objekt} vorgaben={vorgaben} benutzer={benutzer} gesperrt={gesperrt} aendern={aendern} stand={stand} />
      )}
      {reiter === 'raumliste' && <Raumliste objekt={objekt} stand={stand} />}
      {reiter === 'vorgaben' && fach && (
        <Projektvorgaben
          objekt={objekt}
          vorgaben={vorgaben}
          gesperrt={gesperrt}
          pauschaleGesperrt={gesperrt || !hatRolle(benutzer, 'fachpruefer')}
          aendern={aendern}
          stand={stand}
        />
      )}
      {reiter === 'protokoll' && <Protokoll pfad={`/projekte/${projektId}/protokoll`} stand={stand} />}
    </section>
  );
}

/** Offline-Bearbeitung: auschecken, einchecken, Sperre anzeigen und (Admin) lösen */
function OfflineKarte({
  projekt,
  benutzer,
  lokal,
  neuLaden,
}: {
  projekt: ProjektDetail;
  benutzer: Benutzer;
  lokal: boolean;
  neuLaden: () => Promise<void>;
}) {
  const { online } = useOffline();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');

  async function ausfuehren(aktion: () => Promise<unknown>) {
    setFehler('');
    setLaeuft(true);
    try {
      await aktion();
      await neuLaden();
    } catch (e) {
      setFehler((e as Error).message);
    } finally {
      setLaeuft(false);
    }
  }

  async function auschecken() {
    let geraet = await offline.geraet();
    if (!geraet) {
      geraet = window.prompt('Name dieses Geräts (wird anderen bei der Sperre angezeigt):', `Tablet ${benutzer.name}`)?.trim();
      if (!geraet) return;
      await offline.geraetSetzen(geraet.slice(0, 100));
    }
    await ausfuehren(() => offline.auschecken(projekt.id, geraet!));
  }

  async function einchecken() {
    await ausfuehren(async () => {
      const echteId = await offline.einchecken(projekt.id);
      // offline angelegte Projekte haben jetzt ihre Server-ID
      if (echteId !== projekt.id) gehe(`/projekt/${echteId}`);
    });
  }

  if (lokal) {
    return (
      <div className="karte offline-karte lokal">
        <div>
          <strong>Auf diesem Gerät zur Offline-Bearbeitung ausgecheckt</strong>
          {projekt.ausgecheckt_am && <small className="leise"> seit {zeitpunkt(projekt.ausgecheckt_am)}</small>}
          <br />
          <small>Für alle anderen gesperrt. Änderungen werden gespeichert und automatisch übertragen, sobald eine Verbindung besteht.</small>
        </div>
        <button className="knopf-zweit" disabled={laeuft || !online} onClick={einchecken} title={online ? '' : 'Einchecken braucht eine Verbindung'}>
          {laeuft ? 'Wird eingecheckt …' : 'Einchecken'}
        </button>
        {fehler && <Meldung>{fehler}</Meldung>}
      </div>
    );
  }
  if (projekt.ausgecheckt_am) {
    return (
      <div className="karte offline-karte fremd">
        <div>
          <strong>Gesperrt: zur Offline-Bearbeitung ausgecheckt</strong>
          <br />
          von {projekt.ausgecheckt_von_name} auf Gerät „{projekt.ausgecheckt_geraet}“ seit {zeitpunkt(projekt.ausgecheckt_am)}.
          Änderungen sind erst nach dem Einchecken möglich.
        </div>
        {hatRolle(benutzer, 'admin') && (
          <button
            className="knopf-gefahr"
            disabled={laeuft}
            onClick={() =>
              window.confirm(
                'Sperre lösen? Änderungen, die auf dem Gerät noch nicht übertragen sind, werden danach nicht mehr angenommen.',
              ) && void ausfuehren(() => api.post(`/projekte/${projekt.id}/einchecken`))
            }
          >
            Sperre lösen
          </button>
        )}
        {fehler && <Meldung>{fehler}</Meldung>}
      </div>
    );
  }
  if (projekt.status === 'freigegeben') return null;
  return (
    <div className="karte offline-karte">
      <span>
        Ohne Netz weiterarbeiten? Projekt auf dieses Gerät holen und für andere sperren.
        <Hilfe begriff="Auschecken" text={HILFE.auschecken} />
      </span>
      <button className="knopf-zweit" disabled={laeuft || !online} onClick={auschecken}>
        {laeuft ? 'Wird ausgecheckt …' : 'Für Offline-Bearbeitung auschecken'}
      </button>
      {fehler && <Meldung>{fehler}</Meldung>}
    </div>
  );
}

function wertText(w: number | string | null): string {
  if (w === null) return '–';
  return typeof w === 'number' ? zahl(w, w % 1 === 0 ? 0 : 2) : w;
}

/**
 * Stand der eingefrorenen Fachvorgaben; bei zentralen Änderungen Unterschiede, Auswirkung und Entscheidung per Klick.
 * Unterschiede, Übernehmen und Ablehnen nur für Fachprüfer; der Außendienst sieht einen neutralen Hinweis
 * (Festlegung 13.10.2026). Bis zur Entscheidung ist für das Projekt kein Angebot möglich.
 */
function VorgabenStand({
  pv,
  freigegeben,
  fachpruefer,
  offenLautProjekt,
  entscheidbar,
  uebernehmen,
  ablehnen,
}: {
  pv: ProjektVorgaben;
  freigegeben: boolean;
  fachpruefer: boolean;
  /** offline (ohne Vergleich) gilt der Stand vom Auschecken */
  offenLautProjekt: boolean;
  entscheidbar: boolean;
  uebernehmen: () => Promise<void>;
  ablehnen: (bemerkung: string) => Promise<void>;
}) {
  const [offen, setOffen] = useState(false);
  const stand = `Fachvorgaben-Stand des Projekts: ${zeitpunkt(pv.stand_am)}`;
  const hilfe = <Hilfe begriff="Fachvorgaben-Stand" text={HILFE.vorgabenStand} />;
  if (freigegeben) return <p className="leise klein-text">{stand} (freigegeben, bleibt unverändert){hilfe}</p>;
  if (!fachpruefer && (pv.offen || offenLautProjekt)) return <Meldung art="hinweis">{HINWEIS_VORGABEN_AKTUALISIERT}</Meldung>;
  if (pv.unterschiede === null) return <p className="leise klein-text">{stand} (Vergleich mit den zentralen Vorgaben erst nach dem Einchecken){hilfe}</p>;
  if (pv.unterschiede.length === 0 || !fachpruefer) return <p className="leise klein-text">{stand}{hilfe}</p>;

  const a = pv.auswirkung;
  const differenz = a ? a.summe_neu_w - a.summe_alt_w : 0;
  return (
    <div className={`karte vorgaben-aenderung${pv.offen ? '' : ' abgelehnt'}`}>
      <div className="zeile">
        <div>
          <strong>
            {pv.offen
              ? 'Die zentralen Fachvorgaben haben sich geändert. Bis zur Entscheidung ist kein Angebot möglich.'
              : `Neue zentrale Fachvorgaben am ${zeitpunkt(pv.abgelehnt_am)} bewusst abgelehnt.`}
          </strong>
          <br />
          <small>
            {stand}. Das Projekt rechnet weiter mit diesem Stand, bis die neuen Werte übernommen werden.
            {a && (
              <>
                {' '}
                Summe Heizlast: {watt(a.summe_alt_w)} → <strong>{watt(a.summe_neu_w)}</strong> ({differenz >= 0 ? '+' : ''}
                {watt(differenz)})
              </>
            )}
          </small>
        </div>
        <button className="knopf-leise klein" onClick={() => setOffen(!offen)} aria-expanded={offen}>
          {offen ? 'Unterschiede ausblenden' : `${pv.unterschiede.length} Unterschied(e) anzeigen`}
        </button>
      </div>
      {offen && (
        <>
          <div className="tabelle-rahmen">
            <table className="tabelle">
              <thead>
                <tr>
                  <th>Bereich</th>
                  <th>Vorgabe</th>
                  <th>Projekt (alt)</th>
                  <th>zentral (neu)</th>
                </tr>
              </thead>
              <tbody>
                {pv.unterschiede.map((u, i) => (
                  <tr key={i}>
                    <td>{u.bereich}</td>
                    <td>{u.bezeichnung}</td>
                    <td>{wertText(u.alt)}</td>
                    <td>
                      <strong>{wertText(u.neu)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {a && a.raeume.length > 0 && (
            <>
              <h3>Auswirkung auf die Räume</h3>
              <ul className="auswirkung">
                {a.raeume.map((r) => (
                  <li key={r.raum_id}>
                    {r.bezeichnung}: {watt(r.alt_w)} → <strong>{watt(r.neu_w)}</strong>
                    {r.neue_verstoesse > 0 && <span className="verstoss-text"> · {r.neue_verstoesse} neue(r) Regelverstoß/-verstöße</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {entscheidbar ? (
        <div className="knopfreihe">
          <button
            className={pv.offen ? 'knopf' : 'knopf-zweit'}
            onClick={() =>
              window.confirm('Neue zentrale Fachvorgaben in dieses Projekt übernehmen? Die Heizlast wird neu berechnet; die Übernahme wird protokolliert.') &&
              void uebernehmen()
            }
          >
            Neue Vorgaben übernehmen
          </button>
          {pv.offen && (
            <button
              className="knopf-zweit"
              onClick={() => {
                const bemerkung = window.prompt(
                  'Neue Vorgaben für dieses Projekt ablehnen? Es rechnet weiter mit seinem bisherigen Stand, und ein Angebot ist wieder möglich.\n\nBegründung (optional, wird protokolliert):',
                  '',
                );
                if (bemerkung !== null) void ablehnen(bemerkung.trim());
              }}
            >
              Ablehnen, bisherige Werte behalten
            </button>
          )}
        </div>
      ) : (
        <small className="leise">Entscheidung nicht möglich, solange das Projekt gesperrt oder auf einem Gerät ausgecheckt ist.</small>
      )}
    </div>
  );
}

/**
 * Zuständiger Außendienst: angelegt von … / zugewiesen an … (Festlegung 31.10.2026). Nur Admins weisen zu,
 * z. B. als Urlaubsvertretung; Benutzer mit nur der Rolle Außendienst sehen nur eigene und zugewiesene Projekte.
 */
function Zustaendig({
  projekt,
  benutzer,
  onZuweisen,
}: {
  projekt: ProjektDetail;
  benutzer: Benutzer;
  onZuweisen: (benutzerId: number | null) => Promise<void>;
}) {
  const admin = hatRolle(benutzer, 'admin');
  const [kandidaten, setKandidaten] = useState<Benutzer[]>([]);
  useEffect(() => {
    if (!admin) return;
    api
      .get<Benutzer[]>('/benutzer')
      .then((l) => setKandidaten(l.filter((b) => b.aktiv && b.rollen.includes('aussendienst'))))
      .catch(() => setKandidaten([]));
  }, [admin]);
  const herkunft = `angelegt von ${projekt.ersteller_name ?? '–'}${projekt.zugewiesen_an_name ? `, zugewiesen an ${projekt.zugewiesen_an_name}` : ''}`;
  return (
    <div className="maske-feld">
      <span className="feldname">
        Zuständig (Außendienst)
        <Hilfe begriff="Zuständig" text={herkunft} />
      </span>
      {admin ? (
        <select
          aria-label="Projekt zuweisen"
          value={projekt.zugewiesen_an_id ?? ''}
          onChange={(e) => void onZuweisen(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{projekt.ersteller_name ?? 'Ersteller'} (keine Zuweisung)</option>
          {kandidaten.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="maske-wert">{projekt.zugewiesen_an_name ?? projekt.ersteller_name ?? '–'}</span>
      )}
    </div>
  );
}

function modulWert(w: number | string | boolean | null): string {
  if (w === null) return '–';
  if (typeof w === 'boolean') return w ? 'ja' : 'nein';
  return typeof w === 'number' ? zahl(w, w % 1 === 0 ? 0 : 2) : w;
}

/**
 * Geänderte Katalogdaten verwendeter Module (Festlegung 31.10.2026), gleiche Logik wie bei den Fachvorgaben:
 * Unterschiede, Auswirkung und Entscheidung nur für Fachprüfer, der Außendienst sieht einen neutralen Hinweis.
 */
function ModulStand({
  projektId,
  stand,
  offenLautProjekt,
  freigegeben,
  fachpruefer,
  entscheidbar,
  uebernehmen,
  ablehnen,
}: {
  projektId: number;
  stand: number;
  offenLautProjekt: boolean;
  freigegeben: boolean;
  fachpruefer: boolean;
  entscheidbar: boolean;
  uebernehmen: () => Promise<void>;
  ablehnen: (bemerkung: string) => Promise<void>;
}) {
  const [abgleich, setAbgleich] = useState<ModulAbgleich | null>(null);
  const [offen, setOffen] = useState(false);
  useEffect(() => {
    if (freigegeben || !fachpruefer) return setAbgleich(null);
    // ohne Netz nicht verfügbar – dann gilt der Stand vom Auschecken (offenLautProjekt)
    api.get<ModulAbgleich>(`/projekte/${projektId}/module-abgleich`).then(setAbgleich).catch(() => setAbgleich(null));
  }, [projektId, stand, freigegeben, fachpruefer]);

  if (freigegeben) return null;
  if (!fachpruefer) return offenLautProjekt ? <Meldung art="hinweis">{HINWEIS_MODULE_AKTUALISIERT}</Meldung> : null;
  if (!abgleich || abgleich.unterschiede.length === 0) return null;
  const a = abgleich.auswirkung;
  return (
    <div className={`karte vorgaben-aenderung${abgleich.offen ? '' : ' abgelehnt'}`}>
      <div className="zeile">
        <div>
          <strong>
            {abgleich.offen
              ? 'Daten verwendeter Module wurden im Katalog geändert. Bis zur Entscheidung ist kein Angebot möglich.'
              : 'Geänderte Moduldaten wurden bewusst abgelehnt; das Projekt plant mit den bisherigen Moduldaten.'}
          </strong>
          {a && (
            <>
              <br />
              <small>
                Installierte Leistung: {watt(a.installiert_alt_w)} → <strong>{watt(a.installiert_neu_w)}</strong>
                {a.neue_verstoesse > 0 && <span className="verstoss-text"> · {a.neue_verstoesse} neue(r) Regelverstoß/-verstöße</span>}
              </small>
            </>
          )}
        </div>
        <button className="knopf-leise klein" onClick={() => setOffen(!offen)} aria-expanded={offen}>
          {offen ? 'Unterschiede ausblenden' : `${abgleich.unterschiede.length} Unterschied(e) anzeigen`}
        </button>
      </div>
      {offen && (
        <div className="tabelle-rahmen">
          <table className="tabelle">
            <thead>
              <tr>
                <th>Modul / Feld</th>
                <th>Projekt (alt)</th>
                <th>Katalog (neu)</th>
              </tr>
            </thead>
            <tbody>
              {abgleich.unterschiede.map((u, i) => (
                <tr key={i}>
                  <td>{u.bezeichnung}</td>
                  <td>{modulWert(u.alt)}</td>
                  <td>
                    <strong>{modulWert(u.neu)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {a && a.raeume.length > 0 && (
            <ul className="auswirkung">
              {a.raeume.map((r) => (
                <li key={r.raum_id}>
                  {r.bezeichnung}: installiert {watt(r.installiert_alt_w)} → <strong>{watt(r.installiert_neu_w)}</strong>
                  {r.neue_verstoesse > 0 && <span className="verstoss-text"> · {r.neue_verstoesse} neue(r) Regelverstoß/-verstöße</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {entscheidbar ? (
        <div className="knopfreihe">
          <button
            className={abgleich.offen ? 'knopf' : 'knopf-zweit'}
            onClick={() =>
              window.confirm('Neue Moduldaten in dieses Projekt übernehmen? Lage und Drehung der Module bleiben; die Übernahme wird protokolliert.') &&
              void uebernehmen()
            }
          >
            Neue Moduldaten übernehmen
          </button>
          {abgleich.offen && (
            <button
              className="knopf-zweit"
              onClick={() => {
                const bemerkung = window.prompt('Bei den bisherigen Moduldaten bleiben?\n\nBegründung (optional, wird protokolliert):', '');
                if (bemerkung !== null) void ablehnen(bemerkung.trim());
              }}
            >
              Ablehnen, bisherige Moduldaten behalten
            </button>
          )}
        </div>
      ) : (
        <small className="leise">Entscheidung nicht möglich, solange das Projekt gesperrt oder auf einem Gerät ausgecheckt ist.</small>
      )}
    </div>
  );
}
