// JSON-Schnittstelle für das Backend: Eingabe als JSON-Text, Antwort als JSON-Text.
// Eingabe: {"art": "heizlast" | "auswertung", ...}; ohne "art" gilt "heizlast".
// Antwort: {"ok": true, "ergebnis": {...}} oder {"ok": false, "fehler": {"pfad": ..., "meldung": ...}}

import { berechneAuswertung, type AuswertungEingabe } from './auswertung';
import { berechneHeizlast, RechenkernFehler } from './heizlast';
import type { HeizlastEingabe } from './typen';

function fehlerAntwort(pfad: string, meldung: string): string {
  return JSON.stringify({ ok: false, fehler: { pfad, meldung } });
}

export function verarbeiteJson(text: string): string {
  let eingabe: { art?: unknown };
  try {
    eingabe = JSON.parse(text);
  } catch {
    return fehlerAntwort('', 'Eingabe ist kein gültiges JSON');
  }
  if (eingabe === null || typeof eingabe !== 'object' || Array.isArray(eingabe)) {
    return fehlerAntwort('', 'Eingabe muss ein JSON-Objekt sein');
  }
  const art = eingabe.art ?? 'heizlast';
  try {
    if (art === 'heizlast') {
      return JSON.stringify({ ok: true, ergebnis: berechneHeizlast(eingabe as HeizlastEingabe) });
    }
    if (art === 'auswertung') {
      return JSON.stringify({ ok: true, ergebnis: berechneAuswertung(eingabe as AuswertungEingabe) });
    }
    return fehlerAntwort('art', `unbekannte Art „${String(art)}“`);
  } catch (fehler) {
    if (fehler instanceof RechenkernFehler) return fehlerAntwort(fehler.pfad, fehler.meldung);
    throw fehler;
  }
}
