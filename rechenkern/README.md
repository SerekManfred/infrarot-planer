# rechenkern

Eigenständiges TypeScript-Modul für die Fachberechnungen. Läuft unverändert im Browser (offline, PWA) und auf dem Server (Node-CLI, wird vom Backend aufgerufen). Keine Abhängigkeiten zu Web-Framework oder Datenbank.

Stand: Phase 1A – raumweise Heizlast. Später: Paneelauslegung, Variantenvergleich Infrarot/Wärmepumpe.

## Befehle

Auf dem Server ist kein Node installiert; die Befehle laufen in einem Wegwerf-Container:

```bash
docker run --rm --name infrarot-npm-rechenkern --user "$(id -u):$(id -g)" -e npm_config_cache=/tmp/npm \
  -v "$PWD":/arbeit -w /arbeit node:22.14.0-bookworm-slim sh -c "npm ci && npm test && npm run typecheck"
```

- `npm test` – Unit-Tests (Vitest)
- `npm run typecheck` – Typprüfung
- `npm run build:cli` – Bündel `dist/cli.cjs` für das Backend (JSON über stdin/stdout)

## Verfahren: raumweise Heizlast

Vereinfachtes Verfahren nach dem Prinzip der DIN EN 12831-1:

```
Φ_HL,i = Φ_T,i + Φ_V,i

Φ_T,i  = H_T,i · (θint,i − θe)        H_T,i = Σ_k A_k · (U_k + ΔU_WB) · f_k
Φ_V,i  = H_V,i · (θint,i − θe)        H_V,i = 0,34 · n_i · V_i
```

| Größe | Bedeutung | Einheit | Feld |
|---|---|---|---|
| Φ_HL,i | Raumheizlast | W | `phi_hl_w` |
| Φ_T,i, Φ_V,i | Transmissions-/Lüftungswärmeverlust | W | `phi_t_w`, `phi_v_w` |
| H_T,i, H_V,i | Wärmeverlustkoeffizienten | W/K | `h_t_w_k`, `h_v_w_k` |
| A_k | Fläche des Bauteils k (opak: netto nach Abzug der Öffnungen) | m² | `flaeche_brutto_m2`, `flaeche_m2` |
| U_k | Wärmedurchgangskoeffizient | W/(m²·K) | `u_wert_w_m2k` |
| ΔU_WB | Wärmebrückenzuschlag | W/(m²·K) | `delta_u_wb_w_m2k` |
| f_k | Temperatur-Korrekturfaktor | – | `f_korrektur` |
| θint,i | Norm-Innentemperatur | °C | `theta_int_c` |
| θe | Norm-Außentemperatur (DIN/TS 12831-1) | °C | `theta_e_c` |
| n_i | Luftwechselrate | 1/h | `luftwechsel_1_h` |
| V_i | Raumvolumen | m³ | `volumen_m3` |
| 0,34 | volumenbezogene Wärmekapazität der Luft ρ·c_p | Wh/(m³·K) | Konstante |

### Regeln im Detail

- **Öffnungen** (Fenster, Türen) gehören zu einer Bauteilfläche. Ihre Fläche (× Anzahl) wird von der Bruttofläche abgezogen; Öffnung und Restfläche gehen mit ihrem eigenen U-Wert, aber demselben f ein. Sind die Öffnungen größer als die Bruttofläche, bricht die Berechnung mit Fehler ab.
- **Temperatur-Korrekturfaktor f:**
  - ist `f_korrektur` angegeben, gilt dieser Wert (Vorrang);
  - `aussen` → f = 1;
  - `beheizt`/`unbeheizt` mit `theta_angrenzend_c` = θu → f = (θint − θu) / (θint − θe). Ist der Nachbarraum wärmer, wird f negativ (Wärmegewinn);
  - `erdreich` → f muss angegeben werden (wird nicht geschätzt).
- **ΔU_WB** gilt global für alle Flächen und Öffnungen; eine Fläche kann einen eigenen Wert setzen (z. B. 0 für Innenwände), der dann auch für ihre Öffnungen gilt.
- **Keine Rundung** im Rechenkern. Gerundet wird erst in der Darstellung.
- Die Summe der Raumheizlasten ist **nicht** die Gebäudeheizlast.
- Eingaben werden geprüft (endliche Zahlen, Flächen/U-Werte/n/V ≥ 0, θint > θe). Fehler nennen den Pfad, z. B. `raeume[1].flaechen[0].u_wert_w_m2k`.

### Herkunft der Kennwerte

Der Rechenkern enthält **keine** Normaußentemperaturen, U-Werte, Innentemperaturen oder Luftwechselraten. Diese kommen aus den Bibliotheken des Backends (CSV-Import mit Quellenangabe, siehe `docs/CSV-FORMATE.md`). Zahlen in den Tests sind als **TESTWERT** gekennzeichnete Fantasiewerte.

## Schnittstelle

- Browser: `import { berechneHeizlast } from '@infrarot/rechenkern'`
- Server: `node dist/cli.cjs < eingabe.json` → `{"ok": true, "ergebnis": …}` oder `{"ok": false, "fehler": {"pfad": …, "meldung": …}}`

Typen siehe `src/typen.ts`.
