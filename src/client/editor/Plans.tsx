import { MaterialRequirements } from './MaterialRequirements.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { captureTemplateSchema, copySceneSchema, createSceneSchema, instantiateTemplateSchema, renameProductionSchema, renameSceneSchema, renameSceneTemplateSchema, sceneListSchema, sceneSchema, sceneTemplateListSchema, sceneTemplateSchema, sceneTemplateSummarySchema, type Scene, type SceneTemplate, type VenueGeometry } from '../../shared/layout.js';
import { venueListSchema, venueRecordSchema } from '../../shared/venueLibrary.js';
import { leaseHolderSchema } from '../../shared/leases.js';
import { AUDIENCE_FLOOR_ID } from '../../shared/levels.js';
import { copiedSceneName } from '../../shared/scenes.js';
import type { Me } from '../../shared/contracts.js';
import { can } from '../../shared/permissions.js';
import { ApiError, request } from '../api.js';
import { askConfirm } from '../ConfirmDialog.js';
import { Editor } from './Editor.js';
import { RecipientDocumentWorkspace } from './RecipientDocumentWorkspace.js';
import { PlanPreview } from './PlanPreview.js';
import { writeWorkspaceLocation } from '../workspaceRoutes.js';

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter(item => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; });
}

export function Plans({ me, onDirty, sceneId }: { me: Me; onDirty: (value: boolean) => void; sceneId?: string }) {
  const [productionFilter, setProductionFilter] = useState('');
  const [search, setSearch] = useState('');
  const [scenes, setScenes] = useState<ReturnType<typeof sceneListSchema.parse>>([]);
  const [templates, setTemplates] = useState<ReturnType<typeof sceneTemplateListSchema.parse>>([]);
  const [opened, setOpened] = useState<{ scene: Scene; holdsLease: boolean }>();
  const [creating, setCreating] = useState(false);
  const [addingScene, setAddingScene] = useState<{ productionId: string; venueVersionId: string; productionName: string; venueName: string }>();
  const [addingVenue, setAddingVenue] = useState<{ productionId: string; productionName: string }>();
  const [availableVenues, setAvailableVenues] = useState<ReturnType<typeof venueListSchema.parse>>([]);
  const [selectedVenueVersion, setSelectedVenueVersion] = useState('');
  const [copying, setCopying] = useState<{ source: Scene; destVenue?: VenueGeometry }>();
  const [capturing, setCapturing] = useState<{ id: string; name: string }>();
  const [instantiating, setInstantiating] = useState<{ template: SceneTemplate; destVenue?: VenueGeometry }>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [packageExport, setPackageExport] = useState<{ productionId: string; seedSceneId: string; seedVenueId: string }>();
  const [renaming, setRenaming] = useState<{ kind: 'scene' | 'production' | 'template'; id: string }>();
  const openedIdRef = useRef<string | undefined>(undefined);
  const openingRef = useRef<string | undefined>(undefined);
  openedIdRef.current = opened?.scene.id;
  const openedRef = useRef(opened);
  openedRef.current = opened;
  useEffect(() => () => {
    const held = openedRef.current;
    if (held?.holdsLease) void request(`/api/workspaces/${me.workspace.id}/scenes/${held.scene.id}/lease/release`, {}).catch(() => {});
  }, [me.workspace.id]);
  const readOnly = !can(me.workspace.role, 'scenes');
  const base = `/api/workspaces/${me.workspace.id}/scenes`;
  const templatesBase = `/api/workspaces/${me.workspace.id}/scene-templates`;
  const editingForm = creating || addingScene || addingVenue || copying || capturing || instantiating || renaming;
  function markDirty(value: boolean) {
    onDirty(value);
  }
  useEffect(() => {
    let cancelled = false;
    setBusy(true); setError('');
    Promise.all([request(base), request(templatesBase), request(`/api/workspaces/${me.workspace.id}/venues`)]).then(([sceneData, templateData, venueData]) => {
      if (cancelled) return;
      setScenes(sceneListSchema.parse(sceneData));
      setAvailableVenues(venueListSchema.parse(venueData));
      setTemplates(sceneTemplateListSchema.parse(templateData));
    }).catch(() => { if (!cancelled) setError('Bühnenbilder konnten nicht geladen werden.'); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [base, templatesBase, attempt]);
  async function enter(scene: Scene) {
    openingRef.current = scene.id;
    openedIdRef.current = scene.id;
    if (readOnly) {
      setOpened({ scene, holdsLease: false });
      writeWorkspaceLocation({ section: 'plans', sceneId: scene.id });
      openingRef.current = undefined;
      return;
    }
    try {
      const lease = leaseHolderSchema.parse(await request(`${base}/${scene.id}/lease`, {}));
      const latest = sceneSchema.parse(await request(`${base}/${scene.id}`));
      setOpened({ scene: { ...latest, lease }, holdsLease: true });
      writeWorkspaceLocation({ section: 'plans', sceneId: scene.id });
    } catch (error) {
      if (error instanceof ApiError && error.status === 423) {
        setOpened({ scene, holdsLease: false });
        writeWorkspaceLocation({ section: 'plans', sceneId: scene.id });
      } else {
        openedIdRef.current = undefined;
        throw error;
      }
    } finally {
      openingRef.current = undefined;
    }
  }
  async function open(id: string) {
    if (openingRef.current === id) return;
    // Same scene already writable — skip. Read-only viewers must fall through to re-acquire.
    if (openedIdRef.current === id && opened?.holdsLease) return;
    setBusy(true); setError('');
    try { await enter(sceneSchema.parse(await request(`${base}/${id}`))); }
    catch { setError('Das Bühnenbild konnte nicht geladen werden.'); writeWorkspaceLocation({ section: 'plans' }); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!sceneId) {
      if (!openedIdRef.current) return;
      leave();
      return;
    }
    if (openedIdRef.current === sceneId || openingRef.current === sceneId) return;
    const held = openedRef.current;
    setOpened(undefined); markDirty(false);
    void (async () => {
      if (held?.holdsLease) await request(`${base}/${held.scene.id}/lease/release`, {}).catch(() => {});
      await open(sceneId);
    })();
  }, [sceneId]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = createSceneSchema.safeParse(selectedVenueVersion ? { productionName: data.get('productionName'), sceneName: data.get('sceneName'), venueVersionId: selectedVenueVersion } : { productionName: data.get('productionName'), venueName: data.get('venueName'), sceneName: data.get('sceneName'), width: Number(data.get('width')), depth: Number(data.get('depth')) });
    if (!input.success) { setError('Bitte geben Sie gültige Namen und Maße ein.'); return; }
    setBusy(true); setError('');
    try { await enter(sceneSchema.parse(await request(base, input.data))); setCreating(false); setSelectedVenueVersion(''); }
    catch { setError('Die Produktion konnte nicht angelegt werden. Prüfen Sie vor einem erneuten Versuch die Übersicht.'); }
    finally { setBusy(false); }
  }
  async function createBlankScene(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const productionId = addingScene?.productionId ?? addingVenue?.productionId;
    const venueVersionId = addingScene?.venueVersionId ?? String(data.get('venueVersionId') ?? '');
    const input = createSceneSchema.safeParse({ productionId, venueVersionId, sceneName: data.get('sceneName') });
    if (!input.success) { setError('Bitte geben Sie einen gültigen Bühnenbildnamen ein.'); return; }
    setBusy(true); setError('');
    try {
      await request(base, input.data);
      setAddingScene(undefined); setAddingVenue(undefined); setAttempt(value => value + 1);
    } catch { setError('Das Bühnenbild konnte nicht angelegt werden.'); setBusy(false); }
  }
  async function duplicate(id: string) {
    setBusy(true); setError('');
    try { await request(`${base}/${id}/duplicate`, {}); setAttempt(value => value + 1); }
    catch { setError('Das Bühnenbild konnte nicht dupliziert werden.'); setBusy(false); }
  }
  function dismissForms() {
    setCreating(false); setSelectedVenueVersion(''); setAddingScene(undefined); setAddingVenue(undefined);
    setCopying(undefined); setCapturing(undefined); setInstantiating(undefined); setRenaming(undefined);
  }
  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renaming) return;
    const parsed = (renaming.kind === 'scene' ? renameSceneSchema
      : renaming.kind === 'production' ? renameProductionSchema
        : renameSceneTemplateSchema).safeParse({ name: new FormData(event.currentTarget).get('name') });
    if (!parsed.success) { setError('Bitte geben Sie einen gültigen Namen ein.'); return; }
    setBusy(true); setError('');
    try {
      if (renaming.kind === 'scene') {
        const result = sceneSchema.parse(await request(`${base}/${renaming.id}`, parsed.data, 'PATCH'));
        setScenes(current => current.map(item => item.id === renaming.id
          ? { ...item, name: result.name } : item));
      } else if (renaming.kind === 'production') {
        const result = sceneTemplateSummarySchema.parse(await request(
          `/api/workspaces/${me.workspace.id}/productions/${renaming.id}`, parsed.data, 'PATCH'));
        setScenes(current => current.map(item => item.productionId === renaming.id
          ? { ...item, productionName: result.name } : item));
      } else {
        const result = sceneTemplateSummarySchema.parse(
          await request(`${templatesBase}/${renaming.id}`, parsed.data, 'PATCH'));
        setTemplates(current => current.map(item => item.id === renaming.id ? { ...item, name: result.name } : item)
          .sort((a, b) => a.name.localeCompare(b.name, 'de')));
      }
      setRenaming(undefined);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Der Name konnte nicht geändert werden.');
    } finally { setBusy(false); }
  }
  function startCreatingProduction() {
    dismissForms();
    setSelectedVenueVersion(availableVenues[0]?.venueVersionId ?? '');
    setCreating(true);
  }
  async function startCopy(id: string) {
    setBusy(true); setError(''); dismissForms();
    try {
      const source = sceneSchema.parse(await request(`${base}/${id}`));
      setCopying({ source, destVenue: source.venue });
    } catch { setError('Das Bühnenbild konnte nicht geladen werden.'); }
    finally { setBusy(false); }
  }
  async function loadDestVenue(venueVersionId: string) {
    const match = scenes.find(scene => scene.venueVersionId === venueVersionId);
    if (match) return sceneSchema.parse(await request(`${base}/${match.id}`)).venue;
    const available = availableVenues.find(item => item.venueVersionId === venueVersionId);
    if (!available) return undefined;
    return venueRecordSchema.parse(await request(`/api/workspaces/${me.workspace.id}/venues/${available.id}/versions/${venueVersionId}`)).venue;
  }
  async function chooseDestVenue(venueVersionId: string) {
    if (!copying) return;
    if (venueVersionId === copying.source.venueVersionId) { setCopying({ ...copying, destVenue: copying.source.venue }); return; }
    setBusy(true); setError('');
    try { setCopying({ ...copying, destVenue: await loadDestVenue(venueVersionId) }); }
    catch { setError('Die Zielspielstätte konnte nicht geladen werden.'); }
    finally { setBusy(false); }
  }
  async function copy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!copying) return;
    const data = new FormData(event.currentTarget);
    const surfaceMap = Object.fromEntries((copying.source.venue.platforms ?? []).flatMap(platform => {
      const dest = String(data.get(`surface-${platform.id}`) ?? '');
      return dest ? [[platform.id, dest]] : [];
    }));
    const sceneName = String(data.get('sceneName') ?? '').trim();
    const input = copySceneSchema.safeParse({
      productionId: data.get('productionId'), venueVersionId: data.get('venueVersionId'),
      ...(sceneName ? { sceneName } : {}),
      ...(Object.keys(surfaceMap).length ? { surfaceMap } : {}),
    });
    if (!input.success) { setError('Bitte wählen Sie Zielproduktion und Zielspielstätte.'); return; }
    setBusy(true); setError('');
    try { await request(`${base}/${copying.source.id}/copy`, input.data); setCopying(undefined); setAttempt(value => value + 1); }
    catch { setError('Das Bühnenbild konnte nicht in die Zielspielstätte kopiert werden.'); setBusy(false); }
  }
  async function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!capturing) return;
    const input = captureTemplateSchema.safeParse({ name: new FormData(event.currentTarget).get('name') });
    if (!input.success) { setError('Bitte geben Sie einen Namen für die Bühnenbildvorlage ein.'); return; }
    setBusy(true); setError('');
    try { await request(`${base}/${capturing.id}/templates`, input.data); setCapturing(undefined); setAttempt(value => value + 1); }
    catch { setError('Die Bühnenbildvorlage konnte nicht gespeichert werden.'); setBusy(false); }
  }
  async function startInstantiate(id: string) {
    setBusy(true); setError(''); dismissForms();
    try {
      const template = sceneTemplateSchema.parse(await request(`${templatesBase}/${id}`));
      const destVenue = availableVenues[0] ? await loadDestVenue(availableVenues[0].venueVersionId) : undefined;
      setInstantiating({ template, destVenue });
    } catch { setError('Die Bühnenbildvorlage konnte nicht geladen werden.'); }
    finally { setBusy(false); }
  }
  async function chooseInstantiateVenue(venueVersionId: string) {
    if (!instantiating) return;
    setBusy(true); setError('');
    try { setInstantiating({ ...instantiating, destVenue: await loadDestVenue(venueVersionId) }); }
    catch { setError('Die Zielspielstätte konnte nicht geladen werden.'); }
    finally { setBusy(false); }
  }
  async function instantiate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!instantiating) return;
    const data = new FormData(event.currentTarget);
    const surfaceMap = Object.fromEntries(instantiating.template.sourceSurfaces.flatMap(surface => {
      const dest = String(data.get(`surface-${surface.id}`) ?? '');
      return dest ? [[surface.id, dest]] : [];
    }));
    const sceneName = String(data.get('sceneName') ?? '').trim();
    const input = instantiateTemplateSchema.safeParse({
      productionId: data.get('productionId'), venueVersionId: data.get('venueVersionId'),
      ...(sceneName ? { sceneName } : {}),
      ...(Object.keys(surfaceMap).length ? { surfaceMap } : {}),
    });
    if (!input.success) { setError('Bitte wählen Sie Zielproduktion und Zielspielstätte.'); return; }
    setBusy(true); setError('');
    try {
      await request(`${templatesBase}/${instantiating.template.id}/instantiate`, input.data);
      setInstantiating(undefined); setAttempt(value => value + 1);
    } catch { setError('Die Bühnenbildvorlage konnte nicht in die Produktion eingefügt werden.'); setBusy(false); }
  }
  async function applyVenue(id: string) {
    setBusy(true); setError('');
    try {
      await request(`${base}/${id}/lease`, {});
      try { await request(`${base}/${id}/venue-apply`, {}); }
      finally { await request(`${base}/${id}/lease/release`, {}).catch(() => {}); }
      setAttempt(value => value + 1);
    } catch { setError('Die Spielstättenfassung konnte nicht übernommen werden.'); setBusy(false); }
  }
  async function removeScene(id: string, label: string) {
    if (!await askConfirm({
      title: 'Bühnenbild löschen?',
      message: `„${label}“ wirklich löschen? Dieses Bühnenbild und abhängige Exporte werden entfernt.`,
      confirmLabel: 'Bühnenbild löschen',
      danger: true,
    })) return;
    setBusy(true); setError('');
    try { await request(`${base}/${id}`, undefined, 'DELETE'); setAttempt(value => value + 1); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Das Bühnenbild konnte nicht gelöscht werden.'); setBusy(false); }
  }
  async function removeTemplate(id: string, label: string) {
    if (!await askConfirm({
      title: 'Bühnenbildvorlage löschen?',
      message: `Bühnenbildvorlage „${label}“ wirklich löschen?`,
      confirmLabel: 'Vorlage löschen',
      danger: true,
    })) return;
    setBusy(true); setError('');
    try { await request(`${templatesBase}/${id}`, undefined, 'DELETE'); setAttempt(value => value + 1); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Die Bühnenbildvorlage konnte nicht gelöscht werden.'); setBusy(false); }
  }
  async function leave() {
    const held = opened;
    openedIdRef.current = undefined;
    openingRef.current = undefined;
    setOpened(undefined); onDirty(false); setAttempt(value => value + 1);
    writeWorkspaceLocation({ section: 'plans' });
    if (held?.holdsLease) {
      await request(`${base}/${held.scene.id}/lease/release`, {}).catch(() => {});
    }
  }
  const productions = uniqueBy(scenes, scene => scene.productionId);
  const destVenue = copying?.destVenue ?? instantiating?.destVenue;
  const venues = availableVenues.map(item => ({ venueId: item.id, venueVersionId: item.venueVersionId, venueName: item.name }));
  if (copying && !venues.some(item => item.venueVersionId === copying.source.venueVersionId)) {
    venues.unshift({ venueId: copying.source.venueId, venueVersionId: copying.source.venueVersionId, venueName: `${copying.source.venueName} (Fassung der Quellszene)` });
  }
  const destSurfaces = [
    { id: AUDIENCE_FLOOR_ID, label: 'Zuschauerboden' },
    ...(destVenue?.platforms ?? []).map(platform => ({ id: platform.id, label: platform.label })),
  ];
  if (opened) return <><Editor key={`${opened.scene.id}:${opened.holdsLease}`} initial={opened.scene} workspaceId={me.workspace.id} readOnly={readOnly || !opened.holdsLease} canRename={!readOnly} onDirty={markDirty} onClose={leave}
    onRequestEditing={readOnly ? undefined : () => void open(opened.scene.id)} />{error && <p role="alert">{error}</p>}</>;
  return <section className="plans"><div className="section-heading"><h2>Produktionen & Bühnenbilder</h2>{!readOnly && !editingForm && <button onClick={startCreatingProduction} disabled={busy}>Neue Produktion</button>}</div>
    <p className="muted">Zuerst die Produktion, dann die Bühnenbilder je Spielstätte. Vorschaubilder zeigen den aktuellen Grundriss.</p>
    {error && <div className="error" role="alert">{error} <button className="quiet" onClick={() => setAttempt(value => value + 1)} disabled={busy}>Übersicht neu laden</button></div>}
    {creating && <form className="create-plan" onSubmit={event => void create(event)}><fieldset disabled={busy}>
      <h3>Produktion anlegen</h3><p className="muted">Wählen Sie eine vorhandene Spielstätte oder legen Sie einen neuen Raum an.</p>
      <label htmlFor="production-name">Produktion</label><input id="production-name" name="productionName" required maxLength={120} />
      <label htmlFor="existing-venue">Vorhandene Spielstätte</label><select id="existing-venue" value={selectedVenueVersion} onChange={event => setSelectedVenueVersion(event.target.value)}><option value="">Neue Spielstätte anlegen</option>{availableVenues.map(item => <option key={item.id} value={item.venueVersionId}>{item.name}</option>)}</select>
      {!selectedVenueVersion && <><label htmlFor="venue-name">Spielstätte</label><input id="venue-name" name="venueName" required maxLength={120} /></>}
      <label htmlFor="scene-name">Bühnenbild</label><input id="scene-name" name="sceneName" defaultValue="Bühnenbild 1" required maxLength={120} />
      {!selectedVenueVersion && <div className="numeric-fields"><div><label htmlFor="venue-width">Spielstättenbreite (mm)</label><input id="venue-width" name="width" type="number" min="1" max="100000" step="any" required /></div><div><label htmlFor="venue-depth">Spielstättentiefe (mm)</label><input id="venue-depth" name="depth" type="number" min="1" max="100000" step="any" required /></div></div>}
      <div className="form-actions"><button type="submit">Produktion anlegen</button><button className="quiet" type="button" onClick={() => { setCreating(false); setSelectedVenueVersion(''); }}>Abbrechen</button></div>
    </fieldset></form>}
    {addingScene && <form className="create-plan" onSubmit={event => void createBlankScene(event)}><fieldset disabled={busy}>
      <h3>Neues Bühnenbild</h3>
      <p className="muted">{addingScene.productionName} · {addingScene.venueName}. Das neue Bühnenbild beginnt ohne Anordnung.</p>
      <label htmlFor="blank-scene-name">Bühnenbild</label>
      <input id="blank-scene-name" name="sceneName" required maxLength={120} autoFocus />
      <div className="form-actions"><button type="submit">Bühnenbild anlegen</button>
        <button className="quiet" type="button" onClick={() => setAddingScene(undefined)}>Abbrechen</button></div>
    </fieldset></form>}
    {addingVenue && <form className="create-plan" onSubmit={event => void createBlankScene(event)}><fieldset disabled={busy}>
      <h3>Weitere Spielstätte</h3>
      <p className="muted">{addingVenue.productionName}. Wählen Sie eine vorhandene Spielstätte für ein neues leeres Bühnenbild.</p>
      <label htmlFor="add-venue-version">Spielstätte</label>
      <select id="add-venue-version" name="venueVersionId" required defaultValue={availableVenues[0]?.venueVersionId ?? ''}>
        {availableVenues.map(item => <option key={item.id} value={item.venueVersionId}>{item.name}</option>)}
      </select>
      <label htmlFor="add-venue-scene-name">Bühnenbild</label>
      <input id="add-venue-scene-name" name="sceneName" defaultValue="Bühnenbild 1" required maxLength={120} />
      <div className="form-actions"><button type="submit">Bühnenbild anlegen</button>
        <button className="quiet" type="button" onClick={() => setAddingVenue(undefined)}>Abbrechen</button></div>
    </fieldset></form>}
    {copying && <form className="create-plan" onSubmit={event => void copy(event)}><fieldset disabled={busy}>
      <h3>Spielstättenanpassung anlegen</h3>
      <p className="muted">Nur bewegliche Teile werden übernommen. Plattenzuweisungen entfallen. Die Zielspielstätte behält Umriss, permanente Einrichtungen und Vorgaben. Die Quelle wird nur gelesen, eine Bearbeitungsberechtigung dort ist nicht nötig.</p>
      <label htmlFor="copy-production">Zielproduktion</label>
      <select id="copy-production" name="productionId" required defaultValue={copying.source.productionId}>
        {productions.map(item => <option key={item.productionId} value={item.productionId}>{item.productionName}</option>)}
      </select>
      <label htmlFor="copy-venue">Zielspielstätte</label>
      <select id="copy-venue" name="venueVersionId" required defaultValue={copying.source.venueVersionId}
        onChange={event => void chooseDestVenue(event.target.value)}>
        {venues.map(item => <option key={item.venueVersionId} value={item.venueVersionId}>{item.venueName}</option>)}
      </select>
      <label htmlFor="copy-scene-name">Bühnenbild</label>
      <input id="copy-scene-name" name="sceneName" defaultValue={copiedSceneName(copying.source.name)} required maxLength={120} />
      {copying.source.venue.platforms && copying.source.venue.platforms.length > 0 && <>
        <h4>Auflageflächen zuordnen</h4>
        <p className="muted">Übertragene Teile behalten ihre relative Anordnung. Nicht zugeordnete Auflageflächen müssen in der Zielspielstätte neu gewählt werden.</p>
        {copying.source.venue.platforms.map(platform => <div key={platform.id}>
          <label htmlFor={`copy-surface-${platform.id}`}>„{platform.label}“ zuordnen</label>
          <select id={`copy-surface-${platform.id}`} name={`surface-${platform.id}`} defaultValue="">
            <option value="">Nicht zuordnen</option>
            {destSurfaces.map(surface => <option key={surface.id} value={surface.id}>{surface.label}</option>)}
          </select>
        </div>)}
      </>}
      <div className="form-actions"><button type="submit">Als Spielstättenanpassung anlegen</button>
        <button className="quiet" type="button" onClick={() => setCopying(undefined)}>Abbrechen</button></div>
    </fieldset></form>}
    {capturing && <form className="create-plan" onSubmit={event => void capture(event)}><fieldset disabled={busy}>
      <h3>Bühnenbildvorlage speichern</h3>
      <p className="muted">Die Bühnenbildvorlage ist eine unabhängige, schreibgeschützte Kopie der Anordnung. Spätere Änderungen an der Quelle ändern sie nicht. Die Quelle wird nur gelesen, eine Bearbeitungsberechtigung dort ist nicht nötig.</p>
      <label htmlFor="template-name">Name der Bühnenbildvorlage</label>
      <input id="template-name" name="name" defaultValue={capturing.name} required maxLength={120} />
      <div className="form-actions"><button type="submit">Bühnenbildvorlage speichern</button>
        <button className="quiet" type="button" onClick={() => setCapturing(undefined)}>Abbrechen</button></div>
    </fieldset></form>}
    {instantiating && <form className="create-plan" onSubmit={event => void instantiate(event)}><fieldset disabled={busy}>
      <h3>Bühnenbildvorlage in Produktion einfügen</h3>
      <p className="muted">Es entsteht eine unabhängige, bearbeitbare Kopie. Plattenzuweisungen entfallen. Die Zielspielstätte liefert Umriss, permanente Einrichtungen und Vorgaben. Die Bühnenbildvorlage bleibt unverändert.</p>
      <label htmlFor="template-production">Zielproduktion</label>
      <select id="template-production" name="productionId" required defaultValue={productions[0]?.productionId}>
        {productions.map(item => <option key={item.productionId} value={item.productionId}>{item.productionName}</option>)}
      </select>
      <label htmlFor="template-venue">Zielspielstätte</label>
      <select id="template-venue" name="venueVersionId" required defaultValue={venues[0]?.venueVersionId}
        onChange={event => void chooseInstantiateVenue(event.target.value)}>
        {venues.map(item => <option key={item.venueVersionId} value={item.venueVersionId}>{item.venueName}</option>)}
      </select>
      <label htmlFor="template-scene-name">Bühnenbild</label>
      <input id="template-scene-name" name="sceneName" defaultValue={instantiating.template.name} required maxLength={120} />
      {instantiating.template.sourceSurfaces.length > 0 && <>
        <h4>Auflageflächen zuordnen</h4>
        <p className="muted">Übertragene Teile behalten ihre relative Anordnung. Nicht zugeordnete Auflageflächen müssen in der Zielspielstätte neu gewählt werden.</p>
        {instantiating.template.sourceSurfaces.map(surface => <div key={surface.id}>
          <label htmlFor={`template-surface-${surface.id}`}>„{surface.label}“ zuordnen</label>
          <select id={`template-surface-${surface.id}`} name={`surface-${surface.id}`} defaultValue="">
            <option value="">Nicht zuordnen</option>
            {destSurfaces.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>)}
      </>}
      <div className="form-actions"><button type="submit">Bühnenbildvorlage einfügen</button>
        <button className="quiet" type="button" onClick={() => setInstantiating(undefined)}>Abbrechen</button></div>
    </fieldset></form>}
    {busy && <p role="status">Bühnenbilder werden geladen …</p>}
    {!busy && !scenes.length && !editingForm && !error && <p className="muted">Noch keine Bühnenbilder vorhanden.{!readOnly && ' Legen Sie Ihre erste Produktion mit Spielstätte und Bühnenbild an.'}</p>}
    {scenes.length > 0 && <div className="production-browser">
      <div className="overview-tools"><label htmlFor="scene-search">Produktionen & Bühnenbilder suchen<input id="scene-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Produktion, Bühnenbild oder Spielstätte" /></label>
        <button type="button" className="quiet" aria-pressed={!productionFilter} onClick={() => { setProductionFilter(''); setSearch(''); }}>Alle Produktionen ({productions.length})</button></div>
      <div className="production-gallery" aria-label="Produktionen auswählen">{productions.map(production => {
        const items = scenes.filter(scene => scene.productionId === production.productionId);
        return <button key={production.productionId} type="button" className="quiet production-tile" aria-pressed={productionFilter === production.productionId} onClick={() => setProductionFilter(current => current === production.productionId ? '' : production.productionId)}>
          {production.preview && <PlanPreview preview={production.preview} label={`Bühnenbild ${production.productionName}`} />}
          <strong>{production.productionName}</strong><span>{items.length} Bühnenbilder · {new Set(items.map(scene => scene.venueId)).size} Spielstätten</span>
        </button>;
      })}</div>
      <p className="muted" role="status">{scenes.filter(scene => (!productionFilter || scene.productionId === productionFilter) && `${scene.productionName} ${scene.name} ${scene.venueName}`.toLocaleLowerCase('de').includes(search.trim().toLocaleLowerCase('de'))).length} Bühnenbilder gefunden</p>
    </div>}
    <div className={`production-details${productionFilter ? ' focused' : ''}`}>{productions.filter(item => (!productionFilter || item.productionId === productionFilter) && scenes.some(scene => scene.productionId === item.productionId && `${scene.productionName} ${scene.name} ${scene.venueName}`.toLocaleLowerCase('de').includes(search.trim().toLocaleLowerCase('de')))).map(item => {
      const productionScenes = scenes.filter(scene => scene.productionId === item.productionId);
      const venueNames = uniqueBy(productionScenes, scene => scene.venueId);
      return <section className="production-block" key={item.productionId} aria-label={`Produktion ${item.productionName}`}>
        <div className="section-heading">
          <h2>{item.productionName}</h2>
          {!readOnly && !editingForm && availableVenues.length > 0 && <button className="quiet" type="button" onClick={() => { dismissForms(); setAddingVenue({ productionId: item.productionId, productionName: item.productionName }); }} disabled={busy}>Weitere Spielstätte</button>}
          {!readOnly && !editingForm && <button className="quiet" type="button" disabled={busy} onClick={() => { dismissForms(); setRenaming({ kind: 'production', id: item.productionId }); }}>Umbenennen</button>}
        </div>
        {renaming?.kind === 'production' && renaming.id === item.productionId && <form className="create-plan" onSubmit={event => void rename(event)}>
          <label htmlFor={`rename-production-${item.productionId}`}>Neuer Name</label>
          <input id={`rename-production-${item.productionId}`} name="name" required maxLength={120} defaultValue={item.productionName} autoFocus />
          <div className="form-actions">
            <button type="submit" disabled={busy}>Umbenennen</button>
            <button type="button" className="quiet" disabled={busy} onClick={() => setRenaming(undefined)}>Abbrechen</button>
          </div>
        </form>}
        {venueNames.map(venue => {
          const venueScenes = productionScenes.filter(scene => scene.venueId === venue.venueId && `${scene.productionName} ${scene.name} ${scene.venueName}`.toLocaleLowerCase('de').includes(search.trim().toLocaleLowerCase('de')));
          if (!venueScenes.length) return null;
          return <div className="venue-block" key={venue.venueId}>
            <div className="section-heading venue-block-heading">
              <h3 className="venue-block-title">Spielstätte · {venue.venueName}</h3>
              {!readOnly && !editingForm && <button className="quiet" type="button" onClick={() => { dismissForms(); setAddingScene({ productionId: item.productionId, venueVersionId: venue.venueVersionId, productionName: item.productionName, venueName: venue.venueName }); }} disabled={busy}>Neues Bühnenbild</button>}
            </div>
            <MaterialRequirements workspaceId={me.workspace.id} productionId={item.productionId} venueId={venue.venueId}
              revisionKey={productionScenes.filter(scene => scene.venueId === venue.venueId).map(scene => scene.id).join(',')} />
            <div className="scene-list">{venueScenes.map(scene => <div className="scene-card" key={scene.id}>
              <button className="quiet scene-open" aria-label={`${scene.productionName} · ${scene.name} ${scene.venueName}`} onClick={() => void open(scene.id)} disabled={busy}>
                {scene.preview && <PlanPreview preview={scene.preview} label={`Grundriss ${scene.name}`} />}
                <span className="scene-open-copy">
                  <strong>{scene.name}</strong>
                  <span>{scene.venueUpdateAvailable ? 'Aktualisierung verfügbar · ' : ''}{scene.lease ? `Bearbeitung durch ${scene.lease.holderName}` : 'Bühnenbild öffnen'} →</span>
                </span>
              </button>
              {!readOnly && scene.venueUpdateAvailable && <button className="quiet" type="button" onClick={() => void applyVenue(scene.id)} disabled={busy}>Spielstättenfassung übernehmen</button>}
              {!readOnly && <button className="quiet" type="button" onClick={() => void duplicate(scene.id)} disabled={busy}>Bühnenbild duplizieren</button>}
              {!readOnly && renaming?.kind !== 'scene' && <button className="quiet" type="button" disabled={busy} onClick={() => { dismissForms(); setRenaming({ kind: 'scene', id: scene.id }); }}>Umbenennen</button>}
              {!readOnly && renaming?.kind === 'scene' && renaming.id === scene.id && <form className="create-plan" onSubmit={event => void rename(event)}>
                <label htmlFor={`rename-scene-${scene.id}`}>Neuer Name</label>
                <input id={`rename-scene-${scene.id}`} name="name" required maxLength={120} defaultValue={scene.name} autoFocus />
                <div className="form-actions">
                  <button type="submit" disabled={busy}>Umbenennen</button>
                  <button type="button" className="quiet" disabled={busy} onClick={() => setRenaming(undefined)}>Abbrechen</button>
                </div>
              </form>}
              {!readOnly && <details className="scene-actions">
                <summary>Weitere Aktionen</summary>
                <button className="quiet" type="button" onClick={() => void startCopy(scene.id)} disabled={busy}>In andere Spielstätte kopieren</button>
                <button className="quiet" type="button" onClick={() => { dismissForms(); setCapturing({ id: scene.id, name: scene.name }); }} disabled={busy}>Als Bühnenbildvorlage speichern</button>
                <button className="quiet" type="button" onClick={() => void removeScene(scene.id, `${scene.productionName} · ${scene.name}`)} disabled={busy}>Löschen</button>
              </details>}
            </div>)}</div>
          </div>;
        })}
        {!readOnly && productionScenes[0] && <button type="button" className="quiet" onClick={() => setPackageExport({
          productionId: item.productionId,
          seedSceneId: productionScenes[0]!.id,
          seedVenueId: productionScenes[0]!.venueId,
        })}>PDF gestalten</button>}
      </section>;
    })}
    </div>
    {packageExport && <RecipientDocumentWorkspace workspaceId={me.workspace.id} productionId={packageExport.productionId}
      seedSceneId={packageExport.seedSceneId} seedVenueId={packageExport.seedVenueId} defaultScope="production"
      freezeDisabled={busy} onClose={() => setPackageExport(undefined)} />}
    <div className="section-heading"><h2>Bühnenbildvorlagen</h2></div>
    {!busy && !templates.length && !capturing && !instantiating && !error && <p className="muted">Noch keine Bühnenbildvorlagen vorhanden.{!readOnly && ' Speichern Sie ein Bühnenbild als schreibgeschützte Bühnenbildvorlage.'}</p>}
    <div className="scene-list">{templates.map(template => <div className="scene-card" key={template.id}>
      <div className="scene-open"><strong>{template.name}</strong><span>schreibgeschützt</span></div>
      {!readOnly && renaming?.kind === 'template' && renaming.id === template.id && <form className="create-plan" onSubmit={event => void rename(event)}>
        <label htmlFor={`rename-template-${template.id}`}>Neuer Name</label>
        <input id={`rename-template-${template.id}`} name="name" required maxLength={120} defaultValue={template.name} autoFocus />
        <div className="form-actions">
          <button type="submit" disabled={busy}>Umbenennen</button>
          <button type="button" className="quiet" disabled={busy} onClick={() => setRenaming(undefined)}>Abbrechen</button>
        </div>
      </form>}
      {!readOnly && <button className="quiet" type="button" onClick={() => void startInstantiate(template.id)} disabled={busy}>In Produktion einfügen</button>}
      {!readOnly && <button className="quiet" type="button" disabled={busy} onClick={() => { dismissForms(); setRenaming({ kind: 'template', id: template.id }); }}>Umbenennen</button>}
      {!readOnly && <button className="quiet" type="button" onClick={() => void removeTemplate(template.id, template.name)} disabled={busy}>Löschen</button>}
    </div>)}</div>
  </section>;
}
