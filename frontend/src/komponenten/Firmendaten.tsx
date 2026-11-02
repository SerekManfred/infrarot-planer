// Firmendaten und Logo (Paket M3, 02.11.2026) – nur Admin. Mehrere Firmen; eine ist Standard für Berichte, je Projekt
// kann eine andere gewählt werden. Logo: PNG, JPG oder SVG bis 2 MB; der Server prüft den Inhalt, wandelt SVG in PNG
// um und vergibt einen neuen Dateinamen. Ohne Logo steht der Firmenname als Text im Kopf der Berichte.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Firma } from '../api';
import { Meldung, Textfeld } from './Felder';

const FELDER: [keyof Firma, string][] = [
  ['name', 'Name'], ['rechtsform', 'Rechtsform'], ['strasse', 'Straße'], ['plz', 'PLZ'], ['ort', 'Ort'], ['telefon', 'Telefon'],
  ['email', 'E-Mail'], ['web', 'Web'], ['geschaeftsfuehrer', 'Geschäftsführer'], ['handelsregister', 'Handelsregister'], ['ust_idnr', 'USt-IdNr.'],
];

export function FirmendatenSeite() {
  const [firmen, setFirmen] = useState<Firma[] | null>(null);
  const [fehler, setFehler] = useState('');
  const [hinweis, setHinweis] = useState('');
  const laden = useCallback(() => {
    api.get<Firma[]>('/firmen').then(setFirmen).catch((e) => setFehler((e as Error).message));
  }, []);
  useEffect(laden, [laden]);

  async function aendern(aktion: () => Promise<unknown>, erfolg = '') {
    setFehler('');
    setHinweis('');
    try {
      await aktion();
      setHinweis(erfolg);
    } catch (e) {
      setFehler((e as Error).message);
    }
    laden();
  }

  return (
    <section>
      <h1>Firmendaten</h1>
      <Meldung art="hinweis">
        Für die Kopf- und Fußzeilen der Berichte. Die Standardfirma gilt für alle Projekte, die keine andere Berichtsfirma gewählt haben.
        Jede Änderung wird protokolliert.
      </Meldung>
      {fehler && <Meldung>{fehler}</Meldung>}
      {hinweis && <Meldung art="hinweis">{hinweis}</Meldung>}
      {firmen === null ? (
        <p>Wird geladen …</p>
      ) : (
        firmen.map((f) => <FirmaKarte key={f.id} firma={f} aendern={aendern} />)
      )}
      <NeueFirma aendern={aendern} />
    </section>
  );
}

function FirmaKarte({ firma, aendern }: { firma: Firma; aendern: (a: () => Promise<unknown>, erfolg?: string) => Promise<void> }) {
  const [datei, setDatei] = useState<File | null>(null);
  const setzen = (feld: keyof Firma) => (wert: unknown) => aendern(() => api.patch(`/firmen/${firma.id}`, { [feld]: wert }));
  function hochladen(e: FormEvent) {
    e.preventDefault();
    if (!datei) return;
    const form = new FormData();
    form.append('datei', datei);
    void aendern(() => api.post(`/firmen/${firma.id}/logo`, form), `Logo für ${firma.name} gespeichert.`).then(() => setDatei(null));
  }
  return (
    <div className="karte firma">
      <div className="firma-kopf">
        <h2>{firma.name}</h2>
        {firma.standard ? (
          <span className="chip">Standard für Berichte</span>
        ) : (
          <button className="knopf-leise klein" onClick={() => void setzen('standard')(true)}>
            Als Standard festlegen
          </button>
        )}
      </div>
      <div className="raster">
        {FELDER.map(([feld, name]) => (
          <label key={feld}>
            {name}
            <Textfeld wert={String(firma[feld] ?? '')} pflicht={feld === 'name'} beschriftung={`${firma.name}: ${name}`} onSpeichern={setzen(feld)} />
          </label>
        ))}
      </div>
      <div className="logo-bereich">
        <span className="feldname">Logo</span>
        {firma.hat_logo ? (
          <img className="logo-vorschau" src={`/api/firmen/${firma.id}/logo?v=${encodeURIComponent(firma.geaendert_am)}`} alt={`Logo ${firma.name}`} />
        ) : (
          <Meldung art="warnung">Kein Logo hinterlegt – in den Berichten steht dann der Firmenname als Text im Kopf.</Meldung>
        )}
        <form className="knopfreihe" onSubmit={hochladen}>
          <input type="file" aria-label={`Logo für ${firma.name}`} accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" onChange={(e) => setDatei(e.target.files?.[0] ?? null)} />
          <button className="knopf-zweit" type="submit" disabled={!datei}>
            {firma.hat_logo ? 'Logo ersetzen' : 'Logo hochladen'}
          </button>
          {firma.hat_logo && (
            <button type="button" className="knopf-leise" onClick={() => window.confirm('Logo löschen?') && void aendern(() => api.loeschen(`/firmen/${firma.id}/logo`), 'Logo gelöscht.')}>
              Logo löschen
            </button>
          )}
        </form>
        <small className="leise">PNG, JPG oder SVG, höchstens 2 MB. SVG wird beim Hochladen bereinigt und in PNG umgewandelt.</small>
      </div>
      {!firma.standard && (
        <button className="knopf-gefahr" onClick={() => window.confirm(`Firma „${firma.name}“ löschen? Projekte mit dieser Berichtsfirma nutzen danach die Standardfirma.`) && void aendern(() => api.loeschen(`/firmen/${firma.id}`), 'Firma gelöscht.')}>
          Firma löschen
        </button>
      )}
    </div>
  );
}

function NeueFirma({ aendern }: { aendern: (a: () => Promise<unknown>, erfolg?: string) => Promise<void> }) {
  const [name, setName] = useState('');
  function absenden(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    void aendern(() => api.post('/firmen', { name: name.trim() }), 'Firma angelegt.').then(() => setName(''));
  }
  return (
    <form className="karte knopfreihe" onSubmit={absenden}>
      <input aria-label="Name der neuen Firma" placeholder="Neue Firma, z. B. Muster GmbH" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="knopf-zweit" type="submit">
        + Firma
      </button>
    </form>
  );
}
