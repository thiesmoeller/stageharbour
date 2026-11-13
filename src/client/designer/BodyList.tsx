import { useState } from 'react';
import type { PartBodyKind, PartDefinition, PartMaterial } from '../../shared/parts/definition.js';
import type { PartSummary } from '../../shared/parts/catalog.js';
import {
  BODY_KIND_LABELS, moveItem, newBody, newConnector, newHardware, removeAt, removeBody,
  type DesignerSelection,
} from './draft.js';
import { connectorKindLabel, connectorStyle } from './PartViewsSvg.js';
import { sameSelection } from './views.js';

type Row = { selection: DesignerSelection; title: string; detail: string; marker?: string };

function ElementSection({ title, rows, selection, onSelect, onMove, onRemove, disabled, children, testId, emptyText }: {
  title: string; rows: Row[]; selection: DesignerSelection | undefined; onSelect: (selection: DesignerSelection) => void;
  onMove: (index: number, delta: number) => void; onRemove: (index: number) => void; disabled: boolean;
  children?: React.ReactNode; testId: string; emptyText: string;
}) {
  return <section className="designer-elements" data-testid={testId}>
    <h3>{title} <span className="muted-inline">{rows.length}</span></h3>
    {rows.length ? <ol>
      {rows.map((row, index) => {
        const selected = sameSelection(row.selection, selection);
        return <li key={index} className={selected ? 'selected' : undefined}>
          <button type="button" className="element-select" aria-pressed={selected} onClick={() => onSelect(row.selection)}>
            {row.marker && <span className="element-marker" style={{ background: row.marker }} aria-hidden="true" />}
            <span className="element-title">{row.title}</span><span className="element-detail">{row.detail}</span>
          </button>
          <span className="element-actions">
            <button type="button" className="quiet icon-button" disabled={disabled || index === 0} aria-label={`${row.title} nach oben`} onClick={() => onMove(index, -1)}>↑</button>
            <button type="button" className="quiet icon-button" disabled={disabled || index === rows.length - 1} aria-label={`${row.title} nach unten`} onClick={() => onMove(index, 1)}>↓</button>
            <button type="button" className="quiet icon-button" disabled={disabled} aria-label={`${row.title} entfernen`} onClick={() => onRemove(index)}>×</button>
          </span>
        </li>;
      })}
    </ol> : <p className="muted">{emptyText}</p>}
    {children}
  </section>;
}

/** Bodies, child parts, connectors and hardware of the open definition: select, add, remove, reorder. */
export function BodyList({ definition, onChange, selection, onSelect, materials, library, onAddChild, disabled }: {
  definition: PartDefinition;
  onChange: (definition: PartDefinition, select?: DesignerSelection) => void;
  selection: DesignerSelection | undefined;
  onSelect: (selection: DesignerSelection) => void;
  materials: readonly PartMaterial[];
  library: readonly PartSummary[];
  onAddChild: (partId: string) => void;
  disabled: boolean;
}) {
  const [childPart, setChildPart] = useState('');
  const materialName = (key: string) => materials.find(material => material.key === key)?.name ?? key;
  const children = definition.children ?? [];
  const connectors = definition.connectors ?? [];
  const hardware = definition.hardware ?? [];
  const candidates = library.filter(part => part.id !== definition.id && !part.archived);
  const addBody = (kind: PartBodyKind) => {
    const body = newBody(kind, definition, materials);
    onChange({ ...definition, bodies: [...definition.bodies, body] }, { kind: 'body', key: body.key });
  };
  return <div className="designer-body-list" aria-label="Aufbau des Bauteils">
    <ElementSection title="Körper" testId="designer-bodies" selection={selection} onSelect={onSelect} disabled={disabled}
      emptyText="Noch kein Körper."
      rows={definition.bodies.map(body => ({
        selection: { kind: 'body', key: body.key }, title: body.label || body.key,
        detail: `${BODY_KIND_LABELS[body.kind]} · ${materialName(body.material)}`,
        marker: materials.find(material => material.key === body.material)?.color,
      }))}
      onMove={(index, delta) => onChange({ ...definition, bodies: moveItem(definition.bodies, index, delta) })}
      onRemove={index => onChange(removeBody(definition, index))}>
      <div className="designer-actions">
        {(['sheet', 'beam', 'box'] as const).map(kind => <button key={kind} type="button" className="quiet" disabled={disabled}
          onClick={() => addBody(kind)}>+ {BODY_KIND_LABELS[kind]}</button>)}
      </div>
    </ElementSection>
    <ElementSection title="Unterbauteile" testId="designer-children" selection={selection} onSelect={onSelect} disabled={disabled}
      emptyText="Keine Unterbauteile."
      rows={children.map(child => ({
        selection: { kind: 'child', key: child.key }, title: child.label || child.key,
        detail: `${library.find(part => part.id === child.part.id)?.name ?? 'Bauteil'} · Rev. ${child.part.revision}`,
      }))}
      onMove={(index, delta) => onChange({ ...definition, children: moveItem(children, index, delta) })}
      onRemove={index => onChange({ ...definition, children: removeAt(children, index) })}>
      {!disabled && <div className="designer-actions add-child">
        <select aria-label="Bauteil als Unterbauteil wählen" value={childPart} onChange={event => setChildPart(event.target.value)}>
          <option value="">Bauteil wählen …</option>
          {candidates.map(part => <option key={part.id} value={part.id}>{part.name} ({part.category})</option>)}
        </select>
        <button type="button" className="quiet" disabled={!childPart} onClick={() => { onAddChild(childPart); setChildPart(''); }}>Hinzufügen</button>
      </div>}
    </ElementSection>
    <ElementSection title="Verbinder" testId="designer-connectors" selection={selection} onSelect={onSelect} disabled={disabled}
      emptyText="Keine Verbinder."
      rows={connectors.map(connector => ({
        selection: { kind: 'connector', key: connector.key }, title: connector.label || connector.key,
        detail: connectorKindLabel(connector.kind), marker: connectorStyle(connector.kind).color,
      }))}
      onMove={(index, delta) => onChange({ ...definition, connectors: moveItem(connectors, index, delta) })}
      onRemove={index => onChange({ ...definition, connectors: removeAt(connectors, index) })}>
      <div className="designer-actions">
        <button type="button" className="quiet" disabled={disabled} onClick={() => {
          const connector = newConnector(definition);
          onChange({ ...definition, connectors: [...connectors, connector] }, { kind: 'connector', key: connector.key });
        }}>+ Verbinder</button>
      </div>
    </ElementSection>
    <ElementSection title="Zubehör" testId="designer-hardware" selection={selection} onSelect={onSelect} disabled={disabled}
      emptyText="Kein zusätzliches Zubehör."
      rows={hardware.map((item, index) => ({
        selection: { kind: 'hardware', index }, title: materialName(item.material), detail: `Menge ${item.quantity}`,
      }))}
      onMove={(index, delta) => onChange({ ...definition, hardware: moveItem(hardware, index, delta) })}
      onRemove={index => onChange({ ...definition, hardware: removeAt(hardware, index) })}>
      <div className="designer-actions">
        <button type="button" className="quiet" disabled={disabled} onClick={() => {
          onChange({ ...definition, hardware: [...hardware, newHardware(materials)] }, { kind: 'hardware', index: hardware.length });
        }}>+ Zubehör</button>
      </div>
    </ElementSection>
  </div>;
}
