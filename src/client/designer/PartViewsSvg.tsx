import { useMemo } from 'react';
import { CONNECTOR_KINDS, type BuiltInConnectorKind, type PartMaterial } from '../../shared/parts/definition.js';
import { formatNumber } from '../../shared/parts/issues.js';
import type { ResolvedPart } from '../../shared/parts/resolve.js';
import type { DesignerSelection } from './draft.js';
import { PART_VIEWS, buildPartView, sameSelection, type PartView, type ViewConnector } from './views.js';

type MarkerShape = 'circle' | 'square' | 'diamond' | 'triangle';

export const CONNECTOR_STYLE: Readonly<Record<BuiltInConnectorKind, { color: string; shape: MarkerShape }>> = {
  'hinge-edge': { color: '#7d3c98', shape: 'circle' },
  'brace-mount': { color: '#b03a2e', shape: 'square' },
  'deck-edge': { color: '#1f618d', shape: 'diamond' },
  'leg-socket': { color: '#b9770e', shape: 'triangle' },
  floor: { color: '#566573', shape: 'square' },
};
const OWN_KIND_STYLE = { color: '#1e8449', shape: 'circle' as MarkerShape };

export function connectorStyle(kind: string) {
  return Object.hasOwn(CONNECTOR_STYLE, kind) ? CONNECTOR_STYLE[kind as BuiltInConnectorKind] : OWN_KIND_STYLE;
}

export function connectorKindLabel(kind: string) {
  return Object.hasOwn(CONNECTOR_KINDS, kind) ? CONNECTOR_KINDS[kind as BuiltInConnectorKind].label : kind;
}

function Marker({ shape, x, y, size, color }: { shape: MarkerShape; x: number; y: number; size: number; color: string }) {
  if (shape === 'circle') return <circle cx={x} cy={y} r={size} fill={color} />;
  if (shape === 'square') return <rect x={x - size} y={y - size} width={size * 2} height={size * 2} fill={color} />;
  if (shape === 'diamond') return <polygon points={`${x},${y - size * 1.3} ${x + size * 1.3},${y} ${x},${y + size * 1.3} ${x - size * 1.3},${y}`} fill={color} />;
  return <polygon points={`${x},${y - size * 1.3} ${x + size * 1.2},${y + size} ${x - size * 1.2},${y + size}`} fill={color} />;
}

function ConnectorMark({ connector, unit, selected, onSelect }: {
  connector: ViewConnector; unit: number; selected: boolean; onSelect?: (selection: DesignerSelection) => void;
}) {
  const style = connectorStyle(connector.kind);
  const size = unit * (selected ? 1.5 : 1);
  const arrow = unit * 4;
  const select = connector.select;
  return <g className={selected ? 'view-connector selected' : 'view-connector'} data-connector={connector.id} data-kind={connector.kind}
    onClick={select && onSelect ? event => { event.stopPropagation(); onSelect(select); } : undefined}
    style={select && onSelect ? { cursor: 'pointer' } : undefined}>
    <title>{`${connectorKindLabel(connector.kind)}: ${connector.id}`}</title>
    {connector.end && <line x1={connector.at.x} y1={connector.at.y} x2={connector.end.x} y2={connector.end.y}
      stroke={style.color} strokeWidth={selected ? 4 : 2.5} vectorEffect="non-scaling-stroke" strokeDasharray={connector.select ? undefined : '6 4'} />}
    {!connector.end && connector.direction && <line x1={connector.at.x} y1={connector.at.y}
      x2={connector.at.x + connector.direction.x * arrow} y2={connector.at.y + connector.direction.y * arrow}
      stroke={style.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
    <Marker shape={style.shape} x={connector.at.x} y={connector.at.y} size={size} color={style.color} />
  </g>;
}

function ViewSvg({ view, label, caption, colors, selection, onSelect }: {
  view: PartView; label: string; caption: string; colors: ReadonlyMap<string, string>;
  selection: DesignerSelection | undefined; onSelect?: (selection: DesignerSelection) => void;
}) {
  const { x, y, width, height } = view.viewBox;
  const unit = Math.max(width, height) * 0.011;
  return <figure className="designer-view">
    <figcaption><strong>{label}</strong> <span>{caption}</span>
      <span className="designer-view-size" data-testid={`designer-view-size-${view.id}`}>
        {view.size.width || view.size.height ? `${formatNumber(Math.round(view.size.width))} × ${formatNumber(Math.round(view.size.height))} mm` : '–'}
      </span>
    </figcaption>
    <svg viewBox={`${x} ${y} ${width} ${height}`} role="img" aria-label={label} data-testid={`designer-view-${view.id}`} preserveAspectRatio="xMidYMid meet">
      {view.shapes.map(shape => {
        const selected = sameSelection(shape.select, selection);
        return <path key={shape.solid} d={shape.d} fillRule="evenodd" data-solid={shape.solid}
          className={selected ? 'view-solid selected' : 'view-solid'}
          fill={colors.get(shape.material) ?? '#c9cfd2'}
          onClick={onSelect ? event => { event.stopPropagation(); onSelect(shape.select); } : undefined}>
          <title>{shape.solid}</title>
        </path>;
      })}
      {view.connectors.map(connector => <ConnectorMark key={connector.id} connector={connector} unit={unit}
        selected={sameSelection(connector.select, selection)} onSelect={onSelect} />)}
    </svg>
  </figure>;
}

/** Draufsicht, Vorderansicht and Seitenansicht of the resolved part; clicking a body selects it. */
export function PartViewsSvg({ resolved, materials, selection, onSelect }: {
  resolved: Pick<ResolvedPart, 'solids' | 'connectors'> | undefined;
  materials: readonly PartMaterial[];
  selection: DesignerSelection | undefined;
  onSelect?: (selection: DesignerSelection) => void;
}) {
  const views = useMemo(() => resolved ? PART_VIEWS.map(view => ({ ...view, view: buildPartView(view.id, resolved) })) : [], [resolved]);
  const colors = useMemo(() => new Map(materials.map(material => [material.key, material.color])), [materials]);
  const kinds = useMemo(() => [...new Set(resolved?.connectors.map(connector => connector.kind) ?? [])], [resolved]);
  return <div className="designer-views">
    <div className="designer-view-grid">
      {views.map(item => <ViewSvg key={item.id} view={item.view} label={item.label} caption={item.caption} colors={colors} selection={selection} onSelect={onSelect} />)}
    </div>
    {kinds.length > 0 && <ul className="designer-connector-legend" aria-label="Verbinderarten">
      {kinds.map(kind => {
        const style = connectorStyle(kind);
        return <li key={kind}><svg viewBox="-10 -10 20 20" aria-hidden="true"><Marker shape={style.shape} x={0} y={0} size={6} color={style.color} /></svg>{connectorKindLabel(kind)}</li>;
      })}
    </ul>}
  </div>;
}
