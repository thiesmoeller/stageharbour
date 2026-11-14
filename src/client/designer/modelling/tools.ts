/** Modelling tools of the Designer's tool rail, with SketchUp's single-key shortcuts where it has one. */
export const MODEL_TOOLS = [
  { id: 'select', label: 'Auswählen', key: ' ', keyLabel: 'Leertaste', hint: 'Anklicken wählt. Umschalt fügt hinzu, Strg schaltet um. Ziehen von links wählt innen, von rechts schneidet. Doppelklick öffnet eine Gruppe.' },
  { id: 'move', label: 'Verschieben', key: 'm', keyLabel: 'M', hint: 'Startpunkt klicken, Zielpunkt klicken. Pfeiltasten oder Umschalt sperren eine Achse. Strg beim Ziel kopiert.' },
  { id: 'rotate', label: 'Drehen', key: 'q', keyLabel: 'Q', hint: 'Mittelpunkt, Startpunkt, Endpunkt. Pfeiltasten wählen die Achse: rot X, grün Y, blau Z.' },
  { id: 'pushpull', label: 'Drücken/Ziehen', key: 'p', keyLabel: 'P', hint: 'Fläche anklicken, dann die neue Lage. Maß eintippen und Enter setzt es genau.' },
  { id: 'rect', label: 'Rechteck', key: 'r', keyLabel: 'R', hint: 'Zwei Ecken auf Boden oder Fläche klicken. „1200;600“ und Enter setzt die Maße. Es entsteht eine Fläche.' },
  { id: 'line', label: 'Linie', key: 'l', keyLabel: 'L', hint: 'Punkte nacheinander klicken. Schließen erzeugt eine Fläche. Rücktaste nimmt den letzten Punkt zurück.' },
  { id: 'polygon', label: 'Vieleck', key: 'v', keyLabel: 'V', hint: 'Eckpunkte klicken; erster Punkt oder Enter schließt die Fläche. Rücktaste nimmt den letzten zurück.' },
  { id: 'beam', label: 'Latte', key: 'b', keyLabel: 'B', hint: 'Anfang und Ende klicken; Länge eintippen und Enter.' },
  { id: 'tape', label: 'Maßband', key: 't', keyLabel: 'T', hint: 'Zwei Punkte klicken, um den Abstand zu messen.' },
  { id: 'interact', label: 'Ausprobieren', key: 'i', keyLabel: 'I', hint: 'Bauteil anklicken schaltet seine Zustände (Tür auf/zu) – ohne zu speichern.' },
] as const;

export type ModelToolId = (typeof MODEL_TOOLS)[number]['id'];
export const DRAWING_TOOLS: readonly ModelToolId[] = ['move', 'rotate', 'pushpull', 'rect', 'line', 'polygon', 'beam'];

export function toolForKey(key: string): ModelToolId | undefined {
  const lower = key.toLowerCase();
  return MODEL_TOOLS.find(tool => tool.key === lower)?.id;
}

/**
 * Numbers typed into the value box: `750`, `1200;600`, `-25`, with a decimal comma or point.
 * A semicolon separates values, as in SketchUp's German edition.
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
