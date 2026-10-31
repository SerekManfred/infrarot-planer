// Offline-Dienst mit Speicher im Arbeitsspeicher und nachgebautem Server. Zahlen sind TESTWERTE.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Projekt } from '../src/api';
import { ApiFehler } from '../src/netz';
import { OfflineDienst } from '../src/offline/dienst';
import { SpeicherImArbeitsspeicher } from '../src/offline/speicher';
import { paket, vorgaben } from './hilfen';

interface Aufruf {
  methode: string;
  pfad: string;
  daten?: unknown;
  kopf: Record<string, string>;
}

/** Nachgebauter Server: erreichbar oder nicht, legt Datensätze mit fortlaufenden IDs ab 100 an */
class Server {
  erreichbar = true;
  aufrufe: Aufruf[] = [];
  naechsteId = 100;
  /** Antwortet auf den nächsten passenden Aufruf mit diesem Fehler */
  fehler: { pfad: RegExp; status: number; meldung: string } | null = null;
  liste: Projekt[] = [];

  netz = async <T,>(methode: string, pfad: string, daten?: unknown, kopf: Record<string, string> = {}): Promise<T> => {
    if (!this.erreichbar) throw new ApiFehler(0, 'Server nicht erreichbar');
    this.aufrufe.push({ methode, pfad, daten, kopf });
    if (this.fehler && this.fehler.pfad.test(pfad)) {
      const f = this.fehler;
      this.fehler = null;
      throw new ApiFehler(f.status, f.meldung);
    }
    if (methode === 'GET' && pfad === '/projekte') return this.liste as T;
    if (methode === 'GET' && pfad === '/offline/vorgaben') return vorgaben() as T;
    if (methode === 'GET' && pfad.startsWith('/offline/projekte/')) return paket() as T;
    if (pfad.endsWith('/auschecken')) return { sperre: `token-${pfad}` } as T;
    if (methode === 'POST' && pfad === '/projekte') return { id: this.naechsteId++, nummer: '2026-0007', objekte: [{ id: this.naechsteId++ }] } as T;
    if (methode === 'POST') return { id: this.naechsteId++ } as T;
    return {} as T;
  };

  /** Aufrufe ohne Lesezugriffe */
  aenderungen() {
    return this.aufrufe.filter((a) => a.methode !== 'GET').map((a) => `${a.methode} ${a.pfad}`);
  }
}

let server: Server;
let speicher: SpeicherImArbeitsspeicher;
let dienst: OfflineDienst;

beforeEach(async () => {
  vi.useFakeTimers();
  server = new Server();
  speicher = new SpeicherImArbeitsspeicher();
  dienst = new OfflineDienst(speicher, server.netz, () => '2026-10-10T09:00:00Z');
  await dienst.geraetSetzen('Tablet 1');
});

async function ausgechecktOffline() {
  await dienst.auschecken(5, 'Tablet 1');
  server.erreichbar = false;
  dienst.erreichbarkeit(false);
}

describe('Auschecken und lokale Bearbeitung', () => {
  it('auschecken speichert Projekt, Token und Vorgaben-Schnappschuss', async () => {
    await dienst.auschecken(5, 'Tablet 1');
    expect(dienst.istLokal(5)).toBe(true);
    expect(dienst.zustand.vorgabenStand).toBe('2026-10-10T08:00:00Z');
    expect((await speicher.projekte())[0].sperre).toBe('token-/projekte/5/auschecken');
  });

  it('ohne Netz: bearbeiten, rechnen und Änderungen zählen', async () => {
    await ausgechecktOffline();
    const raum = await dienst.anfrage<{ id: number }>('POST', '/geschosse/500/raeume', { bezeichnung: 'Bad', laenge_m: 2, breite_m: 3 });
    expect(raum.id).toBe(-1);
    await dienst.anfrage('PATCH', `/raeume/${raum.id}`, { hoehe_m: 2.5 });
    const a = await dienst.anfrage<{ summe: { phi_massgeblich_w: number } }>('GET', '/objekte/50/auswertung');
    // 20 m² + 6 m² ohne Raumtyp: 660 W + 6 · 45 W (Rückfallwert) = 930 W
    expect(a.summe.phi_massgeblich_w).toBe(930);
    expect(dienst.zustand.ausstehend).toBe(2);
    // Fachvorgaben und Klimadaten aus dem Schnappschuss
    expect(await dienst.anfrage('GET', '/bibliotheken/klimadaten?plz=12345')).toHaveLength(1);
    expect(await dienst.anfrage('GET', '/fachvorgaben')).toMatchObject({ werte: { rueckfall_neubau_w_m2: 45 } });
  });

  it('Synchronisierung bei Verbindung: der Reihe nach, vorläufige IDs ersetzt, mit Sperr-Token', async () => {
    await ausgechecktOffline();
    const raum = await dienst.anfrage<{ id: number }>('POST', '/geschosse/500/raeume', { bezeichnung: 'Bad' });
    await dienst.anfrage('PATCH', `/raeume/${raum.id}`, { hoehe_m: 2.5 });
    const flaeche = await dienst.anfrage<{ id: number }>('POST', `/raeume/${raum.id}/flaechen`, { flaeche_brutto_m2: 4 });
    await dienst.anfrage('DELETE', `/flaechen/${flaeche.id}`);

    server.erreichbar = true;
    server.aufrufe = [];
    await dienst.synchronisieren();
    expect(server.aenderungen()).toEqual([
      'POST /geschosse/500/raeume',
      'PATCH /raeume/100',
      'POST /raeume/100/flaechen',
      'DELETE /flaechen/101',
    ]);
    expect(server.aufrufe.every((a) => a.kopf['X-Sperre'] === 'token-/projekte/5/auschecken')).toBe(true);
    expect(dienst.zustand).toMatchObject({ ausstehend: 0, online: true, problem: null });
    // lokal bleibt die vorläufige ID gültig
    expect(await dienst.anfrage('GET', `/raeume/${raum.id}`)).toMatchObject({ bezeichnung: 'Bad', hoehe_m: 2.5 });
  });

  it('fachlicher Fehler hält an; verwerfen setzt fort', async () => {
    await ausgechecktOffline();
    await dienst.anfrage('PATCH', '/raeume/5000', { hoehe_m: 99 });
    await dienst.anfrage('PATCH', '/raeume/5000', { hoehe_m: 2.7 });
    server.erreichbar = true;
    server.fehler = { pfad: /raeume\/5000/, status: 422, meldung: 'Eingaben ungültig – bitte Werte prüfen' };
    await dienst.synchronisieren();
    expect(dienst.zustand.problem?.meldung).toMatch(/ungültig/);
    expect(dienst.zustand.ausstehend).toBe(2);

    await dienst.eintragVerwerfen(dienst.zustand.problem!.eintrag.nr!);
    expect(dienst.zustand).toMatchObject({ problem: null, ausstehend: 0 });
    // der abgelehnte Wert wurde einmal versucht und danach nicht erneut gesendet
    expect(server.aufrufe.filter((a) => a.methode === 'PATCH').map((a) => a.daten)).toEqual([{ hoehe_m: 99 }, { hoehe_m: 2.7 }]);
  });

  it('aufgehobene Sperre (409) wird angezeigt, nichts geht verloren', async () => {
    await ausgechecktOffline();
    await dienst.anfrage('PATCH', '/raeume/5000', { hoehe_m: 2.7 });
    server.erreichbar = true;
    server.fehler = { pfad: /raeume/, status: 409, meldung: 'Die Offline-Sperre dieses Geräts für das Projekt wurde aufgehoben.' };
    await dienst.synchronisieren();
    expect(dienst.zustand.problem?.meldung).toMatch(/aufgehoben/);
    expect(dienst.zustand.ausstehend).toBe(1);
  });

  it('abgelaufene Anmeldung: anhalten, nach Anmeldung weiter', async () => {
    await ausgechecktOffline();
    await dienst.anfrage('PATCH', '/raeume/5000', { hoehe_m: 2.7 });
    server.erreichbar = true;
    server.fehler = { pfad: /raeume/, status: 401, meldung: 'Nicht angemeldet' };
    await dienst.synchronisieren();
    expect(dienst.zustand.anmeldungNoetig).toBe(true);
    await dienst.angemeldet({ id: 1, email: 't@test.invalid', name: 'Test', rollen: ['aussendienst'], aktiv: true });
    await vi.runAllTimersAsync();
    expect(dienst.zustand).toMatchObject({ anmeldungNoetig: false, ausstehend: 0 });
  });

  it('Einchecken überträgt zuerst, hebt die Sperre auf und entfernt das Projekt', async () => {
    await ausgechecktOffline();
    await dienst.anfrage('PATCH', '/raeume/5000', { hoehe_m: 2.7 });
    server.erreichbar = true;
    expect(await dienst.einchecken(5)).toBe(5);
    expect(server.aenderungen()).toEqual(['POST /projekte/5/auschecken', 'PATCH /raeume/5000', 'POST /projekte/5/einchecken']);
    expect(dienst.istLokal(5)).toBe(false);
  });

  it('Einchecken ohne Netz scheitert und behält alles', async () => {
    await ausgechecktOffline();
    await dienst.anfrage('PATCH', '/raeume/5000', { hoehe_m: 2.7 });
    await expect(dienst.einchecken(5)).rejects.toThrow(/nicht übertragen/);
    expect(dienst.istLokal(5)).toBe(true);
  });
});

describe('Ohne Netz angelegtes Projekt', () => {
  it('wird lokal geführt, später angelegt, ausgecheckt und weiter übertragen', async () => {
    await speicher.wertSchreiben('benutzer', { id: 1, name: 'Test' });
    server.erreichbar = false;
    const p = await dienst.anfrage<{ id: number; objekte: { id: number }[] }>('POST', '/projekte', {
      bezeichnung: 'Neu', gebaeudestandard: 'neubau',
    });
    expect(p.id).toBeLessThan(0);
    const g = await dienst.anfrage<{ id: number }>('POST', `/objekte/${p.objekte[0].id}/geschosse`, { bezeichnung: 'EG' });
    // Bezeichnung korrigiert, bevor übertragen wurde: geht mit der Anlage mit; die Nummer vergibt der Server
    await dienst.anfrage('PATCH', `/projekte/${p.id}`, { bezeichnung: 'Neu 2' });
    expect((await dienst.anfrage<Projekt[]>('GET', '/projekte')).map((x) => x.nummer)).toEqual(['Nr. folgt']);

    server.erreichbar = true;
    await dienst.synchronisieren();
    expect(server.aenderungen()).toEqual([
      'POST /projekte',
      'POST /projekte/100/auschecken',
      'POST /objekte/101/geschosse',
      'PATCH /projekte/100',
    ]);
    const anlage = server.aufrufe.find((a) => a.pfad === '/projekte')!.daten as Record<string, unknown>;
    expect(anlage).toMatchObject({ bezeichnung: 'Neu 2', gebaeudestandard: 'neubau' });
    expect(anlage).not.toHaveProperty('nummer');
    // vom Server vergebene Nummer erscheint lokal
    expect((await dienst.anfrage<Projekt[]>('GET', '/projekte')).map((x) => x.nummer)).toEqual(['2026-0007']);
    expect(server.aufrufe.find((a) => a.pfad === '/objekte/101/geschosse')!.kopf['X-Sperre']).toBe('token-/projekte/100/auschecken');
    expect(g.id).toBeLessThan(0);
    // Projektliste: Server kennt das Projekt jetzt als 100 – es erscheint nur einmal (lokal)
    server.liste = [{ id: 100, nummer: 'N-2' } as Projekt];
    expect((await dienst.anfrage<Projekt[]>('GET', '/projekte')).map((x) => x.id)).toEqual([p.id]);
    // Einchecken liefert die Server-ID
    expect(await dienst.einchecken(p.id)).toBe(100);
  });
});

describe('Abmelden', () => {
  it('online: überträgt, checkt ein, nichts geht verloren', async () => {
    await dienst.auschecken(5, 'Tablet 1');
    await dienst.anfrage('PATCH', '/raeume/5000', { hoehe_m: 2.7 });
    expect(await dienst.abmeldenVorbereiten()).toEqual({ ausstehend: 0, projekte: [] });
  });

  it('offline: meldet ausstehende Änderungen und gesperrte Projekte; löschen leert alles', async () => {
    await ausgechecktOffline();
    await dienst.anfrage('PATCH', '/raeume/5000', { hoehe_m: 2.7 });
    expect(await dienst.abmeldenVorbereiten()).toEqual({ ausstehend: 1, projekte: ['T-5 Testprojekt'] });
    await dienst.allesLoeschen();
    expect(dienst.hatLokaleDaten()).toBe(false);
    expect(await speicher.eintraege()).toEqual([]);
    expect(await dienst.geraet()).toBe('Tablet 1');
  });
});
