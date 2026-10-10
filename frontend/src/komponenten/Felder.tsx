// Eingabefelder, die erst beim Verlassen speichern – angenehm am Tablet und schonend für das Protokoll.
import { useEffect, useState, type ReactNode } from 'react';
import { leseZahl } from '../texte';

interface ZahlfeldProps {
  wert: number | null;
  onSpeichern: (wert: number | null) => void | Promise<void>;
  einheit?: string;
  platzhalter?: string;
  gesperrt?: boolean;
  min?: number;
  hervorheben?: boolean;
  beschriftung?: string;
}

export function Zahlfeld({ wert, onSpeichern, einheit, platzhalter, gesperrt, min = 0, hervorheben, beschriftung }: ZahlfeldProps) {
  const [text, setText] = useState(alsText(wert));
  const [ungueltig, setUngueltig] = useState(false);
  useEffect(() => setText(alsText(wert)), [wert]);

  function verlassen() {
    const neu = leseZahl(text);
    if (neu !== null && (Number.isNaN(neu) || neu < min)) {
      setUngueltig(true);
      return;
    }
    setUngueltig(false);
    if (neu !== wert) void onSpeichern(neu);
  }

  return (
    <span className={`zahlfeld${hervorheben ? ' abweichung' : ''}${ungueltig ? ' ungueltig' : ''}`}>
      <input
        aria-label={beschriftung}
        inputMode="decimal"
        value={text}
        placeholder={platzhalter}
        disabled={gesperrt}
        onChange={(e) => setText(e.target.value)}
        onBlur={verlassen}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {einheit && <span className="einheit">{einheit}</span>}
    </span>
  );
}

function alsText(wert: number | null): string {
  return wert === null ? '' : String(wert).replace('.', ',');
}

interface TextfeldProps {
  wert: string;
  onSpeichern: (wert: string) => void | Promise<void>;
  platzhalter?: string;
  gesperrt?: boolean;
  pflicht?: boolean;
  beschriftung?: string;
}

export function Textfeld({ wert, onSpeichern, platzhalter, gesperrt, pflicht, beschriftung }: TextfeldProps) {
  const [text, setText] = useState(wert);
  useEffect(() => setText(wert), [wert]);
  return (
    <input
      aria-label={beschriftung}
      value={text}
      placeholder={platzhalter}
      disabled={gesperrt}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const neu = text.trim();
        if (pflicht && !neu) return setText(wert);
        if (neu !== wert) void onSpeichern(neu);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** Große Umschaltknöpfe statt Auswahlliste, wenn es nur wenige Möglichkeiten gibt */
export function Schalter<T extends string>({
  wert,
  optionen,
  onWahl,
  gesperrt,
}: {
  wert: T;
  optionen: Record<T, string>;
  onWahl: (wert: T) => void;
  gesperrt?: boolean;
}) {
  return (
    <span className="schalter" role="radiogroup">
      {(Object.keys(optionen) as T[]).map((schluessel) => (
        <button
          key={schluessel}
          type="button"
          role="radio"
          aria-checked={schluessel === wert}
          className={schluessel === wert ? 'aktiv' : ''}
          disabled={gesperrt}
          onClick={() => schluessel !== wert && onWahl(schluessel)}
        >
          {optionen[schluessel]}
        </button>
      ))}
    </span>
  );
}

export function Meldung({ art = 'fehler', children }: { art?: 'fehler' | 'hinweis' | 'warnung'; children: ReactNode }) {
  return <p className={`meldung ${art}`}>{children}</p>;
}
