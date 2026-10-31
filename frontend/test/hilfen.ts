// Testdaten: alle Zahlen sind TESTWERTE (Fantasiewerte), keine Fachvorgaben.
import type { OfflineVorgaben, ProjektPaket } from '../src/api';

export function vorgaben(): OfflineVorgaben {
  return {
    stand: '2026-10-10T08:00:00Z',
    fachvorgaben: {
      werte: {
        rueckfall_neubau_w_m2: 45,
        rueckfall_effizienzhaus_sanierung_w_m2: 75,
        hoehe_hinweis_m: 2.9,
        delta_u_wb: 0.05,
        quelle: 'TESTWERT',
      },
      raumtypen: [{ id: 10, bezeichnung: 'TESTWOHNEN', theta_int: 20, luftwechsel: 0.5, reduktionsfaktor: null, quelle: '', bemerkung: '', reihenfolge: 0, richtwert_altbau_w_m2: null }],
      pauschalen: [{ raumtyp_id: 10, gebaeudestandard: 'neubau', w_m2: 33, quelle: 'TESTWERT' }],
      gebaeudestandards: { neubau: 'Neubau', effizienzhaus_sanierung: 'Effizienzhaus-Sanierung', sonstiger_bestand: 'sonstiger Bestand' },
    },
    bauteile: [],
    klimadaten: [{ id: 1, plz: '12345', ort: 'TESTORT', theta_e: -10, theta_m_e: null, quelle: 'TESTWERT' }],
  };
}

/** Projekt 5 mit Gebäude 50, Geschoss EG (500) und Raum 5000 (4 × 5 m) */
export function paket(): ProjektPaket {
  return {
    id: 5,
    nummer: 'T-5',
    bezeichnung: 'Testprojekt',
    kunde_name: '',
    notizen: '',
    status: 'entwurf',
    ersteller_id: 1,
    ersteller_name: 'Test',
    zugewiesen_an_id: null,
    zugewiesen_an_name: null,
    geprueft_von_id: null,
    geprueft_am: null,
    freigegeben_von_id: null,
    freigegeben_am: null,
    ausgecheckt_von_id: 1,
    ausgecheckt_von_name: 'Test',
    ausgecheckt_geraet: 'Tablet 1',
    ausgecheckt_am: '2026-10-10T08:00:00Z',
    // eingefrorene Fachvorgaben des Projekts (beim Anlegen)
    vorgaben_stand_am: '2026-10-10T08:00:00Z',
    wartet_auf_fachpruefer: false,
    vorgaben_offen: false,
    angebot_gesperrt: false,
    vorgaben_stand: (({ werte, raumtypen, pauschalen }) => ({ werte, raumtypen, pauschalen }))(vorgaben().fachvorgaben),
    erstellt_am: '2026-10-10T08:00:00Z',
    geaendert_am: '2026-10-10T08:00:00Z',
    objekte: [
      {
        id: 50,
        projekt_id: 5,
        bezeichnung: 'Gebäude',
        gebaeudestandard: 'neubau',
        strasse: '',
        plz: '',
        ort: '',
        baujahr: null,
        klimadaten_id: null,
        delta_u_wb: null,
        pauschale_abweichungen: {},
        geschosse: [
          {
            id: 500,
            objekt_id: 50,
            bezeichnung: 'EG',
            reihenfolge: 1,
            raeume: [
              {
                id: 5000, geschoss_id: 500, bezeichnung: 'Wohnen', raumtyp_id: 10, laenge_m: 4, breite_m: 5, flaeche_m2: 20,
                hoehe_m: 2.5, volumen_m3: null, heizlastquelle: 'A', hottgenroth_w: null, pauschale_w_m2: null,
                theta_int: null, luftwechsel: null, flaechen: [], sperrflaechen: [], module: [], tueren_fenster: [],
              },
            ],
          },
        ],
      },
    ],
  };
}
