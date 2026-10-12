# Fachkonzept

Stand: Phase 1 Teil D (12.10.2026)

## Zweck und Beteiligte

- **Mein Energie Haus GmbH (MEH), Außendienst:** plant vor Ort Infrarot-**Deckenmodule** (nur Deckenmontage), später mit Angebot und Platzierungsplan.
- **Energieberatung Serek, Fachprüfer:** pflegt die Fachvorgaben, prüft die Projekte fachlich und gibt sie frei.
- **Admin:** verwaltet Benutzer und Betrieb, darf Fachvorgaben pflegen, prüft und gibt aber nicht frei.
- **Rollen sind kombinierbar.** Prüfen und Freigeben erfordert immer die Rolle Fachprüfer. Ein Konto mit Admin + Fachprüfer darf also beides. Festgelegt am 12.10.2026; das Konto serek.manfred@googlemail.com hat Admin + Fachprüfer.

## Projektstatus

```
Vor-Ort-Entwurf ──(Fachprüfer: geprüft)──▶ fachlich geprüft ──(Fachprüfer: freigeben)──▶ freigegeben
        ▲                                         │                                        │
        └──────────── Fachprüfer: zurück auf Entwurf ◀─────────────────────────────────────┘
```

- Nur Fachprüfer ändern den Status.
- **Fachlich geprüft:** Ändert danach jemand Projektdaten, fällt das Projekt automatisch auf „Vor-Ort-Entwurf“ zurück (die Prüfung gilt nur für den geprüften Stand).
- **Freigegeben:** Projektdaten sind gesperrt. Zum Ändern setzt ein Fachprüfer das Projekt zurück auf „Vor-Ort-Entwurf“. Bei der Freigabe wird die Auswertung als unveränderliche, versionierte Berechnung gespeichert, damit spätere Änderungen an den Fachvorgaben das freigegebene Ergebnis nicht verändern.
- Alle Benutzer sehen alle Projekte. Jede Änderung (anlegen, ändern, löschen, Status) wird mit Benutzer, Zeit und alten/neuen Werten protokolliert.

## Gebäudestandard (Pflichtfeld)

| Wert | Bezeichnung |
|---|---|
| `neubau` | Neubau |
| `effizienzhaus_sanierung` | Effizienzhaus-Sanierung |
| `sonstiger_bestand` | sonstiger Bestand |

Bei „sonstiger Bestand“ erscheint der Hinweis: **„Infrarot als alleiniges Heizsystem wird für diesen Gebäudestandard nicht empfohlen.“** Die Berechnung bleibt möglich.
Dabei gibt es bewusst **keinen Rückfallwert und keine Tabellenwerte**. Die W/m²-Pauschale ist bei jedem Raum eine **Pflichteingabe**. Ohne sie gibt es für den Raum kein Ergebnis und den Hinweis „Eingabe fehlt: Pauschale W/m² für diesen Raum (bei „sonstiger Bestand“ Pflicht)“.

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
  - Für „sonstiger Bestand“ gibt es keinen Rückfallwert, die Pauschale wird je Raum eingegeben (siehe oben).
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
| Pauschale W/m² je Raumtyp × Gebäudestandard (nicht „sonstiger Bestand“) | zentral | je Projekt (je Raumtyp) und je Raum |
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

## Noch nicht Bestandteil

Modulkatalog, Sperrflächen, Platzierung, Angebot, Platzierungsplan, Grundriss-Import per KI, Hottgenroth-Import.
