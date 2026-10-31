// Lokale Bearbeitung eines ausgecheckten Projekts. Zahlen sind TESTWERTE.
import { describe, expect, it } from 'vitest';
import { ausfuehren, LokalFehler, neuesProjekt, pfadAufloesen, projektFuerPfad, wartetAufFachpruefer, type LokalesProjekt } from '../src/offline/lokal';
import { paket, vorgaben } from './hilfen';

function lp(): LokalesProjekt {
  return { id: 5, paket: paket(), sperre: 'token', geraet: 'Tablet 1' };
}

function zaehler(start = -1) {
  let n = start;
  return () => n--;
}

describe('projektFuerPfad', () => {
  const projekte = [lp()];
  it('findet das Projekt über jede Ebene', () => {
    expect(projektFuerPfad('/projekte/5', projekte)?.id).toBe(5);
    expect(projektFuerPfad('/objekte/50/auswertung', projekte)?.id).toBe(5);
    expect(projektFuerPfad('/geschosse/500/raeume', projekte)?.id).toBe(5);
    expect(projektFuerPfad('/raeume/5000', projekte)?.id).toBe(5);
  });
  it('fremde Daten und andere Pfade gehen ans Netz', () => {
    expect(projektFuerPfad('/raeume/7777', projekte)).toBeNull();
    expect(projektFuerPfad('/projekte', projekte)).toBeNull();
    expect(projektFuerPfad('/fachvorgaben', projekte)).toBeNull();
    expect(projektFuerPfad('/bibliotheken/klimadaten?plz=1', projekte)).toBeNull();
  });
});

describe('ausfuehren', () => {
  it('liest Geschosse und Räume ohne Kinderlisten', () => {
    const p = lp();
    const geschosse = ausfuehren(p, null, 'GET', '/objekte/50/geschosse', undefined, zaehler())!.antwort as object[];
    expect(geschosse).toHaveLength(1);
    expect(geschosse[0]).not.toHaveProperty('raeume');
    const projekt = ausfuehren(p, null, 'GET', '/projekte/5', undefined, zaehler())!.antwort as { objekte: object[] };
    expect(projekt.objekte[0]).not.toHaveProperty('geschosse');
  });

  it('legt einen Raum mit vorläufiger ID und Standardwerten an und rechnet die Fläche', () => {
    const p = lp();
    const e = ausfuehren(p, null, 'POST', '/geschosse/500/raeume', { bezeichnung: 'Bad', laenge_m: 2, breite_m: 3 }, zaehler())!;
    expect(e.antwort).toMatchObject({ id: -1, geschoss_id: 500, heizlastquelle: 'A', flaeche_m2: 6, hoehe_m: null });
    expect(e.eintrag).toMatchObject({ methode: 'POST', pfad: '/geschosse/500/raeume', temp_id: -1, projekt_id: 5 });
    expect(e.eintrag!.beschreibung).toBe('Raum „Bad“ angelegt');
    expect(p.paket.objekte[0].geschosse[0].raeume.map((r) => r.id)).toEqual([5000, -1]);
    // Der neue Raum ist sofort weiter bearbeitbar
    ausfuehren(p, null, 'PATCH', '/raeume/-1', { breite_m: 4 }, zaehler());
    expect(p.paket.objekte[0].geschosse[0].raeume[1].flaeche_m2).toBe(8);
  });

  it('Änderung eines geprüften Projekts setzt es lokal auf Entwurf zurück', () => {
    const p = lp();
    p.paket.status = 'geprueft';
    ausfuehren(p, null, 'PATCH', '/raeume/5000', { hoehe_m: 2.6 }, zaehler());
    expect(p.paket.status).toBe('entwurf');
  });

  it('Altbau wartet auf den Fachprüfer, solange ein Raum keinen W/m²-Wert hat – auch offline', () => {
    const p = lp();
    const lesen = () => (ausfuehren(p, null, 'GET', '/projekte/5', undefined, zaehler())!.antwort as { wartet_auf_fachpruefer: boolean }).wartet_auf_fachpruefer;
    expect(lesen()).toBe(false); // Neubau
    p.paket.objekte[0].gebaeudestandard = 'sonstiger_bestand';
    expect(wartetAufFachpruefer(p.paket)).toBe(true);
    expect(lesen()).toBe(true);
    ausfuehren(p, null, 'PATCH', '/raeume/5000', { pauschale_w_m2: 99 }, zaehler());
    expect(lesen()).toBe(false);
    // neuer Raum ohne Wert: wartet wieder
    ausfuehren(p, null, 'POST', '/geschosse/500/raeume', { bezeichnung: 'Bad' }, zaehler());
    expect(lesen()).toBe(true);
  });

  it('löscht mit allen Kindern', () => {
    const p = lp();
    const e = ausfuehren(p, null, 'DELETE', '/geschosse/500', undefined, zaehler())!;
    expect(e.eintrag).toMatchObject({ methode: 'DELETE', pfad: '/geschosse/500' });
    expect(projektFuerPfad('/raeume/5000', [p])).toBeNull();
  });

  it('Geschosse nach Reihenfolge, neue bei Gleichstand hinten', () => {
    const p = lp();
    ausfuehren(p, null, 'POST', '/objekte/50/geschosse', { bezeichnung: 'KG', reihenfolge: 0 }, zaehler(-1));
    ausfuehren(p, null, 'POST', '/objekte/50/geschosse', { bezeichnung: 'OG', reihenfolge: 1 }, zaehler(-2));
    const namen = (ausfuehren(p, null, 'GET', '/objekte/50/geschosse', undefined, zaehler())!.antwort as { bezeichnung: string }[]).map(
      (g) => g.bezeichnung,
    );
    expect(namen).toEqual(['KG', 'EG', 'OG']);
  });

  it('rechnet die Auswertung offline mit dem Rechenkern: 20 m² · 33 W/m² = 660 W', () => {
    const a = ausfuehren(lp(), vorgaben(), 'GET', '/objekte/50/auswertung', undefined, zaehler())!.antwort as {
      summe: { phi_massgeblich_w: number };
      raeume: { werte: { pauschale_w_m2: { herkunft: string } } }[];
    };
    expect(a.summe.phi_massgeblich_w).toBe(660);
    expect(a.raeume[0].werte.pauschale_w_m2.herkunft).toBe('vorgabe');
  });

  it('Tür und Fenster offline: gespeichert, in der Warteschlange, ohne Einfluss auf die Auswertung', () => {
    const p = lp();
    const vorher = ausfuehren(p, vorgaben(), 'GET', '/objekte/50/auswertung', undefined, zaehler())!.antwort;
    const e = ausfuehren(p, vorgaben(), 'PATCH', '/raeume/5000', {
      tueren_fenster: [
        { id: 't1', art: 'tuer', wand: 'unten', position: 0.5, breite: 0.9, aufschlag: 'innen', band: 'links' },
        { id: 'f1', art: 'fenster', wand: 'oben', position: 1.5, breite: 1.2 },
      ],
    }, zaehler())!;
    expect(e.eintrag).toMatchObject({ methode: 'PATCH', pfad: '/raeume/5000' });
    expect(p.paket.objekte[0].geschosse[0].raeume[0].tueren_fenster).toHaveLength(2);
    expect(ausfuehren(p, vorgaben(), 'GET', '/objekte/50/auswertung', undefined, zaehler())!.antwort).toEqual(vorher);
  });

  it('Deckenplan offline: Sperrflächen und Module speichern, Regelprüfung mit den eingefrorenen Regeln', () => {
    const p = lp();
    // Regeln im Projektstand (TESTWERTE)
    p.paket.vorgaben_stand!.regeln = [
      { schluessel: 'abstand_wand_cm', bezeichnung: 'TEST Wand', wert: 50, wert_text: '', einheit: 'cm', erlaeuterung: '', quelle: 'TESTWERT', reihenfolge: 0 },
      { schluessel: 'abstand_sitzplatz_cm', bezeichnung: 'TEST Sitz', wert: 30, wert_text: '', einheit: 'cm', erlaeuterung: '', quelle: 'TESTWERT', reihenfolge: 1 },
      { schluessel: 'thermostat_je_raum', bezeichnung: 'TEST Thermostat', wert: null, wert_text: 'ja', einheit: 'ja/nein', erlaeuterung: '', quelle: 'TESTWERT', reihenfolge: 2 },
    ];
    const modul = {
      id: 'm1', modul_id: 1, artikel_nr: 'T-1', bezeichnung: 'TESTMODUL', leistung_w: 750, laenge_m: 0.9, breite_m: 0.7,
      schutzart: 'IP44', bad_geeignet: true, x: 0.2, y: 2.0, gedreht: false,
    };
    const e = ausfuehren(p, vorgaben(), 'PATCH', '/raeume/5000', {
      sperrflaechen: [{ id: 's1', typ: 'sitzplatz', x: 2, y: 2, b: 1.5, t: 1 }],
      module: [modul],
    }, zaehler())!;
    expect(e.eintrag).toMatchObject({ methode: 'PATCH', pfad: '/raeume/5000' });
    const a = ausfuehren(p, vorgaben(), 'GET', '/objekte/50/auswertung', undefined, zaehler())!.antwort as {
      raeume: { modulplanung: { installiert_w: number; thermostate: number; verstoesse: Record<string, string[]> } }[];
      summe: { module: number };
    };
    expect(a.raeume[0].modulplanung.installiert_w).toBe(750);
    expect(a.raeume[0].modulplanung.thermostate).toBe(1);
    expect(a.raeume[0].modulplanung.verstoesse.m1).toEqual(['Abstand zur Wand 20 cm (mind. 50 cm)']);
    expect(a.summe.module).toBe(1);
  });

  it('Klimadaten aus dem Schnappschuss für die Gegenprobe', () => {
    const p = lp();
    ausfuehren(p, null, 'PATCH', '/objekte/50', { klimadaten_id: 1 }, zaehler());
    const a = ausfuehren(p, vorgaben(), 'GET', '/objekte/50/auswertung', undefined, zaehler())!.antwort as {
      vorgaben: { theta_e: { wert: number; herkunft: string } };
    };
    expect(a.vorgaben.theta_e).toEqual({ wert: -10, herkunft: 'klimadaten' });
  });

  it('rechnet mit den eingefrorenen Vorgaben des Projekts, nicht mit dem neueren Schnappschuss des Geräts', () => {
    const geraet = vorgaben();
    geraet.fachvorgaben.pauschalen[0].w_m2 = 99;
    const a = ausfuehren(lp(), geraet, 'GET', '/objekte/50/auswertung', undefined, zaehler())!.antwort as { summe: { phi_massgeblich_w: number } };
    expect(a.summe.phi_massgeblich_w).toBe(660);
    // ohne Schnappschuss des Geräts genügt der Projektstand
    expect(ausfuehren(lp(), null, 'GET', '/objekte/50/auswertung', undefined, zaehler())).not.toBeNull();
  });

  it('hoher Raum: Hinweis statt Zuschlag (Hinweis-Höhe aus dem Projektstand)', () => {
    const p = lp();
    ausfuehren(p, null, 'PATCH', '/raeume/5000', { hoehe_m: 3.2 }, zaehler());
    const a = ausfuehren(p, null, 'GET', '/objekte/50/auswertung', undefined, zaehler())!.antwort as {
      raeume: { phi_a_w: number; hinweise: string[] }[];
    };
    expect(a.raeume[0].phi_a_w).toBe(660);
    expect(a.raeume[0].hinweise).toEqual(['Raumhöhe über 2,90 m – Pauschale prüfen und ggf. manuell anpassen.']);
  });

  it('Projektvorgaben lokal ohne Vergleich; Übernahme erst nach dem Einchecken', () => {
    const v = ausfuehren(lp(), null, 'GET', '/projekte/5/vorgaben', undefined, zaehler())!.antwort as {
      unterschiede: unknown;
      vorgaben: { werte: { rueckfall_neubau_w_m2: number }; gebaeudestandards: Record<string, string> };
    };
    expect(v.unterschiede).toBeNull();
    expect(v.vorgaben.werte.rueckfall_neubau_w_m2).toBe(45);
    expect(v.vorgaben.gebaeudestandards.neubau).toBe('Neubau');
    expect(() => ausfuehren(lp(), null, 'POST', '/projekte/5/vorgaben/uebernehmen', {}, zaehler())).toThrow(/Einchecken/);
    expect(() => ausfuehren(lp(), null, 'POST', '/projekte/5/vorgaben/ablehnen', {}, zaehler())).toThrow(/Einchecken/);
  });

  it('offene Fachvorgaben vom Auschecken sperren das Angebot auch offline', () => {
    const p = lp();
    const lesen = () => ausfuehren(p, null, 'GET', '/projekte/5', undefined, zaehler())!.antwort as { angebot_gesperrt: boolean };
    expect(lesen().angebot_gesperrt).toBe(false);
    p.paket.vorgaben_offen = true;
    expect(lesen().angebot_gesperrt).toBe(true);
    const v = ausfuehren(p, null, 'GET', '/projekte/5/vorgaben', undefined, zaehler())!.antwort as { offen: boolean };
    expect(v.offen).toBe(true);
  });

  it('offene Moduldaten vom Auschecken sperren das Angebot auch offline', () => {
    const p = lp();
    const lesen = () => ausfuehren(p, null, 'GET', '/projekte/5', undefined, zaehler())!.antwort as { angebot_gesperrt: boolean };
    expect(lesen().angebot_gesperrt).toBe(false);
    p.paket.module_offen = true;
    expect(lesen().angebot_gesperrt).toBe(true);
  });

  it('ohne Fachvorgaben keine Auswertung, Statuswechsel nicht lokal, Protokoll ans Netz', () => {
    const ohneStand = lp();
    ohneStand.paket.vorgaben_stand = null;
    expect(() => ausfuehren(ohneStand, null, 'GET', '/objekte/50/auswertung', undefined, zaehler())).toThrow(LokalFehler);
    expect(() => ausfuehren(lp(), null, 'POST', '/projekte/5/status', { status: 'geprueft' }, zaehler())).toThrow(/eingecheckt/);
    expect(ausfuehren(lp(), null, 'GET', '/projekte/5/protokoll', undefined, zaehler())).toBeNull();
  });

  it('unbekannte ID → 404', () => {
    expect(() => ausfuehren(lp(), null, 'PATCH', '/projekte/6', {}, zaehler())).toThrow(LokalFehler);
  });
});

describe('neuesProjekt und pfadAufloesen', () => {
  it('offline angelegt: Projekt und Gebäude mit vorläufigen IDs, Anlegen und Auschecken in der Warteschlange', () => {
    const { lp: neu, eintraege } = neuesProjekt(
      { bezeichnung: 'Neu', gebaeudestandard: 'neubau' },
      zaehler(),
      { id: 1, name: 'Test' },
      'Tablet 1',
      '2026-10-10T08:00:00Z',
      vorgaben(),
    );
    expect(neu.paket.vorgaben_stand?.werte.rueckfall_neubau_w_m2).toBe(45);
    expect(neu.id).toBe(-1);
    expect(neu.paket.objekte[0]).toMatchObject({ id: -2, projekt_id: -1, gebaeudestandard: 'neubau', geschosse: [] });
    expect(eintraege.map((e) => e.pfad)).toEqual(['/projekte', '/projekte/-1/auschecken']);
    expect(eintraege[0]).toMatchObject({ temp_id: -1, temp_objekt_id: -2 });
  });

  it('ersetzt vorläufige IDs; fehlt eine Zuordnung → null', () => {
    expect(pfadAufloesen('/geschosse/-3/raeume', { '-3': 77 })).toBe('/geschosse/77/raeume');
    expect(pfadAufloesen('/raeume/-12', { '-1': 5, '-12': 9 })).toBe('/raeume/9');
    expect(pfadAufloesen('/raeume/12', {})).toBe('/raeume/12');
    expect(pfadAufloesen('/raeume/-4', {})).toBeNull();
  });
});
