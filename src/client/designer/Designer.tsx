import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Me } from '../../shared/contracts.js';
import { can } from '../../shared/permissions.js';
import type { ImportReport, PartDetail, PartSummary } from '../../shared/parts/catalog.js';
import { canonicalJson } from '../../shared/parts/catalogPlans.js';
import {
  BODY_MATERIAL_KINDS, createPartContext, inlineGroup, partRefKey, type PartChild, type PartDefinition, type PartMaterial, type PartRef,
} from '../../shared/parts/definition.js';
import { bindFieldToParameter, bindMeasureToParameter } from '../../shared/parts/directEdit.js';
import { calculateFormula } from '../../shared/parts/formula.js';
import { explodeChild, makeChildFromBodies, makeGroup } from '../../shared/parts/grouping.js';
import { elementScope, type Handle } from '../../shared/parts/handles.js';
import { hasErrors, type PartIssue } from '../../shared/parts/issues.js';
import type { RigidTransform } from '../../shared/parts/math.js';
import { resolvePartConfiguration, type ResolvedPart, type ResolvedSolid } from '../../shared/parts/resolve.js';
import { definitionDependencies } from '../../shared/parts/sites.js';
import { validateDefinition } from '../../shared/parts/validate.js';
import type { StageBounds } from '../stage/cameraFraming.js';
import { ApiError } from '../api.js';
import { askConfirm } from '../ConfirmDialog.js';
import { catalogIssues, createPart, duplicatePart, getPart, listMaterials, listParts, resolveParts, savePart, setPartFavourite } from '../partsApi.js';
import { writeWorkspaceLocation, type WorkspaceLocation } from '../workspaceRoutes.js';
import { FaceOpeningsSketcher } from './FaceOpeningsSketcher.js';
import { LibrarySidebar } from './LibrarySidebar.js';
import { OpeningInspector } from './OpeningInspector.js';
import { PartEditor, type InspectorTab } from './PartEditor.js';
import { previewBounds } from './PartPreview3D.js';
import { PartViewsSvg } from './PartViewsSvg.js';
import { firstMaterialKey, newChild, newPartDefinition, type DesignerSelection } from './draft.js';
import { childFrame, solidOfChild } from './modelling/childFrame.js';
import { emptyHistory, record, redo, undo, type History } from './modelling/history.js';
import { ModelCanvas, type ModelEdit, type ToolController, type ValueReadout } from './modelling/ModelCanvas.js';
import { ToolRail } from './modelling/ToolRail.js';
import { DRAWING_TOOLS, isTypingTarget, toolForKey, type ModelToolId } from './modelling/tools.js';
import { ValueBox, type ValueBoxHandle } from './modelling/ValueBox.js';
import './designer.css';

type Phase = { kind: 'idle' } | { kind: 'loading' } | { kind: 'missing'; partId: string } | { kind: 'failed'; message: string };
type SaveState =
  | { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; revision: number }
  | { kind: 'invalid' } | { kind: 'conflict'; message: string } | { kind: 'failed'; message: string };

/** A child part opened inside its parent. Leaving saves a new revision of the child. */
type InPlace = {
  key: string;
  /** Absent while a Gruppe is edited: it is stored on the parent, not in the library. */
  detail?: PartDetail;
  original: PartDefinition;
  draft: PartDefinition;
  frame: RigidTransform;
  variant: string | undefined;
  values: Record<string, number>;
  parentHistory: History<PartDefinition>;
  parentSelection: DesignerSelection | undefined;
};

/** Only the live check runs while typing; saving checks every combination. */
const LIVE_CHECK = { maxCombinationsPerVariant: 8, maxCombinations: 48 } as const;
const MAX_CHILD_DEPTH = 8;
const VIEW_TOOLS: readonly ModelToolId[] = ['select', 'tape', 'interact'];
const EMPTY_FRAME: StageBounds = { min: [-1, 0, -1], max: [1, 1, 1] };

const childRefs = (definition: PartDefinition): PartRef[] => (definition.children ?? []).flatMap(child => {
  const nested = inlineGroup(child);
  return child.part ? [child.part, ...(nested ? childRefs(nested) : [])] : nested ? childRefs(nested) : [];
});
const message = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;

/** Loads the definitions every child reference of `definition` needs, level by level. */
async function loadChildClosure(workspaceId: string, roots: readonly PartDefinition[], known: ReadonlyMap<string, PartDefinition>): Promise<Map<string, PartDefinition>> {
  const loaded = new Map(known);
  let frontier = roots.flatMap(childRefs);
  for (let depth = 0; depth < MAX_CHILD_DEPTH; depth++) {
    const wanted = [...new Map(frontier.filter(ref => !loaded.has(partRefKey(ref))).map(ref => [partRefKey(ref), ref])).values()];
    if (!wanted.length) break;
    const { definitions } = await resolveParts(workspaceId, wanted);
    for (const definition of definitions) loaded.set(partRefKey(definition), definition);
    frontier = definitions.flatMap(childRefs);
  }
  return loaded;
}

type Live = { issues: PartIssue[]; resolved: ResolvedPart | undefined };

function liveCheck(definition: PartDefinition, context: ReturnType<typeof createPartContext>, variant: string | undefined, values: Readonly<Record<string, number>>): Live {
  const check = validateDefinition(definition, context, LIVE_CHECK);
  if (!check.definition) return { issues: check.issues, resolved: undefined };
  const parsed = check.definition;
  const useVariant = parsed.variants?.some(item => item.key === variant) ? variant : parsed.variants?.[0]?.key;
  const free = Object.fromEntries(Object.entries(values).filter(([key]) =>
    parsed.parameters.some(parameter => parameter.key === key && (!parsed.variants?.length || parameter.scope !== 'variant'))));
  try {
    const resolved = resolvePartConfiguration(parsed, { variant: useVariant, values: free }, context);
    const known = new Set(check.issues.map(item => item.message));
    const adjusted = resolved.issues.filter(item => item.code === 'value-adjusted' && !known.has(item.message));
    return { issues: [...check.issues, ...adjusted], resolved };
  } catch (cause) {
    return { issues: [...check.issues, { severity: 'error', code: 'formula', message: message(cause, 'Die Vorschau konnte nicht berechnet werden.') }], resolved: undefined };
  }
}

/** Parameters whose default or variant values differ, so that preview overrides of them stop hiding the edit. */
function changedParameters(before: PartDefinition, after: PartDefinition): string[] {
  const changed: string[] = [];
  for (const parameter of after.parameters) {
    const old = before.parameters.find(item => item.key === parameter.key);
    const variantsDiffer = (before.variants ?? []).some(variant => {
      const next = after.variants?.find(item => item.key === variant.key);
      return next?.values[parameter.key] !== variant.values[parameter.key];
    });
    if (!old || old.default !== parameter.default || variantsDiffer) changed.push(parameter.key);
  }
  return changed;
}

function frameOf(resolved: ResolvedPart | undefined): StageBounds {
  return resolved?.solids.length ? previewBounds(resolved) : EMPTY_FRAME;
}

/** Bühnentechnik-Designer: parametric parts of the workspace library, modelled directly with live preview. */
export function Designer({ me, onDirty, partId }: { me: Me; onDirty: (dirty: boolean) => void; partId: string | undefined }) {
  const workspaceId = me.workspace.id;
  const readOnly = !can(me.workspace.role, 'parts');
  const [parts, setParts] = useState<PartSummary[]>([]);
  const [materials, setMaterials] = useState<PartMaterial[]>([]);
  const [libraryError, setLibraryError] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [saved, setSaved] = useState<PartDetail>();
  const [draft, setDraft] = useState<PartDefinition>();
  const [isNew, setIsNew] = useState(false);
  const [childDefinitions, setChildDefinitions] = useState<ReadonlyMap<string, PartDefinition>>(new Map());
  const [selection, setSelection] = useState<DesignerSelection>();
  const [multi, setMulti] = useState<string[]>([]);
  const [openingKey, setOpeningKey] = useState<string>();
  const [previewVariant, setPreviewVariant] = useState<string>();
  const [previewValues, setPreviewValues] = useState<Record<string, number>>({});
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [saveIssues, setSaveIssues] = useState<PartIssue[]>();
  const [busy, setBusy] = useState('');
  const [tool, setTool] = useState<ModelToolId>('select');
  const [tab, setTab] = useState<InspectorTab>('options');
  const [history, setHistory] = useState<History<PartDefinition>>(emptyHistory);
  const [readout, setReadout] = useState<ValueReadout>();
  const [modelStatus, setModelStatus] = useState<string>();
  const [promote, setPromote] = useState<Handle>();
  const [frame, setFrame] = useState<{ bounds: StageBounds; revision: number; fitted: boolean }>({ bounds: EMPTY_FRAME, revision: 0, fitted: false });
  const [inPlace, setInPlace] = useState<InPlace>();
  const loadToken = useRef(0);
  const pendingNew = useRef<PartDefinition | undefined>(undefined);
  const lastResolved = useRef<ResolvedPart | undefined>(undefined);
  const lastChildResolved = useRef<ResolvedPart | undefined>(undefined);
  const gestureStart = useRef<PartDefinition | undefined>(undefined);
  const controller = useRef<ToolController | null>(null);
  const valueBox = useRef<ValueBoxHandle>(null);

  const refreshLibrary = useCallback(async () => {
    try {
      const [summaries, stock] = await Promise.all([listParts(workspaceId, { includeArchived: true }), listMaterials(workspaceId)]);
      setParts(summaries); setMaterials(stock); setLibraryError('');
    } catch (error) { setLibraryError(message(error, 'Die Bauteilbibliothek konnte nicht geladen werden.')); }
  }, [workspaceId]);
  useEffect(() => { void refreshLibrary(); }, [refreshLibrary]);

  const startEditing = useCallback((definition: PartDefinition, detail: PartDetail | undefined, children: ReadonlyMap<string, PartDefinition>) => {
    lastResolved.current = undefined;
    gestureStart.current = undefined;
    setSaved(detail); setDraft(definition); setIsNew(!detail); setChildDefinitions(children);
    setSelection(definition.bodies[0] ? { kind: 'body', key: definition.bodies[0].key } : undefined);
    setMulti([]); setOpeningKey(undefined); setInPlace(undefined); setPromote(undefined);
    setPreviewVariant(definition.variants?.[0]?.key); setPreviewValues({});
    setSaveState({ kind: 'idle' }); setSaveIssues(undefined);
    setHistory(emptyHistory()); setModelStatus(undefined);
    setFrame(current => ({ ...current, fitted: false }));
  }, []);

  const load = useCallback(async (id: string) => {
    const token = ++loadToken.current;
    setPhase({ kind: 'loading' });
    try {
      const detail = await getPart(workspaceId, id);
      const children = await loadChildClosure(workspaceId, [detail.definition], new Map());
      if (token !== loadToken.current) return;
      startEditing(detail.definition, detail, children);
      setPhase({ kind: 'idle' });
    } catch (error) {
      if (token !== loadToken.current) return;
      setSaved(undefined); setDraft(undefined); setIsNew(false);
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) setPhase({ kind: 'missing', partId: id });
      else setPhase({ kind: 'failed', message: message(error, 'Das Bauteil konnte nicht geladen werden.') });
    }
  }, [workspaceId, startEditing]);

  useEffect(() => {
    if (!partId) {
      loadToken.current++;
      setPhase({ kind: 'idle' });
      const fresh = pendingNew.current;
      pendingNew.current = undefined;
      if (fresh) startEditing(fresh, undefined, new Map());
      else if (!isNew) { setDraft(undefined); setSaved(undefined); }
      return;
    }
    if (saved?.id === partId && draft?.id === partId) return;
    void load(partId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partId]);

  const childDirty = !!inPlace && canonicalJson(inPlace.draft) !== canonicalJson(inPlace.original);
  const dirty = !!draft && (isNew || !saved || childDirty || canonicalJson(draft) !== canonicalJson(saved.definition));
  useEffect(() => { onDirty(dirty && !readOnly); }, [dirty, readOnly, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    if (!dirty || readOnly) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, readOnly]);

  const context = useMemo(() => createPartContext({ materials, parts: [...childDefinitions.values()] }), [materials, childDefinitions]);
  const deferredDraft = useDeferredValue(draft);
  const deferredVariant = useDeferredValue(previewVariant);
  const deferredValues = useDeferredValue(previewValues);
  const deferredChild = useDeferredValue(inPlace?.draft);
  const inPlaceContext = useMemo(() => deferredChild
    ? createPartContext({ materials, parts: [...childDefinitions.values(), deferredChild] })
    : undefined, [materials, childDefinitions, deferredChild]);
  const live = useMemo(() => deferredDraft && materials.length
    ? liveCheck(deferredDraft, inPlaceContext ?? context, deferredVariant, deferredValues) : undefined,
  [deferredDraft, context, inPlaceContext, deferredVariant, deferredValues, materials.length]);
  if (live?.resolved) lastResolved.current = live.resolved;
  const resolved = live?.resolved ?? lastResolved.current;
  const childLive = useMemo(() => inPlace && deferredChild && materials.length
    ? liveCheck(deferredChild, context, inPlace.variant, inPlace.values) : undefined,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [deferredChild, context, inPlace?.variant, inPlace?.values, materials.length]);
  if (childLive?.resolved) lastChildResolved.current = childLive.resolved;

  /** The definition the canvas and the tabs edit: the open part, or the child opened in place. */
  const model = inPlace?.draft ?? draft;
  const modelResolved = inPlace ? childLive?.resolved ?? lastChildResolved.current : resolved;
  const modelLive = inPlace ? childLive : live;
  const issues = inPlace ? childLive?.issues ?? [] : saveIssues ?? live?.issues ?? [];
  const stale = deferredDraft !== draft || (!!inPlace && deferredChild !== inPlace.draft);
  const blocking = hasErrors(live?.issues ?? []);
  const effectiveTool: ModelToolId = readOnly && !VIEW_TOOLS.includes(tool) ? 'select' : tool;

  useEffect(() => {
    if (frame.fitted || !resolved || inPlace) return;
    setFrame(current => ({ bounds: frameOf(resolved), revision: current.revision + 1, fitted: true }));
  }, [resolved, frame.fitted, inPlace]);
  function fit() {
    setFrame(current => ({ bounds: frameOf(resolved), revision: current.revision + 1, fitted: true }));
  }

  const sketchBody = selection?.kind === 'body' ? model?.bodies.find(body => body.key === selection.key) : undefined;
  const sketchBodyKey = sketchBody?.kind === 'sheet' ? sketchBody.key : undefined;
  useEffect(() => { setOpeningKey(undefined); }, [sketchBodyKey]);

  /** Shows `next` without an undo step: gesture previews and history moves. */
  function applyModel(next: PartDefinition) {
    if (inPlace) setInPlace(current => current && { ...current, draft: next });
    else setDraft(next);
    setSaveIssues(undefined);
    if (saveState.kind === 'saved' || saveState.kind === 'invalid') setSaveState({ kind: 'idle' });
  }

  /** One undo step: `before` (default: the model now) becomes undoable, `next` is shown. */
  function commitModel(next: PartDefinition, options: { before?: PartDefinition; tag?: string; select?: DesignerSelection } = {}) {
    if (readOnly || !model) return;
    const before = options.before ?? model;
    if (next === before) return;
    setHistory(current => record(current, before, options.tag));
    applyModel(next);
    const stalePreview = changedParameters(before, next);
    if (stalePreview.length) setPreviewValues(current => {
      const kept = { ...current };
      for (const key of stalePreview) delete kept[key];
      return kept;
    });
    if (options.select) { setSelection(options.select); setMulti([]); }
  }

  function change(next: PartDefinition, select?: DesignerSelection) {
    commitModel(next, { tag: 'panel', select });
  }

  function stepHistory(direction: 'undo' | 'redo') {
    if (readOnly || !model) return;
    const step = (direction === 'undo' ? undo : redo)(history, model);
    if (!step) return;
    gestureStart.current = undefined;
    setHistory(step.history);
    applyModel(step.value);
    setModelStatus(direction === 'undo' ? 'Rückgängig gemacht.' : 'Wiederholt.');
  }

  function onPreview(next: PartDefinition) {
    if (readOnly || !model) return;
    gestureStart.current ??= model;
    applyModel(next);
  }
  function onCommit(edit: ModelEdit, amend: boolean) {
    const before = gestureStart.current;
    gestureStart.current = undefined;
    if (amend) {
      applyModel(edit.definition);
      if (edit.select) setSelection(edit.select);
    } else commitModel(edit.definition, { before, select: edit.select });
    setModelStatus(edit.label);
  }
  function onCancel() {
    if (gestureStart.current) applyModel(gestureStart.current);
    gestureStart.current = undefined;
  }

  function remember(next: DesignerSelection) {
    const key = next.kind === 'body' || next.kind === 'child' ? next.key : undefined;
    if (!key) return;
    setMulti(current => current.includes(key) ? current : [...current, key]);
  }
  function select(next: DesignerSelection | undefined, mode: 'replace' | 'add' | 'toggle' = 'replace') {
    if ((mode === 'add' || mode === 'toggle') && next && (next.kind === 'body' || next.kind === 'child')) {
      if (!selection) { setSelection(next); return; }
      const key = next.key;
      const selectedKey = selection.kind === 'body' || selection.kind === 'child' ? selection.key : undefined;
      if (mode === 'toggle' && selectedKey && (selectedKey === key || multi.includes(key))) {
        if (selectedKey === key) {
          const [first, ...rest] = multi;
          setSelection(first ? { kind: draft?.children?.some(child => child.key === first) ? 'child' : 'body', key: first } : undefined);
          setMulti(rest);
        } else setMulti(current => current.filter(item => item !== key));
        return;
      }
      remember(selection.kind === 'body' || selection.kind === 'child' ? selection : next);
      if (selectedKey !== key && !multi.includes(key)) setMulti(current => [...current, key]);
      return;
    }
    setSelection(next);
    setMulti([]);
  }
  function selectMany(keys: string[]) {
    const [first, ...rest] = keys;
    if (!first || !draft) { setSelection(undefined); setMulti([]); return; }
    const kind = draft.children?.some(child => child.key === first) ? 'child' as const : 'body' as const;
    setSelection({ kind, key: first });
    setMulti(rest);
  }

  function promoteHandle(handle: Handle) {
    if (!model || !modelResolved) return;
    const result = bindMeasureToParameter(model, modelResolved, handle);
    if (!result.ok) { setModelStatus(result.message); return; }
    commitModel(result.definition);
    setPromote(undefined);
    setModelStatus(`„${handle.measure?.label}“ ist jetzt die Option ${result.parameter}.`);
    setTab('options');
  }
  function promoteField(target: DesignerSelection, path: (string | number)[], label: string) {
    if (!model || !modelResolved || (target.kind !== 'body' && target.kind !== 'child')) return;
    const result = bindFieldToParameter(model, modelResolved, target.kind === 'body' ? { body: target.key } : { child: target.key }, path, label);
    if (!result.ok) { setModelStatus(result.message); return; }
    commitModel(result.definition);
    setModelStatus(`„${label}“ ist jetzt die Option ${result.parameter}.`);
  }

  function interact(solid: ResolvedSolid) {
    if (!model || !modelResolved) return;
    const states = model.parameters.filter(parameter => parameter.scope === 'state');
    if (!states.length) { setModelStatus('Dieses Bauteil hat keine Zustände zum Ausprobieren.'); return; }
    const owner = solid.path.length ? `child:${solid.path[0]!.replace(/\[.*$/, '')}` : `body:${solid.body}`;
    const reads = definitionDependencies(model).get(owner) ?? [];
    const parameter = states.find(item => reads.includes(item.key)) ?? states[0]!;
    const current = previewValues[parameter.key] ?? modelResolved.values[parameter.key] ?? parameter.default;
    let next: number;
    if (parameter.type === 'toggle') next = current ? 0 : 1;
    else if (parameter.values?.length) next = parameter.values[(parameter.values.indexOf(current) + 1) % parameter.values.length]!;
    else if (parameter.range) next = current >= parameter.range.max ? parameter.range.min : parameter.range.max;
    else next = current ? 0 : 1;
    setPreviewValues(values => ({ ...values, [parameter.key]: next }));
    const shown = parameter.type === 'toggle' ? (parameter.valueLabels ?? ['Nein', 'Ja'])[next] : String(next);
    setModelStatus(`${parameter.label || parameter.key}: ${shown} (nur Vorschau)`);
  }

  const groupKeys = [...new Set([
    ...(selection?.kind === 'body' || selection?.kind === 'child' ? [selection.key] : []),
    ...multi,
  ])];
  async function makeChild() {
    if (readOnly || inPlace || !draft || !resolved || !groupKeys.length) return;
    const name = `${draft.name || 'Bauteil'} · Unterbauteil`;
    const bodyKeys = groupKeys.filter(key => draft.bodies.some(body => body.key === key));
    const result = makeChildFromBodies(draft, resolved, bodyKeys, { id: crypto.randomUUID(), name });
    if (!result.ok) { setModelStatus(result.message); return; }
    setBusy('Unterbauteil wird angelegt …');
    try {
      const created = await createPart(workspaceId, { ...result.child, category: draft.category });
      const ref = { id: created.id, revision: created.definition.revision };
      const parent: PartDefinition = {
        ...result.parent,
        children: (result.parent.children ?? []).map(child => child.key === result.childKey ? { ...child, part: ref } : child),
      };
      setChildDefinitions(current => new Map([...current, [partRefKey(created.definition), created.definition]]));
      commitModel(parent, { select: { kind: 'child', key: result.childKey } });
      setModelStatus(`„${created.definition.name}“ als Revision ${created.definition.revision} angelegt. Doppelklick öffnet es.`);
      void refreshLibrary();
    } catch (error) {
      setModelStatus(message(error, 'Das Unterbauteil konnte nicht angelegt werden.'));
    } finally { setBusy(''); }
  }
  function groupSelection() {
    if (readOnly || inPlace || !draft || !resolved || !groupKeys.length) return;
    const name = 'Gruppe';
    const result = makeGroup(draft, resolved, groupKeys, { id: crypto.randomUUID(), name });
    if (!result.ok) { setModelStatus(result.message); return; }
    commitModel(result.parent, { select: { kind: 'child', key: result.childKey } });
    setModelStatus('Gruppe angelegt. Doppelklick öffnet sie; alles darin bewegt sich mit.');
  }
  function explode(key: string) {
    if (readOnly || inPlace || !draft) return;
    const child = draft.children?.find(item => item.key === key);
    const definition = (child && inlineGroup(child)) ?? (child?.part ? childDefinitions.get(partRefKey(child.part)) : undefined);
    if (!definition) { setModelStatus('Das Unterbauteil ist nicht geladen.'); return; }
    const result = explodeChild(draft, key, definition);
    if (!result.ok) { setModelStatus(result.message); return; }
    commitModel(result.definition, { select: undefined });
    setSelection(undefined);
    setModelStatus(`„${definition.name}“ aufgelöst: seine Körper gehören jetzt zu diesem Bauteil.`);
  }

  async function enterChild(key: string) {
    if (readOnly || inPlace || !draft || !resolved) return;
    const child = draft.children?.find(item => item.key === key);
    const definition = (child && inlineGroup(child)) ?? (child?.part ? childDefinitions.get(partRefKey(child.part)) : undefined);
    const placement = child && childFrame(draft, resolved, key);
    if (!child || !definition || !placement) { setModelStatus('Dieses Unterbauteil lässt sich nicht öffnen.'); return; }
    if (inlineGroup(child)) {
      lastChildResolved.current = undefined;
      gestureStart.current = undefined;
      setInPlace({ key, original: definition, draft: definition, frame: placement, variant: child.variant, values: {}, parentHistory: history, parentSelection: selection });
      setHistory(emptyHistory());
      setSelection(definition.bodies[0] ? { kind: 'body', key: definition.bodies[0].key } : undefined);
      setMulti([]); setPromote(undefined); setTool('select');
      setModelStatus(`Gruppe „${definition.name}“ wird bearbeitet. Schließen übernimmt sie in dieses Bauteil.`);
      return;
    }
    setBusy('Unterbauteil wird geöffnet …');
    try {
      const detail = await getPart(workspaceId, child.part!.id);
      const scope = elementScope(resolved, child, child.repeat ? [0, 0, 0] : []);
      const values: Record<string, number> = {};
      for (const [name, formula] of Object.entries(child.values ?? {})) {
        try { values[name] = calculateFormula(formula, scope); } catch { /* the child's default applies */ }
      }
      lastChildResolved.current = undefined;
      gestureStart.current = undefined;
      setInPlace({ key, detail, original: definition, draft: definition, frame: placement, variant: child.variant, values, parentHistory: history, parentSelection: selection });
      setHistory(emptyHistory());
      setSelection(definition.bodies[0] ? { kind: 'body', key: definition.bodies[0].key } : undefined);
      setMulti([]); setPromote(undefined); setTool('select');
      setModelStatus(`„${definition.name}“ wird bearbeitet. Schließen speichert eine neue Revision.`);
    } catch (error) {
      setModelStatus(message(error, 'Das Unterbauteil konnte nicht geladen werden.'));
    } finally { setBusy(''); }
  }

  function closeInPlace(current: InPlace) {
    setInPlace(undefined);
    setHistory(current.parentHistory);
    setSelection(current.parentSelection ?? { kind: 'child', key: current.key });
    setMulti([]); setPromote(undefined);
    gestureStart.current = undefined;
  }
  async function leaveChild(keep: boolean) {
    if (!inPlace || !draft) return;
    const current = inPlace;
    if (!keep || !childDirty) { closeInPlace(current); setModelStatus(keep ? undefined : 'Änderungen am Unterbauteil verworfen.'); return; }
    const check = validateDefinition(current.draft, context);
    if (!check.ok || !check.definition) {
      setModelStatus('Das Unterbauteil hat Fehler. Bitte zuerst beheben.');
      setTab('issues');
      return;
    }
    if (!current.detail) {
      const next: PartDefinition = {
        ...draft,
        children: (draft.children ?? []).map(child => child.key === current.key ? { ...child, group: check.definition, part: undefined } : child),
      };
      closeInPlace(current);
      setHistory(record(current.parentHistory, draft));
      setDraft(next);
      setSaveIssues(undefined);
      setModelStatus(`Gruppe „${check.definition.name}“ übernommen.`);
      return;
    }
    setBusy('Unterbauteil wird gespeichert …');
    try {
      const detail = await savePart(workspaceId, current.detail.id, current.detail.latestRevision, check.definition);
      const ref = { id: detail.id, revision: detail.definition.revision };
      setChildDefinitions(known => new Map([...known, [partRefKey(detail.definition), detail.definition]]));
      const next: PartDefinition = {
        ...draft,
        children: (draft.children ?? []).map(child =>
          child.part?.id === current.original.id && child.part.revision === current.original.revision ? { ...child, part: ref } : child),
      };
      closeInPlace(current);
      setHistory(record(current.parentHistory, draft));
      setDraft(next);
      setSaveIssues(undefined);
      setModelStatus(`„${detail.definition.name}“ als Revision ${detail.definition.revision} gespeichert; dieses Bauteil verweist jetzt darauf.`);
      void refreshLibrary();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) setModelStatus('Der Server lehnt das Unterbauteil ab: ' + catalogIssues(error).map(item => item.message).join(' '));
      else setModelStatus(message(error, 'Das Unterbauteil konnte nicht gespeichert werden.'));
    } finally { setBusy(''); }
  }

  useEffect(() => {
    if (!model || phase.kind !== 'idle') return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[role="dialog"], [data-testid="designer-face-sketcher"]')) return;
      const typing = isTypingTarget(event.target);
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (command && !event.altKey && (key === 'z' || key === 'y')) {
        if (typing) return;
        event.preventDefault();
        stepHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (!typing && !command && !event.altKey && key === 'g' && !readOnly) {
        event.preventDefault();
        groupSelection();
        return;
      }
      if (typing || command || event.altKey) return;
      if (target?.closest?.('button, a, summary, [role="tab"]') && (event.key === ' ' || event.key === 'Enter')) return;
      const next = toolForKey(event.key);
      if (next) {
        if (readOnly && !VIEW_TOOLS.includes(next)) return;
        event.preventDefault();
        setTool(next);
        return;
      }
      if (/^[0-9.,;-]$/.test(event.key) && DRAWING_TOOLS.includes(effectiveTool) && !readOnly) {
        event.preventDefault();
        valueBox.current?.type(event.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function confirmLeave(): Promise<boolean> {
    if (!dirty || readOnly) return true;
    return askConfirm({
      title: 'Änderungen verwerfen?', message: 'Das geöffnete Bauteil hat nicht gespeicherte Änderungen. Verwerfen und fortfahren?',
      confirmLabel: 'Verwerfen', cancelLabel: 'Abbrechen', danger: true,
    });
  }
  function go(location: WorkspaceLocation) {
    flushSync(() => onDirty(false));
    writeWorkspaceLocation(location);
  }
  async function open(id: string) {
    if (id === partId && !isNew) return;
    if (!(await confirmLeave())) return;
    go({ section: 'designer', partId: id });
  }
  async function createNew() {
    if (!(await confirmLeave())) return;
    const fresh = newPartDefinition(crypto.randomUUID(), materials);
    if (partId) { pendingNew.current = fresh; go({ section: 'designer' }); }
    else startEditing(fresh, undefined, new Map());
  }
  async function duplicate(id: string) {
    if (!(await confirmLeave())) return;
    setBusy('Kopie wird angelegt …');
    try {
      const copy = await duplicatePart(workspaceId, id);
      await refreshLibrary();
      go({ section: 'designer', partId: copy.id });
    } catch (error) { setSaveState({ kind: 'failed', message: message(error, 'Die Kopie konnte nicht angelegt werden.') }); }
    finally { setBusy(''); }
  }
  async function addChild(id: string) {
    if (!model) return;
    try {
      const detail = await getPart(workspaceId, id);
      const children = await loadChildClosure(workspaceId, [detail.definition], new Map([...childDefinitions, [partRefKey(detail.definition), detail.definition]]));
      setChildDefinitions(children);
      const child = newChild(model, detail.definition);
      commitModel({ ...model, children: [...(model.children ?? []), child] }, { select: { kind: 'child', key: child.key } });
    } catch (error) { setSaveState({ kind: 'failed', message: message(error, 'Das Unterbauteil konnte nicht geladen werden.') }); }
  }
  async function upgradeChild(key: string, id: string) {
    if (!model) return;
    try {
      const detail = await getPart(workspaceId, id);
      const children = await loadChildClosure(workspaceId, [detail.definition], new Map([...childDefinitions, [partRefKey(detail.definition), detail.definition]]));
      setChildDefinitions(children);
      commitModel({
        ...model,
        children: (model.children ?? []).map(child => child.key === key ? { ...child, part: { id, revision: detail.definition.revision } } : child),
      });
    } catch (error) { setSaveState({ kind: 'failed', message: message(error, 'Das Unterbauteil konnte nicht geladen werden.') }); }
  }

  async function save() {
    if (!draft || readOnly || inPlace) return;
    const check = validateDefinition(draft, context);
    if (!check.ok || !check.definition) {
      setSaveIssues(check.issues); setSaveState({ kind: 'invalid' });
      return;
    }
    setSaveState({ kind: 'saving' });
    try {
      const detail = isNew || !saved
        ? await createPart(workspaceId, check.definition)
        : await savePart(workspaceId, saved.id, saved.latestRevision, check.definition);
      const wasNew = isNew;
      setSaved(detail); setDraft(detail.definition); setIsNew(false); setSaveIssues(undefined);
      setSaveState({ kind: 'saved', revision: detail.latestRevision });
      void refreshLibrary();
      if (wasNew) go({ section: 'designer', partId: detail.id });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setSaveState({ kind: 'conflict', message: error.message });
      else if (error instanceof ApiError && error.status === 422) {
        setSaveIssues(catalogIssues(error) as PartIssue[]); setSaveState({ kind: 'invalid' });
      } else setSaveState({ kind: 'failed', message: message(error, 'Speichern fehlgeschlagen.') });
    }
  }
  async function discard() {
    if (!draft) return;
    if (!(await confirmLeave())) return;
    if (isNew || !saved) { flushSync(() => onDirty(false)); setDraft(undefined); setIsNew(false); return; }
    startEditing(saved.definition, saved, childDefinitions);
  }
  async function reloadLatest() {
    if (!partId) return;
    if (!(await askConfirm({
      title: 'Neueste Revision laden?', message: 'Ihre nicht gespeicherten Änderungen gehen verloren.',
      confirmLabel: 'Neu laden', cancelLabel: 'Abbrechen', danger: true,
    }))) return;
    flushSync(() => onDirty(false));
    setSaved(undefined);
    await load(partId);
  }
  function imported(report: ImportReport) {
    if (partId && !dirty && report.revised.some(item => item.id === partId)) {
      setSaved(undefined);
      void load(partId);
    }
  }
  async function toggleFavourite(favourite: boolean) {
    if (!saved) return;
    try { await setPartFavourite(workspaceId, saved.id, favourite); await refreshLibrary(); }
    catch (error) { setSaveState({ kind: 'failed', message: message(error, 'Favorit konnte nicht gesetzt werden.') }); }
  }
  const childDefinition = useCallback((child: PartChild) => inlineGroup(child) ?? (child.part ? childDefinitions.get(partRefKey(child.part)) : undefined), [childDefinitions]);
  const summary = saved ? parts.find(part => part.id === saved.id) : undefined;
  const defaultMaterials = useMemo(() => ({
    box: firstMaterialKey(materials.filter(item => BODY_MATERIAL_KINDS.box.includes(item.kind)), 'hardware', 'gummifuss-50'),
    sheet: firstMaterialKey(materials, 'sheet', 'sperrholz-12'),
    beam: firstMaterialKey(materials, 'profile', 'latte-40x40'),
  }), [materials]);
  const surrounding = useMemo(() => inPlace && resolved ? { resolved, hide: solidOfChild(inPlace.key) } : undefined, [inPlace?.key, resolved]);

  const statusText = (() => {
    if (busy) return busy;
    switch (saveState.kind) {
      case 'saving': return 'Wird gespeichert …';
      case 'saved': return `Gespeichert als Revision ${saveState.revision}.`;
      case 'invalid': return 'Nicht gespeichert: Bitte die markierten Fehler beheben.';
      case 'conflict': return saveState.message;
      case 'failed': return saveState.message;
      default: return isNew ? 'Neues Bauteil, noch nicht gespeichert.' : dirty ? 'Ungespeicherte Änderungen.' : saved ? `Revision ${saved.latestRevision}` : '';
    }
  })();

  const selectedChild = !inPlace && selection?.kind === 'child' ? selection.key : undefined;
  const grouping = !readOnly && model && <div className="designer-grouping" data-testid="designer-grouping">
    <button type="button" className="quiet" disabled={!!inPlace || !groupKeys.length || !!busy} data-testid="designer-make-group"
      title="Die Auswahl wird eine Gruppe. Alles darin bewegt und dreht sich mit, auch ein Griff an einer Tür." onClick={groupSelection}>
      Gruppe{groupKeys.length > 1 ? ` (${groupKeys.length})` : ''}
    </button>
    <button type="button" className="quiet" disabled={!!inPlace || !groupKeys.length || !!busy} data-testid="designer-make-child"
      title="Die ausgewählten Körper werden ein wiederverwendbares Bauteil der Bibliothek." onClick={() => void makeChild()}>
      In die Bibliothek{groupKeys.length > 1 ? ` (${groupKeys.length})` : ''}
    </button>
    <button type="button" className="quiet" disabled={!selectedChild} data-testid="designer-enter-child"
      onClick={() => selectedChild && void enterChild(selectedChild)}>Unterbauteil bearbeiten</button>
    <button type="button" className="quiet" disabled={!selectedChild} data-testid="designer-explode-child"
      onClick={() => selectedChild && explode(selectedChild)}>Auflösen</button>
  </div>;

  return <section className="plans designer-page" aria-label="Bühnentechnik" data-testid="designer-page">
    <div className="section-heading">
      <div>
        <h2>Bühnentechnik</h2>
        <p className="muted">Bauteile direkt im 3D-Fenster modellieren. Maße, die sich ändern dürfen, werden Optionen. Gespeicherte Revisionen bleiben unverändert.</p>
      </div>
    </div>
    {readOnly && <p className="designer-readonly" role="note" data-testid="designer-readonly">Nur Ansicht: Mit Ihrer Rolle können Sie Bauteile ansehen, aber nicht ändern.</p>}
    {libraryError && <p className="error" role="alert">{libraryError}</p>}
    <div className="designer-layout">
      <div className="designer-left">
        <LibrarySidebar workspaceId={workspaceId} parts={parts} currentId={isNew ? undefined : saved?.id} readOnly={readOnly}
          onOpen={id => void open(id)} onNew={() => void createNew()} onDuplicate={id => void duplicate(id)}
          onChanged={() => void refreshLibrary()} onImported={imported} />
      </div>
      <div className="designer-centre">
        {phase.kind === 'loading' && <p className="muted" role="status">Bauteil wird geladen …</p>}
        {phase.kind === 'missing' && <div className="designer-missing" role="alert" data-testid="designer-missing">
          <h3>Bauteil nicht gefunden</h3>
          <p>Dieses Bauteil gibt es in diesem Arbeitsbereich nicht (mehr).</p>
          <a href="#/designer">Zur Bauteilbibliothek</a>
        </div>}
        {phase.kind === 'failed' && <div className="designer-missing" role="alert">
          <p>{phase.message}</p>
          {partId && <button type="button" onClick={() => void load(partId)}>Erneut versuchen</button>}
        </div>}
        {phase.kind === 'idle' && !draft && <div className="designer-empty" data-testid="designer-empty">
          <h3>Kein Bauteil geöffnet</h3>
          <p className="muted">Links ein Bauteil der Bibliothek öffnen{readOnly ? '.' : ', ein neues anlegen oder ein Beispiel als Kopie übernehmen.'}</p>
        </div>}
        {phase.kind === 'idle' && draft && model && <>
          <div className="designer-savebar" data-testid="designer-savebar">
            <div className="designer-title">
              <strong data-testid="designer-title">{draft.name || 'Ohne Namen'}</strong>
              <span className="muted-inline">{isNew ? 'Neu' : `Revision ${saved?.latestRevision ?? draft.revision}`}{dirty ? ' · geändert' : ''}</span>
            </div>
            <p className={saveState.kind === 'failed' || saveState.kind === 'conflict' || saveState.kind === 'invalid' ? 'designer-status error-text' : 'designer-status'}
              role="status" data-testid="designer-status">{statusText}{stale ? ' · Vorschau wird berechnet …' : ''}</p>
            {saveState.kind === 'conflict' && <button type="button" onClick={() => void reloadLatest()}>Neu laden</button>}
            {!readOnly && <>
              <button type="button" className="quiet" disabled={!dirty || saveState.kind === 'saving'} onClick={() => void discard()}>Verwerfen</button>
              <button type="button" className="primary" data-testid="designer-save" disabled={(!dirty && !isNew) || saveState.kind === 'saving' || blocking || !!inPlace}
                title={inPlace ? 'Erst das Unterbauteil schließen.' : blocking ? 'Fehler verhindern das Speichern.' : undefined} onClick={() => void save()}>Speichern</button>
            </>}
          </div>
          {inPlace && <div className="designer-inplace" role="note" data-testid="designer-inplace">
            <span>Unterbauteil <strong>{inPlace.draft.name}</strong> wird bearbeitet{childDirty ? ' · geändert' : ''}. Der Rest ist abgeblendet.</span>
            <button type="button" className="primary" disabled={!!busy} data-testid="designer-leave-child" onClick={() => void leaveChild(true)}>
              {childDirty ? 'Schließen und als neue Revision speichern' : 'Schließen'}
            </button>
            {childDirty && <button type="button" className="quiet" disabled={!!busy} onClick={() => void leaveChild(false)}>Änderungen verwerfen</button>}
          </div>}
          <div className="designer-model">
            <ToolRail tool={effectiveTool} onTool={setTool} readOnly={readOnly}
              canUndo={history.past.length > 0} canRedo={history.future.length > 0}
              onUndo={() => stepHistory('undo')} onRedo={() => stepHistory('redo')} />
            <div className="designer-model-main">
              <ModelCanvas definition={model} resolved={modelResolved} surrounding={surrounding} frame={inPlace?.frame}
                materials={materials} selection={selection} multi={multi} tool={effectiveTool} readOnly={readOnly}
                frameBounds={frame.bounds} frameRevision={frame.revision} label={`3D-Modell von ${model.name}`} controller={controller}
                onSelect={select} onSelectMany={selectMany} onEnterChild={key => void enterChild(key)} onPreview={onPreview} onCommit={onCommit} onCancel={onCancel}
                onStatus={setModelStatus} onReadout={setReadout}
                onDimension={handle => { setPromote(handle); setSelection({ kind: 'body', key: handle.body }); setMulti([]); setTab('attributes'); }}
                onInteract={interact} defaultMaterials={defaultMaterials} />
              <div className="designer-model-footer">
                <ValueBox ref={valueBox} readout={readout} status={modelStatus} disabled={readOnly}
                  onApply={values => controller.current ? controller.current.applyValue(values) : 'Kein Werkzeug nimmt Maße an.'} />
                <button type="button" className="quiet" data-testid="designer-fit" onClick={fit} title="Ansicht auf das ganze Bauteil einpassen">Einpassen</button>
              </div>
            </div>
          </div>
          {modelLive && !modelLive.resolved && <p className="error-text" role="status">Die Vorschau zeigt den letzten gültigen Stand.</p>}
          {sketchBodyKey && <FaceOpeningsSketcher definition={model} bodyKey={sketchBodyKey} resolved={modelResolved}
            activeVariant={inPlace ? inPlace.variant : previewVariant} materials={materials} disabled={readOnly} onChange={definition => change(definition)}
            selectedKey={openingKey} onSelectOpening={setOpeningKey} />}
          {sketchBodyKey && <section className="designer-opening" data-testid="designer-section-opening" aria-label="Öffnung">
            {openingKey
              ? <OpeningInspector definition={model} bodyKey={sketchBodyKey} holeKey={openingKey}
                activeVariant={previewVariant} disabled={readOnly} onChange={definition => change(definition)} />
              : <p className="muted">Öffnung auf der Fläche anklicken oder neu aufziehen.</p>}
          </section>}
          <PartViewsSvg resolved={modelResolved} materials={materials} selection={selection} onSelect={setSelection} />
        </>}
      </div>
      <div className="designer-right">
        {phase.kind === 'idle' && model && <PartEditor tab={tab} onTab={setTab} definition={model} onChange={change} resolved={modelResolved} issues={issues}
          materials={materials} disabled={readOnly} selection={selection} onSelect={setSelection} library={parts} childDefinition={childDefinition}
          onUpgradeChild={(key, id) => void upgradeChild(key, id)} onAddChild={id => void addChild(id)}
          previewVariant={previewVariant} onPreviewVariant={setPreviewVariant}
          previewValues={previewValues} onPreviewValue={(key, value) => setPreviewValues(current => {
            const next = { ...current };
            if (value === undefined) delete next[key];
            else next[key] = value;
            return next;
          })}
          favourite={inPlace ? undefined : summary?.favourite} onFavourite={readOnly || !summary || inPlace ? undefined : favourite => void toggleFavourite(favourite)}
          promote={promote} onPromote={promoteHandle} onPromoteField={promoteField} onDismissPromote={() => setPromote(undefined)}
          grouping={grouping} />}
      </div>
    </div>
  </section>;
}
