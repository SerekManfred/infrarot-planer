// Einstieg für die Oberfläche: der eine Offline-Dienst der App und ein Hook für seinen Zustand.
import { useSyncExternalStore } from 'react';
import { netzAnfrage, netzBeobachten } from '../netz';
import { OfflineDienst, type OfflineZustand } from './dienst';
import type { Methode } from './lokal';
import { IndexedDbSpeicher } from './speicher';

export const offline = new OfflineDienst(new IndexedDbSpeicher(), netzAnfrage, undefined, navigator.onLine);

netzBeobachten((erreichbar) => offline.erreichbarkeit(erreichbar));
// Offline-Daten nicht vom Browser bei Speicherknappheit löschen lassen (bei installierter App meist gewährt)
navigator.storage?.persist?.().catch(() => undefined);
window.addEventListener('online', () => offline.synchronisierenBald(0));
window.addEventListener('offline', () => offline.erreichbarkeit(false));
// Regelmäßig nachsehen, ob der Server wieder erreichbar ist bzw. Änderungen übertragen werden können
setInterval(() => {
  const z = offline.zustand;
  if (!z.online) {
    netzAnfrage('GET', '/gesundheit').catch(() => undefined);
  } else if (z.ausstehend > 0 && !z.problem && !z.laeuft) {
    void offline.synchronisieren();
  }
}, 30_000);

export function anfrage<T>(methode: Methode, pfad: string, daten?: unknown): Promise<T> {
  return offline.anfrage<T>(methode, pfad, daten);
}

export function useOffline(): OfflineZustand {
  return useSyncExternalStore(
    (fn) => offline.beobachten(fn),
    () => offline.zustand,
  );
}
