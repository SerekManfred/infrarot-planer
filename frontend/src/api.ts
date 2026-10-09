// Zugriff auf die Backend-API. Die Sitzung liegt im HttpOnly-Cookie; das Frontend sieht kein Token.

export interface Benutzer {
  id: number;
  email: string;
  name: string;
  rolle: 'admin' | 'berater';
  aktiv: boolean;
}

export interface Projekt {
  id: number;
  nummer: string;
  bezeichnung: string;
  kunde_name: string;
  notizen: string;
  ersteller_id: number | null;
  erstellt_am: string;
  geaendert_am: string;
}

export class ApiFehler extends Error {
  constructor(
    public readonly status: number,
    meldung: string,
  ) {
    super(meldung);
  }
}

function meldungAus(status: number, detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && 'meldung' in detail) return String((detail as { meldung: unknown }).meldung);
  if (Array.isArray(detail)) return 'Eingaben ungültig';
  return `Fehler ${status}`;
}

async function anfrage<T>(pfad: string, optionen: RequestInit = {}): Promise<T> {
  let antwort: Response;
  try {
    antwort = await fetch(`/api${pfad}`, {
      credentials: 'same-origin',
      ...optionen,
      headers: { 'Content-Type': 'application/json', ...optionen.headers },
    });
  } catch {
    throw new ApiFehler(0, 'Server nicht erreichbar');
  }
  if (antwort.status === 204) return undefined as T;
  const daten = await antwort.json().catch(() => null);
  if (!antwort.ok) throw new ApiFehler(antwort.status, meldungAus(antwort.status, daten?.detail));
  return daten as T;
}

export const api = {
  ich: () => anfrage<Benutzer>('/auth/ich'),
  anmelden: (email: string, passwort: string) =>
    anfrage<Benutzer>('/auth/anmelden', { method: 'POST', body: JSON.stringify({ email, passwort }) }),
  abmelden: () => anfrage<void>('/auth/abmelden', { method: 'POST' }),
  projekte: () => anfrage<Projekt[]>('/projekte'),
  projektAnlegen: (daten: { nummer: string; bezeichnung: string; kunde_name: string }) =>
    anfrage<Projekt>('/projekte', { method: 'POST', body: JSON.stringify(daten) }),
};
