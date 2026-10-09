// Kommandozeile für den Server: liest die Eingabe als JSON von stdin, schreibt die Antwort nach stdout.
// Exit-Code 0 bei Erfolg, 1 bei fachlichem Fehler in der Eingabe.

import { verarbeiteJson } from './json';

const teile: Buffer[] = [];
process.stdin.on('data', (teil: Buffer) => teile.push(teil));
process.stdin.on('end', () => {
  const antwort = verarbeiteJson(Buffer.concat(teile).toString('utf8'));
  process.stdout.write(antwort + '\n');
  process.exitCode = (JSON.parse(antwort) as { ok: boolean }).ok ? 0 : 1;
});
