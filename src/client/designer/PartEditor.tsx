import { useId, type ReactNode } from 'react';
import type { PartChild, PartDefinition, PartMaterial } from '../../shared/parts/definition.js';
import type { Handle } from '../../shared/parts/handles.js';
import { hasErrors, type PartIssue } from '../../shared/parts/issues.js';
import type { PartSummary } from '../../shared/parts/catalog.js';
import type { ResolvedPart } from '../../shared/parts/resolve.js';
import { AttributesPanel } from './AttributesPanel.js';
import { BodyList } from './BodyList.js';
import { CutListPanel, IssueList } from './CutListPanel.js';
import { OptionsPanel } from './OptionsPanel.js';
import { PartViewsSvg } from './PartViewsSvg.js';
import { selectionOfIssue, type DesignerSelection } from './draft.js';

export const INSPECTOR_TABS = [
  { id: 'options', label: 'Optionen' },
  { id: 'attributes', label: 'Attribute' },
  { id: 'outline', label: 'Gliederung' },
  { id: 'views', label: 'Ansichten' },
  { id: 'cutlist', label: 'Zuschnitt' },
  { id: 'issues', label: 'Prüfung' },
] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number]['id'];

export type PartEditorProps = {
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  definition: PartDefinition;
  onChange: (definition: PartDefinition, select?: DesignerSelection) => void;
  resolved: ResolvedPart | undefined;
  issues: readonly PartIssue[];
  materials: readonly PartMaterial[];
  disabled: boolean;
  selection: DesignerSelection | undefined;
  onSelect: (selection: DesignerSelection | undefined) => void;
  library: readonly PartSummary[];
  childDefinition: (child: PartChild) => PartDefinition | undefined;
  onUpgradeChild: (key: string, partId: string) => void;
  onAddChild: (partId: string) => void;
  previewVariant: string | undefined;
  onPreviewVariant: (variant: string) => void;
  previewValues: Readonly<Record<string, number>>;
  onPreviewValue: (key: string, value: number | undefined) => void;
  favourite: boolean | undefined;
  onFavourite: ((favourite: boolean) => void) | undefined;
  promote: Handle | undefined;
  onPromote: (handle: Handle) => void;
  onPromoteField: (selection: DesignerSelection, path: (string | number)[], label: string) => void;
  onDismissPromote: () => void;
  /** Grouping actions for the Gliederung tab. */
  grouping: ReactNode;
};

/**
 * Right-hand tabs. Inactive panels stay mounted and hidden, so their fields keep their text and
 * the cut list and issues stay readable for checks.
 */
export function PartEditor(props: PartEditorProps) {
  const { tab, onTab, definition, onChange, resolved, issues, materials, disabled, selection, onSelect } = props;
  const id = useId();
  const errorCount = issues.filter(item => item.severity === 'error').length;
  const panel = (name: InspectorTab, children: ReactNode, testId?: string) =>
    <div role="tabpanel" id={`${id}-${name}`} aria-labelledby={`${id}-${name}-tab`} hidden={tab !== name} className="inspector-panel" data-testid={testId}>
      {children}
    </div>;
  return <div className="designer-inspector" data-testid="designer-inspector">
    <div role="tablist" aria-label="Bauteil bearbeiten" className="inspector-tabs">
      {INSPECTOR_TABS.map(item => <button key={item.id} type="button" role="tab" id={`${id}-${item.id}-tab`} aria-controls={`${id}-${item.id}`}
        aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} data-testid={`designer-tab-${item.id}`}
        className={tab === item.id ? 'inspector-tab active' : 'inspector-tab'} onClick={() => onTab(item.id)}
        onKeyDown={event => {
          const index = INSPECTOR_TABS.findIndex(entry => entry.id === tab);
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
          if (!step) return;
          event.preventDefault();
          const next = INSPECTOR_TABS[(index + step + INSPECTOR_TABS.length) % INSPECTOR_TABS.length]!.id;
          onTab(next);
          document.getElementById(`${id}-${next}-tab`)?.focus();
        }}>
        {item.label}{item.id === 'issues' && errorCount > 0 && <span className="tab-badge" aria-label={`${errorCount} Fehler`}>{errorCount}</span>}
      </button>)}
    </div>
    {panel('options', <OptionsPanel definition={definition} onChange={onChange} issues={issues} disabled={disabled}
      previewVariant={props.previewVariant} onPreviewVariant={props.onPreviewVariant} favourite={props.favourite} onFavourite={props.onFavourite} />,
    'designer-section-measures')}
    {panel('attributes', <AttributesPanel definition={definition} onChange={onChange} resolved={resolved} issues={issues} materials={materials}
      disabled={disabled} selection={selection} library={props.library} childDefinition={props.childDefinition} onUpgradeChild={props.onUpgradeChild}
      previewValues={props.previewValues} onPreviewValue={props.onPreviewValue}
      promote={props.promote} onPromote={props.onPromote} onPromoteField={props.onPromoteField} onDismissPromote={props.onDismissPromote} />)}
    {panel('outline', tab === 'outline' ? <>
      {props.grouping}
      <BodyList definition={definition} onChange={onChange} selection={selection} onSelect={onSelect} materials={materials}
        library={props.library} onAddChild={props.onAddChild} disabled={disabled} />
    </> : null, 'designer-section-outline')}
    {panel('views', <PartViewsSvg resolved={resolved} materials={materials} selection={selection} onSelect={onSelect} />, 'designer-section-views')}
    {panel('cutlist', <CutListPanel resolved={resolved} materials={materials} />, 'designer-section-cutlist')}
    {panel('issues', <>
      {!hasErrors(issues) && !issues.length && <p className="muted">Keine Hinweise.</p>}
      <IssueList issues={issues} onSelect={index => {
        const target = issues[index] && selectionOfIssue(issues[index], definition);
        if (target) onSelect(target);
      }} />
    </>, 'designer-section-issues')}
  </div>;
}
