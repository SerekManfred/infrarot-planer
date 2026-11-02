// Objektbibliothek (Festlegung 01.11.2026): Möbel, Deckeneinbauten und Bauliches für den Deckenplan.
// - ObjektbibliothekKarte: Pflege in den Fachvorgaben (Fachprüfer und Admins), Bearbeiten im Dialog
// - ObjektAuswahl: „Objekt hinzufügen“ im Deckenplan – nach Raumtyp vorsortiert, mit Suche, zuletzt verwendete oben
import { useMemo, useState } from 'react';
import { OBJEKT_FORMEN, OBJEKT_GRUPPEN, OBJEKT_KATEGORIEN, type ObjektForm, type ObjektGruppe, type ObjektKategorie } from '@infrarot/rechenkern';
import { api, type BibliotheksObjekt, type Raumtyp, type VorschauAnfrage } from '../api';
import { HILFE, zahl } from '../texte';
import { masseText, objekteFuerRaum, regelText, zuletztLesen, zuletztMerken } from '../objekte';
import { Dialog, Hilfe, Meldung, Schalter } from './Felder';
import { ExcelTabelle } from './ExcelTabelle';
import { VTabelle } from './VTabelle';

type Pruefen = (anfrage: VorschauAnfrage, aktion: () => Promise<unknown>) => Promise<void>;

// ── Pflege in den Fachvorgaben ──

export function ObjektbibliothekKarte({
  objekte,
  raumtypen,
  darf,
  pruefen,
  fertig,
}: {
  objekte: BibliotheksObjekt[];
  raumtypen: Raumtyp[];
  darf: boolean;
  pruefen: Pruefen;
  fertig: (text: string) => void;
}) {
  const [bearbeiten, setBearbeiten] = useState<BibliotheksObjekt | 'neu' | null>(null);
  const namen = new Map(raumtypen.map((t) => [t.id, t.bezeichnung]));
  return (
    <div className="karte">
      <h2>
        Objektbibliothek (Deckenplan)
        <Hilfe begriff="Objektbibliothek" text={HILFE.objektbibliothek} />
      </h2>
      <p className="leise">
        Maße B × T × H in m, Abstand in cm. tabu = kein Modul darüber, Abstand = Modul erlaubt mit Mindestabstand zur Kante, neutral = nur
        Darstellung und Wärmeverteilung. Quelle im Dialog.
      </p>
      {darf && (
        <div className="knopfreihe">
          <button className="knopf" onClick={() => setBearbeiten('neu')}>
            + Neues Objekt
          </button>
        </div>
      )}
      <VTabelle
        name="Objektbibliothek"
        zeilen={(Object.keys(OBJEKT_GRUPPEN) as ObjektGruppe[]).flatMap((g) => objekte.filter((o) => o.gruppe === g))}
        schluessel={(o) => o.schluessel}
        gruppe={(o) => OBJEKT_GRUPPEN[o.gruppe]}
        inaktiv={(o) => !o.aktiv}
        spalten={[
          { kopf: 'Objekt', wert: (o) => <><strong>{o.name}</strong>{!o.aktiv && ' (inaktiv)'}</> },
          { kopf: 'Maße B × T × H', zahl: true, wert: (o) => masseText(o) },
          { kopf: 'Regel', wert: (o) => regelText(o) },
          {
            kopf: 'Passende Raumtypen',
            umbruch: true,
            wert: (o) => (o.raumtyp_ids.length === 0 ? 'alle' : o.raumtyp_ids.map((i) => namen.get(i) ?? `Raumtyp ${i}`).join(', ')),
          },
        ]}
        aktion={darf ? setBearbeiten : undefined}
      />
      {darf && <ExcelTabelle name="objekte" titel="Objektbibliothek" onFertig={fertig} />}
      {bearbeiten && (
        <ObjektDialog
          objekt={bearbeiten === 'neu' ? null : bearbeiten}
          raumtypen={raumtypen}
          onSchliessen={() => setBearbeiten(null)}
          pruefen={pruefen}
        />
      )}
    </div>
  );
}

type Entwurf = Omit<BibliotheksObjekt, 'schluessel' | 'id' | 'reihenfolge'>;

const LEER: Entwurf = {
  name: '', gruppe: 'moebel', raumtyp_ids: [], form: 'rechteck', breite_m: null, tiefe_m: null, hoehe_m: null,
  kategorie: 'tabu', abstand_cm: null, quelle: '', aktiv: true,
};

function zahlOderNull(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const w = Number(t);
  return Number.isFinite(w) ? w : NaN;
}

function ObjektDialog({
  objekt,
  raumtypen,
  onSchliessen,
  pruefen,
}: {
  objekt: BibliotheksObjekt | null;
  raumtypen: Raumtyp[];
  onSchliessen: () => void;
  pruefen: Pruefen;
}) {
  const start: Entwurf = objekt ? { ...LEER, ...objekt } : LEER;
  const [e, setE] = useState<Entwurf>(start);
  const [texte, setTexte] = useState(() => ({
    breite_m: start.breite_m === null ? '' : zahl(start.breite_m),
    tiefe_m: start.tiefe_m === null ? '' : zahl(start.tiefe_m),
    hoehe_m: start.hoehe_m === null ? '' : zahl(start.hoehe_m),
    abstand_cm: start.abstand_cm === null ? '' : zahl(start.abstand_cm, 0),
  }));
  const [fehler, setFehler] = useState('');

  async function speichern() {
    const zahlen = Object.fromEntries(Object.entries(texte).map(([k, v]) => [k, zahlOderNull(v)])) as Record<keyof typeof texte, number | null>;
    if (Object.values(zahlen).some((w) => w !== null && Number.isNaN(w))) return setFehler('Bitte Zahlen eingeben (z. B. 0,45).');
    if (!e.name.trim()) return setFehler('Bitte einen Namen eingeben.');
    if (!e.quelle.trim()) return setFehler('Bitte eine Quelle angeben.');
    const daten: Partial<Entwurf> = { ...e, ...zahlen };
    if (e.form === 'punkt') Object.assign(daten, { breite_m: null, tiefe_m: null, hoehe_m: null });
    if (e.form === 'streifen') Object.assign(daten, { tiefe_m: null });
    if (objekt) {
      // nur Geändertes senden (Protokoll und Vorschau zeigen genau diese Änderung)
      const aenderung = Object.fromEntries(
        Object.entries(daten).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((objekt as unknown as Record<string, unknown>)[k])),
      );
      if (Object.keys(aenderung).length === 0) return onSchliessen();
      await pruefen({ art: 'objekt_aendern', ziel: objekt.id, daten: aenderung }, () => api.patch(`/fachvorgaben/objekte/${objekt.id}`, aenderung));
    } else {
      await pruefen({ art: 'objekt_neu', daten }, () => api.post('/fachvorgaben/objekte', daten));
    }
    onSchliessen();
  }

  const zahlFeld = (feld: keyof typeof texte, name: string, einheit: string) => (
    <label>
      {name}
      <span className="zahlfeld">
        <input inputMode="decimal" value={texte[feld]} onChange={(ev) => setTexte({ ...texte, [feld]: ev.target.value })} />
        <span className="einheit">{einheit}</span>
      </span>
    </label>
  );

  return (
    <Dialog titel={objekt ? `Objekt bearbeiten: ${objekt.name}` : 'Neues Objekt'} onSchliessen={onSchliessen}>
      <div className="raster">
        <label>
          Name
          <input value={e.name} onChange={(ev) => setE({ ...e, name: ev.target.value })} />
        </label>
        <label>
          Gruppe
          <select value={e.gruppe} onChange={(ev) => setE({ ...e, gruppe: ev.target.value as ObjektGruppe })}>
            {Object.entries(OBJEKT_GRUPPEN).map(([k, t]) => (
              <option key={k} value={k}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Form
          <select value={e.form} onChange={(ev) => setE({ ...e, form: ev.target.value as ObjektForm })}>
            {Object.entries(OBJEKT_FORMEN).map(([k, t]) => (
              <option key={k} value={k}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {e.form !== 'punkt' && zahlFeld('breite_m', e.form === 'streifen' ? 'Standardbreite (Tiefe ab der Wand)' : 'Standardbreite', 'm')}
        {e.form === 'rechteck' && zahlFeld('tiefe_m', 'Standardtiefe', 'm')}
        {e.form !== 'punkt' && zahlFeld('hoehe_m', 'Standardhöhe (Oberseite)', 'm')}
        <label>
          Kategorie
          <select value={e.kategorie} onChange={(ev) => setE({ ...e, kategorie: ev.target.value as ObjektKategorie })}>
            {Object.entries(OBJEKT_KATEGORIEN).map(([k, t]) => (
              <option key={k} value={k}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {e.kategorie !== 'neutral' && zahlFeld('abstand_cm', 'Mindestabstand', 'cm')}
        <label className="breit">
          Quelle
          <input value={e.quelle} onChange={(ev) => setE({ ...e, quelle: ev.target.value })} />
        </label>
        <label className="inline">
          <input type="checkbox" checked={e.aktiv} onChange={(ev) => setE({ ...e, aktiv: ev.target.checked })} /> aktiv (in der Auswahl
          im Deckenplan)
        </label>
      </div>
      <fieldset className="raumtypwahl">
        <legend>Passende Raumtypen (keiner gewählt = alle)</legend>
        {raumtypen.map((t) => (
          <label key={t.id} className="inline">
            <input
              type="checkbox"
              checked={e.raumtyp_ids.includes(t.id)}
              onChange={(ev) =>
                setE({ ...e, raumtyp_ids: ev.target.checked ? [...e.raumtyp_ids, t.id].sort((a, b) => a - b) : e.raumtyp_ids.filter((i) => i !== t.id) })
              }
            />{' '}
            {t.bezeichnung}
          </label>
        ))}
      </fieldset>
      {fehler && <Meldung>{fehler}</Meldung>}
      <div className="knopfreihe">
        <button className="knopf" onClick={() => void speichern()}>
          Speichern
        </button>
        <button className="knopf-leise" onClick={onSchliessen}>
          Abbrechen
        </button>
      </div>
    </Dialog>
  );
}

// ── Auswahl im Deckenplan ──

export function ObjektAuswahl({
  objekte,
  raumtypId,
  raumtyp,
  onWahl,
}: {
  objekte: BibliotheksObjekt[];
  raumtypId: number | null;
  raumtyp: string | null;
  onWahl: (o: BibliotheksObjekt, extra?: SonstigeAngaben) => void;
}) {
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState('');
  const [zuletzt, setZuletzt] = useState(zuletztLesen);
  const [alleZeigen, setAlleZeigen] = useState(false);
  const { passend, allgemein, weitere } = useMemo(() => objekteFuerRaum(objekte, raumtypId), [objekte, raumtypId]);
  const nach = new Map(objekte.map((o) => [o.schluessel, o]));
  const zuletztObjekte = zuletzt.map((s) => nach.get(s)).filter((o): o is BibliotheksObjekt => !!o && o.aktiv !== false);

  // „Sonstige Sperrfläche“ (Paket N4): erst Name, Form, Kategorie und Höhe festlegen
  const [sonstige, setSonstige] = useState<BibliotheksObjekt | null>(null);
  function waehlen(o: BibliotheksObjekt, extra?: SonstigeAngaben) {
    if (o.schluessel === 'sonstiges' && !extra) {
      setSonstige(o);
      return;
    }
    setZuletzt(zuletztMerken(o.schluessel));
    setOffen(false);
    setSuche('');
    setSonstige(null);
    onWahl(o, extra);
  }

  if (objekte.length === 0) {
    return <Meldung art="hinweis">Die Objektbibliothek fehlt im Stand dieses Projekts – der Fachprüfer kann die neuen Fachvorgaben übernehmen.</Meldung>;
  }
  if (!offen) {
    return (
      <button className="knopf-zweit" onClick={() => setOffen(true)} aria-expanded={false}>
        + Objekt hinzufügen …
      </button>
    );
  }
  if (sonstige) {
    return <SonstigeFormular objekt={sonstige} onAbbrechen={() => setSonstige(null)} onEinsetzen={(e) => waehlen(sonstige, e)} />;
  }
  const text = suche.trim().toLowerCase();
  const treffer = text ? [...passend, ...allgemein, ...weitere].filter((o) => o.name.toLowerCase().includes(text)) : [];
  const knopf = (o: BibliotheksObjekt) => (
    <button key={o.schluessel} className={`objekt-knopf kat-${o.kategorie}`} onClick={() => waehlen(o)}>
      <span className="objekt-name">{o.name}</span>
      <span className="objekt-info">
        {masseText(o)} · {regelText(o)}
      </span>
    </button>
  );
  const gruppiert = (liste: BibliotheksObjekt[]) =>
    (Object.keys(OBJEKT_GRUPPEN) as ObjektGruppe[])
      .map((g) => [g, liste.filter((o) => o.gruppe === g)] as const)
      .filter(([, l]) => l.length > 0)
      .map(([g, l]) => (
        <div key={g}>
          <h4>{OBJEKT_GRUPPEN[g]}</h4>
          <div className="objekt-liste">{l.map(knopf)}</div>
        </div>
      ));
  return (
    <div className="objekt-auswahl" role="group" aria-label="Objekt hinzufügen">
      <div className="knopfreihe">
        <input
          type="search"
          className="objekt-suche"
          placeholder="Objekt suchen, z. B. Sofa"
          aria-label="Objekt suchen"
          value={suche}
          onChange={(ev) => setSuche(ev.target.value)}
        />
        <button className="knopf-leise" onClick={() => setOffen(false)}>
          Schließen
        </button>
      </div>
      {text ? (
        treffer.length > 0 ? (
          <div className="objekt-liste">{treffer.map(knopf)}</div>
        ) : (
          <p>Kein Objekt gefunden. Für Unbekanntes „Sonstige Sperrfläche“ nehmen.</p>
        )
      ) : (
        <>
          {zuletztObjekte.length > 0 && (
            <>
              <h4>Zuletzt verwendet</h4>
              <div className="objekt-liste">{zuletztObjekte.map(knopf)}</div>
            </>
          )}
          {passend.length > 0 && (
            <>
              <h4>Passend für {raumtyp ?? 'diesen Raum'}</h4>
              <div className="objekt-liste">{passend.map(knopf)}</div>
            </>
          )}
          {allgemein.length > 0 && (
            <>
              <h4>Für alle Räume</h4>
              <div className="objekt-liste">{allgemein.map(knopf)}</div>
            </>
          )}
          {passend.length === 0 || alleZeigen ? (
            gruppiert(weitere)
          ) : (
            <button className="knopf-leise" onClick={() => setAlleZeigen(true)}>
              Objekte anderer Räume ({weitere.length}) …
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Angaben zur „Sonstigen Sperrfläche“ (Paket N4) */
export interface SonstigeAngaben {
  bezeichnung: string;
  umriss: 'rechteck' | 'quadrat' | 'rund';
  kategorie: ObjektKategorie;
  hoehe: number | null;
}

export const UMRISSE = { rechteck: 'Rechteck', quadrat: 'Quadrat', rund: 'Rund' } as const;
export const KATEGORIE_WAHL: Record<ObjektKategorie, string> = { tabu: 'Tabu', abstand: 'Abstand', neutral: 'Neutral' };

function SonstigeFormular({ objekt, onAbbrechen, onEinsetzen }: { objekt: BibliotheksObjekt; onAbbrechen: () => void; onEinsetzen: (e: SonstigeAngaben) => void }) {
  const [e, setE] = useState<SonstigeAngaben>({ bezeichnung: objekt.name, umriss: 'rechteck', kategorie: 'tabu', hoehe: null });
  const [hoeheText, setHoeheText] = useState('');
  const [fehler, setFehler] = useState('');
  function einsetzen() {
    const t = hoeheText.trim().replace(',', '.');
    const h = t === '' ? null : Number(t);
    if (h !== null && !(h >= 0 && h <= 5)) return setFehler('Höhe: Zahl von 0 bis 5 m');
    if (!e.bezeichnung.trim()) return setFehler('Bitte einen Namen eingeben');
    onEinsetzen({ ...e, bezeichnung: e.bezeichnung.trim(), hoehe: h });
  }
  return (
    <div className="objekt-auswahl sonstige-formular" role="group" aria-label="Sonstige Sperrfläche">
      <h4>Sonstige Sperrfläche</h4>
      <div className="objekt-leiste">
        <label className="leiste-feld">
          <span>Name</span>
          <input value={e.bezeichnung} maxLength={30} aria-label="Name der Sperrfläche" onChange={(x) => setE({ ...e, bezeichnung: x.target.value })} />
        </label>
        <div className="leiste-feld">
          <span>Form</span>
          <Schalter wert={e.umriss} optionen={UMRISSE} onWahl={(u) => setE({ ...e, umriss: u })} beschriftung="Form" />
        </div>
        <div className="leiste-feld">
          <span>
            Kategorie
            <Hilfe begriff="Kategorie" text={HILFE.sperrflaeche} />
          </span>
          <Schalter wert={e.kategorie} optionen={KATEGORIE_WAHL} onWahl={(k) => setE({ ...e, kategorie: k })} beschriftung="Kategorie" />
        </div>
        <label className="leiste-feld">
          <span>Höhe (optional)</span>
          <span className="zahlfeld">
            <input value={hoeheText} inputMode="decimal" aria-label="Höhe der Oberseite in m" placeholder={objekt.hoehe_m === null ? '–' : zahl(objekt.hoehe_m)} onChange={(x) => setHoeheText(x.target.value)} />
            <span className="einheit">m</span>
          </span>
        </label>
      </div>
      {fehler && <Meldung>{fehler}</Meldung>}
      <div className="knopfreihe">
        <button className="knopf" onClick={einsetzen}>
          Einsetzen
        </button>
        <button className="knopf-leise" onClick={onAbbrechen}>
          Zurück
        </button>
      </div>
    </div>
  );
}
