// Einfache Navigation über den Hash (#/projekt/5), ohne zusätzliche Bibliothek
import { useEffect, useState } from 'react';

export function useAdresse(): string[] {
  const lesen = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [teile, setTeile] = useState(lesen);
  useEffect(() => {
    const aendern = () => setTeile(lesen());
    window.addEventListener('hashchange', aendern);
    return () => window.removeEventListener('hashchange', aendern);
  }, []);
  return teile;
}

export function gehe(pfad: string) {
  window.location.hash = pfad;
}
