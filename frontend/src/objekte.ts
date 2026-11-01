// Objektbibliothek im Deckenplan (Festlegung 01.11.2026): reine Hilfen ohne Browser-Abhängigkeit (testbar).
import type { ObjektKategorie } from '@infrarot/rechenkern';
import type { BibliotheksObjekt } from './api';
import { zahl } from './texte';

export const KATEGORIE_KURZ: Record<ObjektKategorie, string> = { tabu: 'tabu', abstand: 'Abstand', neutral: 'neutral' };

/** Maße für Tabelle und Auswahl: „2,20 × 0,90 × 0,45 m“, Streifen „Breite 1,00 m“, Punkt „Punkt“ */
export function masseText(o: Pick<BibliotheksObjekt, 'form' | 'breite_m' | 'tiefe_m' | 'hoehe_m'>): string {
  if (o.form === 'punkt') return 'Punkt';
  if (o.form === 'streifen') return o.breite_m === null ? 'Streifen' : `Streifen, Breite ${zahl(o.breite_m)} m`;
  const teile = [o.breite_m, o.tiefe_m].map((w) => (w === null ? '?' : zahl(w)));
  return `${teile.join(' × ')}${o.hoehe_m !== null ? ` × ${zahl(o.hoehe_m)}` : ''} m`;
}

export function regelText(o: Pick<BibliotheksObjekt, 'kategorie' | 'abstand_cm'>): string {
  if (o.kategorie === 'neutral') return 'neutral';
  return `${KATEGORIE_KURZ[o.kategorie]}, ${o.abstand_cm === null ? 'Abstand fehlt' : `${zahl(o.abstand_cm, 0)} cm`}`;
}

const ZULETZT_SCHLUESSEL = 'deckenplan.objekte.zuletzt';
const ZULETZT_ANZAHL = 6;

type Speicher = Pick<Storage, 'getItem' | 'setItem'>;

function speicher(): Speicher | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

export function zuletztLesen(sp: Speicher | undefined = speicher()): string[] {
  try {
    const liste = JSON.parse(sp?.getItem(ZULETZT_SCHLUESSEL) ?? '[]');
    return Array.isArray(liste) ? liste.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function zuletztMerken(schluessel: string, sp: Speicher | undefined = speicher()): string[] {
  const liste = [schluessel, ...zuletztLesen(sp).filter((s) => s !== schluessel)].slice(0, ZULETZT_ANZAHL);
  try {
    sp?.setItem(ZULETZT_SCHLUESSEL, JSON.stringify(liste));
  } catch {
    /* ohne Speicher: gilt nur bis zum Schließen */
  }
  return liste;
}

/**
 * Reihenfolge der Auswahl: zuerst Objekte für diesen Raumtyp – die speziellsten zuerst (wenigste passende Raumtypen,
 * so stehen im Bad Dusche und Badewanne vor dem Hochschrank) –, dann Objekte für alle Räume, dann die übrigen.
 * Bei Gleichstand gilt die Reihenfolge der Bibliothek.
 */
export function objekteFuerRaum(
  objekte: BibliotheksObjekt[],
  raumtypId: number | null,
): { passend: BibliotheksObjekt[]; allgemein: BibliotheksObjekt[]; weitere: BibliotheksObjekt[] } {
  const aktiv = objekte.filter((o) => o.aktiv !== false).sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0));
  const allgemein = aktiv.filter((o) => o.raumtyp_ids.length === 0);
  if (raumtypId === null) return { passend: [], allgemein, weitere: aktiv.filter((o) => o.raumtyp_ids.length > 0) };
  const passend = aktiv.filter((o) => o.raumtyp_ids.includes(raumtypId)).sort((a, b) => a.raumtyp_ids.length - b.raumtyp_ids.length);
  return { passend, allgemein, weitere: aktiv.filter((o) => o.raumtyp_ids.length > 0 && !o.raumtyp_ids.includes(raumtypId)) };
}
