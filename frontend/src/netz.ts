// Netzzugriff auf die Backend-API. Meldet jedem Beobachter, ob der Server erreichbar war.

export class ApiFehler extends Error {
  constructor(
    public readonly status: number,
    meldung: string,
  ) {
    super(meldung);
  }
}

/** Verständliche Texte, wenn der Server keinen eigenen liefert (z. B. Proxy- oder Serverfehler) */
const STANDARDMELDUNG: Record<number, string> = {
  400: 'Die Anfrage war unvollständig oder ungültig. Bitte Eingaben prüfen.',
  401: 'Bitte neu anmelden.',
  403: 'Dafür fehlt die Berechtigung.',
  404: 'Nicht gefunden – evtl. wurde es inzwischen gelöscht. Bitte Seite neu laden.',
  409: 'Speichern nicht möglich, weil sich die Daten inzwischen geändert haben. Bitte Seite neu laden.',
  413: 'Die Datei ist zu groß.',
  422: 'Bitte Eingaben prüfen – mindestens ein Wert ist ungültig.',
  423: 'Das Projekt ist gerade auf einem anderen Gerät zur Offline-Bearbeitung ausgecheckt.',
  429: 'Zu viele Versuche – bitte kurz warten und erneut versuchen.',
  500: 'Auf dem Server ist ein Fehler aufgetreten. Bitte erneut versuchen; falls es wieder passiert, Admin informieren.',
  502: 'Der Server ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.',
  503: 'Der Server ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.',
  504: 'Der Server antwortet nicht rechtzeitig. Bitte gleich noch einmal versuchen.',
};

function meldungAus(status: number, detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && 'meldung' in detail) {
    const d = detail as { meldung: unknown; fehler?: unknown };
    return Array.isArray(d.fehler) ? `${d.meldung}: ${d.fehler.join('; ')}` : String(d.meldung);
  }
  if (Array.isArray(detail)) return 'Bitte Eingaben prüfen – mindestens ein Wert ist ungültig.';
  return STANDARDMELDUNG[status] ?? `Unerwarteter Fehler (Code ${status}). Bitte erneut versuchen; falls es wieder passiert, Admin informieren.`;
}

const ZEITLIMIT_MS = 20_000;

/** true = Server hat geantwortet, false = nicht erreichbar */
type Beobachter = (erreichbar: boolean) => void;
let beobachter: Beobachter = () => undefined;

export function netzBeobachten(fn: Beobachter) {
  beobachter = fn;
}

/** Status 0 = Server nicht erreichbar (offline); 502–504 = Server bzw. Proxy gerade nicht verfügbar */
export function istNetzfehler(e: unknown): boolean {
  return e instanceof ApiFehler && (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504);
}

export async function netzAnfrage<T>(methode: string, pfad: string, daten?: unknown, kopf: Record<string, string> = {}): Promise<T> {
  let antwort: Response;
  const istDatei = daten instanceof FormData;
  // Schlechte Mobilverbindung: nicht ewig warten, sondern wie „offline“ behandeln
  const abbruch = new AbortController();
  const frist = setTimeout(() => abbruch.abort(), ZEITLIMIT_MS);
  try {
    antwort = await fetch(`/api${pfad}`, {
      method: methode,
      credentials: 'same-origin',
      headers: daten === undefined || istDatei ? kopf : { 'Content-Type': 'application/json', ...kopf },
      body: daten === undefined ? undefined : istDatei ? daten : JSON.stringify(daten),
      signal: abbruch.signal,
    });
  } catch {
    beobachter(false);
    throw new ApiFehler(0, 'Keine Verbindung zum Server. Bitte Internetverbindung prüfen.');
  } finally {
    clearTimeout(frist);
  }
  beobachter(antwort.status < 502 || antwort.status > 504);
  if (antwort.status === 204) return undefined as T;
  const inhalt = await antwort.json().catch(() => null);
  if (!antwort.ok) throw new ApiFehler(antwort.status, meldungAus(antwort.status, inhalt?.detail));
  return inhalt as T;
}
