// Modulauswahl und Platzierung. Alle Zahlen (Regeln, Module, Heizlasten) sind TESTWERTE (Fantasiewerte).

import { describe, expect, it } from 'vitest';
import {
  abstand,
  HINWEIS_BAD,
  leistungPruefen,
  leistungsstatus,
  modulRechteck,
  platziertesModul,
  pruefeModule,
  raumModulplanung,
  regelnAufloesen,
  vorschlagen,
  type KatalogModul,
  type PlatziertesModul,
  type PlatzierungsRaum,
  type BibObjekt,
  type Regel,
  type Sperrflaeche,
  kantenAbstand,
} from '../src';

function regel(schluessel: string, wert: number | null, wert_text = ''): Regel {
  return { schluessel, bezeichnung: `TEST ${schluessel}`, wert, wert_text };
}

/** Regeltabelle mit TESTWERTEN (Abstände in cm) */
function regelTabelle(aenderung: Record<string, number | string | null> = {}): Regel[] {
  const basis: Record<string, number | string | null> = {
    abstand_wand_cm: 50,
    abstand_modul_cm: 40,
    mindesthoehe_m: 2,
    leistungsreserve_prozent: 10,
    ueberdimensionierung_prozent: 20,
    thermostat_je_raum: 'ja',
    bad_min_schutzart: 'IP44',
    ...aenderung,
  };
  return Object.entries(basis).map(([s, w]) => (typeof w === 'string' ? regel(s, null, w) : regel(s, w)));
}

/** Objektbibliothek mit TESTWERTEN (Maße in m, Abstand in cm) */
function obj(schluessel: string, name: string, form: BibObjekt['form'], kategorie: BibObjekt['kategorie'], abstand_cm: number | null, hoehe_m: number | null = null): BibObjekt {
  return { schluessel, name, gruppe: form === 'punkt' ? 'decke' : 'moebel', raumtyp_ids: [], form, breite_m: 1, tiefe_m: 1, hoehe_m, kategorie, abstand_cm };
}
const OBJEKTE: BibObjekt[] = [
  obj('sitzplatz', 'TEST Sitzplatz', 'rechteck', 'tabu', 30, 0.45),
  obj('bett', 'TEST Bett', 'rechteck', 'tabu', 30, 0.5),
  obj('hochschrank', 'TEST Hochschrank', 'rechteck', 'abstand', 30, 2),
  obj('dachschraege', 'TEST Dachschräge', 'streifen', 'abstand', 40),
  obj('dusche', 'TEST Dusche', 'rechteck', 'tabu', null, 0),
  obj('leuchte', 'TEST Leuchte', 'punkt', 'tabu', 50),
  obj('rauchmelder', 'TEST Rauchmelder', 'punkt', 'tabu', 50),
  obj('couchtisch', 'TEST Couchtisch', 'rechteck', 'neutral', null, 0.45),
  obj('kleiderschrank', 'TEST Kleiderschrank', 'rechteck', 'abstand', 30, 2.2),
  obj('lautsprecher', 'TEST Lautsprecher', 'punkt', 'tabu', null),
];
const R = regelnAufloesen(regelTabelle(), OBJEKTE);

const KATALOG: KatalogModul[] = [
  { id: 1, artikel_nr: 'T-A', bezeichnung: 'TESTMODUL A', leistung_w: 250, laenge_mm: 600, breite_mm: 300, schutzart: 'IP54', bad_geeignet: true },
  { id: 2, artikel_nr: 'T-B', bezeichnung: 'TESTMODUL B', leistung_w: 350, laenge_mm: 900, breite_mm: 300, schutzart: 'IP54', bad_geeignet: true },
  { id: 3, artikel_nr: 'T-C', bezeichnung: 'TESTMODUL C', leistung_w: 540, laenge_mm: 800, breite_mm: 600, schutzart: 'IP54', bad_geeignet: true },
  { id: 4, artikel_nr: 'T-D', bezeichnung: 'TESTMODUL D', leistung_w: 900, laenge_mm: 1000, breite_mm: 800, schutzart: 'IP44', bad_geeignet: true },
  { id: 5, artikel_nr: 'T-E', bezeichnung: 'TESTMODUL E', leistung_w: 1350, laenge_mm: 1700, breite_mm: 700, schutzart: 'IP44', bad_geeignet: true },
  { id: 6, artikel_nr: 'T-F', bezeichnung: 'TESTMODUL F', leistung_w: 420, laenge_mm: 600, breite_mm: 600, schutzart: 'IP20', bad_geeignet: false },
  { id: 7, artikel_nr: 'T-X', bezeichnung: 'AUSGELAUFEN', leistung_w: 300, laenge_mm: 600, breite_mm: 300, schutzart: 'IP54', bad_geeignet: true, aktiv: false },
];

function ids() {
  let n = 0;
  return () => `m${++n}`;
}

function raum(laenge_m: number, breite_m: number, teil: Partial<PlatzierungsRaum> = {}): PlatzierungsRaum {
  return { laenge_m, breite_m, hoehe_m: 2.5, ist_bad: false, ...teil };
}

function sperr(objekt: string, x: number, y: number, b = 0, t = 0): Sperrflaeche {
  return { id: `${objekt}-${x}-${y}`, objekt, x, y, b, t };
}

function ohneVerstoss(r: PlatzierungsRaum, s: Sperrflaeche[], module: PlatziertesModul[]) {
  const p = pruefeModule(r, s, module, R);
  expect(Object.values(p.verstoesse).flat()).toEqual([]);
}

describe('Regeln auflösen', () => {
  it('cm → m, ja/nein, Schutzart; fehlende Werte bleiben null', () => {
    expect(R.wand_m).toBe(0.5);
    expect(R.modul_m).toBe(0.4);
    expect(R.objekte.bett).toEqual({ name: 'TEST Bett', form: 'rechteck', kategorie: 'tabu', abstand_m: 0.3, hoehe_m: 0.5 });
    expect(R.objekte.dusche.abstand_m).toBeNull();
    expect(R.thermostat_je_raum).toBe(true);
    expect(R.bad_min_ip).toBe(44);
    expect(regelnAufloesen(undefined).wand_m).toBeNull();
  });
});

describe('Modulauswahl und Platzierung', () => {
  it('kleiner Raum 2,5 × 2,0 m, 300 W: benötigt 330 W → ein Modul T-B (350 W), regelkonform, keine Warnung', () => {
    const r = raum(2.5, 2.0);
    const v = vorschlagen(r, [], KATALOG, R, 300, ids());
    expect(v.benoetigt_w).toBeCloseTo(330);
    expect(v.module?.map((m) => m.artikel_nr)).toEqual(['T-B']);
    expect(v.installiert_w).toBe(350);
    expect(v.hinweise).toEqual([]);
    ohneVerstoss(r, [], v.module!);
    // Längsseite parallel zur langen Raumseite (x), mittig
    const a = modulRechteck(v.module![0]);
    expect(v.module![0].gedreht).toBe(false);
    expect(a.x + a.b / 2).toBeCloseTo(1.25, 1);
    expect(a.y + a.t / 2).toBeCloseTo(1.0, 1);
  });

  it('großer Raum 8 × 6 m, 3 000 W: möglichst wenige Module (3 × T-E), gleichmäßig verteilt, Warnung Überdimensionierung', () => {
    const r = raum(8, 6);
    const v = vorschlagen(r, [], KATALOG, R, 3000, ids());
    expect(v.module).toHaveLength(3);
    expect(v.module!.every((m) => m.artikel_nr === 'T-E' && !m.gedreht)).toBe(true);
    expect(v.installiert_w).toBe(4050);
    expect(v.hinweise).toEqual(['Installierte Leistung 4.050 W übersteigt die benötigte 3.300 W um 23 % (max. 20 %)']);
    ohneVerstoss(r, [], v.module!);
    // gleichmäßig: alle Paare weit auseinander, Schwerpunkt nahe der Raummitte
    const mitten = v.module!.map((m) => {
      const a = modulRechteck(m);
      return { x: a.x + a.b / 2, y: a.y + a.t / 2 };
    });
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(Math.hypot(mitten[i].x - mitten[j].x, mitten[i].y - mitten[j].y)).toBeGreaterThan(1.5);
    expect(mitten.reduce((s, m) => s + m.x, 0) / 3).toBeCloseTo(4, 0);
  });

  it('Bad: nur Module „Bad geeignet“ ab IP44, Hinweis Elektrofachkraft; T-F (IP20) wird bemängelt', () => {
    const r = raum(3, 2.5, { ist_bad: true });
    const v = vorschlagen(r, [], KATALOG, R, 400, ids());
    expect(v.module).toHaveLength(1);
    expect(v.module![0].artikel_nr).toBe('T-C');
    expect(v.hinweise).toContain(HINWEIS_BAD);
    ohneVerstoss(r, [], v.module!);

    const falsch = [platziertesModul(KATALOG[5], 1.2, 0.95, false, 'f')];
    const p = pruefeModule(r, [], falsch, R);
    expect(p.verstoesse.f).toEqual(['nicht für das Bad geeignet (IP20)']);
    expect(p.hinweise).toContain(HINWEIS_BAD);
    // nur IP44 gefordert: IP40 mit „Bad geeignet“ wird trotzdem abgelehnt
    const ip40 = [{ ...falsch[0], bad_geeignet: true, schutzart: 'IP40' }];
    expect(pruefeModule(r, [], ip40, R).verstoesse.f).toEqual(['Schutzart IP40 unter IP44 (Bad)']);
  });

  it('Raum mit vielen Sperrflächen: Module nur in der zulässigen Fläche, nie über Sitzplatz oder Bett', () => {
    const r = raum(5, 4);
    const s = [
      sperr('sitzplatz', 0.5, 0.5, 1.5, 1.2),
      sperr('bett', 3.0, 2.0, 1.6, 2.0),
      sperr('hochschrank', 0, 3.4, 2.0, 0.6),
      { ...sperr('dachschraege', 0, 0, 5, 0.8), wand: 'oben' as const },
      sperr('leuchte', 2.5, 2.0),
      sperr('rauchmelder', 1.2, 2.6),
    ];
    const v = vorschlagen(r, s, KATALOG, R, 300, ids());
    expect(v.meldung).toBeNull();
    expect(v.module!.length).toBeGreaterThan(0);
    expect(v.installiert_w).toBeGreaterThanOrEqual(330);
    ohneVerstoss(r, s, v.module!);
    for (const m of v.module!) {
      expect(abstand(modulRechteck(m), s[0])).toBeGreaterThanOrEqual(0.3 - 1e-9);
      expect(abstand(modulRechteck(m), s[1])).toBeGreaterThanOrEqual(0.3 - 1e-9);
    }
  });

  it('ohne gültige Lösung: klare Meldung mit größter möglicher Leistung und Vorschlag', () => {
    const r = raum(3, 3);
    const s = [sperr('bett', 0.5, 0.5, 2.0, 1.0)];
    const v = vorschlagen(r, s, KATALOG, R, 2000, ids());
    expect(v.module).toBeNull();
    expect(v.meldung).toMatch(/^Keine gültige Lösung: benötigt 2\.200 W, in die freie Deckenfläche passen höchstens .* W \(\d+ × T-[A-F]\)\. Vorschlag: kleinere oder mehr Module wählen, Sperrflächen prüfen\.$/);
  });

  it('Raum, in den gar kein Modul passt', () => {
    const v = vorschlagen(raum(1.2, 1.2), [], KATALOG, R, 200, ids());
    expect(v.module).toBeNull();
    expect(v.meldung).toContain('Kein Modul passt in die freie Deckenfläche');
  });

  it('ausgelaufene (inaktive) Module werden nicht vorgeschlagen', () => {
    const v = vorschlagen(raum(2.5, 2.0), [], KATALOG, R, 250, ids());
    expect(v.module![0].artikel_nr).not.toBe('T-X');
  });

  it('schmaler, langer Raum quer (Breite > Länge): Module gedreht entlang der langen Seite', () => {
    const r = raum(2.4, 6);
    const v = vorschlagen(r, [], KATALOG, R, 1500, ids());
    expect(v.module!.every((m) => m.gedreht)).toBe(true);
    ohneVerstoss(r, [], v.module!);
  });

  it('fehlende Regeln: keine automatische Planung, nichts geschätzt', () => {
    const ohneWand = regelnAufloesen(regelTabelle({ abstand_wand_cm: null }), OBJEKTE);
    expect(vorschlagen(raum(4, 4), [], KATALOG, ohneWand, 500, ids()).meldung).toBe(
      'Vorgabe fehlt: TEST abstand_wand_cm – keine automatische Platzierung.',
    );
    const ohneReserve = regelnAufloesen(regelTabelle({ leistungsreserve_prozent: null }), OBJEKTE);
    expect(vorschlagen(raum(4, 4), [], KATALOG, ohneReserve, 500, ids()).meldung).toContain('Vorgabe fehlt: TEST leistungsreserve_prozent');
    expect(vorschlagen(raum(4, 4), [], KATALOG, R, null, ids()).meldung).toContain('Keine Heizlast');
  });

  it('zu niedriger Raum: keine Deckenmontage', () => {
    const v = vorschlagen(raum(4, 4, { hoehe_m: 1.9 }), [], KATALOG, R, 500, ids());
    expect(v.meldung).toBe('Raumhöhe 1,90 m unter der Mindesthöhe 2,00 m – keine Deckenmontage.');
  });
});

describe('Regelprüfung (manuelle Korrektur)', () => {
  const r = raum(4, 3);
  const modul = (x: number, y: number, id: string, gedreht = false) => platziertesModul(KATALOG[2], x, y, gedreht, id); // 0,8 × 0,6 m

  it('Verstöße im Klartext: Wand, Modulabstand, Sitzplatz, Leuchte, Raumgrenze', () => {
    const s = [sperr('sitzplatz', 2.5, 1.5, 1.0, 1.0), sperr('leuchte', 1.6, 0.9)];
    const module = [modul(0.3, 0.6, 'a'), modul(1.2, 0.6, 'b'), modul(2.6, 1.6, 'c'), modul(3.5, 0.6, 'd')];
    const p = pruefeModule(r, s, module, R);
    expect(p.verstoesse.a).toEqual(['Abstand zur Wand 30 cm (mind. 50 cm)', 'Abstand zu Modul 2 (T-C) 10 cm (mind. 40 cm)']);
    expect(p.verstoesse.b).toEqual(['liegt über TEST Leuchte', 'Abstand zu Modul 1 (T-C) 10 cm (mind. 40 cm)']);
    expect(p.verstoesse.c[0]).toBe('liegt über TEST Sitzplatz – dort ist kein Modul zulässig');
    expect(p.verstoesse.d).toEqual(['ragt über den Raum hinaus']);
  });

  it('Leuchte unter dem Modul und Abstand zur Leuchte', () => {
    const p = pruefeModule(r, [sperr('leuchte', 1.5, 1.0)], [modul(1.2, 0.8, 'a'), modul(2.6, 0.6, 'b')], R);
    expect(p.verstoesse.a).toEqual(['liegt über TEST Leuchte']);
    expect(p.verstoesse.b).toEqual([]);
  });

  it('Sperrfläche ohne Abstandsregel (Dusche): nur Überdeckung geprüft, Hinweis „Vorgabe fehlt“', () => {
    const s = [sperr('dusche', 2.5, 0.5, 1.0, 1.0)];
    const p = pruefeModule(r, s, [modul(0.6, 0.6, 'a'), modul(2.6, 1.0, 'b')], R);
    expect(p.verstoesse.a).toEqual([]);
    expect(p.verstoesse.b).toEqual(['liegt über TEST Dusche – dort ist kein Modul zulässig']);
    expect(p.hinweise).toContain('Vorgabe fehlt: Mindestabstand zu TEST Dusche (Objektbibliothek) – geprüft wird nur, dass kein Modul darüber liegt');
  });

  it('Kategorie „abstand“: Modul darf über dem Objekt liegen, braucht aber Abstand zur Kante', () => {
    // Kleiderschrank 3 × 2 m (TESTWERT, absichtlich groß), Abstand 30 cm; Modul 0,8 × 0,6 m
    const s = [sperr('kleiderschrank', 0.5, 0.5, 3.0, 2.0)];
    const innen = modul(1.5, 1.2, 'a'); // Kanten 1,0 / 0,7 / 1,7 / 0,7 m entfernt
    const nahInnen = modul(0.6, 1.2, 'b'); // 10 cm zur linken Kante
    const ueberKante = modul(0.2, 1.2, 'c'); // ragt über die Kante
    const p = pruefeModule(raum(4.5, 3.5), s, [innen], R);
    expect(p.verstoesse.a).toEqual([]);
    expect(pruefeModule(raum(4.5, 3.5), s, [nahInnen], R).verstoesse.b).toEqual(['Abstand zur Kante TEST Kleiderschrank 10 cm (mind. 30 cm)']);
    expect(pruefeModule(raum(4.5, 3.5), s, [ueberKante], R).verstoesse.c).toContain('Abstand zur Kante TEST Kleiderschrank 0 cm (mind. 30 cm)');
  });

  it('Kategorie „neutral“: keine Regel; unbekanntes Objekt gilt als tabu', () => {
    const p = pruefeModule(r, [sperr('couchtisch', 1.0, 0.5, 2.0, 2.0)], [modul(1.6, 1.2, 'a')], R);
    expect(p.verstoesse.a).toEqual([]);
    expect(p.hinweise).toEqual([]);
    const u = pruefeModule(r, [sperr('gibtsnicht', 1.0, 0.5, 2.0, 2.0)], [modul(1.6, 1.2, 'a')], R);
    expect(u.verstoesse.a).toEqual(['liegt über Objekt „gibtsnicht“ – dort ist kein Modul zulässig']);
    expect(u.hinweise).toContain('Vorgabe fehlt: Objekt „gibtsnicht“ ist nicht in der Objektbibliothek des Projekts – geprüft wird nur, dass kein Modul darüber liegt');
  });

  it('ältere Daten mit festem Typ werden über den gleichnamigen Objektschlüssel geprüft', () => {
    const alt: Sperrflaeche = { id: 'x', typ: 'sitzplatz', x: 2.5, y: 1.5, b: 1.0, t: 1.0 };
    expect(pruefeModule(r, [alt], [modul(2.6, 1.6, 'c')], R).verstoesse.c[0]).toBe('liegt über TEST Sitzplatz – dort ist kein Modul zulässig');
  });

  it('Punkt ohne Mindestabstand: keine automatische Platzierung', () => {
    const v = vorschlagen(raum(4, 4), [sperr('lautsprecher', 2, 2)], KATALOG, R, 500, ids());
    expect(v.module).toBeNull();
    expect(v.meldung).toContain('Vorgabe fehlt: Mindestabstand zu TEST Lautsprecher (Objektbibliothek)');
  });

  it('Kantenabstand: außen, innen, über die Kante', () => {
    const o = { x: 1, y: 1, b: 3, t: 2 };
    expect(kantenAbstand({ x: 0, y: 1, b: 0.5, t: 0.5 }, o)).toBeCloseTo(0.5);
    expect(kantenAbstand({ x: 1.2, y: 1.5, b: 1, t: 0.5 }, o)).toBeCloseTo(0.2);
    expect(kantenAbstand({ x: 0.8, y: 1.5, b: 1, t: 0.5 }, o)).toBe(0);
  });

  it('Mindesthöhe unterschritten: jedes Modul bemängelt', () => {
    const p = pruefeModule(raum(4, 3, { hoehe_m: 1.95 }), [], [modul(1.6, 1.2, 'a')], R);
    expect(p.verstoesse.a).toEqual(['Raumhöhe 1,95 m unter der Mindesthöhe 2,00 m für Deckenmontage']);
  });
});

describe('Leistung und Raumergebnis', () => {
  it('Unterschreitung und Überdimensionierung', () => {
    expect(leistungPruefen(1000, 900, R)).toEqual(['Installierte Leistung 900 W unterschreitet die benötigte Leistung 1.000 W']);
    expect(leistungPruefen(1000, 1200, R)).toEqual([]);
    expect(leistungPruefen(1000, 1250, R)).toEqual(['Installierte Leistung 1.250 W übersteigt die benötigte 1.000 W um 25 % (max. 20 %)']);
  });

  it('Raumergebnis: Typen, Anzahl, installierte Leistung, ein Thermostat, Verstöße gezählt', () => {
    const r = raum(5, 4);
    const module = [
      platziertesModul(KATALOG[2], 0.6, 0.6, false, 'a'),
      platziertesModul(KATALOG[2], 3.6, 0.6, false, 'b'),
      platziertesModul(KATALOG[1], 0.6, 3.0, false, 'c'),
    ];
    const e = raumModulplanung(r, [], module, R, 1200);
    expect(e.benoetigt_w).toBeCloseTo(1320);
    expect(e.installiert_w).toBe(1430);
    expect(e.anzahl).toBe(3);
    expect(e.typen).toEqual([
      { artikel_nr: 'T-C', bezeichnung: 'TESTMODUL C', leistung_w: 540, anzahl: 2 },
      { artikel_nr: 'T-B', bezeichnung: 'TESTMODUL B', leistung_w: 350, anzahl: 1 },
    ]);
    expect(e.thermostate).toBe(1);
    expect(e.module_mit_verstoss).toBe(0);
    expect(raumModulplanung(r, [], [], R, 1200).thermostate).toBe(0);
  });
});

describe('Unterdimensionierung (Praxistest 31.10.2026: benötigt 880 W, installiert 840 W)', () => {
  it('Leistungsstatus: unter, passend, über; ohne benötigte Leistung oder Module nicht prüfbar', () => {
    expect(leistungsstatus(880, 840, R)).toBe('unter');
    expect(leistungsstatus(880, 900, R)).toBe('passend');
    expect(leistungsstatus(880, 1100, R)).toBe('ueber');
    expect(leistungsstatus(null, 840, R)).toBeNull();
    expect(leistungsstatus(880, 0, R)).toBeNull();
  });

  it('von Hand 2 × 420 W bei 880 W Bedarf: deutliche Warnung als eigenes Feld, nicht nur als Hinweis', () => {
    const r = raum(5, 4);
    const m420 = { ...KATALOG[5], bad_geeignet: true, schutzart: 'IP54' };
    const module = [platziertesModul(m420, 0.6, 0.6, false, 'a'), platziertesModul(m420, 3.6, 2.6, false, 'b')];
    const e = raumModulplanung(r, [], module, R, 800);
    expect(e.leistung).toBe('unter');
    expect(e.leistung_hinweis).toBe('Installierte Leistung 840 W unterschreitet die benötigte Leistung 880 W');
    expect(e.hinweise).toEqual([]);
  });

  it('der automatische Vorschlag unterdimensioniert nie (200 zufällige Räume mit Sperrflächen)', () => {
    let saat = 42;
    const zufall = () => ((saat = (saat * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let geprueft = 0;
    for (let i = 0; i < 200; i++) {
      const L = 2 + zufall() * 6;
      const B = 2 + zufall() * 5;
      const s: Sperrflaeche[] = zufall() < 0.5 ? [sperr('sitzplatz', zufall() * (L - 1.5), zufall() * (B - 1), 1.5, 1)] : [];
      const heizlast = 200 + zufall() * 2500;
      const v = vorschlagen(raum(L, B, { ist_bad: zufall() < 0.2 }), s, KATALOG, R, heizlast, ids());
      if (!v.module) continue;
      geprueft++;
      expect(v.installiert_w).toBeGreaterThanOrEqual(v.benoetigt_w! - 1e-6);
      expect(v.installiert_w).toBe(v.module.reduce((x, m) => x + m.leistung_w, 0));
    }
    expect(geprueft).toBeGreaterThan(100);
  });
});
