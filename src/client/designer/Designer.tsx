import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Me } from '../../shared/contracts.js';
import { can } from '../../shared/permissions.js';
import type { ImportReport, PartDetail, PartSummary } from '../../shared/parts/catalog.js';
import { canonicalJson } from '../../shared/parts/catalogPlans.js';
import { createPartContext, partRefKey, type PartChild, type PartDefinition, type PartMaterial, type PartRef } from '../../shared/parts/definition.js';
import { hasErrors, type PartIssue } from '../../shared/parts/issues.js';
import { resolvePartConfiguration, type ResolvedPart } from '../../shared/parts/resolve.js';
import { validateDefinition } from '../../shared/parts/validate.js';
import { ApiError } from '../api.js';
import { askConfirm } from '../ConfirmDialog.js';
import { catalogIssues, createPart, duplicatePart, getPart, listMaterials, listParts, resolveParts, savePart, setPartFavourite } from '../partsApi.js';
import { writeWorkspaceLocation, type WorkspaceLocation } from '../workspaceRoutes.js';
import { BodyList } from './BodyList.js';
import { FaceOpeningsSketcher } from './FaceOpeningsSketcher.js';
import { LibrarySidebar } from './LibrarySidebar.js';
import { PartEditor } from './PartEditor.js';
import { PartPreview3D } from './PartPreview3D.js';
import { PartViewsSvg } from './PartViewsSvg.js';
import { newChild, newPartDefinition, type DesignerSelection } from './draft.js';
import './designer.css';

type Phase = { kind: 'idle' } | { kind: 'loading' } | { kind: 'missing'; partId: string } | { kind: 'failed'; message: string };
type SaveState =
  | { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; revision: number }
  | { kind: 'invalid' } | { kind: 'conflict'; message: string } | { kind: 'failed'; message: string };

/** Only the live check runs while typing; saving checks every combination. */
const LIVE_CHECK = { maxCombinationsPerVariant: 8, maxCombinations: 48 } as const;
const MAX_CHILD_DEPTH = 8;

const childRefs = (definition: PartDefinition): PartRef[] => (definition.children ?? []).map(child => child.part);
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

/** Bühnentechnik-Designer: parametric parts of the workspace library, edited with live preview. */
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
  const [openingKey, setOpeningKey] = useState<string>();
  const [previewVariant, setPreviewVariant] = useState<string>();
  const [previewValues, setPreviewValues] = useState<Record<string, number>>({});
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [saveIssues, setSaveIssues] = useState<PartIssue[]>();
  const [busy, setBusy] = useState('');
  const loadToken = useRef(0);
  const pendingNew = useRef<PartDefinition | undefined>(undefined);
  const lastResolved = useRef<ResolvedPart | undefined>(undefined);

  const refreshLibrary = useCallback(async () => {
    try {
      const [summaries, stock] = await Promise.all([listParts(workspaceId, { includeArchived: true }), listMaterials(workspaceId)]);
      setParts(summaries); setMaterials(stock); setLibraryError('');
    } catch (error) { setLibraryError(message(error, 'Die Bauteilbibliothek konnte nicht geladen werden.')); }
  }, [workspaceId]);
  useEffect(() => { void refreshLibrary(); }, [refreshLibrary]);

  const startEditing = useCallback((definition: PartDefinition, detail: PartDetail | undefined, children: ReadonlyMap<string, PartDefinition>) => {
    lastResolved.current = undefined;
    setSaved(detail); setDraft(definition); setIsNew(!detail); setChildDefinitions(children);
    setSelection(definition.bodies[0] ? { kind: 'body', key: definition.bodies[0].key } : undefined);
    setOpeningKey(undefined);
    setPreviewVariant(definition.variants?.[0]?.key); setPreviewValues({});
    setSaveState({ kind: 'idle' }); setSaveIssues(undefined);
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

  const dirty = !!draft && (isNew || !saved || canonicalJson(draft) !== canonicalJson(saved.definition));
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
  const live = useMemo(() => deferredDraft && materials.length ? liveCheck(deferredDraft, context, deferredVariant, deferredValues) : undefined,
    [deferredDraft, context, deferredVariant, deferredValues, materials.length]);
  if (live?.resolved) lastResolved.current = live.resolved;
  const resolved = live?.resolved ?? lastResolved.current;
  const issues = saveIssues ?? live?.issues ?? [];
  const stale = deferredDraft !== draft;
  const blocking = hasErrors(live?.issues ?? []);

  const sketchBody = selection?.kind === 'body' ? draft?.bodies.find(body => body.key === selection.key) : undefined;
  const sketchBodyKey = sketchBody?.kind === 'sheet' ? sketchBody.key : undefined;
  useEffect(() => { setOpeningKey(undefined); }, [sketchBodyKey]);

  function change(next: PartDefinition, select?: DesignerSelection) {
    if (readOnly) return;
    setDraft(next);
    setSaveIssues(undefined);
    if (saveState.kind === 'saved' || saveState.kind === 'invalid') setSaveState({ kind: 'idle' });
    if (select) setSelection(select);
  }

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
    if (!draft) return;
    try {
      const detail = await getPart(workspaceId, id);
      const children = await loadChildClosure(workspaceId, [detail.definition], new Map([...childDefinitions, [partRefKey(detail.definition), detail.definition]]));
      setChildDefinitions(children);
      const child = newChild(draft, detail.definition);
      change({ ...draft, children: [...(draft.children ?? []), child] }, { kind: 'child', key: child.key });
    } catch (error) { setSaveState({ kind: 'failed', message: message(error, 'Das Unterbauteil konnte nicht geladen werden.') }); }
  }
  async function upgradeChild(key: string, id: string) {
    if (!draft) return;
    try {
      const detail = await getPart(workspaceId, id);
      const children = await loadChildClosure(workspaceId, [detail.definition], new Map([...childDefinitions, [partRefKey(detail.definition), detail.definition]]));
      setChildDefinitions(children);
      change({
        ...draft,
        children: (draft.children ?? []).map(child => child.key === key ? { ...child, part: { id, revision: detail.definition.revision } } : child),
      });
    } catch (error) { setSaveState({ kind: 'failed', message: message(error, 'Das Unterbauteil konnte nicht geladen werden.') }); }
  }

  async function save() {
    if (!draft || readOnly) return;
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
  const childDefinition = useCallback((child: PartChild) => childDefinitions.get(partRefKey(child.part)), [childDefinitions]);
  const summary = saved ? parts.find(part => part.id === saved.id) : undefined;

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

  return <section className="plans designer-page" aria-label="Bühnentechnik" data-testid="designer-page">
    <div className="section-heading">
      <div>
        <h2>Bühnentechnik</h2>
        <p className="muted">Parametrische Bauteile entwerfen: Maße als Parameter, Körper und Verbinder als Formeln. Gespeicherte Revisionen bleiben unverändert.</p>
      </div>
    </div>
    {readOnly && <p className="designer-readonly" role="note" data-testid="designer-readonly">Nur Ansicht: Mit Ihrer Rolle können Sie Bauteile ansehen, aber nicht ändern.</p>}
    {libraryError && <p className="error" role="alert">{libraryError}</p>}
    <div className="designer-layout">
      <div className="designer-left">
        {draft && <BodyList definition={draft} onChange={change} selection={selection} onSelect={setSelection} materials={materials}
          library={parts} onAddChild={id => void addChild(id)} disabled={readOnly} />}
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
        {phase.kind === 'idle' && draft && <>
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
              <button type="button" className="primary" data-testid="designer-save" disabled={(!dirty && !isNew) || saveState.kind === 'saving' || blocking}
                title={blocking ? 'Fehler verhindern das Speichern.' : undefined} onClick={() => void save()}>Speichern</button>
            </>}
          </div>
          <PartPreview3D resolved={resolved} materials={materials} selection={selection} label={`3D-Vorschau von ${draft.name}`} />
          {sketchBodyKey && <FaceOpeningsSketcher definition={draft} bodyKey={sketchBodyKey} resolved={resolved}
            activeVariant={previewVariant} materials={materials} disabled={readOnly} onChange={definition => change(definition)}
            selectedKey={openingKey} onSelectOpening={setOpeningKey} />}
          <PartViewsSvg resolved={resolved} materials={materials} selection={selection} onSelect={setSelection} />
        </>}
      </div>
      <div className="designer-right">
        {phase.kind === 'idle' && draft && <PartEditor definition={draft} onChange={change} resolved={resolved} issues={issues} materials={materials}
          disabled={readOnly} selection={selection} onSelect={setSelection} library={parts} childDefinition={childDefinition}
          onUpgradeChild={(key, id) => void upgradeChild(key, id)}
          previewVariant={previewVariant} onPreviewVariant={setPreviewVariant}
          previewValues={previewValues} onPreviewValue={(key, value) => setPreviewValues(current => {
            const next = { ...current };
            if (value === undefined) delete next[key];
            else next[key] = value;
            return next;
          })}
          favourite={summary?.favourite} onFavourite={readOnly || !summary ? undefined : favourite => void toggleFavourite(favourite)}
          sketchBodyKey={sketchBodyKey} openingKey={openingKey} />}
      </div>
    </div>
  </section>;
}
