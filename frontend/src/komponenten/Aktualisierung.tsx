// Neue App-Version (Service Worker): regelmäßig und beim Zurückkehren in die App prüfen; liegt eine vor, erscheint
// „Neue Version verfügbar – jetzt aktualisieren“. Erst der Klick lädt neu – ausstehende Offline-Änderungen liegen in
// IndexedDB und bleiben dabei erhalten.
import { useRegisterSW } from 'virtual:pwa-register/react';

const PRUEFEN_ALLE_MS = 30 * 60 * 1000;

export function Aktualisierung() {
  const {
    needRefresh: [neu],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registrierung) {
      if (!registrierung) return;
      const pruefen = () => {
        // ohne Netz nicht prüfen (sonst Fehlermeldungen in der Konsole)
        if (navigator.onLine) registrierung.update().catch(() => undefined);
      };
      setInterval(pruefen, PRUEFEN_ALLE_MS);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && pruefen());
      window.addEventListener('online', pruefen);
    },
  });

  if (!neu) return null;
  return (
    <div className="aktualisierung" role="status">
      <span>Neue Version verfügbar</span>
      <button className="knopf" onClick={() => void updateServiceWorker(true)}>
        Jetzt aktualisieren
      </button>
    </div>
  );
}
