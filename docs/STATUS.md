# Status

Stand: 02.11.2026, Phase 1 Teil D; Paket M (Projektmaske, Räume aus Rechtecken, Firmendaten, Berichte) und Paket N (Objekte und Türen/Fenster bearbeiten); Praxistest E–I (Objektbibliothek u. a.) und J–L (einheitliche Tabellen, Emissionsgrad, Excel für alle Tabellen der Fachvorgaben)

Ausrichtung: Vor-Ort-Planung von Infrarot-Deckenmodulen durch den Außendienst der MEH, Fachvorgaben und Prüfung durch die Energieberatung Serek. Fachregeln: `docs/FACHKONZEPT.md`. Betrieb und HTTPS: `docs/BETRIEB.md`.

## Was läuft

| Container | Erreichbar | Zustand |
|---|---|---|
| `infrarot-db` (PostgreSQL 16, Volume `infrarot-db-daten`) | nur intern, kein Host-Port | healthy, Migration `f1c4d8a92b37` (Kalkulation, 02.11.2026) |
| `infrarot-backend` (FastAPI + Rechenkern 0.12.0, Volume `infrarot-uploads`) | `127.0.0.1:8091`, über Caddy `/api/*` | healthy |
| `infrarot-frontend` (React-PWA, nginx) | `127.0.0.1:8090`, über Caddy | läuft |

**Öffentlich:** https://ir-planer.mybase-test.de
- Zertifikat von Let's Encrypt, gültig bis 10.01.2027; Caddy verlängert es automatisch.
- HTTP leitet auf HTTPS um.
- Zugang über den Caddy-Container der Schulungsplattform. Das ist die eng begrenzte, freigegebene Ausnahme, siehe `docs/BETRIEB.md`:
  - nur ein neuer Site-Block im Caddyfile,
  - Caddy hängt zusätzlich am Netzwerk `infrarot-proxy`, das die Datenbank nicht erreicht,
  - übernommen per `caddy reload`, Caddy wurde nicht neu gestartet.
- Sicherung des Caddyfile: `/opt/schulung/Caddyfile.bak-2026-10-12`. Rückweg: `sudo bash betrieb/caddy_einrichten.sh rueckbau`.
- Die Infrarot-Ports bleiben nur an 127.0.0.1 gebunden.

**Daten (18.10.2026):** ein Konto, serek.manfred@googlemail.com, mit den Rollen **Admin + Fachprüfer**.
- Zwei Testprojekte des Auftraggebers, „Test1“ und „Test2“: neue Vorgaben am 18.10.2026 übernommen (Kommandozeile, protokolliert).
  - Heizlast unverändert: 2 040 W bzw. 3 140 W. Betroffen waren sie trotzdem, weil mit den Regeln jetzt eine benötigte Leistung gilt (Leistungsreserve).
  - Beide stehen auf „Vor-Ort-Entwurf“. Test2 war „fachlich geprüft“; eine Übernahme mit Auswirkung setzt die Prüfung zurück.
  - Keine offenen Vorgaben, ein Angebot ist möglich.
- Ergänzt am 18.10.2026 (vorher Sicherung `infrarot_db_20261018_103834.dump`):
  - Mindestabstand zu Dusche/Wanne und zu sonstigen Sperrflächen je 30 cm, Quelle „Erfahrungswert Serek, Stand 18.10.2026“. Damit sind alle 18 Regeln belegt.
  - Quellentext der zentralen Werte korrigiert (ohne Höhenzuschlag, Hinweis-Raumhöhe 2,65 m).
  - Raumtyp „Technik“ bleibt, mit der Neubau-Pauschale 20 W/m², Quelle „Erfahrungswert Serek, Stand 18.10.2026“ (Entscheidung Auftraggeber 18.10.2026). Effizienzhaus-Sanierung ohne Tabellenwert, dort gilt der Rückfallwert.
- Importiert am 14.10.2026 aus `daten/IR-Planer_Importdaten_geprueft.xlsx` (vorher Sicherung `infrarot_db_20261014_151658.dump`):
  - 13 Raumtypen: 12 aus der Datei, „Technik“ unverändert. 4 umbenannt, damit Projekte ihre Raumtypen behalten: Wohnraum → Wohnen, Kind → Kinderzimmer, Flur → Flur/Diele, Abstell → Abstellraum.
  - 25 Pauschalen: 24 aus der Datei mit Quelle „Erfahrungswert Serek, Stand 14.10.2026“, dazu Technik / Neubau 20 W/m² vom 13.10.
  - Altbau-Richtwert 150 W/m² je Raumtyp, nur als Orientierung für den Fachprüfer.
  - 16 von 18 Platzierungsregeln belegt; die zwei fehlenden Abstände wurden am 18.10.2026 ergänzt.
  - 21 Deckenmodule, ohne Preise und Montagezeit.
- Fachvorgaben:
  - Rückfallwerte: Neubau 40 W/m², Effizienzhaus-Sanierung 70 W/m²; Altbau ohne Rückfallwert (Pauschale je Raum durch den Fachprüfer)
  - Hinweis „Pauschale prüfen“ ab Raumhöhe **2,65 m** (vorher 2,80 m)
  - ΔU_WB: 0,05 W/(m²K)

**Alte Docker-Volumes** der früheren Installation sind gelöscht, nach Prüfung, dass kein Container sie nutzt. Inhalte wurden nicht angesehen. Gelöscht wurden `infrarot-data`, `infrarot-planer_app-{data,uploads,outputs}` und `infrarot-planer-new_app-{data,uploads,outputs}`. Übrig sind nur `infrarot-db-daten` und `infrarot-uploads`.

## Nachtrag Paket N (02.11.2026): N4–N6

**N5 Wärmeverteilung nicht sichtbar – Ursache:** Beim Einbau der Raumformen (M2) war die Farbschicht in den Zeichenzweig für Rechteckräume gerutscht. In L-, U- und Erker-Räumen wurde sie berechnet (Kennzahlen korrekt), aber nie gezeichnet. Behoben: Die Farbschicht wird für jede Raumform gezeichnet (unter Objekten und Modulen, Deckkraft-Regler wirkt) und per SVG-Maske exakt auf den Umriss zugeschnitten (Einsprung bleibt frei). Browser: Rechteck und L-Form, Skala automatisch und fest, mit und ohne Objekte – Färbung sichtbar.
- Hinweis zur festen Skala: Sie beginnt bei 0–10 W/m²; liegen alle Werte darunter (wie hier, Max 5,7 W/m²), ist der ganze Raum in der hellsten Stufe – das sieht nach „keine Färbung“ aus. Die Autoskala (Standard) zeigt die Unterschiede.
- „Min 0,0“: Oberseiten hoher Möbel (z. B. Kühlschrank/Hochschrank 2,15 m) liegen außerhalb des Abstrahlkegels von 120° und bekommen nichts ab – physikalisch so gewollt.
- **Plausibilität** (L-Raum TESTRAUM, Projekt 2026-0002: 21,9 m², 2 × CL-540, Katalog: 90 °C, ε 0,3, 120°, Raumhöhe 2,5 m, Raumtemperatur 20 °C): Strahlungsdichte M = ε·σ·(T⁴ − T_R⁴) = 170 W/m²; Strahlungsleistung = 170 W/m² × 0,96 m² = 163 W = 15 % der 1 080 W elektrisch. Am Boden kommen an: Mittel 3,24 W/m² × 21,9 m² = 71 W = 43 % der Strahlung (der Rest trifft die Wände, die nicht dargestellt werden; mit 180° 44 %). Mittel × Fläche stimmt exakt mit der Summe über alle Zellen; Energiebilanz-Test im Rechenkern: sehr großer Boden, 180° → 97–100 % der Strahlung am Boden.
- **Vorschlag (nicht umgesetzt):** Der Emissionsgrad 0,3 des CL-540 im Katalog ist für pulverbeschichtete Oberflächen sehr niedrig (typisch 0,90–0,95, siehe ⓘ). Mit 0,93 läge der Strahlungsanteil bei rund 47 % und alle W/m²-Werte rund 3,1-mal höher (Mittel etwa 10 W/m²). Bitte im Herstellerdatenblatt prüfen und ggf. im Modulkatalog ändern. Ebenso den Vorgabewert Emissionsgrad (zurzeit 0,5).

**N4 Sonstige Sperrfläche:** „Sonstige Sperrfläche“ in „Objekt hinzufügen“ öffnet ein kleines Formular: Name (frei, Standard „Sonstige Sperrfläche“, max. 30 Zeichen), Form Rechteck | Quadrat | Rund, Kategorie Tabu | Abstand | Neutral (Standard Tabu), Höhe optional. Maße: Rechteck Breite × Tiefe, Quadrat Seitenlänge, Rund Durchmesser. Rund: Kreis, 4 Anfasser für den Durchmesser (Mitte bleibt), Abstandsring als Kreis; Quadrat bleibt beim Ziehen quadratisch; Drehen bei Quadrat und Rund ausgeblendet. Prüfung, Platzierung und Wärmeverteilung rechnen mit dem Kreis (Abstand Kreis ↔ Modulrechteck, nicht über die Box). Name und Form stehen im Deckenplan und im Ergebnisbericht (Kreis im Plan, Legendenzeile „Sonstige Sperrflächen: Kamin (rund, Ø 1,50 m, tabu)“). Datenfelder `umriss`, `kategorie`, `bezeichnung` an der Sperrfläche (ohne Migration, JSON). Mindestabstand bleibt der der Bibliothek (Sonstige Sperrfläche: 30 cm), auch bei Kategorie Abstand.

**N6 Lesbarkeit:** Objektnamen werden eingepasst: Schrift bis 9 px verkleinern, dann zwei Zeilen, dann mit „…“ kürzen – nie breiter als das Objekt (geprüft). Voller Name im Tooltip und in der Bearbeitungsleiste; schwarz mit weißem Rand. Abstandsringe werden auf den Raumumriss zugeschnitten und liegen so nie mehr auf den Wandmaßen.

**N3:** unverändert – M2 war vollständig; die Lücke „Türen/Fenster nur am Hauptrechteck“ ist mit N2 geschlossen. N2 entfällt laut Test (funktioniert).

Tests: Rechenkern 114 (Kreisabstand, eigene Kategorie/Name, Energiebilanz), Backend 134 (Sonstige rund im Bericht), Frontend 73 (Einpassen, Quadrat/Kreis ziehen); Browser 18 von 19 Prüfungen bestanden, die eine Abweichung ist ein Messfehler des Tests (Pixel im Einsprung hat das Hellgrau des Hintergrunds, also wie gewünscht ungefärbt).

## Paket N (02.11.2026): Objekte, Türen und Fenster bearbeiten

**N1 Objekte bearbeiten**
- Ursache „Tiefe 3 eingetippt, Zeichnung bleibt 0,75 × 1,15 m“: Die Eingabe wurde still auf den Platz von der Oberkante des Objekts bis zur Wand des Hauptrechtecks begrenzt (`begrenzen(w, 0,1, B − y)`); weil sich der Wert dann nicht änderte, setzte das Feld seinen Text nicht zurück und zeigte weiter „3“. Die Raumform wurde dabei nicht beachtet.
- Neu (`frontend/src/planhilfen.ts`, `objektMasse`): Breite/Tiefe wirken bei Enter oder Verlassen (Komma und Punkt), die Mitte bleibt, das Objekt wird bei Bedarf minimal in den Raum geschoben. Größer als der Raum oder über einem Einsprung: Feld rot, Meldung direkt am Feld, eingetippter Wert bleibt stehen. Das gilt für alle Zahlfelder (auch Türen/Fenster).
- Maßanzeige oberhalb der Eck-Anfasser (geprüft: Grundlinie 0,88 m, Anfasser oben 0,94 m).
- Bearbeitungsleiste in einer Zeile: Objekt | Breite × Tiefe | Höhe | Drehen 90° | Löschen; Beschriftungen gleich hoch, Felder 44 px; schmal als Blöcke untereinander.
- Höhe nur „Höhe“ mit m; Standard als Platzhalter und im ⓘ.
- Drehen 90°: Knopf in der Leiste, runder Knopf ⟳ am ausgewählten Objekt, Taste R (auch für Module). Breite/Tiefe tauschen, Mitte bleibt, minimal verschoben; passt es nicht, Hinweis und keine Drehung. Prüfungen, Sperrflächen und Warnungen rechnen sofort neu.
- Rückgängig: Knopf „↶ Rückgängig“ und Strg+Z für Objekte, Module, Türen und Fenster (bis 30 Schritte je geöffnetem Plan). Neu eingesetzte Objekte bleiben ausgewählt.

**N2 Türen und Fenster**
- Ursachen: (1) Im Modus „Tür setzen“ beendete ein Tippen auf ein Objekt, einen Anfasser, ein Modul oder eine Öffnung nahe der Wand den Modus still und wählte stattdessen das Objekt aus. (2) Die Knöpfe stehen unter dem Plan; nach dem Antippen war die obere Wand oft nicht mehr im Bild (am Tablet besonders). (3) Beim Anfassen nahe einer Ecke sprang die Öffnung, weil der Versatz zur nächstgelegenen statt zur eigenen Wand gerechnet wurde. (4) Bei L-/U-Form landeten Türen auf der Linie des Hauptrechtecks im Raum. (5) Zu große Breite/Abstand wurden still begrenzt.
- Neu: Einsetzen am nächstgelegenen Wandsegment der Raumform (auch Innenwände, verkürzte Wände, Erker; Rechenkern `naechstesSegment`, Feld `linie` am Tür-/Fensterdatensatz), auch über Objekten; Plan rollt nach „+ Tür“/„+ Fenster“ in den Blick; Verschieben und Breite bleiben im eigenen Wandstück; Meldung am Feld statt Begrenzen; neue Angaben Höhe und (Fenster) Brüstung, nur informativ; Aufschlag/Band in der Leiste; Rückgängig.
- Automatische Testmatrix im Browser (alle vier Wände, Ecken, über einem Objekt, L-Form mit Innenwänden und Innenecke, Bearbeiten, Verschieben, Aufschlag/Band, Löschen, Rückgängig, Bericht): 32 von 32 bestanden.

**N3 Abgleich mit M2:** M2 war vor Paket N bereits vollständig umgesetzt (L-, U-Form, Erker aus Rechtecken, Polygon im Rechenkern, Fläche/Wandabstand/Platzierung/Wärmeverteilung/Bemaßung/Anfasser). Gekürzt wurde nichts; geschlossen wurde die Lücke „Türen und Fenster nur am Hauptrechteck“ (jetzt an jedem Wandsegment, siehe N2).

## Paket M (02.11.2026)

**M1 Projektmaske kompakt:** Projektkopf in zwei Zeilen (gemessen 150 px statt rund 450 px; der Rest sind 44-px-Tippflächen): Projektnummer als Chip (nicht mehr in der Maske änderbar), Kunde, Zuständig (Herkunft „angelegt von … zugewiesen an …“ im ⓘ); darunter der Gebäudestandard als drei gleich breite Segmente „Neubau | EH-Sanierung | Altbau“ (Langformen im ⓘ) und die Metazeile „Fachvorgaben-Stand“. Bei Altbau steht „IR als alleiniges System nicht empfohlen“ darunter. Anlegen-Maske ebenso kompakt (172 px), Gebäudestandard ohne Vorauswahl, „Anlegen“ erst nach Auswahl. Wechsel des Standards bei erfassten Räumen nur nach Bestätigung („Heizlasten aller n Räume werden neu berechnet“); die Heizlast rechnet danach sofort neu (Test: 800 → 1 400 W bei Neubau → EH-Sanierung). Handy: Felder untereinander, ohne waagrechten Bildlauf. Bestehende Projekte behalten ihren Standard.

**M2 Räume aus Rechtecken:** Raum = Hauptrechteck (Schnellerfassung Länge × Breite, unverändert) plus Anbauten bzw. minus Ausschnitte (je Wand, Versatz, Länge, Tiefe), Vorlagen Rechteck, L-Form, U-Form, Erker („Raumform ändern“ in der Raumkarte). Datenmodell `raum.geometrie = {basis: {w, h}, teile: [{op, wand, versatz, laenge, tiefe}]}`, Migration `d5e2a8c41f93` (vorher Sicherung `infrarot_db_20261102_075743.dump`): alle 20 Räume mit Maßen bleiben Rechtecke, Flächen unverändert. Rechenkern 0.9.0 (`rechenkern/src/raumform.ts`): Fläche, Umfang, Wandsegmente und Umriss aus einer Rasterzerlegung der Rechtecke; „liegt im Raum“ und Wandabstand euklidisch (Innenecken richtig); Regelprüfung, automatische Platzierung, Wärmeverteilung (Zellen außerhalb durchsichtig) und Heizlast (Gesamtfläche) rechnen auf der Form. Deckenplan: Umriss, Bemaßung jedes Wandsegments, Anfasser je Anbau/Ausschnitt an der äußeren Ecke (Länge und Tiefe ziehen). Offline rechnet die Fläche der Rechenkern im Browser. Browser: L-Form 6 × 4 m → 18 m², 720 W (40 W/m²), Umfang 20 m; mit Anbau 10 bemaßte Segmente, Vorschlag im Raum, Ziehen am Anfasser ändert die Fläche.
- Bewusst einfach (umkehrbar): Dachschrägen-Streifen liegen weiter an den Wänden des Hauptrechtecks (Türen und Fenster seit Paket N2 an jedem Wandsegment). Der gestrichelte Wandabstand wird nur beim Rechteck gezeichnet (geprüft wird er immer). Anbauten oben/links liegen bei negativen Koordinaten, damit nichts verrutscht.

**M3 Firmendaten und Logo:** Menüpunkt „Firmendaten“ (nur Admin). Migration `e7b3c9d2a614` (vorher Sicherung `infrarot_db_20261102_080759.dump`) legt „Mein Energie Haus GmbH“ (Standard für Berichte) und „Energieeffizienzberatung Manfred Serek GmbH“ nur mit Namen an – Anschrift, Kontakt, Geschäftsführer, Handelsregister, USt-IdNr. und Logo trägt der Admin ein (nichts erfunden). Je Projekt optional abweichende Berichtsfirma (Karte „Berichte“ im Projekt; leer = Standardfirma).
- Logo: PNG, JPG oder SVG bis 2 MB, Typ am Inhalt geprüft (Magic Bytes), Pillow prüft und speichert neu; SVG wird mit defusedxml sicher geparst, von Skripten/Ereignissen/externen Verweisen bereinigt und mit CairoSVG (ohne Datei-/Netzzugriff) in PNG umgewandelt – SVG wird nie gespeichert. Neuer Zufallsname, Ablage `uploads/logos` im Volume `infrarot-uploads` (Rechte 0640), damit im täglichen Backup enthalten. Vorschau, Ersetzen, Löschen; ohne Logo Hinweis im Admin, Berichte zeigen dann den Firmennamen.
- Neue Abhängigkeiten im Backend-Image: Pillow, CairoSVG (libcairo2), defusedxml, ReportLab, Schrift DejaVu (für M4).

**M4 Berichte** (Karte „Berichte“ im Projekt; serverseitig erzeugt, offline Hinweis statt Fehler; Sichtbarkeit wie beim Projekt). Migration `f1c4d8a92b37` (vorher Sicherung `infrarot_db_20261102_083126.dump`). Rechenkern 0.10.0 liefert je Raum Reserve und Berichtsstatus (OK 0–20 %, Prüfen über 20 %, Unterdeckt unter der Heizlast) sowie Fläche und Reserve gesamt – der Bericht rechnet nichts selbst.
- **M4a Ergebnisbericht (PDF, ohne Preise):** `Ergebnisbericht_<Nr>_<Kunde>.pdf`. Kopf: Logo links (max. 15 mm hoch, ohne Logo der Firmenname), rechts „Projekt <Nr> · <Kunde>“, Linie; Fuß: Firmendaten in zwei Zeilen, Fachvorgaben-Stand, Status, „Seite x von y“; Wasserzeichen ENTWURF bis „fachlich geprüft“. Seite 1: Projektblock, Kennzahlen, Raumübersicht mit Status als Text, Hinweise (Möblierung vom Kunden zu bestätigen, Änderung erfordert neue Prüfung, Planungsregeln), Prüfvermerk. Raumblätter (meist 2 je Seite): Kopfleiste, Deckenplan in einheitlichem Maßstab (1:20 … 1:500, kleinster passender) mit Bemaßung aller Wandsegmente, Türen/Fenster, Modulen (Nr., Typ, Leistung), Objekten (rot schraffiert tabu, orange Abstand, grau neutral), Raumdaten (Heizlast mit Quelle), Stückliste, Raumhinweise (Bad IP44/DIN VDE 0100-701, Reserve über 20 % mit Bitte um Begründung, Raumhöhe ab Hinweis-Höhe, Regelverstöße). DejaVu Sans eingebettet (m², Umlaute geprüft).
- **M4b Bestellliste (Excel, ohne Preise):** Blätter „Bestellliste“ und „Blattstückliste“; Menge per SUMIF-Formel aus der Blattstückliste, „Zusatz (Reserve)“ = 0 als Eingabe, Bestellmenge = Menge + Zusatz; Art.-Nr. als Eingabefeld, wo nicht im Katalog (Raumthermostat). Gelb mit blauer Schrift = Eingabe, Legende darunter. Logo in A1, Kopfzeilen 1–4 werden auf jeder Druckseite wiederholt, Projekt in der Druckkopfzeile, Firmendaten in der Druckfußzeile, Querformat, eine Seite breit.
- **M4c Kalkulation intern (Excel):** nur mit Recht „Kalkulation sehen“ (Admins immer; Schalter je Benutzer in der Benutzerverwaltung, Standard aus). Blätter „Kalkulation“, „Preise“, „Blattstückliste“, alles mit Formeln; Positionen je Raum mit Modulen: Module, Raumthermostat, Elektroanschluss-Pauschale; je Projekt: Anfahrt. Fehlende Preise „Preis fehlt“ (nie 0 €), Warnzeile mit Anzahl, Summen nur aus Positionen mit Preis; Marge = (VK − EK) / VK in € und % je Position, Raum und gesamt. Preisstand (Datum, Katalogversion) beim ersten Erzeugen je Projekt eingefroren, „Preisstand aktualisieren“ nur bewusst. Artikelstamm (Raumthermostat, Elektroanschluss-Pauschale, Anfahrt – ohne Preise angelegt) auf der Seite Modulkatalog; Preise pflegt der Admin. EK/VK im Modulkatalog, im Katalog-Export/-Import und im Offline-Paket nur mit diesem Recht (ohne Recht bleiben Preise beim Import unverändert).
- Geprüft: PDF mit 3 Räumen (darunter L-Form), 3 Seiten, Schriften eingebettet; Excel in LibreOffice neu berechnet: Mengen, „Preis fehlt“, Warnzeile (7 Positionen), mit Testpreisen 100/125 € Marge 20 % je Position, Raum und gesamt; Außendienst erhält für die Kalkulation 403 und sieht den Knopf nicht.

**Gesetzte Defaults und Abweichungen (Paket M):**
- Projektnummer in der Projektmaske nicht mehr änderbar (der Server lässt Admins sie weiter ändern, z. B. per Schnittstelle).
- Berichtsfirma wählen darf jeder, der das Projekt bearbeiten darf.
- Anbauten/Ausschnitte nur an den Wänden des Hauptrechtecks; Türen, Fenster und Dachschrägen-Streifen bleiben am Hauptrechteck.
- SVG-Logos werden immer in PNG umgewandelt (nicht als SVG gespeichert).
- Excel-Druckkopf: Logo über wiederholte Kopfzeilen statt im Kopfzeilenbereich (openpyxl kann dort keine Bilder setzen).
- Thermostat erscheint in Legende, Raumdaten und Stückliste, nicht als Symbol im Plan (keine Lage erfasst).
- Status „Prüfen“ ab Reserve > 20 % als Konstante im Rechenkern (Festlegung 02.11.2026).
- Reserve-Begründung: Der Bericht bittet um Begründung (kein Eingabefeld dafür).
- Fachprüfer sieht EK/VK nicht mehr, solange das Recht nicht gesetzt ist (konsequent zur Vorgabe „nur Admin“).

## Paket J–L (01.11.2026, vierte Runde)

Vorher gesichert: `infrarot_db_20261101_171159.dump` und vor der Inbetriebnahme `infrarot_db_20261101_213318.dump` (Ordner `~/backups/infrarot`).

**J) Einheitliche Tabellen der Fachvorgaben** (`frontend/src/komponenten/VTabelle.tsx`): Raumtypen und Pauschalen, Platzierungsregeln, Objektbibliothek, U-Werte, Klimadaten und Modulkatalog.
- Kurze Überschriften mit Einheit (z. B. „Neubau (W/m²)“, „θ int (°C)“), Zahlen rechtsbündig, Kopfzeile fixiert in eigenem Scrollbereich, dunkle Schrift.
- Quelle, Bemerkung, Reihenfolge, Quellen der Pauschalen und Erläuterungen stehen nur noch im Dialog „Bearbeiten“ (bzw. „Details“ bei U-Werten und Klimadaten) und im Excel-Export.
- Raumtypen und Regeln werden nicht mehr direkt in der Tabelle, sondern im Dialog geändert; vor dem Speichern zeigt die bekannte Vorschau die betroffenen Projekte. Löschen eines Raumtyps im Dialog.
- Neu sichtbar: Tabellen „U-Werte (Bauteile)“ und „Klimadaten“ (zurzeit leer).
- Seite bis 1 400 px breit. Geprüft bei 1 400 px: keine Tabelle mit waagrechtem Scrollen. Am Handy (390 px) erscheint jede Zeile als Karte mit Beschriftung je Wert, ohne waagrechten Bildlauf.

**K) Emissionsgrad:** Beschriftung „Emissionsgrad (0–1, ohne Einheit)“ im Modul-Dialog und im Excel-Export (die frühere Überschrift „Emissionsgrad“ wird beim Import weiter erkannt), Einheit der Vorgabe-Regel „0–1, ohne Einheit“ (Migration `c3a9e7f15b42`), ⓘ mit dem festgelegten Text. Zulässig sind Werte größer als 0 bis höchstens 1 (Server und Oberfläche); 0 bleibt ausgeschlossen, weil das Modul dann gar nicht strahlen würde.

**L) Excel-Export und -Import für alle Tabellen** (`backend/app/tabellen_excel.py`, Endpunkte `/api/tabellen/{raumtypen|regeln|objekte|bauteile|klimadaten|module}/…`), nur Fachprüfer und Admin:
- Einheitlicher Aufbau: Blatt mit dem Tabellennamen, erste Zeile Überschriften mit Einheit, fixierte Kopfzeile, alle Felder, Blatt „Hinweise“ mit Erklärung jeder Spalte.
- Schlüssel: Raumtyp, Regel (feste Liste, keine neuen), Objektname, Kategorie/Bezeichnung/Baualtersklasse (U-Werte), PLZ/Ort (Klimadaten), Artikel-Nr. (Module).
- Vorschau mit geändert / neu / unverändert, Änderungen alt → neu, Fehlern mit Zeilennummer und Begründung und den betroffenen Projekten; Übernahme nur fehlerfrei, nach Bestätigung, nur für die geprüfte Datei. Vorher Datenbanksicherung, jede Änderung je Feld protokolliert, danach Abgleich der Projekte (Sammelansicht).
- Gelöscht wird nie; Objektbibliothek und Module höchstens über „aktiv“ = nein. Eine leere Pauschale bedeutet wie in der Oberfläche „kein Tabellenwert“ (Rückfallwert).
- U-Werte und Klimadaten werden über ihre ID verwendet und sind nicht je Projekt eingefroren – Änderungen wirken sofort (wie beim bisherigen CSV-Import).

## Praxistest E–I (01.11.2026, dritte Runde)

Vorher gesichert: `infrarot_db_20261101_160733.dump` und direkt vor der Migration `infrarot_db_20261101_163434.dump`. Fachregeln: `docs/FACHKONZEPT.md`, Abschnitt „Objekte im Raum: Objektbibliothek“.

**G) Objektbibliothek statt fester Sperrflächen-Typen**
- Neue Tabelle `bib_objekt` mit 30 Objekten der Startausstattung (22 Möbel, 5 Deckeneinbauten, 3 Bauliches). Die 8 früheren Typen übernehmen Abstand, Höhe und Quelle aus den Platzierungsregeln; alle neuen Werte haben die Quelle „Vorgabe – von Serek prüfen, Stand 01.11.2026“.
- Pflege in den Fachvorgaben (Karte „Objektbibliothek“, Dialog „Bearbeiten“ bzw. „+ Neues Objekt“), nur Fachprüfer und Admin, mit Vorschau der betroffenen Projekte und Protokoll. Je Projekt eingefroren.
- Deckenplan: „+ Objekt hinzufügen“ mit Suche, zuletzt verwendeten Objekten oben und Vorsortierung nach Raumtyp.
- Regelprüfung, automatische Platzierung und Wärmeverteilung nutzen Kategorie, Abstand und Höhe aus der Bibliothek.
- Umstellung der echten Daten: 24 Sperrflächen in allen Projekten zugeordnet (4 Sitzplatz, 7 Hochschrank, 1 Dachschräge, 3 Dusche, 7 Sonstige, 2 Leuchte), Maße und Positionen unverändert. Die 4 Projekte haben danach keine offenen Unterschiede; die Regelprüfung ergibt dasselbe wie vorher (1 Abstandsverstoß in 2026-0001, unverändert).
- 14 abgelöste Platzierungsregeln entfernt, es bleiben 12.
- **Bitte prüfen:** Hochschrank ist jetzt „Abstand“ (vorher kein Modul darüber); die Auslegung „Modul erlaubt, aber Mindestabstand zur Kante“ steht im Fachkonzept.

**E) Objekthöhe:** „Höhe: 0,45 m (Standard für Sofa)“, nach Änderung „(angepasst)“, Knopf „Standard“; am Handy 339 px breit, ohne waagrechten Bildlauf.

**F) Modulkatalog:** Bauhöhe, Schutzart, Quelle und Bemerkung nur noch im Dialog „Bearbeiten“ (alle Felder, auch Deaktivieren und Löschen) und im Excel-Export/-Import. Die Tabelle zeigt kompakte Werte (L × B, EK / VK, Strahler zusammengefasst), „inaktiv“ steht unter der Artikel-Nr. Kein waagrechtes Scrollen bei 1280 und 1366 px; Kopfzeile fixiert. Leser ohne Pflegerecht öffnen „Details“.

**H) Lesbarkeit:** Alle Beschriftungen im Plan schwarz mit weißem Rand, Umrisse 2,5 px in dunklen Farben je Kategorie, Wärmefarbe unter den Objekten. Hilfetexte und Platzhalter dunkel (Kontrast zu Weiß über 10 : 1).

**I) Wärmeverteilung:** weich (bilineare Interpolation, stufenlose Farben, feineres Raster), Autoskala bleibt Standard, stufenloser Farbbalken, Deckkraft-Regler (Standard 75 %).

## Verbesserungen aus dem Praxistest (01.11.2026, zweite Runde)

**A) Modulkatalog-Tabelle:** Die Kopfzeile bleibt beim senkrechten, die Spalte „Artikel-Nr.“ beim waagerechten Scrollen stehen; der Scrollbereich ist eigens für die Tabelle. Im Browser auf dem Handy (390 px) geprüft: 0 px Verschiebung beider.

**B) Wärmeverteilung:**
1. **Autoskala als Standard** (kleinster bis größter Wert im Raum), Umschalter „Skala automatisch / Skala fest“ (fest: 0 … ≥ 70 W/m² in 10er-Stufen).
2. Kräftigere Farben (hell → kräftig rot), weniger Transparenz; die Legende zeigt die echten Zahlenwerte der gewählten Skala.
3. Antippen zeigt eine Markierung mit Wert im Plan; unter dem Plan stehen Min, Mittel und Max des Raums.
4. **Prüfung der fast einheitlichen Darstellung** mit dem Ergebnis: Es lag an beidem.
   - **Skala:** Die feste Skala bis 70 W/m² war für die tatsächlichen Werte zu grob. Im Bad von Test2 (2 × CL-540, 3,5 × 4 m, Höhe 2,5 m) liegen die Werte zwischen 1,6 und 8,3 W/m², Mittel 4,5. Das fiel alles in die unterste Stufe 0–10; mit der Autoskala ist die Verteilung jetzt deutlich sichtbar.
   - **Werte:** Vorgabewerte sind nicht gesetzt. Gerechnet wird nur mit dem, was bei CL-540 im Katalog steht: 90 °C, **Emissionsgrad 0,3**, 120°.
     - Mit ε 0,3 strahlt das Modul 170 W/m² ab. Bei 540 W auf 0,48 m² (1 125 W/m² Flächenleistung) wären das nur 15 % Strahlungsanteil. Direkt unter der Mitte eines einzelnen CL-540 ergeben sich am Boden 4,05 W/m², auf einem Sitzplatz (0,45 m) 5,95 W/m².
     - Mit ε 0,93 wären es 528 W/m² (47 %) und am Boden direkt darunter 12,57 W/m², das 3,1-Fache.
     - Bitte den Emissionsgrad prüfen: Pulverbeschichtete Oberflächen liegen erfahrungsgemäß deutlich über 0,3. Der Wert muss aus Ihrer Quelle bzw. dem Datenblatt kommen; die App ändert ihn nicht.
   - Wird mit Vorgabewerten gerechnet, steht jetzt deutlich „Mit Vorgabewerten berechnet …“ direkt unter dem Plan.
5. Die Beschriftung „Vereinfachte Veranschaulichung der Strahlungsverteilung – keine Behaglichkeitsberechnung nach Norm.“ bleibt.

**C) Katalog-Reimport aus Excel** (Seite Modulkatalog → „Katalog aus Excel importieren“, nur Admin/Fachprüfer):
- **Vorschau:** geändert, neu und unverändert, Änderungen je Feld alt → neu, Fehler mit Zeilennummer.
- **Übernahme:** erst nach Bestätigung und nur, wenn die Datei fehlerfrei ist.
- **Sicherung:** Vorher sichert der Server die Datenbank (`pg_dump` 16 im Backend-Image, Ablage `/app/uploads/sicherungen/`).
- **Zuordnung und Löschen:** Zuordnung über die Artikel-Nr.; gelöscht wird nie.
- **Protokoll und Projekte:** Jede Änderung wird je Feld protokolliert, verwendete Module werden in den Projekten abgeglichen.
- Im Browser geprüft: Testmodul, VK 123,45 in Excel eingetragen → Vorschau „1 geändert“ → übernommen, Sicherung `infrarot_db_20261101_144736_vor_katalogimport.dump`, Protokoll „E2E Fachprüfer, VK – → 123,45“; Testmodul danach gelöscht.

**D) Selbsttest Projektnummer** (live, mit Testkonten, danach entfernt):
- Zwei neue Projekte erhielten 2026-0002 und 2026-0003, fortlaufend nach dem vorhandenen 2026-0001.
- Die Nummer 2026-0002 für das zweite Projekt wurde abgelehnt: „Projektnummer 2026-0002 ist bereits vergeben“.
- Die Testprojekte sind gelöscht, das nächste echte Projekt erhält wieder 2026-0002.

## Wärmeverteilung im Deckenplan (01.11.2026)

Regeln und Formeln: `docs/FACHKONZEPT.md`, Abschnitt „Wärmeverteilung“.

1. **Schalter „Wärmeverteilung anzeigen“** im Deckenplan:
   - Bestrahlungsstärke in W/m² als halbtransparenter Farbverlauf, feste Skala in Stufen zu 10 W/m² (0 … ≥ 70).
   - Legende mit dem Höchstwert und dem Wert unter Zeiger bzw. Finger.
   - Rechnet offline im Browser und aktualisiert sich nach Verschieben oder Ändern.
   - Darunter steht immer: „Vereinfachte Veranschaulichung der Strahlungsverteilung – keine Behaglichkeitsberechnung nach Norm.“
2. **Modell:**
   - Rechteckstrahler an der Decke, Stefan-Boltzmann gegen die Raumtemperatur, exakter Sichtfaktor Flächenelement → paralleles Rechteck, Abstrahlwinkel als Begrenzung, Summe über alle Module.
   - Keine Reflexionen, keine Abschattung, keine Konvektion.
   - Empfangsflächen sind der Boden und die Oberseiten der Sperrflächen.
3. **Sperrflächen** haben das Feld „Höhe“. Leer gilt die Vorgabe des Typs: Sitzplatz 0,45, Bett 0,50, Hochschrank 2,00, Dusche/Wanne 0, Sonstiges 0,75 m. Diese Vorgaben sind unter Fachvorgaben → Platzierungsregeln pflegbar und je Projekt eingefroren.
4. **Modulkatalog:** neue Spalten Oberflächentemperatur, Emissionsgrad, Abstrahlwinkel (auch im Excel-Export). Leer gelten die Vorgabewerte aus den Fachvorgaben, mit dem Hinweis „Mit Vorgabewerten berechnet“.
5. Die Projekte haben die neuen Regeln still übernommen (`vorgaben-abgleichen`: 4 ohne Auswirkung).

**Offen (von Ihnen):** Emissionsgrad 0,3 bei CL-540 prüfen (siehe oben). Für alle übrigen Module fehlen die Werte noch. Entweder je Modul im Katalog Oberflächentemperatur, Emissionsgrad und Abstrahlwinkel eintragen (z. B. aus den Herstellerdatenblättern). Oder unter Fachvorgaben → Platzierungsregeln die drei Vorgabewerte setzen. Bis dahin zeigt der Deckenplan „Wärmeverteilung nicht darstellbar: Vorgabe fehlt …“.

## Modulkatalog pflegbar (31.10.2026)

Regeln im Detail: `docs/FACHKONZEPT.md`, Abschnitt „Modulplanung“ → „Katalogpflege“ und „Moduldaten in laufenden Projekten“.

1. **Neue Seite „Modulkatalog“** (Menü, für alle):
   - Admin und Fachprüfer bearbeiten jedes Feld direkt in der Tabelle, legen neue Module an, deaktivieren und löschen (nur unbenutzte).
   - Der Außendienst sieht den Katalog nur lesend.
   - Der Server prüft die Plausibilität und meldet verständlich, z. B. „„Bad geeignet“ nur ab Schutzart IP44 (hier IP20)“ oder „Modul … wird in 1 Projekt verwendet … bitte stattdessen deaktivieren“.
2. **Protokoll je Feld** (Benutzer, Zeitpunkt, alt/neu), einsehbar unter Fachvorgaben → Änderungsprotokoll. **Excel-Export** mit „Als Excel exportieren“ (`Modulkatalog_JJJJ-MM-TT.xlsx`, Aufbau wie die Importdatei).
3. **Laufende Projekte** arbeiten mit dem Moduldatenstand ihrer Planung:
   - Geänderte Daten verwendeter Module übernimmt ein Projekt still, wenn sie keine Auswirkung haben.
   - Sonst zeigt das Projekt einen Hinweis mit Unterschieden und Auswirkung (installierte Leistung, neue Regelverstöße). Der Status ist dann „wartet auf Fachprüfer“, ein Angebot ist gesperrt.
   - Übernehmen oder ablehnen geht einzeln oder in der Sammelansicht (Spalte „Anlass“). Der Außendienst sieht einen neutralen Hinweis.
   - Freigegebene Projekte bleiben unverändert.
   - Neu im Vergleich der verfeinerten Sperre: Auch die installierte Leistung zählt.

## Sichtbarkeit je Außendienst, automatische Projektnummer (31.10.2026)

1. **Sichtbarkeit:**
   - Benutzer mit nur der Rolle Außendienst sehen ausschließlich selbst angelegte oder ihnen zugewiesene Projekte; Fachprüfer und Admins sehen alle.
   - Der Server prüft das bei jedem Zugriff: Liste, Projekt- und Raumdaten, Auswertung, Berechnungen, Offline-Paket, Auschecken, Synchronisierung. Fremde Projekte gelten als „nicht gefunden“.
   - Die Sammelansicht ist ohnehin nur für Fachprüfer.
2. **Zuweisung:** Admins wählen im Projektkopf unter „Zuständig (Außendienst)“ einen anderen aktiven Außendienst-Benutzer, z. B. als Urlaubsvertretung. Das wird protokolliert. Die Projektliste zeigt eine Spalte „Zuständig“.
3. **Test1–Test3** gehörten bereits dem Admin-Konto serek.manfred@googlemail.com. Das Außendienst-Konto hsteber@web.de sieht sie nicht mehr; bei Bedarf zuweisen.
4. **Projektnummer:**
   - wird beim Anlegen automatisch vergeben, fortlaufend je Jahr (2026-0001, 2026-0002 …);
   - im Formular nicht mehr eintippbar, nur Admins ändern sie im Projektkopf;
   - bei Doppelung: „Projektnummer x ist bereits vergeben“;
   - offline angelegte Projekte zeigen „Nr. folgt“, bis der Server die Nummer vergibt;
   - die alten Nummern 1–3 bleiben.
5. **Verständliche Fehlermeldungen:**
   - Ungültige Eingaben z. B. als „Bitte Eingaben prüfen: Länge darf höchstens 100 sein.“
   - „Raum nicht gefunden – evtl. inzwischen gelöscht“ statt technischer Namen.
   - Doppelte E-Mail-Adresse oder doppelter Raumtyp werden konkret gemeldet.
   - Der allgemeine Datenkonflikt hat einen erklärenden Text.
   - Für Serverfehler (500–504) gibt es Standardtexte statt „Fehler 500“.
   - Ungültige Eingaben in der Vorschau führen nicht mehr zu einem Serverfehler.

## Anmeldung verbessert (31.10.2026)

1. **Augen-Symbol** in allen Passwortfeldern (Anmeldung, Passwort ändern, Benutzer anlegen) zum Ein- und Ausblenden; Tippfläche 44 px.
2. **Anmeldebremse je Gerät/IP-Adresse statt je Konto** (`backend/app/anmeldebremse.py`). Damit kann niemand einen Kollegen aussperren.
   - Ab 5 Fehlversuchen: „E-Mail oder Passwort falsch. Noch x Versuche, dann 2 Minuten Pause.“
   - Nach 10 Fehlversuchen 2 Minuten Pause, danach je weiterem Fehlversuch erneut 2 Minuten.
   - Gezählt wird seit der letzten erfolgreichen Anmeldung bzw. Freigabe von diesem Gerät, höchstens 24 Stunden.
   - Bisher galten 5 Fehlversuche je Konto und 15 Minuten Pause.
   - Hinweis: Geräte hinter demselben Internetanschluss (z. B. im Büro) teilen sich eine IP-Adresse und damit den Zähler.
   - Abwägung: Ohne Zählung je Konto kann ein Angreifer mit vielen IP-Adressen mehr Passwörter ausprobieren. Dagegen helfen die Mindestlänge von 12 Zeichen und die langsame Passwortprüfung (Argon2).
3. **Benutzerverwaltung → „Anmeldesperren“:** Geräte ab 5 Fehlversuchen mit den dort versuchten Konten. „Sperre lösen“ wirkt sofort und wird protokolliert. Kommandozeile: `sperre-loesen --email … | --ip …`.
4. Die Sperre für serek.manfred@googlemail.com (5 Fehlversuche um 15:25–15:26 Uhr von 45.155.118.168) wurde am 31.10.2026 um 15:35 Uhr aufgehoben (protokolliert).

## Korrektur: Auswahl im Deckenplan, App-Aktualisierung (31.10.2026)

1. **Riesige orange Fläche beim Antippen von Tür/Fenster behoben.**
   - Ursache: Die Auswahl-Regel `stroke-width: 3px` traf auch die unsichtbare Tippfläche und den Wandausschnitt. Beide wurden ohne `non-scaling-stroke` gezeichnet, also galten die 3 px als 3 Planeinheiten = 3 m.
   - Jetzt werden alle Striche im Plan in Bildschirmpixeln gezeichnet, Tippflächen haben nie einen Rand, und die Auswahl gilt nur für sichtbare Formen. Ein Regressionstest prüft die Stilregeln.
   - Tür/Fenster ausgewählt: dezent orange, kleine Anfasser an beiden Enden (sichtbar 18 px, Trefferfläche 44 px) zum Verschieben bzw. Ändern der Breite, Breite als Maßzahl.
   - Geprüft im Browser auf Handy (390 px), Tablet (1024 px) und Laptop (1440 px) mit Tür, Fenster, Sitzplatz, Leuchte und Modul: dickster Strich höchstens 3 px, Markierungen nur so groß wie das Element samt Abstandskreis.
2. **Neue App-Version:**
   - Der Service Worker sucht alle 30 Minuten, beim Zurückkehren in die App und bei wiederhergestellter Verbindung nach einer neuen Version.
   - Liegt eine vor, erscheint oben „Neue Version verfügbar – Jetzt aktualisieren“. Erst der Klick lädt neu; ausstehende Offline-Änderungen bleiben in IndexedDB erhalten.
   - `index.html` wird nicht mehr zwischengespeichert; die Sicherheits-Header bleiben.
   - Übergang: Bereits installierte Apps laufen noch mit dem alten Service Worker. Die neue Version wird dort einmalig aktiv, sobald alle Fenster der App geschlossen und neu geöffnet wurden; danach erscheint bei Updates der Hinweis.
   - Den Hinweis selbst konnte ich nicht durchspielen, dafür braucht es eine zweite neue Version.

## Neu: Deckenplan nach dem Praxistest (31.10.2026)

Regeln im Detail: `docs/FACHKONZEPT.md`, Abschnitt „Deckenplan: Bedienung und Darstellung“. Verschieben, Platzieren, Drehen und der Bad-Hinweis sind unverändert.

1. **„Deckenplan öffnen“:** große Schaltfläche in jeder Raumkarte (rund 100 px hoch) mit kleiner Vorschau des Plans; der Plan öffnet bildschirmfüllend.
2. **Sperrflächen:**
   - vier Eck-Anfasser (Trefferfläche 44 px), Größe in jede Richtung;
   - beim Antippen Typ, Breite × Tiefe (m) und Löschen;
   - Live-Maße beim Ziehen.
3. **Bemaßung:** Raummaße an allen vier Wänden; beim gewählten Modul die Abstände zu den zwei nächsten Wänden, im Plan und in der Auswahlleiste.
4. **Tür und Fenster:** Wand antippen; Lage, Breite, Aufschlag (innen/außen) und Band (links/rechts). Darstellung wie im Bauplan. Keine Sperrflächen, offline-fähig, synchronisiert.
5. **Unterdimensionierung:**
   - Ursache im Praxistest: Handkorrektur (Raum „Wohnen“ in Test2, Protokoll 31.10.2026). Vorgeschlagen war 1 × CL-900 = 900 W ≥ 880 W; von Hand entstanden daraus 2 × CL-420 = 840 W.
   - Jetzt erscheint in Raumkarte, Deckenplan und Raumliste eine deutliche rote Warnung „Unterdimensioniert“; Überdimensionierung wird gelb gewarnt.
   - Ein Test sichert ab, dass der Vorschlag nie unterdimensioniert.

## Neu: verfeinerte Sperre bei geänderten Fachvorgaben (18.10.2026)

Regeln im Detail: `docs/FACHKONZEPT.md`, Abschnitt „Fachvorgaben je Projekt eingefroren“.

1. **Nur betroffene Projekte warten.** Gezählt wird je Raum: Heizlast (maßgeblich, A, C), benötigte Leistung (Modulauswahl), Leistungswarnungen, Thermostate und Regelverstöße.
   - Alle anderen Projekte übernehmen still. Das wird protokolliert, der Status bleibt.
   - Eine bewusste Ablehnung gilt bei späteren Änderungen ohne Auswirkung weiter.
2. **Sammelansicht** „Vorgaben-Abgleich“ (Menü, nur Fachprüfer): betroffene Projekte mit Heizlast vorher/nachher und neuen Regelverstößen. Mehrfachauswahl, dann „Für ausgewählte übernehmen“ oder „Für ausgewählte ablehnen“ (Begründung optional).
3. **Vorschau vor dem Speichern** auf der Seite Fachvorgaben: „Diese Änderung betrifft x Projekte“ mit Liste. Gespeichert wird erst nach Bestätigung; ohne betroffene Projekte direkt.
4. **Neue Kommandozeilenbefehle** (`backend/README.md`): `regel-setzen`, `vorgaben-quelle-setzen`, `vorgaben-abgleichen`, `vorgaben-uebernehmen`.

## Neu: Modulkatalog, Sperrflächen und Modulplatzierung (14.10.2026)

Regeln im Detail: `docs/FACHKONZEPT.md`, Abschnitt „Modulplanung“.

1. **Import** der Importdatei. Übersicht siehe „Daten“ oben.
2. **Deckenplan je Raum** (Raumkarte → „Deckenplan: Sperrflächen und Module“, für alle Rollen):
   - maßstäbliche Draufsicht; Sperrflächen per Finger einzeichnen, verschieben, Größe ändern (Eckpunkt), löschen;
   - gestrichelt: Wandabstand und Mindestabstände der Sperrflächen.
3. **„Module vorschlagen“:** möglichst wenige Module, regelkonform und gleichmäßig verteilt; Warnungen zur Leistung; im Bad nur badgeeignete Module mit Hinweis zur Elektrofachkraft. Ohne Lösung erscheint eine klare Meldung mit Vorschlag.
4. **Manuell:** Module verschieben, drehen, tauschen, hinzufügen, löschen. Verstöße live rot, mit Begründung.
5. **Thermostat** je Raum mit Modulen, in der Raumkarte und in der Raumliste.
6. **Offline:** Der Katalog liegt im Geräte-Schnappschuss, die Regeln im eingefrorenen Projektstand. Gespeichert wird beim Loslassen über die Warteschlange.
7. **Reiter „Raumliste“:** Module (Typ, Anzahl), installierte Leistung, Thermostate und Prüfergebnis je Raum, mit Summen.
8. **Fachvorgaben-Seite:** Platzierungsregeln pflegbar (Wert, Quelle), Modulkatalog zur Ansicht, Altbau-Richtwert je Raumtyp.

Noch nicht gebaut: Angebot und PDF-Platzierungsplan (Teil E).

## Neu: Entscheidung über neue Fachvorgaben (13.10.2026, zweite Rückmeldung)

1. **Hilfetext „Klimadaten“:** „Auslegungs-Außentemperatur am Standort (Norm-Außentemperatur), ermittelt über die Postleitzahl. Nicht die tiefste je gemessene Temperatur. Nur für die Kontrollrechnung.“
2. **„Neue Vorgaben übernehmen“ nur für Fachprüfer:**
   - Unterschiedsliste und Knopf sieht nur die Rolle Fachprüfer.
   - Der Außendienst sieht nur: „Die Fachvorgaben wurden aktualisiert. Der Fachprüfer prüft dieses Projekt vor dem Angebot.“
   - Neu ist **„Ablehnen, bisherige Werte behalten“**, mit optionaler Begründung. Die Ablehnung wird protokolliert, Projektdaten und Status bleiben unverändert.
   - Bis zur Übernahme oder Ablehnung ist für das Projekt **kein Angebot möglich** (`angebot_gesperrt`). Es lässt sich so lange nicht prüfen und zeigt „wartet auf Fachprüfer“.
   - Ändern sich die zentralen Vorgaben nach einer Ablehnung erneut, ist die Entscheidung wieder offen.
   - Der Server prüft die Rolle (403).
   - Datenbank: Migration `5e8b1c90d4a7` mit zwei neuen Spalten am Projekt (abgelehnter Stand und Zeitpunkt).

## Neu nach dem ersten Praxistest (13.10.2026)

Die App wird von Vertriebsmitarbeitern ohne Heizungs-Fachwissen bedient. Umgesetzt (Regeln in `docs/FACHKONZEPT.md`):

1. **Fachvorgaben-Seite** (Raumtypen und Pauschalen) nur für Fachprüfer und Admins. Für den Außendienst ist sie weder im Menü noch über die Adresse erreichbar.
2. **Vereinfachte Raumkarte für den Außendienst:**
   - sichtbar sind nur Raum, Raumtyp, Länge/Breite/Höhe, W/m² (nur Anzeige) und Heizlast;
   - ausgeblendet sind Heizlastquelle, Kontrollrechnung, Bauteile/U-Werte und der Reiter „Projektvorgaben“;
   - „Raum löschen“ steht direkt in der Karte.
   - Fachprüfer und Admins sehen alles.
   - W/m² (je Raum und je Projekt) setzt nur die Rolle Fachprüfer. Das prüft auch der Server (403).
3. **Neue Beschriftungen:**
   - „sonstiger Bestand“ → „Altbau (nicht Effizienzhaus)“
   - „Raumtemperatur (θint, °C)“, „Luftwechsel (n, pro Stunde)“, „Korrekturfaktor angrenzender Raum (f)“, „Quelle des Werts“
   - „Gegenprobe C“ heißt in der Oberfläche „Kontrollrechnung“.
   - Der interne Schlüssel `sonstiger_bestand` bleibt, die Daten sind unverändert.
4. **ⓘ neben Fachbegriffen:** Antippen zeigt den Hilfetext, erneutes Antippen oder Tippen daneben schließt ihn. Die Tippfläche ist rund 44 px groß, der Text bleibt auch auf dem Handy im Bild. Alle Texte stehen in `frontend/src/texte.ts` (`HILFE`).
5. **Altbau: „wartet auf Fachprüfer“:**
   - Der Außendienst sieht „Pauschale wird vom Fachprüfer festgelegt“.
   - Solange ein Raum keinen W/m²-Wert hat, zeigt das Projekt den Status „wartet auf Fachprüfer“, in der Liste und im Projekt.
   - Es kann so lange nicht als geprüft markiert werden und ist damit für Angebote gesperrt.
   - Der Status wird aus den Daten abgeleitet (Server und Tablet, auch offline). Ein neuer Raum ohne Wert lässt das Projekt wieder warten.
   - Das Angebotsmodul gibt es noch nicht; es muss beim Bau `wartet_auf_fachpruefer` beachten.

## Neu in Phase 1D (Festlegungen vom 12.10.2026)

1. **Kein Höhenzuschlag.** Bei Räumen über 2,80 m erscheint nur „Raumhöhe über 2,80 m – Pauschale prüfen und ggf. manuell anpassen.“ Wird die Pauschale für den Raum von Hand gesetzt, verschwindet der Hinweis.
2. **„sonstiger Bestand“** (seit 13.10.2026 „Altbau (nicht Effizienzhaus)“, Pauschale nur durch den Fachprüfer):
   - kein Rückfallwert und keine Tabellenwerte (der Server lehnt sie ab);
   - die W/m²-Pauschale ist in jeder Raumkarte ein Pflichtfeld, rot markiert, solange es leer ist;
   - dazu der Hinweis, dass Infrarot nicht empfohlen wird.
3. **Rollen kombinierbar.**
   - Prüfen und Freigeben gehen nur mit der Rolle Fachprüfer. Ein Konto mit nur Admin darf es weiterhin nicht.
   - In der Benutzerverwaltung lassen sich mehrere Rollen wählen.
   - Über die Kommandozeile: `rollen-setzen`.
4. **Fachvorgaben je Projekt eingefroren:**
   - Das Projekt speichert beim Anlegen eine Kopie der Vorgaben und rechnet nur damit, auch offline.
   - Ändern sich die zentralen Vorgaben, erscheint im Projekt ein orangefarbener Hinweis. Er zeigt die Unterschiede alt/neu, die Heizlast-Summe vorher/nachher und die betroffenen Räume.
   - „Neue Vorgaben übernehmen“ wird mit allen Unterschieden protokolliert.
   - Freigegebene Projekte bleiben unverändert.

## Neu in Phase 1C

- **HTTPS und Sicherheits-Header:**
  - HSTS (1 Jahr), CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; der `Server`-Header ist entfernt.
  - Sitzungs-Cookie mit `Secure`, `HttpOnly`, `SameSite=Strict` und `Path=/api`.
- **PWA installierbar:** Manifest (`application/manifest+json`) und Service Worker. Die App startet ohne Netz.
- **Offline-Betrieb:**
  - Projekt „für Offline-Bearbeitung auschecken“, danach auf dem Gerät in IndexedDB bearbeiten, auch ohne Netz.
  - Der Schnappschuss der Fachvorgaben und Bibliotheken liegt mit auf dem Gerät.
  - Änderungen kommen in eine Warteschlange und werden automatisch übertragen, sobald der Server erreichbar ist.
  - Statusanzeige im Kopf: Online / Offline / x Änderungen ausstehend / Übertragung angehalten. Bei abgelehnten Änderungen gibt es die Wahl „erneut versuchen“ oder „verwerfen“.
  - Ohne Netz angelegte Projekte werden beim nächsten Kontakt angelegt und ausgecheckt.
- **Sperre:**
  - Ein ausgechecktes Projekt ist für alle anderen gesperrt. Die Anzeige nennt, wer es auf welchem Gerät seit wann hat.
  - Der Server prüft das über ein Sperr-Token je Gerät und antwortet sonst mit 423.
  - Ein Admin kann die Sperre lösen. Danach nimmt der Server alte Änderungen dieses Geräts nicht mehr an (409, wird angezeigt).
- **Rechenkern im Browser:**
  - Die Vorgaben-Auflösung (Herkunft, „Vorgabe fehlt“) liegt jetzt im Rechenkern (0.3.0).
  - Server und Tablet rechnen mit demselben Code. Alle bisherigen Backend-Auswertungstests laufen unverändert grün.
  - Gespeicherte Berechnungen enthalten jetzt den vollständigen Planungsstand (`eingaben.art = "objekt"`).
- **Abmelden:**
  - Mit Verbindung wird zuerst alles übertragen und eingecheckt. Danach werden die lokalen Daten gelöscht.
  - Bleibt etwas offen, fragt die App vorher nach.
  - Meldet sich auf dem Gerät ein anderer Benutzer an, während noch fremde Offline-Daten da sind, fragt die App ebenfalls.

Funktionen aus Phase 1B (Rollen, Status, Protokoll, Fachvorgaben, Heizlastquellen A/B/C, Schnellerfassung, Bremse, Benutzerverwaltung, Datensicherung) unverändert; Details in `docs/FACHKONZEPT.md`.

## Tests (alle grün)

| Bereich | Ergebnis |
|---|---|
| Rechenkern (Vitest) | 112 Tests (0.11.0). Neu (Paket N2): nächstes Wandsegment mit Ausrichtung, Wandlinie und Bereich an der L-Form, Tür an einer Innenwand schlägt in den Raum. Davor 111 Tests (0.10.0). Neu (Paket M): Raumform (Rechteck, L-Form 18 m² mit 6 Segmenten, Abstand an der Innenecke euklidisch, Modul über dem Einsprung unzulässig, Platzierung im L, U-Form, Ausschnitt in der Ecke, Erker mit negativen Koordinaten, Heizlast aus Gesamtfläche, Wärmeverteilung nur im Raum), Berichtsstatus OK/Prüfen/Unterdeckt. Davor 102 Tests (0.8.0). Neu: Objektkategorien tabu/Abstand/neutral, Kantenabstand (außen, innen, über die Kante), unbekanntes Objekt gilt als tabu, ältere Daten mit festem Typ, Punkt ohne Abstand → keine automatische Planung, Standardhöhe über den Objektschlüssel, Streifen und Punkte keine Empfangsfläche. Davor 96 Tests. Neu: Min/Mittel/Max des Raums, Beispielrechnung Emissionsgrad (CL-540-Maße, 90 °C: ε 0,3 → 4,05 W/m², ε 0,93 → 12,57 W/m² direkt darunter). Davor 95 Tests. Neu in 0.7.0 (Wärmeverteilung): Eckformel für X = Y = 1 (≈ 0,13853), unendliche Decke → F = 1, Punkt mittig = 4 Eckrechtecke, Symmetrie, Abnahme mit Abstand (senkrecht und seitlich), Stefan-Boltzmann (100 °C gegen 20 °C, ε 0,9 ≈ 612,6 W/m²), Summe mehrerer Module, Abstrahlwinkel (außerhalb 0, darunter wie unbegrenzt), Möbeloberseite näher an der Decke, Raster, Vorgabewerte und „Vorgabe fehlt“. Bis 31.10.: 78 Tests. Neu in 0.6.0: Leistungsstatus unter/passend/über, 2 × 420 W bei 880 W Bedarf → „unter“, Prüflauf 200 Zufallsräume (Vorschlag nie unter Bedarf), Tür (Band, Aufschlag, Bogenrichtung) an allen Wänden, Begrenzung auf die Wand, Wandabstände des Moduls, nächste Wand beim Antippen. Bisher 69 Tests, Typprüfung fehlerfrei; laufen bei jedem Backend-Build. Neu in 0.5.0 (20 Tests): Beispielräume klein (2,5 × 2 m → 1 × 350 W), groß (8 × 6 m → 3 Module gleichmäßig, Warnung Überdimensionierung), Bad (nur badgeeignet ab IP44, Hinweis), viele Sperrflächen (nie über Sitzplatz/Bett, alle Abstände), ohne gültige Lösung (Meldung mit größter möglicher Leistung), kein Modul passt, quer liegender Raum, fehlende Regeln, Mindesthöhe; Regelprüfung im Klartext; Leistung; Raumliste je Raum |
| Backend (pytest, mit echtem Rechenkern) | 133 Tests. Neu: Tür an einem Wandsegment mit Höhe und Brüstung, ungültige Brüstung abgelehnt. Davor 132 Tests. Neu (Paket M): Raumgeometrie (Hauptrechteck folgt Länge × Breite, Fläche/Umfang aus dem Rechenkern, ungültige Teile, negative Koordinaten), Firmendaten (nur Admin, eine Standardfirma, Logo PNG/JPG/SVG, Inhaltsprüfung, 2 MB, SVG mit Entitäten abgelehnt, Skripte/externe Verweise entfernt, SVG → PNG, Ersetzen löscht alte Datei, Dateirechte ohne Ausführung), Berichtsfirma je Projekt, Berichte (Daten aus dem Rechenkern ohne Preise, PDF mit Sichtbarkeit und Dateiname mit Umlauten, Bestellliste mit Formeln/Eingabezellen/Druckeinstellungen, Kalkulation nur mit Recht, Preisstand eingefroren und bewusst aktualisiert, „Preis fehlt“), Preise im Katalog nur mit Recht. Davor 120 Tests. Neu (Excel für alle Tabellen): einheitlicher Aufbau aller sechs Dateien (Blattname, Hinweisblatt, fixierte Kopfzeile), nur Fachprüfer/Admin, Pauschale über Excel geändert → Vorschau alt → neu und betroffenes Projekt, Übernahme mit Protokoll (Benutzer, Feld alt/neu) und wartendem Projekt, Fehler mit Zeilennummer (Quelle fehlt, keine Zahl, doppelt) → nichts übernommen, geänderte Datei abgelehnt, Regeln (feste Liste, ja/nein, Grenze Emissionsgrad), Objekte (neu, deaktivieren, fehlende Zeile löscht nicht, unbekannte Auswahl/Raumtyp), Klimadaten (PLZ als Zahl, kein Duplikat), U-Wert-Grenze, Modulkatalog über dieselben Adressen mit alter Überschrift. Davor 113 Tests. Neu (Objektbibliothek): Startausstattung, Pflege nur Fachprüfer/Admin (Name doppelt, Maße zur Form, Quelle Pflicht, unbekannter Raumtyp, Punkt ohne Maße, Protokoll), Kategorie-Änderung mit Vorschau → Projekt wartet und rechnet bis zur Übernahme mit dem eingefrorenen Stand, Änderung ohne Auswirkung still übernommen, Höhe gespeichert, Umstellung eingefrorener Stände (Werte des eigenen Stands, Quellen), alter fester Typ wird zugeordnet, Excel-Import überspringt abgelöste Regeln. Davor 107 Tests. Neu (Reimport): Vorschau und Übernahme (Zuordnung über Artikel-Nr., neues Modul, Protokoll je Feld), Fehler mit Zeilennummer (Leistung leer, Bad bei IP20, doppelte Artikel-Nr.) → nichts übernommen, nie löschen, „aktiv“ = nein deaktiviert, geänderte Datei abgelehnt (Prüfsumme), nur Admin/Fachprüfer, keine Excel-Datei, verwendetes Modul → Projekt wartet. Davor 103 Tests. Neu am 01.11.: Strahlerkennwerte im Katalog (Wertebereiche, leeren erlaubt, Export), Vorgabewerte und Höhen in den Regeln (Wertebereiche), Höhe je Sperrfläche, neue Regeln sperren kein Projekt. Bis 31.10.: 101 Tests. Neu am 31.10. (Modulkatalog): Rechte (Außendienst lesen, Admin/Fachprüfer pflegen), Plausibilität mit verständlichen Texten, doppelte Artikel-Nr., Protokoll je Feld, Löschen nur unbenutzt sonst deaktivieren (Planung bleibt gültig), Excel-Export im Importformat, geänderte Leistung → Projekt wartet (Unterschiede, installiert alt/neu, Prüfen gesperrt, ablehnen, erneute Änderung, übernehmen mit Lage), Textänderung still übernommen (Status bleibt), längeres Modul → neuer Wandabstands-Verstoß über die Sammelansicht übernommen, freigegebene Projekte unverändert. Davor 93 Tests. Neu am 31.10. (Sichtbarkeit): Außendienst A sieht keine Projekte von B, auch nicht über 19 API-Wege (Projekt, Ändern, Protokoll, Vorgaben, Auschecken, Einchecken, Offline-Paket, Gebäude, Geschosse, Auswertung, Berechnungen lesen/speichern, Geschoss/Raum anlegen, Raum lesen/ändern/löschen, Bauteilflächen), Fachprüfer/Admin sehen alle; Zuweisung nur durch Admin, nur an aktiven Außendienst, protokolliert, wirkt sofort; Nummern fortlaufend, nur Admin ändert, Doppelung verständlich; deutsche Eingabe- und Nicht-gefunden-Texte. Davor 89 Tests. Neu am 31.10. (Anmeldung): Hinweis ab 5, Sperre nach 10, andere IP sperrt das Konto nicht, Bremse je IP über alle Konten, nach der Pause erneut 2 Minuten je Fehlversuch, Erfolg setzt zurück, alte Fehlversuche (> 24 h) zählen nicht, Admin sieht und löst Sperren (protokolliert, nur Admin), Kommandozeile sperre-loesen und passwort-setzen. Davor 85 Tests. Neu am 31.10.: Türen/Fenster speichern, im Offline-Paket, Auswertung unverändert, ungültige Wand/Breite abgelehnt. Bis 18.10.: 84 Tests. Neu am 18.10.: neuer Raumtyp ohne Auswirkung still übernommen (Status „geprüft“ bleibt, Protokoll „automatisch“), Quellenänderung sperrt nicht, neue Wandabstands-Regel sperrt nur das Projekt mit dann verletztem Modul, Vorschau ohne Speichern (betroffen/nicht betroffen, nur Fachprüfer/Admin), Sammelansicht und Sammelentscheidung (ablehnen, übernehmen, unbekanntes und ausgechecktes Projekt gemeldet), Ablehnung gilt bei Änderung ohne Auswirkung weiter, Kommandozeile. Vom 14.10.: Import der echten Importdatei (Umbenennen, Regeln, Katalog, erneuter Import), Probelauf, alles oder nichts bei Fehlern, Regeln pflegen (nur Fachprüfer/Admin, protokolliert), Regeln im Projekt eingefroren, Katalog und Offline-Schnappschuss, Sperrflächen/Module speichern, prüfen und auswerten. Vom 13.10.: Neu am 13.10. (2. Rückmeldung): Übernehmen und Ablehnen nur Fachprüfer (403), offene Vorgaben sperren Angebot und Prüfen (409), Ablehnung protokolliert mit Begründung, Status bleibt, erneute zentrale Änderung öffnet wieder, reine Quellenänderung nicht, spätere Übernahme hebt Ablehnung auf, freigegeben nie offen. Neu am 13.10. (1. Rückmeldung): W/m² nur durch Fachprüfer (Außendienst und reiner Admin 403, unveränderte Werte erlaubt), Altbau wartet auf Fachprüfer (ohne Räume nicht, Prüfen gesperrt, nach Festlegung prüfbar, neuer Raum wartet wieder), Neubau wartet nie. Aus Phase 1D: eingefrorene Vorgaben (Unterschiede, Auswirkung, Übernahme mit Protokoll, Freigabe unverändert, Sperre, Rücksetzung auf Entwurf), kombinierte Rollen (Admin + Fachprüfer gibt frei, nur Admin nicht), Rollen in Verwaltung und Kommandozeile, „sonstiger Bestand“, Hinweis-Höhe |
| Frontend (Vitest) | 68 Tests. Neu (Paket N1): Praxistest Sofa Tiefe 3 (Mitte, in den Raum geschoben), Mitte bleibt, zu groß bzw. über Einsprung → Meldung, Drehen mit Verschieben bzw. Hinweis. Davor 64 Tests. Neu: Gebäudestandard kurz, Raumform-Vorlagen, Raster mit Versatz. Davor 61 Tests. Neu: einheitliche Tabellen (fixierte Kopfzeile, Zahlen rechtsbündig, Karten am Handy), Zahlenformat, Hilfetext Emissionsgrad. Davor 59 Tests. Neu: Auswahl nach Raumtyp (spezielle zuerst, inaktive nie), zuletzt verwendet, Maßtexte, Höhenbeschriftung, Streifen-Geometrie, Standardhöhen aus der Bibliothek, Interpolation, stufenlose Farben, Bildpunkte, Farbbalken, Stilregeln (schwarze Beschriftung mit weißem Rand, Kontrast der Hilfetexte, Katalog ohne Mindestbreiten). Davor 46 Tests. Neu: Autoskala (Grenzen, Stufen, ohne Spanne), feste Skala, Farbstufen, fixierte Kopfzeile/Spalte im Katalog. Davor 43 Tests. Neu: feste Farbskala, Höhen-Vorgaben, Rechnen mit Vorgabewerten bzw. „Vorgabe fehlt“, Farbschicht lässt Eingaben durch. Bis 31.10.: 39 Tests. Neu: offene Moduldaten sperren das Angebot auch offline. Davor 38 Tests. Neu: Stilregeln des Plans (Striche in Bildschirmpixeln, Tippflächen ohne Rand). Davor 36 Tests. Neu am 31.10.: Tür und Fenster offline, Auswertung unverändert. Bis 14.10.: 35 Tests. Neu am 14.10.: Deckenplan offline speichern und mit eingefrorenen Regeln prüfen. Vom 13.10.: offene Vorgaben vom Auschecken sperren das Angebot offline, Ablehnen offline erst nach dem Einchecken; „wartet auf Fachprüfer“ offline aus dem lokalen Stand, Statusanzeige, Hinweise für den Außendienst, Beschriftung Altbau. Aus Phase 1C/1D, Offline-Logik: Rechnen mit dem eingefrorenen Projektstand, Hinweis statt Zuschlag, Übernahme erst nach dem Einchecken. Laufen bei jedem Frontend-Build; `tsc` und `vite build` fehlerfrei |
| Migration | `3b7e9c4d2a18` am 31.10.2026 ausgeführt (vorher Sicherung `infrarot_db_20261031_115623.dump`), `alembic check` sauber. `8d3f6a21c5e9` am 14.10.2026 ausgeführt (vorher Sicherung `infrarot_db_20261014_151658.dump`), `alembic check` sauber. `5e8b1c90d4a7` am 13.10.2026 auf der echten Datenbank ausgeführt (vorher Sicherung `infrarot_db_20261013_145403.dump`), `alembic check`: Modell und Datenbank stimmen überein. Ihre Projekte „Test1“ und „Test2“: keine offenen Vorgaben, Angebot möglich |
| Browser 02.11.2026, Paket N | Testmatrix mit temporärem Konto und Testprojekt (Rechteck 4 × 3 m und L-Form 6 × 4 m), danach entfernt: 32 von 32 Prüfungen (N1: Tiefe 3 wirkt, Meldung bei 3,5, Komma, Mitte bleibt, Leiste in einer Zeile, Maßanzeige über den Anfassern, Drehen per Knopf/Taste R/Knopf am Objekt, Rückgängig, Drehen unmöglich → Hinweis; N2: alle vier Wände, Ecken, über einem Objekt, Breite zu groß → Meldung, Breite/Höhe/Brüstung, Verschieben ohne Sprung, Aufschlag/Band, Löschen, Rückgängig, L-Form-Innenwände und Innenecke, Bericht; Handy ohne waagrechten Bildlauf) |
| Browser 02.11.2026, Paket M | Mit temporären Konten, Testfirma und Testprojekten, danach alles entfernt: Projektkopf 150 px, Anlegen 172 px, Labels auf einer Höhe, Standard ohne Vorauswahl, Bestätigung beim Wechsel (800 → 1 400 W); L-Form 18 m²/720 W, 10 bemaßte Segmente, Ziehen am Anfasser; Firmendaten mit SVG-Logo (→ PNG 1 200 px); Ergebnisbericht, Bestellliste, Kalkulation heruntergeladen (Dateinamen mit Umlauten), Außendienst ohne Kalkulationsknopf (403), offline Hinweis statt Knöpfen |
| Browser 01.11.2026, Paket J–L | Mit temporärem Fachprüfer-Konto, danach entfernt; nichts übernommen: bei 1 400 px keine Tabelle mit waagrechtem Scrollen, Seite nicht breiter als das Fenster; Raumtyp-Dialog mit 12 Feldern; Emissionsgrad 1,5 im Regel-Dialog abgelehnt; Modul-Dialog „Emissionsgrad (0–1, ohne Einheit)“ mit ⓘ; Objektbibliothek exportiert (Blätter „Objektbibliothek“, „Hinweise“), in Excel geändert und geprüft: „1 geändert · 0 neu · 29 unverändert · 1 Fehler“, Fehler „Zeile 32 (E2E Test): Form: „Kreis“ – erlaubt: …“, Änderung „Sofa · Mindestabstand (cm) · 30 → 35“, Übernehmen gesperrt; am Handy Kartenansicht ohne waagrechten Bildlauf |
| Browser 01.11.2026, Praxistest E–I | Mit temporären Konten und Testprojekt (Bad 3,20 × 2,60 m), danach alles entfernt: Auswahl im Bad „Dusche, Badewanne, Waschtisch, WC, Spiegelschrank, Hochschrank“, dann „Für alle Räume“; Suche „wasch“ → Waschtisch; zuletzt verwendet oben; Höhe „0,00 m (Standard für Dusche)“ → nach Eingabe „0,90 m (angepasst)“; Wärmeverteilung mit CL-540 weich als Bild, Farbbalken 1,0 … 8,8 W/m², Deckkraft 75 % → 40 %; Beschriftung schwarz/weiß; Katalog bei 1280 und 1366 px ohne waagrechten Bildlauf, Dialog mit allen 18 Feldern; Objektbibliothek mit 30 Zeilen |
| Browser 01.11.2026, Wärmeverteilung | Mit temporären Konten, Testmodul (95 °C, ε 0,93, 160°) und Testprojekt 5 × 4 × 2,5 m mit zwei Modulen, Sitzplatz und Hochschrank, danach alles entfernt: 2 000 Rasterzellen, Höchstwert 34 W/m² (plausibel: rund 22 W/m² je Modul direkt darunter), Wert unter dem Zeiger am Boden 29 W/m² und auf dem Sitzplatz in 0,45 m Höhe 24 W/m²; Höhenfeld mit „0,45 (Vorgabe)“; nach dem Verschieben neu gerechnet; Sperrflächen trotz Farbschicht antippbar; keine Konsolenfehler |
| Browser 31.10.2026, Modulkatalog | Mit temporären Konten, Testmodul und Testprojekt, danach alles entfernt; echte Katalogdaten unberührt. Geprüft: neues Modul über das Formular; Leistung in der Tabelle 500 → 650 W → „1 Projekt(e) warten …“; „Bad geeignet“ mit IP20 → verständliche Meldung; Löschen eines verwendeten Moduls → Hinweis „bitte stattdessen deaktivieren“; Excel-Download; Projekt zeigt „Daten verwendeter Module wurden im Katalog geändert …“ und „wartet auf Fachprüfer“; Sammelansicht „Moduldaten, installiert 500 W → 650 W“; Außendienst: Tabelle gesperrt, ohne Formular und Löschen, neutraler Hinweis im Projekt |
| Ende-zu-Ende 31.10.2026, Sichtbarkeit | Mit zwei temporären Außendienst-Konten und einem Admin, danach entfernt: Nummern 2026-0001/-0002 automatisch (mitgeschickte Nummer ignoriert); A und B sehen nur ihr Projekt; A erhält für Projekt, Offline-Paket, Auswertung und Auschecken von B jeweils 404; A darf die Nummer nicht ändern (403); Admin sieht alles, doppelte Nummer → „Projektnummer 2026-0002 ist bereits vergeben“; Zuweisung im Browser → B sieht beide Projekte; Formular ohne Nummernfeld |
| Browser 31.10.2026 (Chromium headless, Tablet 1024 px, Handy 390 px) | Mit temporärem Außendienst-Konto, danach Konto und Testprojekte entfernt: Schaltfläche „Deckenplan öffnen“ 101 px hoch; 4 Eck-Anfasser mit 44 px Trefferfläche; Ecke oben links gezogen, Live-Maß „2,35 × 1,25 m“; Breite 1,8 eingegeben → „1,80 × 1,25 m“; Tür an der unteren und Fenster an der oberen Wand per Antippen; Vorschlag 1 × CL-900, Auswahl zeigt „Wand rechts 0,65 m · Wand unten 1,60 m“; von Hand 2 × CL-420 → rote Warnung „Unterdimensioniert: … 840 W … 880 W“ in Plan und Raumkarte; Bemaßung auf dem Handy vollständig lesbar, keine horizontale Bildlaufleiste, keine Konsolenfehler |
| Browser und Schnittstelle 18.10.2026 | Mit temporärem Fachprüfer-Konto, danach entfernt: Vorschau Rückfallwert Neubau 40 → 99 W/m² → betrifft Test1 (2 040 → 5 049 W) und Test2 (3 140 → 4 025 W), gespeichert wurde nichts; Vorschau Wandabstand 300 cm → betrifft keines (keine Module); Quellenänderung → keines; Sammelansicht im Menü, leer, ohne Konsolenfehler |
| Browser 14.10.2026 (Chromium headless, Tablet 1024 px und Handy 390 px) | Mit temporärem Außendienst-Konto, danach Konto und Projekt entfernt: Sitzplatz und Leuchte eingezeichnet, Vorschlag 1 × CL-930 (930 W für benötigt 880 W), Modul per Zeiger auf den Sitzplatz gezogen → rot mit „liegt über einem Sitzplatz – über Sitzplätzen und Betten unzulässig“ und „liegt über einer Leuchte“, Raumliste mit Summen, Fachvorgaben nicht im Menü, Handy ohne horizontalen Bildlauf, keine Konsolenfehler |
| Ende-zu-Ende 13.10.2026 über HTTPS, Vorgaben ablehnen | Mit zwei temporären Konten 10 von 10 Prüfungen bestanden, Konten und Testprojekt danach entfernt. Zentrale Vorgaben wurden dabei nicht verändert, nur der eingefrorene Stand des Testprojekts. Geprüft: Vorgaben offen → Angebot gesperrt; Außendienst übernimmt/lehnt nicht ab (403); Prüfen gesperrt (409); Fachprüfer lehnt ab → rechnet weiter mit dem Projektstand (660 W), Angebot möglich, protokolliert mit Begründung; spätere Übernahme → 800 W |
| Ende-zu-Ende 13.10.2026 über HTTPS | Mit zwei temporären Konten (Außendienst; Admin + Fachprüfer) 10 von 10 Prüfungen bestanden, Konten und Testprojekt danach entfernt: Altbau ohne Räume wartet nicht, mit Raum ohne W/m² schon; Text „Altbau (nicht Effizienzhaus)“ und Hinweis „vom Fachprüfer festgelegt“ (Rechenkern 0.4.1); Außendienst setzt W/m² nicht (403), ändert aber Maße; Prüfen gesperrt (409); Fachprüfer setzt 120 W/m² → 2 400 W; danach nicht mehr wartend und prüfbar |
| Ende-zu-Ende Phase 1D über HTTPS | Mit einem temporären Konto geprüft, danach entfernt: Vorgaben-Stand beim Anlegen, 3,20 m hoher Raum → 800 W ohne Zuschlag mit Hinweis, „sonstiger Bestand“ ohne Raumpauschale ohne Ergebnis, mit 120 W/m² → 2 400 W, Außendienst darf nicht prüfen |
| Caddy | Konfiguration vorab in einem Wegwerf-Container geprüft; Skript lief am 12.10.2026; Schulungsplattform danach weiter per HTTPS erreichbar; Caddy nicht neu gestartet |
| Ende-zu-Ende Phase 1C über https://ir-planer.mybase-test.de | Mit zwei temporären Konten (Außendienst, Fachprüfer) 16 Prüfungen bestanden, Testkonten und Testdaten danach entfernt. Geprüft wurde: Cookie-Flags, Auschecken, Projektpaket, Schnappschuss, 423 ohne Token, Bearbeiten mit Token, Auswertung (Rechenkern 0.3.0, 4 × 5 m → 800 W mit Rückfallwert), Sperranzeige, 423 für den Fachprüfer bei Änderung, Status, fremdem Token und Einchecken, Einchecken durch das Gerät, 409 für das alte Token, danach Status möglich, Protokoll |

**Nicht automatisiert geprüft:** die Bedienung im echten Tablet-Browser, also Installation, Flugmodus und Statusanzeige. Dazu: das ⓘ, die vereinfachte Raumkarte und das Ziehen im Deckenplan mit dem Finger, also Eck-Anfasser, Tür und Fenster. Getestet wurde nur mit Mauszeiger im Headless-Browser. Zum Ansehen der Außendienst-Sicht ein Konto nur mit Rolle Außendienst anlegen (Benutzerverwaltung). Bitte einmal nach der Anleitung unten durchspielen.

## App auf dem Tablet installieren

1. Im Browser des Tablets **https://ir-planer.mybase-test.de** öffnen und anmelden.
   - Android: Chrome
   - iPad: Safari
2. Installieren:
   - **Android (Chrome):** Menü ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.
   - **iPad (Safari):** Teilen-Symbol → „Zum Home-Bildschirm“.
3. Die App über das neue Symbol „IR-Planer“ starten. Sie läuft dann ohne Browserleiste.
4. Vor dem Termin, mit Netz: Projekt öffnen und **„Für Offline-Bearbeitung auschecken“** tippen. Beim ersten Mal fragt die App nach einem Gerätenamen.
5. Vor Ort ohne Netz weiterarbeiten. Oben rechts steht „Offline · x ausstehend“.
6. Danach mit Netz: Die Änderungen gehen von selbst raus. Dann im Projekt **„Einchecken“**, damit der Fachprüfer prüfen kann.

Hinweise:
- Auf dem iPad hat die installierte App einen eigenen Speicher, getrennt von Safari. Auschecken also in der installierten App, nicht im Browser-Tab.
- Nicht über die Browser-Einstellungen die Website-Daten löschen, solange Änderungen ausstehen.

## Offen

- Paket M, noch zu klären: wer außer Admin EK/VK/Marge sieht; weitere Artikel der Stückliste (Aufhängung, Anschlussdose, Leitung, Funkmodul); Montagezeit und Stundensatz; EK/VK der 21 Module und der Pauschalen, Art.-Nr., Logo und Anschrift der Firmen (Eingabe über Firmendaten bzw. Modulkatalog).

**Fachliche Zulieferung (von Ihnen):**
- **EK/VK-Preise und Montagezeiten** der 21 Module (für Teil E). Maße vor dem Produktivstart gegen die Herstellerdatenblätter prüfen (Prüfprotokoll der Importdatei).
- Niedrige Priorität, nur für Quelle C: Klimadaten (DIN/TS 12831-1), Pauschal-U-Werte, Reduktionsfaktoren je Raumtyp.

**Als Nächstes geplant (Teil E):** Angebot und PDF-Platzierungsplan.

**Später:** Hottgenroth-Import, Grundriss-Import per KI, Raumliste als PDF/Excel, Word-Bericht im CI.

**Betrieb:**
- Wird `schulung-caddy-1` von der Schulungsplattform einmal neu erstellt, fehlt die Netzwerkverbindung. Dann `docker network connect infrarot-proxy schulung-caddy-1` ausführen (`docs/BETRIEB.md`).
- Sicherungskopie außer Haus und Benachrichtigung bei fehlgeschlagener Sicherung.
- Das leere Netzwerk `infrarot-planer_infrarot-net` der früheren Installation wurde am 12.10.2026 entfernt. Übrig sind nur `infrarot-netz` (intern, mit Datenbank) und `infrarot-proxy` (Caddy ↔ Frontend/Backend).
- Die App-Icons und Farben sind Platzhalter bis zum CI.
