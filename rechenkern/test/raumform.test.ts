// Räume aus Rechtecken (Paket M2, 02.11.2026). Alle Maße und Regeln sind TESTWERTE.
import { describe, expect, it } from 'vitest';
import {
  berechneObjekt,
  enthaeltRechteck,
  platziertesModul,
  pruefeModule,
  raumform,
  regelnAufloesen,
  vorschlagen,
  waermeverteilung,
  wandAbstand,
  type KatalogModul,
  type Regel,
} from '../src';

const regel = (schluessel: string, wert: number | null, wert_text = ''): Regel => ({ schluessel, bezeichnung: `TEST ${schluessel}`, wert, wert_text });
const R = regelnAufloesen([regel('abstand_wand_cm', 50), regel('abstand_modul_cm', 40), regel('leistungsreserve_prozent', 10), regel('ueberdimensionierung_prozent', 50)]);
const MODUL: KatalogModul = { id: 1, artikel_nr: 'T-1', bezeichnung: 'TESTMODUL', leistung_w: 500, laenge_mm: 1000, breite_mm: 600, schutzart: 'IP44', bad_geeignet: true };

// L-Form: 6 × 4 m, oben rechts 3 × 2 m ausgeschnitten → 24 − 6 = 18 m²
const L_FORM = raumform({ basis: { w: 6, h: 4 }, teile: [{ op: 'sub', wand: 'oben', versatz: 3, laenge: 3, tiefe: 2 }] });

describe('Raumform aus Rechtecken', () => {
  it('Rechteck ohne Teile: Fläche, Umfang, 4 Wände', () => {
    const f = raumform({ basis: { w: 5, h: 4 }, teile: [] });
    expect([f.flaeche_m2, f.umfang_m, f.segmente.length, f.rechteck]).toEqual([20, 18, 4, true]);
  });

  it('L-Form: Fläche 18 m², Umfang 20 m, 6 Wandsegmente, Innenecke bei (3 | 2)', () => {
    expect(L_FORM.flaeche_m2).toBe(18);
    expect(L_FORM.umfang_m).toBe(20);
    expect(L_FORM.segmente).toHaveLength(6);
    expect(L_FORM.umriss[0]).toContainEqual({ x: 3, y: 2 });
  });

  it('Abstand an der Innenecke euklidisch: Modul schräg vor der Ecke', () => {
    // Modul links unterhalb der Innenecke (3 | 2): Ecke liegt 0,3 m rechts und 0,4 m oberhalb → 0,5 m
    const m = { x: 1.7, y: 2.4, b: 1.0, t: 0.6 };
    expect(enthaeltRechteck(L_FORM, m)).toBe(true);
    expect(wandAbstand(L_FORM, m)).toBeCloseTo(0.5);
    // näher an die Ecke: 0,3 m bzw. 0,2 m → 0,36 m
    expect(wandAbstand(L_FORM, { x: 1.7, y: 2.2, b: 1.0, t: 0.6 })).toBeCloseTo(Math.hypot(0.3, 0.2));
  });

  it('Modul über dem Einsprung unzulässig, daneben mit Wandabstand zulässig', () => {
    const raum = { laenge_m: 6, breite_m: 4, hoehe_m: 2.5, ist_bad: false, form: L_FORM };
    const ueber = platziertesModul(MODUL, 3.5, 0.6, false, 'a'); // liegt im ausgeschnittenen Bereich
    const nahEcke = platziertesModul(MODUL, 2.2, 2.2, false, 'b'); // 0,2 m unter der Innenwand
    const gut = platziertesModul(MODUL, 1.0, 1.0, false, 'c');
    const p = pruefeModule(raum, [], [ueber, nahEcke, gut], R);
    expect(p.verstoesse.a).toEqual(['ragt über den Raum hinaus']);
    expect(p.verstoesse.b[0]).toBe('Abstand zur Wand 20 cm (mind. 50 cm)');
    expect(p.verstoesse.c).toEqual([]);
  });

  it('automatische Platzierung bleibt im L und hält die Abstände auch an der Innenecke', () => {
    const raum = { laenge_m: 6, breite_m: 4, hoehe_m: 2.5, ist_bad: false, form: L_FORM };
    let n = 0;
    const v = vorschlagen(raum, [], [MODUL], R, 1300, () => `m${++n}`);
    expect(v.module!.length).toBeGreaterThan(1);
    expect(Object.values(pruefeModule(raum, [], v.module!, R).verstoesse).flat()).toEqual([]);
  });

  it('U-Form: Ausschnitt in der Mitte der oberen Wand', () => {
    const f = raumform({ basis: { w: 6, h: 4 }, teile: [{ op: 'sub', wand: 'oben', versatz: 2, laenge: 2, tiefe: 2.5 }] });
    expect(f.flaeche_m2).toBe(24 - 5);
    expect(f.segmente).toHaveLength(8);
    expect(enthaeltRechteck(f, { x: 2.5, y: 0.5, b: 1, t: 1 })).toBe(false);
    expect(enthaeltRechteck(f, { x: 0.5, y: 0.5, b: 1, t: 1 })).toBe(true);
  });

  it('Ausschnitt in einer Ecke und Erker als Anbau (negative Koordinaten an der oberen Wand)', () => {
    const ecke = raumform({ basis: { w: 4, h: 3 }, teile: [{ op: 'sub', wand: 'rechts', versatz: 2, laenge: 1, tiefe: 1 }] });
    expect(ecke.flaeche_m2).toBe(11);
    const erker = raumform({ basis: { w: 4, h: 3 }, teile: [{ op: 'add', wand: 'oben', versatz: 1, laenge: 2, tiefe: 0.8 }] });
    expect(erker.flaeche_m2).toBeCloseTo(13.6);
    expect(erker.bbox).toEqual({ x0: 0, y0: -0.8, x1: 4, y1: 3 });
    expect(enthaeltRechteck(erker, { x: 1.2, y: -0.6, b: 0.5, t: 0.5 })).toBe(true);
  });

  it('Heizlast aus der Gesamtfläche; Wärmeverteilung nur im Raum', () => {
    const raum = {
      id: 1, bezeichnung: 'L', raumtyp_id: null, laenge_m: 6, breite_m: 4, flaeche_m2: 24, hoehe_m: 2.5, volumen_m3: null,
      heizlastquelle: 'A' as const, hottgenroth_w: null, pauschale_w_m2: 50, theta_int: null, luftwechsel: null, flaechen: [],
      geometrie: { basis: { w: 6, h: 4 }, teile: [{ op: 'sub' as const, wand: 'oben' as const, versatz: 3, laenge: 3, tiefe: 2 }] },
    };
    const a = berechneObjekt({
      art: 'objekt',
      objekt: { id: 1, bezeichnung: 'O', gebaeudestandard: 'neubau', gebaeudestandard_text: 'Neubau', delta_u_wb: null, pauschale_abweichungen: {}, theta_e: null },
      vorgaben: { rueckfall_neubau_w_m2: 40, rueckfall_effizienzhaus_sanierung_w_m2: null, rueckfall_sonstiger_bestand_w_m2: null, hoehe_hinweis_m: null, delta_u_wb: null },
      pauschalen: [], raumtypen: [], bauteile: [], geschosse: [{ id: 1, bezeichnung: 'EG', raeume: [raum] }],
    }).auswertung.raeume[0];
    expect(a.flaeche_m2).toBe(18);
    expect(a.phi_massgeblich_w).toBe(900);
    expect(a.umfang_m).toBe(20);
    const w = waermeverteilung({
      laenge_m: 6, breite_m: 4, hoehe_m: 2.5, raumtemperatur_c: 20, form: L_FORM, raster_m: 0.5, sperrflaechen: [], sperrhoehe: {},
      module: [platziertesModul(MODUL, 1, 2, false, 'x')], kennwerte: new Map([[1, { temperatur_c: 90, emissionsgrad: 0.9, abstrahlwinkel_grad: 180 }]]),
      vorgaben: { temperatur_c: null, emissionsgrad: null, abstrahlwinkel_grad: null },
    });
    expect(w.zellen.filter((z) => z.innen === false)).toHaveLength(24); // 3 × 2 m ausgeschnitten = 6 × 4 Zellen à 0,5 m
    expect(w.min_w_m2).toBeGreaterThan(0);
  });
});

describe('Berichtsstatus je Raum (Paket M4)', () => {
  it('OK bis 20 % Reserve, Prüfen darüber, Unterdeckt unter der Heizlast, ohne Module kein Status', async () => {
    const { berichtStatus } = await import('../src');
    expect(berichtStatus(1000, 1000)).toEqual({ reserve_prozent: 0, status: 'ok' });
    expect(berichtStatus(1000, 1200).status).toBe('ok');
    expect(berichtStatus(1000, 1210)).toMatchObject({ status: 'pruefen' });
    expect(berichtStatus(1000, 950).status).toBe('unterdeckt');
    expect(berichtStatus(1000, 950).reserve_prozent).toBeCloseTo(-5);
    expect(berichtStatus(1000, 0)).toEqual({ reserve_prozent: null, status: null });
    expect(berichtStatus(null, 500).status).toBeNull();
  });
});

describe('Türen und Fenster an Wandsegmenten (Paket N2)', () => {
  it('nächstes Segment: Ausrichtung nach innen, Wandlinie, Bereich; Hauptrechteck ohne eigene Linie', async () => {
    const { naechstesSegment, oeffnungStrecke, tuerGeometrie } = await import('../src');
    // L-Form 6 × 4 m, oben rechts 3 × 2 m ausgeschnitten: Innenwand y = 2 von x = 3 bis 6 (Raum darunter)
    const innen = naechstesSegment({ x: 4.5, y: 2.1 }, L_FORM.segmente, 6, 4)!;
    expect(innen).toMatchObject({ wand: 'oben', linie: 2, von: 3, bis: 6 });
    // obere Wand des Hauptrechtecks ist nur noch 3 m lang
    expect(naechstesSegment({ x: 1, y: 0.1 }, L_FORM.segmente, 6, 4)).toMatchObject({ wand: 'oben', linie: null, von: 0, bis: 3 });
    expect(naechstesSegment({ x: 5.9, y: 3 }, L_FORM.segmente, 6, 4)).toMatchObject({ wand: 'rechts', linie: null, von: 2, bis: 4 });
    // senkrechte Innenwand x = 3 (Raum links davon)
    expect(naechstesSegment({ x: 3.05, y: 1 }, L_FORM.segmente, 6, 4)).toMatchObject({ wand: 'rechts', linie: 3, von: 0, bis: 2 });
    const tuer = { id: 't', art: 'tuer' as const, wand: 'oben' as const, linie: 2, position: 4, breite: 0.9, aufschlag: 'innen' as const, band: 'links' as const };
    expect(oeffnungStrecke(tuer, 6, 4)).toEqual([{ x: 4, y: 2 }, { x: 4.9, y: 2 }]);
    expect(tuerGeometrie(tuer, 6, 4).blatt.y).toBeCloseTo(2.9); // schlägt in den Raum (nach unten)
  });
});

describe('Sonstige Sperrfläche rund/quadratisch (Paket N4)', () => {
  it('Abstand Kreis ↔ Modul über den Kreis, nicht über die umschließende Box; eigene Kategorie und Name', async () => {
    const { kreisAbstand, kreisKantenAbstand, pruefeModule, regelnAufloesen } = await import('../src');
    const kreis = { x: 1, y: 1, b: 2, t: 2 }; // Mittelpunkt (2|2), Radius 1
    // Modul diagonal vor der Box-Ecke: Box-Abstand 0, Kreis-Abstand √(0,2²+0,2²)… genauer: Ecke (0,8|0,8) → Abstand √2·1,2 − 1
    const m = { x: 0.2, y: 0.2, b: 0.6, t: 0.6 };
    expect(kreisAbstand(m, kreis)).toBeCloseTo(Math.hypot(1.2, 1.2) - 1);
    expect(kreisAbstand({ x: 1.5, y: 1.5, b: 0.5, t: 0.5 }, kreis)).toBe(0);
    expect(kreisKantenAbstand({ x: 1.8, y: 1.8, b: 0.4, t: 0.4 }, kreis)).toBeCloseTo(1 - Math.hypot(0.2, 0.2));
    const R = regelnAufloesen([{ schluessel: 'abstand_wand_cm', bezeichnung: 'W', wert: 10, wert_text: '' }], [
      { schluessel: 'sonstiges', name: 'Sonstige Sperrfläche', gruppe: 'moebel', raumtyp_ids: [], form: 'rechteck', breite_m: 1, tiefe_m: 1, hoehe_m: 0.75, kategorie: 'tabu', abstand_cm: 30 },
    ]);
    const raum = { laenge_m: 5, breite_m: 5, hoehe_m: 2.5, ist_bad: false };
    const modul = (x: number, y: number) => ({ id: 'a', modul_id: null, artikel_nr: 'T', bezeichnung: 'T', leistung_w: 300, laenge_m: 0.6, breite_m: 0.6, schutzart: '', bad_geeignet: false, x, y, gedreht: false });
    const kamin = { id: 'k', objekt: 'sonstiges', bezeichnung: 'Kamin', umriss: 'rund' as const, x: 1, y: 1, b: 2, t: 2 };
    // in der Box-Ecke, aber 0,52 m vom Kreis entfernt → kein Verstoß (über die Box wäre es „liegt über“)
    expect(pruefeModule(raum, [kamin], [modul(0.2, 0.2)], R).verstoesse.a).toEqual([]);
    // Modul links neben dem Kreis, 0,25 m vom Kreisrand → unter 30 cm
    expect(pruefeModule(raum, [kamin], [modul(0.15, 1.7)], R).verstoesse.a).toEqual(['Abstand zu Kamin 25 cm (mind. 30 cm)']);
    expect(pruefeModule(raum, [kamin], [modul(1.7, 1.7)], R).verstoesse.a).toEqual(['liegt über Kamin – dort ist kein Modul zulässig']);
    // eigene Kategorie neutral: keine Regel
    expect(pruefeModule(raum, [{ ...kamin, kategorie: 'neutral' as const }], [modul(1.7, 1.7)], R).verstoesse.a).toEqual([]);
  });
});

describe('Energiebilanz der Wärmeverteilung (Paket N5)', () => {
  it('sehr großer Boden, Abstrahlwinkel 180°: am Boden kommt praktisch die ganze Strahlungsleistung an (Σ E·A ≈ M·A)', async () => {
    const { strahlungsdichte, waermeverteilung } = await import('../src');
    const modul = { id: 'm', modul_id: 1, artikel_nr: 'T', bezeichnung: 'T', leistung_w: 500, laenge_m: 1, breite_m: 1, schutzart: '', bad_geeignet: false, x: 49.5, y: 49.5, gedreht: false };
    const w = waermeverteilung({
      laenge_m: 100, breite_m: 100, hoehe_m: 2.5, raumtemperatur_c: 20, module: [modul], raster_m: 0.5, sperrflaechen: [], sperrhoehe: {},
      kennwerte: new Map([[1, { temperatur_c: 90, emissionsgrad: 0.9, abstrahlwinkel_grad: 180 }]]),
      vorgaben: { temperatur_c: null, emissionsgrad: null, abstrahlwinkel_grad: null },
    });
    const empfangen = w.zellen.reduce((s, z) => s + z.wert * z.b * z.t, 0);
    const pRad = strahlungsdichte(90, 20, 0.9) * 1;
    expect(empfangen / pRad).toBeGreaterThan(0.97);
    expect(empfangen / pRad).toBeLessThan(1.001);
    expect(w.mittel_w_m2 * 100 * 100).toBeCloseTo(empfangen, 6);
  });
});
