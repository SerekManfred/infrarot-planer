// Offline-Dienst: entscheidet je Anfrage zwischen lokalem Speicher und Server, führt die Warteschlange
// und synchronisiert automatisch, sobald der Server erreichbar ist.
//
// Regeln:
// - Ein ausgecheckter Projekt wird immer lokal bearbeitet (auch online); Änderungen gehen sofort in die
//   Warteschlange und werden der Reihe nach übertragen, jeweils mit dem Sperr-Token des Geräts (X-Sperre).
// - Ohne Netz liefern Projektliste, Fachvorgaben und Bibliotheken den zuletzt gespeicherten Stand.
// - Ohne Netz angelegte Projekte werden lokal geführt und beim Übertragen angelegt und ausgecheckt.
// - Schlägt ein Eintrag fachlich fehl (z. B. 409, 422), hält die Synchronisierung an und zeigt ihn an.

import type { Benutzer, Klimadaten, OfflineVorgaben, Projekt, ProjektDetail, ProjektPaket } from '../api';
import { ApiFehler, istNetzfehler } from '../netz';
import {
  aufgeloesteId,
  ausfuehren,
  LokalFehler,
  neuesProjekt,
  pfadAufloesen,
  projektAnlageDaten,
  projektFuerPfad,
  type Eintrag,
  type LokalesProjekt,
  type Methode,
  type ProjektNeuDaten,
  wartetAufFachpruefer,
} from './lokal';
import type { Speicher } from './speicher';

export type Netz = <T>(methode: string, pfad: string, daten?: unknown, kopf?: Record<string, string>) => Promise<T>;

export interface Problem {
  eintrag: Eintrag;
  meldung: string;
}

export interface OfflineZustand {
  /** Server zuletzt erreichbar */
  online: boolean;
  /** Änderungen in der Warteschlange */
  ausstehend: number;
  laeuft: boolean;
  /** Synchronisierung angehalten wegen eines fachlichen Fehlers */
  problem: Problem | null;
  /** Sitzung abgelaufen: zum Übertragen neu anmelden */
  anmeldungNoetig: boolean;
  letzteSynchronisierung: string | null;
  /** Stand des Vorgaben-Schnappschusses auf dem Gerät */
  vorgabenStand: string | null;
  /** IDs der Projekte im Offline-Speicher (lokale IDs) */
  projekte: number[];
}

const W = {
  vorgaben: 'vorgaben',
  zuordnung: 'zuordnung',
  tempId: 'temp_id',
  benutzer: 'benutzer',
  geraet: 'geraet',
  projektliste: 'projektliste',
} as const;

export class OfflineDienst {
  private projekte: LokalesProjekt[] = [];
  private vorgaben: OfflineVorgaben | null = null;
  private zuordnung: Record<string, number> = {};
  private naechsteTempId = -1;
  private bereit: Promise<void>;
  /** Reihenfolge lokaler Änderungen sichern */
  private kette: Promise<unknown> = Promise.resolve();
  private beobachter = new Set<() => void>();
  private syncZeitgeber: ReturnType<typeof setTimeout> | null = null;
  zustand: OfflineZustand;

  constructor(
    private readonly speicher: Speicher,
    private readonly netz: Netz,
    private readonly jetzt: () => string = () => new Date().toISOString(),
    online = true,
  ) {
    this.zustand = {
      online, ausstehend: 0, laeuft: false, problem: null, anmeldungNoetig: false,
      letzteSynchronisierung: null, vorgabenStand: null, projekte: [],
    };
    this.bereit = this.laden();
  }

  private async laden() {
    this.projekte = await this.speicher.projekte();
    this.vorgaben = (await this.speicher.wertLesen<OfflineVorgaben>(W.vorgaben)) ?? null;
    this.zuordnung = (await this.speicher.wertLesen<Record<string, number>>(W.zuordnung)) ?? {};
    this.naechsteTempId = (await this.speicher.wertLesen<number>(W.tempId)) ?? -1;
    await this.zaehlen();
  }

  // ── Zustand für die Oberfläche ──

  beobachten(fn: () => void): () => void {
    this.beobachter.add(fn);
    return () => this.beobachter.delete(fn);
  }

  private melden(teil: Partial<OfflineZustand>) {
    this.zustand = { ...this.zustand, ...teil };
    this.beobachter.forEach((fn) => fn());
  }

  private async zaehlen() {
    this.melden({
      ausstehend: (await this.speicher.eintraege()).length,
      vorgabenStand: this.vorgaben?.stand ?? null,
      projekte: this.projekte.map((p) => p.id),
    });
  }

  /** Vom Netz gemeldet: Server erreichbar oder nicht */
  erreichbarkeit(erreichbar: boolean) {
    if (erreichbar === this.zustand.online) return;
    this.melden({ online: erreichbar });
    if (erreichbar) this.synchronisierenBald(0);
  }

  // ── Anfragen ──

  private exklusiv<T>(fn: () => Promise<T>): Promise<T> {
    const lauf = this.kette.then(fn, fn);
    this.kette = lauf.catch(() => undefined);
    return lauf;
  }

  private async neueId(): Promise<number> {
    const id = this.naechsteTempId--;
    await this.speicher.wertSchreiben(W.tempId, this.naechsteTempId);
    return id;
  }

  async anfrage<T>(methode: Methode, pfad: string, daten?: unknown): Promise<T> {
    await this.bereit;
    const lp = projektFuerPfad(pfad, this.projekte);
    if (lp) return this.lokal<T>(lp, methode, pfad, daten);

    if (methode === 'GET' && pfad === '/projekte') return (await this.projektliste()) as T;
    if (methode === 'POST' && pfad === '/projekte') {
      try {
        return await this.netz<T>(methode, pfad, daten);
      } catch (e) {
        if (!istNetzfehler(e)) throw e;
        return (await this.offlineAnlegen(daten as ProjektNeuDaten)) as T;
      }
    }
    try {
      const antwort = await this.netz<T>(methode, pfad, daten);
      if (methode === 'GET' && pfad === '/auth/ich') await this.speicher.wertSchreiben(W.benutzer, antwort);
      return antwort;
    } catch (e) {
      if (methode !== 'GET' || !istNetzfehler(e)) throw e;
      const ersatz = await this.ersatzOhneNetz(pfad);
      if (ersatz === undefined) throw e;
      return ersatz as T;
    }
  }

  private lokal<T>(lp: LokalesProjekt, methode: Methode, pfad: string, daten: unknown): Promise<T> {
    return this.exklusiv(async () => {
      let ergebnis;
      try {
        ergebnis = await ausfuehrenMitIds(lp, this.vorgaben, methode, pfad, daten, () => this.neueId());
      } catch (e) {
        if (e instanceof LokalFehler) throw new ApiFehler(e.status, e.message);
        throw e;
      }
      if (ergebnis === null) {
        // lokal nicht beantwortbar (z. B. Protokoll) → Server, mit aufgelösten IDs
        const aufgeloest = pfadAufloesen(pfad, this.zuordnung);
        if (aufgeloest === null) throw new ApiFehler(409, 'Erst verfügbar, wenn die Änderungen übertragen sind.');
        return this.netz<T>(methode, aufgeloest, daten);
      }
      if (ergebnis.eintrag) {
        lp.paket.geaendert_am = this.jetzt();
        await this.speicher.projektSchreiben(lp);
        await this.speicher.eintragAnhaengen({ ...ergebnis.eintrag, zeit: this.jetzt() });
        await this.zaehlen();
        this.synchronisierenBald();
      }
      return ergebnis.antwort as T;
    });
  }

  /** Antworten aus dem gespeicherten Stand, wenn der Server nicht erreichbar ist */
  private async ersatzOhneNetz(pfad: string): Promise<unknown> {
    const [weg, abfrage] = pfad.split('?');
    if (weg === '/auth/ich') return this.speicher.wertLesen<Benutzer>(W.benutzer);
    if (!this.vorgaben) return undefined;
    if (weg === '/fachvorgaben') return this.vorgaben.fachvorgaben;
    if (weg === '/bibliotheken/bauteile') return this.vorgaben.bauteile;
    if (weg === '/bibliotheken/klimadaten') {
      const plz = new URLSearchParams(abfrage ?? '').get('plz');
      return plz ? this.vorgaben.klimadaten.filter((k: Klimadaten) => k.plz === plz) : this.vorgaben.klimadaten;
    }
    if (/^\/projekte\/\d+$/.test(weg)) {
      throw new ApiFehler(0, 'Ohne Verbindung sind nur Projekte verfügbar, die auf diesem Gerät ausgecheckt sind.');
    }
    return undefined;
  }

  /** Projektliste vom Server (wird gespeichert) bzw. ohne Netz die zuletzt gespeicherte – ergänzt um die lokalen Projekte */
  private async projektliste(): Promise<Projekt[]> {
    let liste: Projekt[];
    try {
      liste = await this.netz<Projekt[]>('GET', '/projekte');
      await this.speicher.wertSchreiben(W.projektliste, liste);
    } catch (e) {
      if (!istNetzfehler(e)) throw e;
      liste = (await this.speicher.wertLesen<Projekt[]>(W.projektliste)) ?? [];
    }
    const lokal = this.projekte.map((lp) => {
      const { objekte: _o, ...projekt } = lp.paket;
      return { ...projekt, wartet_auf_fachpruefer: wartetAufFachpruefer(lp.paket) } as Projekt;
    });
    const lokaleIds = new Set(this.projekte.map((lp) => aufgeloesteId(lp.id, this.zuordnung)));
    return [...lokal, ...liste.filter((p) => !lokaleIds.has(p.id))];
  }

  // ── Auschecken, Einchecken, offline anlegen ──

  async geraet(): Promise<string | undefined> {
    await this.bereit;
    return this.speicher.wertLesen<string>(W.geraet);
  }

  async geraetSetzen(name: string) {
    await this.speicher.wertSchreiben(W.geraet, name);
  }

  istLokal(projektId: number): boolean {
    return this.projekte.some((lp) => lp.id === projektId);
  }

  async vorgabenAktualisieren() {
    const v = await this.netz<OfflineVorgaben>('GET', '/offline/vorgaben');
    this.vorgaben = v;
    await this.speicher.wertSchreiben(W.vorgaben, v);
    await this.zaehlen();
  }

  async auschecken(projektId: number, geraet: string): Promise<void> {
    await this.bereit;
    const { sperre } = await this.netz<{ sperre: string }>('POST', `/projekte/${projektId}/auschecken`, { geraet });
    const paket = await this.netz<ProjektPaket>('GET', `/offline/projekte/${projektId}`);
    await this.vorgabenAktualisieren();
    await this.exklusiv(async () => {
      const lp: LokalesProjekt = { id: projektId, paket, sperre, geraet };
      this.projekte = [...this.projekte.filter((p) => p.id !== projektId), lp];
      await this.speicher.projektSchreiben(lp);
      await this.zaehlen();
    });
  }

  /** Überträgt ausstehende Änderungen, hebt die Sperre auf und entfernt das Projekt vom Gerät. Gibt die Server-ID zurück. */
  async einchecken(projektId: number): Promise<number> {
    await this.bereit;
    await this.synchronisieren();
    const offen = (await this.speicher.eintraege()).filter((e) => e.projekt_id === projektId).length;
    if (offen > 0) {
      throw new ApiFehler(409, `${offen} Änderung(en) noch nicht übertragen – Einchecken erst nach erfolgreicher Synchronisierung.`);
    }
    const lp = this.projekte.find((p) => p.id === projektId);
    if (!lp) return projektId;
    const echteId = aufgeloesteId(lp.id, this.zuordnung);
    await this.netz('POST', `/projekte/${echteId}/einchecken`, {}, lp.sperre ? { 'X-Sperre': lp.sperre } : {});
    await this.entfernen(projektId);
    return echteId;
  }

  private async entfernen(projektId: number) {
    await this.exklusiv(async () => {
      this.projekte = this.projekte.filter((p) => p.id !== projektId);
      await this.speicher.projektLoeschen(projektId);
      await this.zaehlen();
    });
  }

  /** Ohne Netz: Projekt lokal anlegen; die Warteschlange legt es später auf dem Server an und checkt es aus */
  private offlineAnlegen(daten: ProjektNeuDaten): Promise<ProjektDetail> {
    return this.exklusiv(async () => {
      const benutzer = await this.speicher.wertLesen<Benutzer>(W.benutzer);
      const geraet = await this.speicher.wertLesen<string>(W.geraet);
      if (!benutzer) throw new ApiFehler(0, 'Server nicht erreichbar');
      const ids: number[] = [await this.neueId(), await this.neueId()];
      const { lp, eintraege } = neuesProjekt(daten, () => ids.shift()!, benutzer, geraet ?? 'dieses Gerät', this.jetzt(), this.vorgaben);
      this.projekte = [...this.projekte, lp];
      await this.speicher.projektSchreiben(lp);
      for (const e of eintraege) await this.speicher.eintragAnhaengen({ ...e, zeit: this.jetzt() });
      await this.zaehlen();
      const { objekte, ...rest } = lp.paket;
      return { ...rest, objekte: objekte.map(({ geschosse: _g, ...o }) => o) };
    });
  }

  // ── Synchronisierung ──

  synchronisierenBald(verzoegerung = 800) {
    if (this.syncZeitgeber) clearTimeout(this.syncZeitgeber);
    this.syncZeitgeber = setTimeout(() => {
      this.syncZeitgeber = null;
      void this.synchronisieren();
    }, verzoegerung);
  }

  private laufend: Promise<void> | null = null;

  /** Überträgt die Warteschlange der Reihe nach. Hält bei Netzfehler, abgelaufener Anmeldung oder fachlichem Fehler an. */
  synchronisieren(): Promise<void> {
    this.laufend ??= this.uebertragen().finally(() => {
      this.laufend = null;
    });
    return this.laufend;
  }

  private async uebertragen() {
    await this.bereit;
    if (this.zustand.problem || this.zustand.anmeldungNoetig) return;
    this.melden({ laeuft: true });
    try {
      for (;;) {
        const [e] = await this.speicher.eintraege();
        if (!e) break;
        const fertig = await this.eintragSenden(e);
        if (!fertig) return;
        await this.speicher.eintragLoeschen(e.nr!);
        await this.zaehlen();
      }
      this.melden({ letzteSynchronisierung: this.jetzt() });
    } finally {
      this.melden({ laeuft: false });
      await this.zaehlen();
    }
  }

  /** true = übertragen (oder hinfällig), false = angehalten */
  private async eintragSenden(e: Eintrag): Promise<boolean> {
    const lp = this.projekte.find((p) => p.id === e.projekt_id);
    const pfad = pfadAufloesen(e.pfad, this.zuordnung);
    if (pfad === null) {
      this.melden({ problem: { eintrag: e, meldung: 'Bezug auf einen Datensatz, der nicht übertragen wurde.' } });
      return false;
    }
    const istAnlage = e.methode === 'POST' && e.pfad === '/projekte';
    const daten = istAnlage && lp ? projektAnlageDaten(lp.paket) : e.daten;
    const kopf: Record<string, string> = lp?.sperre && !istAnlage ? { 'X-Sperre': lp.sperre } : {};
    let antwort: Record<string, unknown>;
    try {
      antwort = (await this.netz<Record<string, unknown>>(e.methode, pfad, daten, kopf)) ?? {};
    } catch (fehler) {
      if (istNetzfehler(fehler)) {
        this.melden({ online: false });
        return false;
      }
      const status = fehler instanceof ApiFehler ? fehler.status : -1;
      if (status === 401) {
        this.melden({ anmeldungNoetig: true });
        return false;
      }
      // Bereits gelöscht → Ziel erreicht
      if (status === 404 && e.methode === 'DELETE') return true;
      this.melden({ problem: { eintrag: e, meldung: (fehler as Error).message } });
      return false;
    }
    if (!this.zustand.online) this.melden({ online: true });
    if (e.temp_id !== undefined && typeof antwort.id === 'number') {
      this.zuordnung[String(e.temp_id)] = antwort.id;
      if (e.temp_objekt_id !== undefined) {
        const objekte = antwort.objekte as { id: number }[] | undefined;
        if (objekte?.[0]) this.zuordnung[String(e.temp_objekt_id)] = objekte[0].id;
      }
      await this.speicher.wertSchreiben(W.zuordnung, this.zuordnung);
    }
    if (lp && /\/auschecken$/.test(e.pfad) && typeof antwort.sperre === 'string') {
      lp.sperre = antwort.sperre;
      await this.speicher.projektSchreiben(lp);
    }
    return true;
  }

  /** Nach einem angezeigten Problem: erneut versuchen */
  erneutVersuchen() {
    this.melden({ problem: null });
    return this.synchronisieren();
  }

  /** Nach einem angezeigten Problem: diese eine Änderung verwerfen und weitermachen */
  async eintragVerwerfen(nr: number) {
    await this.speicher.eintragLoeschen(nr);
    this.melden({ problem: null });
    await this.zaehlen();
    return this.synchronisieren();
  }

  /** Nach erneuter Anmeldung */
  async angemeldet(benutzer: Benutzer) {
    await this.bereit;
    await this.speicher.wertSchreiben(W.benutzer, benutzer);
    this.melden({ anmeldungNoetig: false });
    this.synchronisierenBald(0);
  }

  /** Benutzer, dem die lokalen Daten gehören (zuletzt angemeldet) */
  async lokalerBenutzer(): Promise<Benutzer | undefined> {
    await this.bereit;
    return this.speicher.wertLesen<Benutzer>(W.benutzer);
  }

  hatLokaleDaten(): boolean {
    return this.projekte.length > 0 || this.zustand.ausstehend > 0;
  }

  /**
   * Vor dem Abmelden: online alles übertragen und die Projekte einchecken.
   * Gibt zurück, was auf dem Gerät verloren ginge (ausstehende Änderungen, nicht eingecheckte Projekte).
   */
  async abmeldenVorbereiten(): Promise<{ ausstehend: number; projekte: string[] }> {
    await this.bereit;
    await this.synchronisieren();
    for (const lp of [...this.projekte]) {
      try {
        await this.einchecken(lp.id);
      } catch {
        // bleibt gesperrt; wird unten gemeldet
      }
    }
    return {
      ausstehend: (await this.speicher.eintraege()).length,
      projekte: this.projekte.map((lp) => `${lp.paket.nummer} ${lp.paket.bezeichnung}`),
    };
  }

  /** Löscht alle lokalen Daten des Geräts (der Gerätename bleibt) */
  async allesLoeschen() {
    await this.bereit;
    const geraet = await this.speicher.wertLesen<string>(W.geraet);
    await this.exklusiv(async () => {
      await this.speicher.allesLoeschen();
      if (geraet) await this.speicher.wertSchreiben(W.geraet, geraet);
      this.projekte = [];
      this.vorgaben = null;
      this.zuordnung = {};
      this.naechsteTempId = -1;
      this.melden({ problem: null, anmeldungNoetig: false });
      await this.zaehlen();
    });
  }
}

function ausfuehrenMitIds(
  lp: LokalesProjekt,
  vorgaben: OfflineVorgaben | null,
  methode: Methode,
  pfad: string,
  daten: unknown,
  neueId: () => Promise<number>,
) {
  // ausfuehren() braucht die neue ID synchron; vorab eine reservieren, wenn angelegt wird
  if (methode !== 'POST') return Promise.resolve(ausfuehren(lp, vorgaben, methode, pfad, daten, () => 0));
  return neueId().then((id) => ausfuehren(lp, vorgaben, methode, pfad, daten, () => id));
}
