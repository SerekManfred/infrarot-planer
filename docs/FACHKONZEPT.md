# Fachkonzept

Stand: Phase 1 Teil D, Deckenplan nach Praxistest überarbeitet (31.10.2026)

## Zweck und Beteiligte

- **Mein Energie Haus GmbH (MEH), Außendienst:** plant vor Ort Infrarot-**Deckenmodule** (nur Deckenmontage), später mit Angebot und Platzierungsplan.
- **Energieberatung Serek, Fachprüfer:** pflegt die Fachvorgaben, prüft die Projekte fachlich und gibt sie frei.
- **Admin:** verwaltet Benutzer und Betrieb, darf Fachvorgaben pflegen, prüft und gibt aber nicht frei.
- **Rollen sind kombinierbar.** Prüfen und Freigeben erfordert immer die Rolle Fachprüfer. Ein Konto mit Admin + Fachprüfer darf also beides. Festgelegt am 12.10.2026; das Konto serek.manfred@googlemail.com hat Admin + Fachprüfer.

### Bedienung durch den Außendienst (Festlegung 13.10.2026)

Die App wird von Vertriebsmitarbeitern ohne Heizungs-Fachwissen bedient. Daher:

- **Seite „Fachvorgaben“** (Raumtypen und Pauschalen) nur für Fachprüfer und Admins. Der Außendienst sieht sie nicht. Lesend bleibt die Schnittstelle für alle offen, weil das Tablet die Vorgaben zum Offline-Rechnen braucht.
- **Vereinfachte Raumkarte für den Außendienst:** Raum, Raumtyp, Länge/Breite/Höhe, W/m² (nur Anzeige) und Heizlast. Ausgeblendet sind Heizlastquelle, Kontrollrechnung (Raumtemperatur, Luftwechsel, Korrekturfaktor, Bauteile, U-Werte) und der Reiter „Projektvorgaben“. Hinweise zur Kontrollrechnung entfallen; der Höhen-Hinweis lautet „… – der Fachprüfer prüft die Pauschale.“ Fachprüfer und Admins sehen alles.
- **W/m²-Pauschalen** (je Raum und je Projekt) setzt nur die Rolle Fachprüfer. Der Server lehnt Änderungen anderer Rollen ab (403); unveränderte Werte im Datensatz stören nicht.
- **Beschriftungen in Alltagssprache**, Formelzeichen klein dahinter: „Raumtemperatur (θint, °C)“, „Luftwechsel (n, pro Stunde)“, „Korrekturfaktor angrenzender Raum (f)“, „Quelle des Werts“.
- **ⓘ neben Fachbegriffen:** Antippen zeigt einen kurzen Hilfetext; erneutes Antippen, Tippen daneben oder Esc schließt ihn. Texte zentral in `frontend/src/texte.ts` (`HILFE`).

## Projektstatus

```
Vor-Ort-Entwurf ──(Fachprüfer: geprüft)──▶ fachlich geprüft ──(Fachprüfer: freigeben)──▶ freigegeben
        ▲                                         │                                        │
        └──────────── Fachprüfer: zurück auf Entwurf ◀─────────────────────────────────────┘
```

- Nur Fachprüfer ändern den Status.
- **„wartet auf Fachprüfer“** (Festlegung 13.10.2026): Wird angezeigt statt „Vor-Ort-Entwurf“, solange ein Projekt mit Gebäudestandard „Altbau (nicht Effizienzhaus)“ mindestens einen Raum ohne W/m²-Wert hat. Dasselbe gilt, solange über neue zentrale Fachvorgaben nicht entschieden ist (siehe „Fachvorgaben je Projekt eingefroren“). Beides zusammen ergibt `angebot_gesperrt`. Der Status wird aus den Daten abgeleitet, nicht von Hand gesetzt, und gilt auch offline auf dem Tablet. So lange kann das Projekt nicht als geprüft markiert werden und ist damit für Angebote gesperrt. Das künftige Angebotsmodul prüft dafür `angebot_gesperrt`. Ein Projekt ohne Räume wartet noch nicht.
- **Fachlich geprüft:** Ändert danach jemand Projektdaten, fällt das Projekt automatisch auf „Vor-Ort-Entwurf“ zurück (die Prüfung gilt nur für den geprüften Stand).
- **Freigegeben:** Projektdaten sind gesperrt. Zum Ändern setzt ein Fachprüfer das Projekt zurück auf „Vor-Ort-Entwurf“. Bei der Freigabe wird die Auswertung als unveränderliche, versionierte Berechnung gespeichert, damit spätere Änderungen an den Fachvorgaben das freigegebene Ergebnis nicht verändern.
- **Sichtbarkeit** (Festlegung 31.10.2026):
  - Fachprüfer und Admins sehen alle Projekte.
  - Benutzer mit nur der Rolle Außendienst sehen ausschließlich Projekte, die sie selbst angelegt haben oder die ihnen zugewiesen sind.
  - Das gilt im Server für jeden Zugriff: Projektliste, alle Projektdaten, Auswertung, Berechnungen, Offline-Paket, Auschecken und Synchronisierung. Fremde Projekte gelten als „nicht gefunden“.
  - Admins weisen ein Projekt einem anderen aktiven Außendienst-Benutzer zu (Projektkopf „Zuständig“), z. B. als Urlaubsvertretung; der Ersteller sieht es weiterhin. Die Zuweisung wird protokolliert.
- **Projektnummer:** vergibt der Server beim Anlegen, fortlaufend je Jahr (JJJJ-NNNN, z. B. 2026-0004), eindeutig. Nicht frei eintippbar; nur Admins dürfen sie im Ausnahmefall ändern. Ist eine Nummer schon vergeben, erscheint „Projektnummer x ist bereits vergeben“. Hinweis: Wird das Projekt mit der höchsten Nummer eines Jahres gelöscht, wird diese Nummer erneut vergeben.
- Jede Änderung (anlegen, ändern, löschen, Status) wird mit Benutzer, Zeit und alten/neuen Werten protokolliert.

## Gebäudestandard (Pflichtfeld)

| Wert | Bezeichnung |
|---|---|
| `neubau` | Neubau |
| `effizienzhaus_sanierung` | Effizienzhaus-Sanierung |
| `sonstiger_bestand` | Altbau (nicht Effizienzhaus), bis 13.10.2026 „sonstiger Bestand“ |

Bei „Altbau (nicht Effizienzhaus)“ erscheint der Hinweis: **„Infrarot als alleiniges Heizsystem wird für diesen Gebäudestandard nicht empfohlen.“** Die Berechnung bleibt möglich.
Dabei gibt es bewusst **keinen Rückfallwert und keine Tabellenwerte**. Die W/m²-Pauschale ist bei jedem Raum Pflicht und wird **vom Fachprüfer festgelegt**. Der Außendienst sieht an ihrer Stelle „Pauschale wird vom Fachprüfer festgelegt“, und das Projekt „wartet auf Fachprüfer“ (siehe Projektstatus). Ohne Wert gibt es für den Raum kein Ergebnis. Der Hinweis dazu lautet: „Eingabe fehlt: Pauschale W/m² für diesen Raum – wird bei „Altbau (nicht Effizienzhaus)“ vom Fachprüfer festgelegt“.

## Heizlastquellen je Raum

| Quelle | Bedeutung | Ermittlung |
|---|---|---|
| **A Pauschal** (Standard) | Pauschale in W/m² für Raumtyp × Gebäudestandard | Φ_A = q · A_Raum |
| **B Hottgenroth** | Raumheizlast aus einer Hottgenroth-Berechnung | manuelle Eingabe in W je Raum (Import folgt) |
| **C Vereinfachte Berechnung** | Transmission + Lüftung nach dem Prinzip der DIN EN 12831-1 | Rechenkern, siehe `rechenkern/README.md` |

- Die gewählte Quelle liefert die **maßgebliche Raumheizlast**.
- **C als Gegenprobe:** Sind für einen Raum Bauteildaten erfasst, wird C zusätzlich berechnet und die Abweichung zur maßgeblichen Heizlast angezeigt: Abweichung = (Φ_C − Φ_maßgeblich) / Φ_maßgeblich.
- Detaillierte Bauteilmasken (Flächen, Fenster, Türen) braucht es nur für Quelle C.

### Quelle A im Detail

- q = Heizlast-Pauschale in W/m² aus der Tabelle **Raumtyp × Gebäudestandard**.
- Fehlt der Tabellenwert, gilt der **Rückfallwert** des Gebäudestandards. Festgelegt: Neubau 40 W/m², Effizienzhaus-Sanierung 70 W/m².
  - Für „Altbau (nicht Effizienzhaus)“ gibt es keinen Rückfallwert, der Fachprüfer legt die Pauschale je Raum fest (siehe oben).
  - Raumtypen und Pauschalen liefert der Auftraggeber nach. Bis dahin gelten die Rückfallwerte.
- A_Raum = Länge × Breite (Schnellerfassung) oder direkt eingegebene Fläche.
- **Kein Höhenzuschlag** (Festlegung 12.10.2026).
  - Ist ein Raum höher als **2,80 m** (Fachvorgabe „Hinweis ab Raumhöhe“), erscheint nur der Hinweis: **„Raumhöhe über 2,80 m – Pauschale prüfen und ggf. manuell anpassen.“**
  - Der Hinweis entfällt, sobald die Pauschale für den Raum von Hand gesetzt ist.

### Quelle C im Detail

- Norm-Außentemperatur θe aus den Klimadaten (DIN/TS 12831-1, CSV-Import).
- ΔU_WB = **0,05 W/(m²·K)** (zentrale Vorgabe).
- Je Raumtyp: Norm-Innentemperatur θint, Luftwechsel n, Reduktionsfaktor f (Temperatur-Korrekturfaktor, wenn eine Bauteilfläche an einen Raum dieses Typs grenzt, z. B. unbeheizter Keller).
- Faktor f einer Bauteilfläche: eigener Wert › Reduktionsfaktor des angrenzenden Raumtyps › Herleitung aus der Nachbartemperatur › 1 bei Außenluft.
- U-Werte aus der Bauteilbibliothek (Pauschalwerte nach der Bekanntmachung für den Wohngebäudebestand, CSV-Import) oder eigene Eingabe.

## Fachvorgaben

Pflegbar durch Fachprüfer und Admins; jede Änderung wird protokolliert.

| Vorgabe | Ebene | Überschreibbar |
|---|---|---|
| Pauschale W/m² je Raumtyp × Gebäudestandard (nicht Altbau) | zentral | je Projekt (je Raumtyp) und je Raum, nur durch Fachprüfer |
| Rückfallwert W/m² für Neubau und Effizienzhaus-Sanierung | zentral | – |
| Hinweis ab Raumhöhe (kein Zuschlag) | zentral | – |
| ΔU_WB | zentral | je Projekt |
| θint, Luftwechsel, Reduktionsfaktor je Raumtyp | zentral | θint und Luftwechsel je Raum |

- „Projekt“ meint hier das Gebäude (Objekt) des Projekts.
- **Abweichungen sind kenntlich:** Jeder verwendete Wert trägt seine Herkunft – zentrale Vorgabe, Rückfallwert, Projekt, Raum – oder „Vorgabe fehlt“. Projekt- und Raumwerte werden in der Oberfläche hervorgehoben.
- **Keine Fachwerte erfinden:** Was nicht gepflegt ist, wird nicht geschätzt, sondern als „Vorgabe fehlt“ gekennzeichnet. Für diesen Raum gibt es dann kein Ergebnis aus der betroffenen Quelle.
- Vom Auftraggeber festgelegt (Quelle „Festlegung Auftraggeber 10.10.2026“): Rückfallwerte 40/70 W/m², Grenzhöhe 2,80 m (seit 12.10.2026 nur noch für den Hinweis), ΔU_WB 0,05 W/(m²·K).
- Klimadaten und Pauschal-U-Werte werden nur für die Gegenprobe C gebraucht und haben niedrige Priorität.

### Fachvorgaben je Projekt eingefroren

Festlegung 12.10.2026:

- Beim **Anlegen** speichert das Projekt eine Kopie der gültigen Fachvorgaben: Einzelwerte, Raumtypen mit Kennwerten und Pauschalen. Es rechnet nur mit dieser Kopie, auch offline.
- Ändern sich die zentralen Vorgaben, zeigt das Projekt einen Hinweis mit den **Unterschieden (alt/neu)** und der **Auswirkung auf die Heizlast**: Summe und betroffene Räume.
- Die neuen Werte werden **nur per bewusstem Klick** übernommen („Neue Vorgaben übernehmen“). Die Übernahme wird mit allen Unterschieden und der Heizlast vorher/nachher protokolliert.
- **Nur der Fachprüfer entscheidet** (Festlegung 13.10.2026):
  - Unterschiedsliste und Knöpfe sieht nur die Rolle Fachprüfer. Der Server lehnt Übernehmen und Ablehnen anderer Rollen ab (403).
  - Der Außendienst sieht stattdessen den Hinweis „Die Fachvorgaben wurden aktualisiert. Der Fachprüfer prüft dieses Projekt vor dem Angebot.“
  - Der Fachprüfer kann übernehmen oder **bewusst ablehnen** („Ablehnen, bisherige Werte behalten“, Begründung optional). Beim Ablehnen rechnet das Projekt weiter mit seinem Stand. Projektdaten und Status bleiben unverändert, die Ablehnung wird protokolliert.
  - Abgelehnt wird der jeweilige zentrale Stand. Ändern sich die zentralen Vorgaben danach erneut, ist die Entscheidung wieder offen. Eine reine Änderung der Quellenangabe zählt nicht. Später übernehmen ist weiterhin möglich.
  - **Solange nicht übernommen oder abgelehnt ist** (`vorgaben_offen`), ist für das Projekt **kein Angebot möglich**. Das Projekt kann so lange nicht als geprüft markiert werden und zeigt im Entwurf „wartet auf Fachprüfer“. Offline gilt der Stand vom Auschecken.
- Die Übernahme ist eine Änderung am Projekt:
  - Ein geprüftes Projekt fällt dadurch auf „Vor-Ort-Entwurf“ zurück.
  - Bei einem ausgecheckten Projekt geht sie erst nach dem Einchecken.
- **Verfeinerte Sperre** (Festlegung 18.10.2026, `backend/app/vorgabenabgleich.py`):
  - Nach jeder zentralen Änderung gleicht der Server alle nicht freigegebenen Projekte ab. Das gilt für Oberfläche, CSV-/Excel-Import und Kommandozeile.
  - Ein Projekt wartet nur, wenn sich für einen seiner Räume etwas ändert:
    - Heizlast (maßgeblich, aus der Pauschale A oder aus der Gegenprobe C),
    - benötigte Leistung (Grundlage der Modulauswahl),
    - Leistungswarnungen,
    - Thermostate,
    - Regelverstöße.
  - **Ohne Auswirkung übernimmt das Projekt still.** Dazu gehören neue Raumtypen, die im Projekt nicht vorkommen, Text- und Quellenänderungen und Werte, die das Projekt nicht nutzt. Das wird protokolliert („automatisch“, mit Grund); der Status bleibt, auch „fachlich geprüft“.
  - Wurde ein Stand bewusst abgelehnt und kommt danach eine Änderung ohne Auswirkung hinzu, gilt die Ablehnung weiter (protokolliert).
  - Ausgecheckte Projekte werden ebenfalls abgeglichen, denn bei einer stillen Übernahme ändern sich ihre Ergebnisse nicht.
- **Vorschau vor dem Speichern:** Auf der Seite Fachvorgaben zeigt jede Änderung vorab „Diese Änderung betrifft x Projekte“, mit Heizlast vorher/nachher und neuen Regelverstößen. Gemessen wird die Wirkung genau dieser Änderung; gespeichert wird erst nach Bestätigung. Betrifft sie kein Projekt, wird ohne Rückfrage gespeichert.
- **Sammelansicht „Vorgaben-Abgleich“** (nur Fachprüfer): alle wartenden Projekte mit Heizlast vorher/nachher, Zahl neuer Regelverstöße und betroffenen Räumen. Nach Mehrfachauswahl „Für ausgewählte übernehmen“ oder „Für ausgewählte ablehnen“, jeweils je Projekt protokolliert wie die Einzelentscheidung. Gesperrte (ausgecheckte) Projekte werden mit Begründung gemeldet und übersprungen.
- **Freigegebene Projekte bleiben unverändert**. Ihnen wird keine Übernahme angeboten.
- Neue Raumtypen stehen in einem bestehenden Projekt nach der (meist stillen) Übernahme zur Auswahl.
- Nicht eingefroren werden die Bibliotheken (Bauteile mit U-Werten, Klimadaten). Sie sind Nachschlagewerke mit Quellenangabe und werden über ihre Kennung verwendet.

## Offline-Betrieb

Vor Ort gibt es oft kein Netz. Deshalb arbeitet die App auf dem Tablet auch offline.

- **Auschecken:** Ein Gerät holt ein Projekt zur Offline-Bearbeitung auf sich („Für Offline-Bearbeitung auschecken“).
  - Das Projekt ist dann für alle anderen Benutzer und Geräte **gesperrt**, auch für den Fachprüfer.
  - Alle sehen, wer es auf welchem Gerät seit wann hat.
  - Freigegebene Projekte lassen sich nicht auschecken.
- **Bearbeiten:** Ein ausgechecktes Projekt wird auf dem Gerät bearbeitet, mit oder ohne Netz.
  - Die Heizlast rechnet der Rechenkern im Browser, mit demselben Code wie der Server. Grundlage sind die im Projekt eingefrorenen Fachvorgaben und die Bibliotheken vom letzten Kontakt zum Server.
  - Ohne Netz angelegte Projekte frieren den Vorgaben-Schnappschuss des Geräts ein. Beim Übertragen legt der Server den dann gültigen Stand fest.
  - Jede Änderung kommt in eine Warteschlange. Sobald der Server erreichbar ist, wird sie automatisch übertragen.
- **Statusanzeige** im Kopf: „Online“, „Offline“, „x Änderungen ausstehend“ oder „Übertragung angehalten“.
  - Lehnt der Server eine Änderung ab, hält die Übertragung an diesem Eintrag an und zeigt den Grund. Typische Gründe: ungültiger Wert, Sperre aufgehoben, kein Zugriff mehr auf das Projekt.
  - Danach: erneut versuchen oder nur diese eine Änderung verwerfen.
- **Neue Projekte ohne Netz** werden auf dem Gerät angelegt. Beim nächsten Kontakt werden sie auf dem Server angelegt und für das Gerät ausgecheckt. Bis dahin steht „Nr. folgt“; die Projektnummer vergibt der Server bei der Übertragung.
- **Einchecken** (braucht Netz): Zuerst wird alles übertragen. Dann wird die Sperre aufgehoben und das Projekt vom Gerät entfernt. Statuswechsel (prüfen, freigeben) gehen erst danach.
- **Sperre lösen:** Ein Admin kann die Sperre aufheben, etwa wenn ein Tablet verloren ging. Noch nicht übertragene Änderungen dieses Geräts nimmt der Server danach nicht mehr an (Sperr-Token ungültig). Das Gerät zeigt das an und verwirft nichts selbst.
- **Abmelden:** Bei Verbindung wird zuerst alles übertragen und eingecheckt. Danach werden die lokalen Daten gelöscht.
  - Bleiben Änderungen oder Sperren übrig (z. B. ohne Netz), fragt die App vorher nach.
  - Meldet sich auf dem Gerät ein anderer Benutzer an, während noch Offline-Daten vorhanden sind, fragt die App, ob diese gelöscht werden sollen.
- Ohne Netz zeigt die Projektliste den zuletzt geladenen Stand. Bearbeiten lassen sich dann nur ausgecheckte Projekte.

## Modulplanung: Katalog, Sperrflächen, Platzierung (Festlegung 14.10.2026)

Nur Deckenmontage und vorerst nur rechteckige Räume. Rechenregeln im Rechenkern (`rechenkern/src/platzierung.ts`). Server, Tablet (offline) und Raumliste nutzen denselben Code.

### Daten

- **Importdatei** `daten/IR-Planer_Importdaten_geprueft.xlsx`, eingelesen mit `python -m app.cli excel-importieren` (`backend/README.md`). Alles oder nichts, Probelauf möglich. Leere Zellen bleiben leer.
- **Raumtypen:** W/m² je Raumtyp für Neubau und Effizienzhaus-Sanierung, Raumtemperatur, Luftwechsel und Quelle. Die Altbau-Spalte wird als **Richtwert für den Fachprüfer** gespeichert. Sie ist nur ein Platzhalter im Pauschalenfeld und wird nie automatisch gerechnet.
- **Platzierungsregeln:** feste Liste (`backend/app/platzierungsregeln.py`), gepflegt werden Wert und Quelle. Nur Fachprüfer und Admins dürfen ändern. Die Regeln werden je Projekt eingefroren wie die übrigen Fachvorgaben; Änderungen erscheinen als Unterschied „Platzierungsregel“. „Maximale Raumhöhe ohne Rückfrage“ ist die zentrale Hinweis-Höhe (2,65 m seit 14.10.2026).
- **Modulkatalog:** 21 Deckenmodule. Preise und Montagezeit sind leer, bis sie geliefert werden. Module, die nicht mehr in der Datei stehen, werden inaktiv und nicht mehr vorgeschlagen. Platzierte Module speichern eine Kopie ihrer Katalogdaten (Stand zum Zeitpunkt der Planung).
- **Katalogpflege** (Festlegung 31.10.2026, Seite „Modulkatalog“):
  - Lesen dürfen alle; Admin und Fachprüfer pflegen. Jedes Feld lässt sich direkt in der Tabelle ändern, neue Module werden über ein Formular angelegt.
  - Plausibilität im Server: Leistung, Länge und Breite > 0; Bauhöhe und Gewicht > 0, falls angegeben; Preise und Montagezeit ≥ 0; Schutzart im Format IPxx; „Bad geeignet“ nur ab IP44; Artikel-Nr. eindeutig; Quelle Pflicht.
  - Löschen nur, wenn das Modul in keinem Projekt verwendet wird. Sonst deaktivieren: nicht mehr auswählbar, bestehende Planungen bleiben gültig.
  - Jede Änderung wird je Feld (alt/neu) mit Benutzer und Zeitpunkt protokolliert. Export als Excel im Aufbau der Importdatei, mit der zusätzlichen Spalte „aktiv“.
- **Moduldaten in laufenden Projekten** (`backend/app/modulabgleich.py`): gleiche Logik wie bei den Fachvorgaben.
  - Ändern sich Daten eines im Projekt verwendeten Moduls, gleicht der Server alle nicht freigegebenen Projekte ab.
  - Ohne Auswirkung auf Heizlast, installierte Leistung, Modulauswahl und Regelprüfung (z. B. nur Bezeichnung oder Preis) übernimmt das Projekt still, protokolliert, der Status bleibt.
  - Mit Auswirkung wartet das Projekt auf den Fachprüfer: kein Prüfen, kein Angebot. Der Hinweis im Projekt zeigt die Unterschiede alt/neu je Modul und Feld sowie die Auswirkung (installierte Leistung, neue Regelverstöße).
  - Übernehmen ersetzt die Moduldaten im Raum; Lage und Drehung bleiben. Ablehnen behält die bisherigen Daten; ändert sich das Modul erneut, ist es wieder offen.
  - Beides geht einzeln oder in der Sammelansicht „Vorgaben-Abgleich“ (Spalte „Anlass: Moduldaten“).
  - Freigegebene Projekte bleiben unverändert.

### Sperrflächen

Die Sperrflächen werden je Raum in einer maßstäblichen Draufsicht eingezeichnet: Ursprung linke obere Ecke, x entlang der Länge, Raster 5 cm.

- **Rechtecke:** Sitzplatz, Bett, Hochschrank, Dusche/Wanne, Sonstiges, dazu die Dachschräge als Streifen entlang einer Wand.
- **Punkte:** Leuchte/Spot und Rauchmelder.
- **Mindestabstand** je Typ aus der Regeltabelle, gemessen als kürzeste Entfernung zwischen den Kanten.
- **Sitzplatz und Bett:** Über ihnen ist ein Modul **immer unzulässig**.
- **Fehlender Abstand:** Fehlt die Abstandsregel eines Typs, wird nur geprüft, dass kein Modul darüber liegt, mit dem Hinweis „Vorgabe fehlt“. Seit dem 18.10.2026 sind alle Abstände belegt (Dusche/Wanne und Sonstiges je 30 cm).

### Modulauswahl

- **Benötigte Leistung** = Raumheizlast × (1 + Leistungsreserve).
- **Vorschlag:** möglichst wenige gleiche Module, die zusammen mindestens die benötigte Leistung bringen und regelkonform in die freie Deckenfläche passen. Bei gleicher Anzahl gewinnt die kleinste ausreichende Leistung, dann die kleinere Modulfläche. Höchstens 12 Module je Raum.
- **Warnung**, wenn die installierte Leistung die benötigte unterschreitet oder um mehr als die maximale Überdimensionierung übersteigt.
- **Bad** (Raumtyp beginnt mit „Bad“): nur Module „Bad geeignet“ und mindestens IP44. Dazu der Hinweis „Schutzbereiche nach DIN VDE 0100-701 durch Elektrofachkraft prüfen“.
- **Ohne gültige Lösung** erscheint eine Meldung mit der größten möglichen Leistung, z. B. „höchstens 1 080 W (2 × …)“, und dem Vorschlag „kleinere oder mehr Module wählen, Sperrflächen prüfen“.
- **Keine automatische Planung**, wenn eine nötige Regel fehlt (Wand- oder Modulabstand, Leistungsreserve) oder der Raum niedriger als die Mindestraumhöhe ist.

### Platzierung und Regelprüfung

- **Zulässig** ist eine Position nur, wenn alle Mindestabstände eingehalten sind: zur Wand, zu anderen Modulen, Leuchten, Rauchmeldern und Sperrflächen. Mit Sperrflächen ist die Bewegungsfläche automatisch bevorzugt; bei gleicher Lage gewinnt die Position mit mehr Abstand zu Möbeln.
- **Ausrichtung:** Die Längsseite des Moduls liegt parallel zur langen Raumseite. Nur wenn das nicht passt, wird quer gelegt, mit Hinweis.
- **Verteilung:** Mehrere Module werden in einem Raster über die freie Fläche gleichmäßig verteilt.
- **Manuelle Korrektur:** verschieben, drehen, tauschen, hinzufügen, löschen. Die Regelprüfung läuft live; Verstöße werden rot markiert und im Klartext begründet, z. B. „Abstand zur Wand 32 cm (mind. 50 cm)“.
- **Thermostat:** eins je Raum mit Modulen (Regel „Thermostat je Raum“).
- **Leistung:** Liegt die installierte Leistung unter der benötigten, erscheint eine deutliche rote Warnung „Unterdimensioniert“: in der Raumkarte, im Deckenplan und in der Raumliste. Bei Überdimensionierung erscheint eine gelbe Warnung. Der automatische Vorschlag unterdimensioniert nie; ein Prüflauf über 200 Zufallsräume sichert das ab.
  - Die Unterdimensionierung im Praxistest (880 W benötigt, 840 W installiert) entstand durch Handkorrektur: Der Vorschlag hatte 1 × 900 W gesetzt, von Hand wurde daraus 2 × 420 W.

### Deckenplan: Bedienung und Darstellung (Festlegung 31.10.2026)

- **Zugang:** In jeder Raumkarte gibt es eine große Schaltfläche „Deckenplan öffnen“ mit kleiner Vorschau. Der Plan öffnet bildschirmfüllend; „Schließen“ oder Esc beendet ihn.
- **Sperrflächen:**
  - Anfasser an allen vier Ecken, Größe in jede Richtung änderbar, Trefferfläche 44 px.
  - Beim Antippen lassen sich Typ, Breite × Tiefe (m) eingeben oder die Fläche löschen. Bei der Dachschräge sind es Wand und Tiefe.
  - Während des Ziehens werden die aktuellen Maße angezeigt.
- **Bemaßung wie im Bauplan:** Länge oben und unten, Breite links und rechts. Beim gewählten Modul stehen die Abstände zu den beiden nächstgelegenen Wänden in m daneben, je eine in x- und y-Richtung (`rechenkern/src/plan.ts`, `wandAbstaende`). Diese Abstände sind für den PDF-Platzierungsplan vorgesehen.
- **Tür und Fenster** nur zur Orientierung:
  - **Keine Sperrflächen**, ohne Einfluss auf Platzierung und Regelprüfung.
  - Anlegen: „+ Tür“ oder „+ Fenster“ tippen, dann die Wand antippen. Die Lage wird als Abstand vom Wandanfang gespeichert (oben/unten von links, links/rechts von oben), dazu die Breite. Startwerte (Bedienkomfort, danach änderbar): Tür 0,90 m, Fenster 1,00 m.
  - Tür: öffnet nach innen oder außen, Band links oder rechts (vom Raum aus gesehen); dargestellt mit Türblatt und Viertelkreis. Fenster: Doppellinie in der Wand.
  - Mehrere je Raum möglich, offline-fähig, synchronisiert mit dem Projekt (`raum.tueren_fenster`).
- **Raumliste** (Reiter im Projekt): je Raum Heizlast, benötigte Leistung, Module (Typ × Anzahl), installierte Leistung, Thermostat und Prüfergebnis, dazu die Summen.

## Noch nicht Bestandteil

Angebot und PDF-Platzierungsplan (Teil E), nicht rechteckige Räume, Grundriss-Import per KI, Hottgenroth-Import.
