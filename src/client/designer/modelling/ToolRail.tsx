import { MODEL_TOOLS, type ModelToolId } from './tools.js';

const ICONS: Record<ModelToolId, string> = {
  select: '↖', move: '✥', rotate: '⟳', pushpull: '⇳', split: '✂', rect: '▭', line: '╱', circle: '○', polygon: '⬠', beam: '▬', tape: '⟷', interact: '☝',
};
const VIEW_TOOLS: readonly ModelToolId[] = ['select', 'tape', 'interact'];

/** The modelling tools down the left edge of the canvas. */
export function ToolRail({ tool, onTool, readOnly, canUndo, canRedo, onUndo, onRedo }: {
  tool: ModelToolId; onTool: (tool: ModelToolId) => void; readOnly: boolean;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
}) {
  return <nav className="model-tool-rail" aria-label="Werkzeuge" data-testid="designer-tool-rail">
    {MODEL_TOOLS.map(item => {
      const disabled = readOnly && !VIEW_TOOLS.includes(item.id);
      return <button key={item.id} type="button" className={item.id === tool ? 'model-tool active' : 'model-tool'} aria-pressed={item.id === tool}
        disabled={disabled} data-testid={`designer-tool-${item.id}`} title={`${item.label} (${item.keyLabel}) – ${item.hint}`} aria-keyshortcuts={item.key === ' ' ? 'Space' : item.key.toUpperCase()}
        onClick={() => onTool(item.id)}>
        <span className="model-tool-icon" aria-hidden="true">{ICONS[item.id]}</span>
        <span className="model-tool-label">{item.label}</span>
      </button>;
    })}
    <span className="model-tool-gap" />
    <button type="button" className="model-tool" disabled={readOnly || !canUndo} data-testid="designer-undo" title="Rückgängig (Strg+Z)" aria-keyshortcuts="Control+Z" onClick={onUndo}>
      <span className="model-tool-icon" aria-hidden="true">↶</span><span className="model-tool-label">Rückgängig</span>
    </button>
    <button type="button" className="model-tool" disabled={readOnly || !canRedo} data-testid="designer-redo" title="Wiederholen (Strg+Umschalt+Z)" aria-keyshortcuts="Control+Shift+Z" onClick={onRedo}>
      <span className="model-tool-icon" aria-hidden="true">↷</span><span className="model-tool-label">Wiederholen</span>
    </button>
  </nav>;
}
