/** Modelling tools of the Designer's tool rail, with single-key shortcuts where the tool has one. */
export const MODEL_TOOLS = [
  { id: 'select', label: 'Auswählen', key: ' ', keyLabel: 'Leertaste', hint: 'Anklicken wählt. Umschalt fügt hinzu, Strg schaltet um. Strg+A wählt alles. Ziehen von links wählt innen, von rechts schneidet. Doppelklick öffnet eine Gruppe.' },
  { id: 'move', label: 'Verschieben', key: 'm', keyLabel: 'M', hint: 'Bezugspunkt aus der Inferenz (Ecke, Mitte, …) klicken, dann Zielpunkt. Pfeiltasten oder Umschalt sperren eine Achse. Strg beim Ziel kopiert.' },
  { id: 'rotate', label: 'Drehen', key: 'q', keyLabel: 'Q', hint: 'Drehpunkt aus der Inferenz, dann Start- und Endpunkt. Pfeiltasten wählen die Achse: rot X, grün Y, blau Z. Strg beim Endpunkt kopiert.' },
  { id: 'pushpull', label: 'Drücken/Ziehen', key: 'p', keyLabel: 'P', hint: 'Fläche anklicken, dann die neue Lage. Maß eintippen und Enter. Doppelklick wiederholt den letzten Abstand. Strg erzeugt einen neuen Körper von der Fläche.' },
  { id: 'rect', label: 'Rechteck', key: 'r', keyLabel: 'R', hint: 'Zwei Ecken auf Boden oder Fläche. Pfeiltasten sperren die Ebene (Hoch = waagrecht, Links/Rechts = senkrecht in die Luft). „1200;600“ und Enter. Umschalt sperrt ein Quadrat.' },
  { id: 'line', label: 'Linie', key: 'l', keyLabel: 'L', hint: 'Punkte nacheinander klicken. Pfeiltasten sperren die Zeichenebene. Schließen erzeugt eine Fläche. Rücktaste nimmt den letzten Punkt zurück.' },
  { id: 'circle', label: 'Kreis', key: 'c', keyLabel: 'C', hint: 'Mittelpunkt, dann Radius. Pfeiltasten sperren die Ebene (senkrecht = in die Luft). Radius eintippen; optional „Radius;Segmente“.' },
  { id: 'polygon', label: 'Vieleck', key: 'v', keyLabel: 'V', hint: 'Mittelpunkt, dann Radius. Pfeiltasten sperren die Ebene. Seitenanzahl in Maße (Standard 6), zum Beispiel „500“ oder „500;8“.' },
  { id: 'beam', label: 'Latte', key: 'b', keyLabel: 'B', hint: 'Anfang und Ende klicken; Länge eintippen und Enter.' },
  { id: 'tape', label: 'Maßband', key: 't', keyLabel: 'T', hint: 'Zwei Punkte klicken, um den Abstand zu messen.' },
  { id: 'interact', label: 'Ausprobieren', key: 'i', keyLabel: 'I', hint: 'Bauteil anklicken schaltet seine Zustände (Tür auf/zu) – ohne zu speichern.' },
] as const;

export type ModelToolId = (typeof MODEL_TOOLS)[number]['id'];
export const DRAWING_TOOLS: readonly ModelToolId[] = ['move', 'rotate', 'pushpull', 'rect', 'line', 'circle', 'polygon', 'beam'];

export function toolForKey(key: string): ModelToolId | undefined {
  const lower = key.toLowerCase();
  return MODEL_TOOLS.find(tool => tool.key === lower)?.id;
}

/**
 * Numbers typed into the value box: `750`, `1200;600`, `-25`, with a decimal comma or point.
 * A semicolon separates values (German locale convention for paired Maße).
 */
export function parseValueBox(text: string): number[] | undefined {
  const parts = text.trim().split(/\s*;\s*/);
  if (!parts.length || parts.some(part => !part)) return undefined;
  const values = parts.map(part => Number(part.replace(',', '.').replace(/\s*mm$/i, '').replace(/\s*°$/, '')));
  return values.every(Number.isFinite) ? values : undefined;
}

/** Whether a key press belongs to an editable control and must not reach the canvas shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(type);
}
