# CSV-Formate der Bibliotheken

Die Bibliotheken (Bauteile, Raumtypen, Klimadaten) werden **leer** angelegt und per CSV-Import gefüllt; Raumtypen und Pauschalen lassen sich außerdem in der Oberfläche unter „Fachvorgaben“ pflegen. Das Programm erfindet keine Werte: Jede Zeile braucht eine Quellenangabe.

## Allgemeine Regeln

- Kodierung **UTF-8** (mit oder ohne BOM; Excel: „CSV UTF-8 (durch Trennzeichen getrennt)“)
- Trennzeichen **Semikolon** `;`
- Erste Zeile: Spaltenköpfe wie unten (Groß-/Kleinschreibung egal, Reihenfolge egal)
- Zahlen mit **Dezimalkomma oder Dezimalpunkt**, ohne Tausendertrennzeichen
- Leerzeilen werden übersprungen
- **Alles oder nichts:** Enthält die Datei einen Fehler, wird nichts importiert und alle Fehler werden mit Zeilennummer gemeldet
- **Aktualisieren:** Zeilen mit vorhandenem Schlüssel überschreiben den bestehenden Eintrag; Einträge, die nicht in der Datei stehen, bleiben erhalten
- Höchstens 5 MB je Datei
- Die Grenzwerte unten fangen nur Tipp- und Einheitenfehler ab; sie sind keine Normwerte

## Import

- **Oberfläche** (Fachprüfer und Admins): Fachvorgaben → „Bibliotheken per CSV importieren“
- **API:** `POST /api/bibliotheken/{bauteile|raumtypen|klimadaten}/import`, Feld `datei`
- **Kommandozeile:**
  ```bash
  docker cp bauteile.csv infrarot-backend:/tmp/bauteile.csv
  docker exec infrarot-backend python -m app.cli bibliothek-importieren bauteile /tmp/bauteile.csv
  ```

## bauteile

Bauteile mit U-Wert, z. B. die Pauschalwerte aus der *Bekanntmachung der Regeln zur Datenaufnahme und Datenverwendung im Wohngebäudebestand*.

| Spalte | Pflicht | Inhalt |
|---|---|---|
| `kategorie` | ja | z. B. Außenwand, Dach, Oberste Geschossdecke, Kellerdecke, Bodenplatte, Fenster, Außentür, Innenwand |
| `bezeichnung` | ja | Bauteilbeschreibung |
| `baualtersklasse` | nein | z. B. „1949–1957“; leer = ohne Altersklasse |
| `u_wert` | ja | W/(m²·K), 0,01 … 10 |
| `quelle` | ja | Fundstelle (Dokument, Tabelle, Stand) |
| `bemerkung` | nein | Freitext |

Schlüssel: `kategorie` + `bezeichnung` + `baualtersklasse`.

```csv
kategorie;bezeichnung;baualtersklasse;u_wert;quelle;bemerkung
Außenwand;TESTWERT Mauerwerk;bis 1918;9,99;TESTWERT – kein echter Wert;Beispielzeile
```

## raumtypen

| Spalte | Pflicht | Inhalt |
|---|---|---|
| `bezeichnung` | ja | z. B. Wohnzimmer, Bad, Keller unbeheizt |
| `theta_int` | nein | Norm-Innentemperatur in °C, 0 … 40 (für Quelle C) |
| `luftwechsel` | nein | Luftwechselrate n in 1/h, 0 … 10 (für Quelle C) |
| `reduktionsfaktor` | nein | Temperatur-Korrekturfaktor f, −1 … 1,5, wenn ein Bauteil an einen Raum dieses Typs grenzt (für Quelle C) |
| `quelle` | ja | Fundstelle |
| `bemerkung` | nein | Freitext |

Schlüssel: `bezeichnung`. Leere Kennwerte erscheinen in der Auswertung als „Vorgabe fehlt“. Die Heizlast-Pauschalen (W/m² je Gebäudestandard) werden nicht per CSV, sondern in der Oberfläche gepflegt.

```csv
bezeichnung;theta_int;luftwechsel;reduktionsfaktor;quelle;bemerkung
TESTWERT Raum;19;0,9;;TESTWERT – kein echter Wert;
```

## klimadaten

Norm-Außentemperatur nach DIN/TS 12831-1 je Postleitzahl bzw. Ort.

| Spalte | Pflicht | Inhalt |
|---|---|---|
| `plz` | nein | Postleitzahl (als Text, führende Null bleibt erhalten) |
| `ort` | ja | Ort bzw. Referenzort |
| `theta_e` | ja | Norm-Außentemperatur in °C, −40 … 10 |
| `theta_m_e` | nein | Jahresmittel der Außentemperatur in °C, −10 … 25 |
| `quelle` | ja | Fundstelle |

Schlüssel: `plz` + `ort`.

```csv
plz;ort;theta_e;theta_m_e;quelle
00000;TESTWERT-Ort;-99;;TESTWERT – kein echter Wert
```

(Die Beispielzeilen enthalten absichtlich unbrauchbare Werte; `-99` wird vom Import sogar abgelehnt.)
