// Offline-Speicher in IndexedDB: Projekte, Warteschlange und Einzelwerte (Vorgaben-Schnappschuss, Projektliste …).
// Die Schnittstelle Speicher erlaubt in den Tests einen Speicher im Arbeitsspeicher.

import type { Eintrag, LokalesProjekt } from './lokal';

export interface Speicher {
  wertLesen<T>(schluessel: string): Promise<T | undefined>;
  wertSchreiben(schluessel: string, wert: unknown): Promise<void>;
  projekte(): Promise<LokalesProjekt[]>;
  projektSchreiben(lp: LokalesProjekt): Promise<void>;
  projektLoeschen(id: number): Promise<void>;
  eintraege(): Promise<Eintrag[]>;
  eintragAnhaengen(e: Eintrag): Promise<void>;
  eintragLoeschen(nr: number): Promise<void>;
  allesLoeschen(): Promise<void>;
}

const DB_NAME = 'infrarot-planer';
const SPEICHER = ['werte', 'projekte', 'warteschlange'] as const;

function alsPromise<T>(anfrage: IDBRequest<T>): Promise<T> {
  return new Promise((ok, fehler) => {
    anfrage.onsuccess = () => ok(anfrage.result);
    anfrage.onerror = () => fehler(anfrage.error);
  });
}

export class IndexedDbSpeicher implements Speicher {
  private db: Promise<IDBDatabase> | null = null;

  private oeffnen(): Promise<IDBDatabase> {
    this.db ??= new Promise((ok, fehler) => {
      const anfrage = indexedDB.open(DB_NAME, 1);
      anfrage.onupgradeneeded = () => {
        const db = anfrage.result;
        db.createObjectStore('werte');
        db.createObjectStore('projekte', { keyPath: 'id' });
        db.createObjectStore('warteschlange', { keyPath: 'nr', autoIncrement: true });
      };
      anfrage.onsuccess = () => ok(anfrage.result);
      anfrage.onerror = () => fehler(anfrage.error);
    });
    return this.db;
  }

  private async mit<T>(name: (typeof SPEICHER)[number], modus: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.oeffnen();
    const t = db.transaction(name, modus);
    const ergebnis = await alsPromise(fn(t.objectStore(name)));
    await new Promise<void>((ok, fehler) => {
      t.oncomplete = () => ok();
      t.onerror = () => fehler(t.error);
      t.onabort = () => fehler(t.error);
    });
    return ergebnis;
  }

  wertLesen<T>(schluessel: string) {
    return this.mit('werte', 'readonly', (s) => s.get(schluessel) as IDBRequest<T | undefined>);
  }
  async wertSchreiben(schluessel: string, wert: unknown) {
    await this.mit('werte', 'readwrite', (s) => s.put(wert, schluessel));
  }
  projekte() {
    return this.mit('projekte', 'readonly', (s) => s.getAll() as IDBRequest<LokalesProjekt[]>);
  }
  async projektSchreiben(lp: LokalesProjekt) {
    await this.mit('projekte', 'readwrite', (s) => s.put(lp));
  }
  async projektLoeschen(id: number) {
    await this.mit('projekte', 'readwrite', (s) => s.delete(id));
  }
  eintraege() {
    return this.mit('warteschlange', 'readonly', (s) => s.getAll() as IDBRequest<Eintrag[]>);
  }
  async eintragAnhaengen(e: Eintrag) {
    await this.mit('warteschlange', 'readwrite', (s) => s.add(e));
  }
  async eintragLoeschen(nr: number) {
    await this.mit('warteschlange', 'readwrite', (s) => s.delete(nr));
  }
  async allesLoeschen() {
    for (const name of SPEICHER) await this.mit(name, 'readwrite', (s) => s.clear());
  }
}

/** Für Tests */
export class SpeicherImArbeitsspeicher implements Speicher {
  werte = new Map<string, unknown>();
  lp = new Map<number, LokalesProjekt>();
  schlange: Eintrag[] = [];
  private nr = 0;

  async wertLesen<T>(schluessel: string) {
    return structuredClone(this.werte.get(schluessel)) as T | undefined;
  }
  async wertSchreiben(schluessel: string, wert: unknown) {
    this.werte.set(schluessel, structuredClone(wert));
  }
  async projekte() {
    return [...this.lp.values()].map((p) => structuredClone(p));
  }
  async projektSchreiben(lp: LokalesProjekt) {
    this.lp.set(lp.id, structuredClone(lp));
  }
  async projektLoeschen(id: number) {
    this.lp.delete(id);
  }
  async eintraege() {
    return structuredClone(this.schlange);
  }
  async eintragAnhaengen(e: Eintrag) {
    this.schlange.push({ ...structuredClone(e), nr: ++this.nr });
  }
  async eintragLoeschen(nr: number) {
    this.schlange = this.schlange.filter((e) => e.nr !== nr);
  }
  async allesLoeschen() {
    this.werte.clear();
    this.lp.clear();
    this.schlange = [];
  }
}
