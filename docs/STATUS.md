# Status

Stand: 31.10.2026, Phase 1 Teil D, Deckenplan nach Praxistest überarbeitet

Ausrichtung: Vor-Ort-Planung von Infrarot-Deckenmodulen durch den Außendienst der MEH, Fachvorgaben und Prüfung durch die Energieberatung Serek. Fachregeln: `docs/FACHKONZEPT.md`. Betrieb und HTTPS: `docs/BETRIEB.md`.

## Was läuft

| Container | Erreichbar | Zustand |
|---|---|---|
| `infrarot-db` (PostgreSQL 16, Volume `infrarot-db-daten`) | nur intern, kein Host-Port | healthy, Migration `3b7e9c4d2a18` (Türen und Fenster, 31.10.2026) |
| `infrarot-backend` (FastAPI + Rechenkern 0.6.0, Volume `infrarot-uploads`) | `127.0.0.1:8091`, über Caddy `/api/*` | healthy |
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
| Rechenkern (Vitest) | 78 Tests. Neu in 0.6.0: Leistungsstatus unter/passend/über, 2 × 420 W bei 880 W Bedarf → „unter“, Prüflauf 200 Zufallsräume (Vorschlag nie unter Bedarf), Tür (Band, Aufschlag, Bogenrichtung) an allen Wänden, Begrenzung auf die Wand, Wandabstände des Moduls, nächste Wand beim Antippen. Bisher 69 Tests, Typprüfung fehlerfrei; laufen bei jedem Backend-Build. Neu in 0.5.0 (20 Tests): Beispielräume klein (2,5 × 2 m → 1 × 350 W), groß (8 × 6 m → 3 Module gleichmäßig, Warnung Überdimensionierung), Bad (nur badgeeignet ab IP44, Hinweis), viele Sperrflächen (nie über Sitzplatz/Bett, alle Abstände), ohne gültige Lösung (Meldung mit größter möglicher Leistung), kein Modul passt, quer liegender Raum, fehlende Regeln, Mindesthöhe; Regelprüfung im Klartext; Leistung; Raumliste je Raum |
| Backend (pytest, mit echtem Rechenkern) | 89 Tests. Neu am 31.10. (Anmeldung): Hinweis ab 5, Sperre nach 10, andere IP sperrt das Konto nicht, Bremse je IP über alle Konten, nach der Pause erneut 2 Minuten je Fehlversuch, Erfolg setzt zurück, alte Fehlversuche (> 24 h) zählen nicht, Admin sieht und löst Sperren (protokolliert, nur Admin), Kommandozeile sperre-loesen und passwort-setzen. Davor 85 Tests. Neu am 31.10.: Türen/Fenster speichern, im Offline-Paket, Auswertung unverändert, ungültige Wand/Breite abgelehnt. Bis 18.10.: 84 Tests. Neu am 18.10.: neuer Raumtyp ohne Auswirkung still übernommen (Status „geprüft“ bleibt, Protokoll „automatisch“), Quellenänderung sperrt nicht, neue Wandabstands-Regel sperrt nur das Projekt mit dann verletztem Modul, Vorschau ohne Speichern (betroffen/nicht betroffen, nur Fachprüfer/Admin), Sammelansicht und Sammelentscheidung (ablehnen, übernehmen, unbekanntes und ausgechecktes Projekt gemeldet), Ablehnung gilt bei Änderung ohne Auswirkung weiter, Kommandozeile. Vom 14.10.: Import der echten Importdatei (Umbenennen, Regeln, Katalog, erneuter Import), Probelauf, alles oder nichts bei Fehlern, Regeln pflegen (nur Fachprüfer/Admin, protokolliert), Regeln im Projekt eingefroren, Katalog und Offline-Schnappschuss, Sperrflächen/Module speichern, prüfen und auswerten. Vom 13.10.: Neu am 13.10. (2. Rückmeldung): Übernehmen und Ablehnen nur Fachprüfer (403), offene Vorgaben sperren Angebot und Prüfen (409), Ablehnung protokolliert mit Begründung, Status bleibt, erneute zentrale Änderung öffnet wieder, reine Quellenänderung nicht, spätere Übernahme hebt Ablehnung auf, freigegeben nie offen. Neu am 13.10. (1. Rückmeldung): W/m² nur durch Fachprüfer (Außendienst und reiner Admin 403, unveränderte Werte erlaubt), Altbau wartet auf Fachprüfer (ohne Räume nicht, Prüfen gesperrt, nach Festlegung prüfbar, neuer Raum wartet wieder), Neubau wartet nie. Aus Phase 1D: eingefrorene Vorgaben (Unterschiede, Auswirkung, Übernahme mit Protokoll, Freigabe unverändert, Sperre, Rücksetzung auf Entwurf), kombinierte Rollen (Admin + Fachprüfer gibt frei, nur Admin nicht), Rollen in Verwaltung und Kommandozeile, „sonstiger Bestand“, Hinweis-Höhe |
| Frontend (Vitest) | 38 Tests. Neu: Stilregeln des Plans (Striche in Bildschirmpixeln, Tippflächen ohne Rand). Davor 36 Tests. Neu am 31.10.: Tür und Fenster offline, Auswertung unverändert. Bis 14.10.: 35 Tests. Neu am 14.10.: Deckenplan offline speichern und mit eingefrorenen Regeln prüfen. Vom 13.10.: offene Vorgaben vom Auschecken sperren das Angebot offline, Ablehnen offline erst nach dem Einchecken; „wartet auf Fachprüfer“ offline aus dem lokalen Stand, Statusanzeige, Hinweise für den Außendienst, Beschriftung Altbau. Aus Phase 1C/1D, Offline-Logik: Rechnen mit dem eingefrorenen Projektstand, Hinweis statt Zuschlag, Übernahme erst nach dem Einchecken. Laufen bei jedem Frontend-Build; `tsc` und `vite build` fehlerfrei |
| Migration | `3b7e9c4d2a18` am 31.10.2026 ausgeführt (vorher Sicherung `infrarot_db_20261031_115623.dump`), `alembic check` sauber. `8d3f6a21c5e9` am 14.10.2026 ausgeführt (vorher Sicherung `infrarot_db_20261014_151658.dump`), `alembic check` sauber. `5e8b1c90d4a7` am 13.10.2026 auf der echten Datenbank ausgeführt (vorher Sicherung `infrarot_db_20261013_145403.dump`), `alembic check`: Modell und Datenbank stimmen überein. Ihre Projekte „Test1“ und „Test2“: keine offenen Vorgaben, Angebot möglich |
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
