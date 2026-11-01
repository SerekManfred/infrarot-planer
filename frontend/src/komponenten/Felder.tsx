// Eingabefelder, die erst beim Verlassen speichern – angenehm am Tablet und schonend für das Protokoll.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Gebaeudestandard } from '../api';
import { GEBAEUDESTANDARDS, HILFE, HILFE_GEBAEUDESTANDARD, leseZahl } from '../texte';

interface ZahlfeldProps {
  wert: number | null;
  onSpeichern: (wert: number | null) => void | Promise<void>;
  einheit?: string;
  platzhalter?: string;
  gesperrt?: boolean;
  min?: number;
  hervorheben?: boolean;
  beschriftung?: string;
  /** leer ist nicht erlaubt: rot markiert, bis ein Wert eingetragen ist */
  pflicht?: boolean;
}

export function Zahlfeld({ wert, onSpeichern, einheit, platzhalter, gesperrt, min = 0, hervorheben, beschriftung, pflicht }: ZahlfeldProps) {
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
    <span className={`zahlfeld${hervorheben ? ' abweichung' : ''}${ungueltig || (pflicht && wert === null) ? ' ungueltig' : ''}`}>
      <input
        aria-label={beschriftung}
        inputMode="decimal"
        value={text}
        placeholder={platzhalter ?? (pflicht ? 'Pflicht' : undefined)}
        required={pflicht}
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

/**
 * ⓘ neben einem Fachbegriff: Antippen zeigt einen kurzen Hilfetext, erneutes Antippen, Tippen daneben oder Esc schließt.
 * Bewusst kein <button>: Steht das ⓘ in einem <label>, würde ein Knopf das Eingabefeld als Bezugsfeld verdrängen.
 */
export function Hilfe({ text, begriff }: { text: ReactNode; begriff?: string }) {
  const [lage, setLage] = useState<CSSProperties | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!lage) return;
    const schliessen = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setLage(null);
    };
    const zu = () => setLage(null);
    document.addEventListener('pointerdown', schliessen);
    document.addEventListener('keydown', schliessen);
    window.addEventListener('scroll', zu, true);
    window.addEventListener('resize', zu);
    return () => {
      document.removeEventListener('pointerdown', schliessen);
      document.removeEventListener('keydown', schliessen);
      window.removeEventListener('scroll', zu, true);
      window.removeEventListener('resize', zu);
    };
  }, [lage]);

  function umschalten(e: { preventDefault(): void; stopPropagation(): void }) {
    // nicht das Feld im umgebenden <label> fokussieren
    e.preventDefault();
    e.stopPropagation();
    if (lage) return setLage(null);
    // fest positioniert, damit Tabellen mit Bildlauf und schmale Bildschirme den Text nicht abschneiden
    const r = ref.current!.getBoundingClientRect();
    const breite = Math.min(288, window.innerWidth - 32);
    const links = Math.min(Math.max(16, r.left - 12), window.innerWidth - breite - 16);
    setLage({ top: r.bottom + 6, left: links, width: breite });
  }

  return (
    <span className="hilfe" ref={ref}>
      <span
        role="button"
        tabIndex={0}
        className="hilfe-knopf"
        aria-label={begriff ? `Erklärung: ${begriff}` : 'Erklärung'}
        aria-expanded={lage !== null}
        onClick={umschalten}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && umschalten(e)}
      >
        ⓘ
      </span>
      {lage && (
        <span role="tooltip" className="hilfe-text" style={lage} onClick={(e) => e.preventDefault()}>
          {text}
        </span>
      )}
    </span>
  );
}

/** ⓘ zur Auswahl des Gebäudestandards: allgemein und je Standard */
export function GebaeudestandardHilfe() {
  return (
    <Hilfe
      begriff="Gebäudestandard"
      text={
        <>
          {HILFE.gebaeudestandard}
          {(Object.keys(GEBAEUDESTANDARDS) as Gebaeudestandard[]).map((gs) => (
            <span key={gs} className="hilfe-absatz">
              <strong>{GEBAEUDESTANDARDS[gs]}:</strong> {HILFE_GEBAEUDESTANDARD[gs]}
            </span>
          ))}
        </>
      }
    />
  );
}

/** Passwortfeld mit Augen-Symbol zum Ein-/Ausblenden (Tippfläche 44 px) */
export function PasswortFeld({
  wert,
  onAendern,
  autoComplete,
  minLength,
}: {
  wert: string;
  onAendern: (wert: string) => void;
  autoComplete: 'current-password' | 'new-password';
  minLength?: number;
}) {
  const [sichtbar, setSichtbar] = useState(false);
  return (
    <span className="passwortfeld">
      <input
        type={sichtbar ? 'text' : 'password'}
        autoComplete={autoComplete}
        minLength={minLength}
        value={wert}
        onChange={(e) => onAendern(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
      />
      <button
        type="button"
        className="passwort-auge"
        aria-label={sichtbar ? 'Passwort verbergen' : 'Passwort anzeigen'}
        aria-pressed={sichtbar}
        title={sichtbar ? 'Passwort verbergen' : 'Passwort anzeigen'}
        onClick={() => setSichtbar(!sichtbar)}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          {sichtbar && <line x1="3" y1="21" x2="21" y2="3" stroke="currentColor" strokeWidth="1.8" />}
        </svg>
      </button>
    </span>
  );
}

/** Dialog über der Seite (Bearbeiten-Masken): Esc oder „Schließen“ schließt; auf dem Handy fast bildschirmfüllend */
export function Dialog({ titel, onSchliessen, children }: { titel: string; onSchliessen: () => void; children: ReactNode }) {
  useEffect(() => {
    const taste = (e: KeyboardEvent) => e.key === 'Escape' && onSchliessen();
    document.addEventListener('keydown', taste);
    return () => document.removeEventListener('keydown', taste);
  }, [onSchliessen]);
  return (
    <div className="dialog-hintergrund" onPointerDown={(e) => e.target === e.currentTarget && onSchliessen()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={titel}>
        <div className="dialog-kopf">
          <h2>{titel}</h2>
          <button className="knopf-leise" onClick={onSchliessen} aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="dialog-inhalt">{children}</div>
      </div>
    </div>
  );
}
