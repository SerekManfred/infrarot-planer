// Ein- und Ausgabetypen des Rechenkerns.
// Schlüssel in snake_case, damit dieselben JSON-Daten im Backend (Python) und im Browser genutzt werden können.
// Einheiten stehen im Feldnamen: _c = °C, _k = K, _m2 = m², _m3 = m³, _w = W, _w_k = W/K, _w_m2k = W/(m²·K), _1_h = 1/h.

/** Woran eine Bauteilfläche grenzt. */
export type Angrenzung = 'aussen' | 'beheizt' | 'unbeheizt' | 'erdreich';

export interface OeffnungEingabe {
  bezeichnung?: string;
  /** Fläche einer Öffnung (Fenster, Tür) in m² */
  flaeche_m2: number;
  /** Anzahl gleicher Öffnungen, Standard 1 */
  anzahl?: number;
  /** U-Wert der Öffnung in W/(m²·K) */
  u_wert_w_m2k: number;
}

export interface BauteilflaecheEingabe {
  bezeichnung?: string;
  /** Bruttofläche inkl. Öffnungen in m² */
  flaeche_brutto_m2: number;
  /** U-Wert des opaken Bauteils in W/(m²·K) */
  u_wert_w_m2k: number;
  angrenzung: Angrenzung;
  /** Temperatur des angrenzenden Raums in °C (für 'beheizt'/'unbeheizt', wenn f nicht direkt angegeben ist) */
  theta_angrenzend_c?: number | null;
  /** Temperatur-Korrekturfaktor f (dimensionslos). Hat Vorrang vor jeder Herleitung. Für 'erdreich' Pflicht. */
  f_korrektur?: number | null;
  /** Wärmebrückenzuschlag nur für diese Fläche und ihre Öffnungen in W/(m²·K); ersetzt den globalen Wert */
  delta_u_wb_w_m2k?: number | null;
  oeffnungen?: OeffnungEingabe[];
}

export interface RaumEingabe {
  id: string;
  bezeichnung: string;
  /** Norm-Innentemperatur θint in °C */
  theta_int_c: number;
  /** Luftwechselrate n in 1/h */
  luftwechsel_1_h: number;
  /** Raumvolumen V in m³ */
  volumen_m3: number;
  flaechen: BauteilflaecheEingabe[];
}

export interface HeizlastEingabe {
  /** Norm-Außentemperatur θe in °C (DIN/TS 12831-1) */
  theta_e_c: number;
  /** Globaler Wärmebrückenzuschlag ΔU_WB in W/(m²·K) */
  delta_u_wb_w_m2k: number;
  raeume: RaumEingabe[];
}

export interface ElementErgebnis {
  bezeichnung: string;
  art: 'flaeche' | 'oeffnung';
  /** Netto-Fläche (Bauteilfläche abzüglich Öffnungen bzw. Öffnungsfläche × Anzahl) in m² */
  flaeche_m2: number;
  u_wert_w_m2k: number;
  delta_u_wb_w_m2k: number;
  f_korrektur: number;
  /** Transmissionswärmeverlust-Koeffizient H_T = A·(U+ΔU_WB)·f in W/K */
  h_t_w_k: number;
}

export interface RaumErgebnis {
  id: string;
  bezeichnung: string;
  theta_int_c: number;
  /** θint − θe in K */
  delta_theta_k: number;
  h_t_w_k: number;
  /** Lüftungswärmeverlust-Koeffizient H_V = 0,34·n·V in W/K */
  h_v_w_k: number;
  phi_t_w: number;
  phi_v_w: number;
  /** Raumheizlast Φ_HL = Φ_T + Φ_V in W */
  phi_hl_w: number;
  elemente: ElementErgebnis[];
}

export interface HeizlastErgebnis {
  rechenkern_version: string;
  theta_e_c: number;
  raeume: RaumErgebnis[];
  /** Summe der Raumheizlasten (nicht die Gebäudeheizlast) */
  summe: { phi_t_w: number; phi_v_w: number; phi_hl_w: number };
}
