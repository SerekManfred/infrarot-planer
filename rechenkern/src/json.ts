// JSON-Schnittstelle für das Backend: Eingabe als JSON-Text, Antwort als JSON-Text.
// Antwort: {"ok": true, "ergebnis": {...}} oder {"ok": false, "fehler": {"pfad": ..., "meldung": ...}}

import { berechneHeizlast, RechenkernFehler } from './heizlast';
import type { HeizlastEingabe } from './typen';

export function verarbeiteJson(text: string): string {
  let eingabe: HeizlastEingabe;
  try {
    eingabe = JSON.parse(text) as HeizlastEingabe;
  } catch {
    return JSON.stringify({ ok: false, fehler: { pfad: '', meldung: 'Eingabe ist kein gültiges JSON' } });
  }
  if (eingabe === null || typeof eingabe !== 'object') {
    return JSON.stringify({ ok: false, fehler: { pfad: '', meldung: 'Eingabe muss ein JSON-Objekt sein' } });
  }
  try {
    return JSON.stringify({ ok: true, ergebnis: berechneHeizlast(eingabe) });
  } catch (fehler) {
    if (fehler instanceof RechenkernFehler) {
      return JSON.stringify({ ok: false, fehler: { pfad: fehler.pfad, meldung: fehler.meldung } });
    }
    throw fehler;
  }
}
