# Fachkonzept

Stand: Phase 1 Teil D, Modulkatalog, Sperrflächen und Modulplatzierung (14.10.2026)

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
- Alle Benutzer sehen alle Projekte. Jede Änderung (anlegen, ändern, löschen, Status) wird mit Benutzer, Zeit und alten/neuen Werten protokolliert.

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
- **Freigegebene Projekte bleiben unverändert**. Ihnen wird keine Übernahme angeboten.
- Neue Raumtypen stehen in einem bestehenden Projekt erst nach der Übernahme zur Auswahl.
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
  - Lehnt der Server eine Änderung ab, hält die Übertragung an diesem Eintrag an und zeigt den Grund. Typische Gründe: ungültiger Wert, Sperre aufgehoben, Projektnummer vergeben.
  - Danach: erneut versuchen oder nur diese eine Änderung verwerfen.
- **Neue Projekte ohne Netz** werden auf dem Gerät angelegt. Beim nächsten Kontakt werden sie auf dem Server angelegt und für das Gerät ausgecheckt. Die Projektnummer lässt sich bis dahin noch korrigieren.
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
- **Modulkatalog:** 21 Deckenmodule. Preise und Montagezeit sind leer, bis sie geliefert werden. Module, die nicht mehr in der Datei stehen, werden inaktiv und nicht mehr vorgeschlagen. Platzierte Module speichern eine Kopie ihrer Katalogdaten, damit spätere Katalogänderungen einen Plan nicht verändern.

### Sperrflächen

Die Sperrflächen werden je Raum in einer maßstäblichen Draufsicht eingezeichnet: Ursprung linke obere Ecke, x entlang der Länge, Raster 5 cm.

- **Rechtecke:** Sitzplatz, Bett, Hochschrank, Dusche/Wanne, Sonstiges, dazu die Dachschräge als Streifen entlang einer Wand.
- **Punkte:** Leuchte/Spot und Rauchmelder.
- **Mindestabstand** je Typ aus der Regeltabelle, gemessen als kürzeste Entfernung zwischen den Kanten.
- **Sitzplatz und Bett:** Über ihnen ist ein Modul **immer unzulässig**.
- **Fehlender Abstand:** Für Dusche/Wanne und Sonstiges fehlt die Regel (14.10.2026). Dort wird nur geprüft, dass kein Modul darüber liegt, mit dem Hinweis „Vorgabe fehlt“.

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
- **Raumliste** (Reiter im Projekt): je Raum Heizlast, benötigte Leistung, Module (Typ × Anzahl), installierte Leistung, Thermostat und Prüfergebnis, dazu die Summen.

## Noch nicht Bestandteil

Angebot und PDF-Platzierungsplan (Teil E), nicht rechteckige Räume, Grundriss-Import per KI, Hottgenroth-Import.
