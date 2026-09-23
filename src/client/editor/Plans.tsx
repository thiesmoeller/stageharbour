import { useEffect, useRef, useState, type FormEvent } from 'react';
import { captureTemplateSchema, copySceneSchema, createSceneSchema, instantiateTemplateSchema, sceneListSchema, sceneSchema, sceneTemplateListSchema, sceneTemplateSchema, type Scene, type SceneTemplate, type VenueGeometry } from '../../shared/layout.js';
import { venueListSchema, venueRecordSchema } from '../../shared/venueLibrary.js';
import { leaseHolderSchema } from '../../shared/leases.js';
import { AUDIENCE_FLOOR_ID } from '../../shared/levels.js';
import { copiedSceneName } from '../../shared/scenes.js';
import type { Me } from '../../shared/contracts.js';
import { can } from '../../shared/permissions.js';
import { ApiError, request } from '../api.js';
import { Editor } from './Editor.js';
import { PackageExport } from './ExportPanel.js';
import { PlanPreview } from './PlanPreview.js';
import { writeWorkspaceLocation } from '../workspaceRoutes.js';

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter(item => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; });
}

export function Plans({ me, onDirty, sceneId }: { me: Me; onDirty: (value: boolean) => void; sceneId?: string }) {
  const [scenes, setScenes] = useState<ReturnType<typeof sceneListSchema.parse>>([]);
  const [templates, setTemplates] = useState<ReturnType<typeof sceneTemplateListSchema.parse>>([]);
  const [opened, setOpened] = useState<{ scene: Scene; holdsLease: boolean }>();
  const [creating, setCreating] = useState(false);
  const [availableVenues, setAvailableVenues] = useState<ReturnType<typeof venueListSchema.parse>>([]);
  const [selectedVenueVersion, setSelectedVenueVersion] = useState('');
  const [copying, setCopying] = useState<{ source: Scene; destVenue?: VenueGeometry }>();
  const [capturing, setCapturing] = useState<{ id: string; name: string }>();
  const [instantiating, setInstantiating] = useState<{ template: SceneTemplate; destVenue?: VenueGeometry }>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [documentDirty, setDocumentDirty] = useState(false);
  const openedIdRef = useRef<string | undefined>(undefined);
  const openingRef = useRef<string | undefined>(undefined);
  const documentDirtyRef = useRef(false);
  openedIdRef.current = opened?.scene.id;
  documentDirtyRef.current = documentDirty;
  const readOnly = !can(me.workspace.role, 'scenes');
  const base = `/api/workspaces/${me.workspace.id}/scenes`;
  const templatesBase = `/api/workspaces/${me.workspace.id}/scene-templates`;
  const editingForm = creating || copying || capturing || instantiating;
  function markDirty(value: boolean) {
    setDocumentDirty(value);
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
    catch { setError('Die Szene konnte nicht geladen werden.'); writeWorkspaceLocation({ section: 'plans' }); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!sceneId) {
      if (!openedIdRef.current) return;
      if (documentDirtyRef.current) {
        writeWorkspaceLocation({ section: 'plans', sceneId: openedIdRef.current });
        return;
      }
      leave();
      return;
    }
    if (openedIdRef.current === sceneId || openingRef.current === sceneId) return;
    if (openedIdRef.current && documentDirtyRef.current) {
      writeWorkspaceLocation({ section: 'plans', sceneId: openedIdRef.current });
      return;
    }
    void open(sceneId);
  }, [sceneId]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = createSceneSchema.safeParse(selectedVenueVersion ? { productionName: data.get('productionName'), sceneName: data.get('sceneName'), venueVersionId: selectedVenueVersion } : { productionName: data.get('productionName'), venueName: data.get('venueName'), sceneName: data.get('sceneName'), width: Number(data.get('width')), depth: Number(data.get('depth')) });
    if (!input.success) { setError('Bitte geben Sie gültige Namen und Maße ein.'); return; }
    setBusy(true); setError('');
    try { await enter(sceneSchema.parse(await request(base, input.data))); setCreating(false); setSelectedVenueVersion(''); }
    catch { setError('Das Bühnenbild konnte nicht angelegt werden. Prüfen Sie vor einem erneuten Versuch die Übersicht.'); }
    finally { setBusy(false); }
  }
  async function duplicate(id: string) {
    setBusy(true); setError('');
    try { await request(`${base}/${id}/duplicate`, {}); setAttempt(value => value + 1); }
    catch { setError('Die Szene konnte nicht dupliziert werden.'); setBusy(false); }
  }
  function dismissForms() { setCreating(false); setSelectedVenueVersion(''); setCopying(undefined); setCapturing(undefined); setInstantiating(undefined); }
  async function startCopy(id: string) {
    setBusy(true); setError(''); dismissForms();
    try {
      const source = sceneSchema.parse(await request(`${base}/${id}`));
      setCopying({ source, destVenue: source.venue });
    } catch { setError('Die Szene konnte nicht geladen werden.'); }
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
    catch { setError('Die Szene konnte nicht in die Zielspielstätte kopiert werden.'); setBusy(false); }
  }
  async function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!capturing) return;
    const input = captureTemplateSchema.safeParse({ name: new FormData(event.currentTarget).get('name') });
    if (!input.success) { setError('Bitte geben Sie einen Namen für die Szenenvorlage ein.'); return; }
    setBusy(true); setError('');
    try { await request(`${base}/${capturing.id}/templates`, input.data); setCapturing(undefined); setAttempt(value => value + 1); }
    catch { setError('Die Szenenvorlage konnte nicht gespeichert werden.'); setBusy(false); }
  }
  async function startInstantiate(id: string) {
    setBusy(true); setError(''); dismissForms();
    try {
      const template = sceneTemplateSchema.parse(await request(`${templatesBase}/${id}`));
      const destVenue = availableVenues[0] ? await loadDestVenue(availableVenues[0].venueVersionId) : undefined;
      setInstantiating({ template, destVenue });
    } catch { setError('Die Szenenvorlage konnte nicht geladen werden.'); }
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
    } catch { setError('Die Szenenvorlage konnte nicht in die Produktion eingefügt werden.'); setBusy(false); }
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
    if (!window.confirm(`„${label}“ wirklich löschen? Diese Szene und abhängige Exporte werden entfernt.`)) return;
    setBusy(true); setError('');
    try { await request(`${base}/${id}`, undefined, 'DELETE'); setAttempt(value => value + 1); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Die Szene konnte nicht gelöscht werden.'); setBusy(false); }
  }
  async function removeTemplate(id: string, label: string) {
    if (!window.confirm(`Szenenvorlage „${label}“ wirklich löschen?`)) return;
    setBusy(true); setError('');
    try { await request(`${templatesBase}/${id}`, undefined, 'DELETE'); setAttempt(value => value + 1); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Die Szenenvorlage konnte nicht gelöscht werden.'); setBusy(false); }
  }
  async function leave() {
    const held = opened;
    openedIdRef.current = undefined;
    openingRef.current = undefined;
    setOpened(undefined); setDocumentDirty(false); onDirty(false); setAttempt(value => value + 1);
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
  if (opened) return <><Editor key={`${opened.scene.id}:${opened.holdsLease}`} initial={opened.scene} workspaceId={me.workspace.id} readOnly={readOnly || !opened.holdsLease} onDirty={markDirty} onClose={leave}
    onRequestEditing={readOnly ? undefined : () => void open(opened.scene.id)} />{error && <p role="alert">{error}</p>}</>;
  return <section className="plans"><div className="section-heading"><h2>Produktionen & Szenen</h2>{!readOnly && !editingForm && <button onClick={() => { setSelectedVenueVersion(''); setCreating(true); }} disabled={busy}>Neues Bühnenbild</button>}</div>
    <p className="muted">Zuerst die Produktion, dann die Szenen je Spielstätte. Vorschaubilder zeigen den aktuellen Grundriss.</p>
    {error && <div className="error" role="alert">{error} <button className="quiet" onClick={() => setAttempt(value => value + 1)} disabled={busy}>Übersicht neu laden</button></div>}
    {creating && <form className="create-plan" onSubmit={event => void create(event)}><fieldset disabled={busy}>
      <h3>Produktion anlegen</h3><p className="muted">Wählen Sie eine vorhandene Spielstätte oder legen Sie einen neuen Raum an.</p>
      <label htmlFor="production-name">Produktion</label><input id="production-name" name="productionName" required maxLength={120} />
      <label htmlFor="existing-venue">Vorhandene Spielstätte</label><select id="existing-venue" value={selectedVenueVersion} onChange={event => setSelectedVenueVersion(event.target.value)}><option value="">Neue Spielstätte anlegen</option>{availableVenues.map(item => <option key={item.id} value={item.venueVersionId}>{item.name}</option>)}</select>
      {!selectedVenueVersion && <><label htmlFor="venue-name">Spielstätte</label><input id="venue-name" name="venueName" required maxLength={120} /></>}
      <label htmlFor="scene-name">Szene</label><input id="scene-name" name="sceneName" defaultValue="Szene 1" required maxLength={120} />
      {!selectedVenueVersion && <div className="numeric-fields"><div><label htmlFor="venue-width">Spielstättenbreite (mm)</label><input id="venue-width" name="width" type="number" min="1" max="100000" step="any" required /></div><div><label htmlFor="venue-depth">Spielstättentiefe (mm)</label><input id="venue-depth" name="depth" type="number" min="1" max="100000" step="any" required /></div></div>}
      <div className="form-actions"><button type="submit">Bühnenbild anlegen</button><button className="quiet" type="button" onClick={() => { setCreating(false); setSelectedVenueVersion(''); }}>Abbrechen</button></div>
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
      <label htmlFor="copy-scene-name">Szene</label>
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
      <h3>Szenenvorlage speichern</h3>
      <p className="muted">Die Szenenvorlage ist eine unabhängige, schreibgeschützte Kopie der Anordnung. Spätere Änderungen an der Quelle ändern sie nicht. Die Quelle wird nur gelesen, eine Bearbeitungsberechtigung dort ist nicht nötig.</p>
      <label htmlFor="template-name">Name der Szenenvorlage</label>
      <input id="template-name" name="name" defaultValue={capturing.name} required maxLength={120} />
      <div className="form-actions"><button type="submit">Szenenvorlage speichern</button>
        <button className="quiet" type="button" onClick={() => setCapturing(undefined)}>Abbrechen</button></div>
    </fieldset></form>}
    {instantiating && <form className="create-plan" onSubmit={event => void instantiate(event)}><fieldset disabled={busy}>
      <h3>Szenenvorlage in Produktion einfügen</h3>
      <p className="muted">Es entsteht eine unabhängige, bearbeitbare Kopie. Plattenzuweisungen entfallen. Die Zielspielstätte liefert Umriss, permanente Einrichtungen und Vorgaben. Die Szenenvorlage bleibt unverändert.</p>
      <label htmlFor="template-production">Zielproduktion</label>
      <select id="template-production" name="productionId" required defaultValue={productions[0]?.productionId}>
        {productions.map(item => <option key={item.productionId} value={item.productionId}>{item.productionName}</option>)}
      </select>
      <label htmlFor="template-venue">Zielspielstätte</label>
      <select id="template-venue" name="venueVersionId" required defaultValue={venues[0]?.venueVersionId}
        onChange={event => void chooseInstantiateVenue(event.target.value)}>
        {venues.map(item => <option key={item.venueVersionId} value={item.venueVersionId}>{item.venueName}</option>)}
      </select>
      <label htmlFor="template-scene-name">Szene</label>
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
      <div className="form-actions"><button type="submit">Szenenvorlage einfügen</button>
        <button className="quiet" type="button" onClick={() => setInstantiating(undefined)}>Abbrechen</button></div>
    </fieldset></form>}
    {busy && <p role="status">Bühnenbilder werden geladen …</p>}
    {!busy && !scenes.length && !editingForm && !error && <p className="muted">Noch keine Bühnenbilder vorhanden.{!readOnly && ' Legen Sie Ihre erste Produktion mit Spielstätte und Szene an.'}</p>}
    {productions.map(item => {
      const productionScenes = scenes.filter(scene => scene.productionId === item.productionId);
      const venueNames = uniqueBy(productionScenes, scene => scene.venueId);
      return <section className="production-block" key={item.productionId} aria-label={`Produktion ${item.productionName}`}>
        <div className="section-heading"><h2>{item.productionName}</h2></div>
        {venueNames.map(venue => {
          const venueScenes = productionScenes.filter(scene => scene.venueId === venue.venueId);
          return <div className="venue-block" key={venue.venueId}>
            <h3 className="venue-block-title">Spielstätte · {venue.venueName}</h3>
            <div className="scene-list">{venueScenes.map(scene => <div className="scene-card" key={scene.id}>
              <button className="quiet scene-open" aria-label={`${scene.productionName} · ${scene.name} ${scene.venueName}`} onClick={() => void open(scene.id)} disabled={busy}>
                {scene.preview && <PlanPreview preview={scene.preview} label={`Grundriss ${scene.name}`} />}
                <span className="scene-open-copy">
                  <strong>{scene.name}</strong>
                  <span>{scene.venueUpdateAvailable ? 'Aktualisierung verfügbar · ' : ''}{scene.lease ? `Bearbeitung durch ${scene.lease.holderName}` : 'Bühnenbild öffnen'} →</span>
                </span>
              </button>
              {!readOnly && scene.venueUpdateAvailable && <button className="quiet" type="button" onClick={() => void applyVenue(scene.id)} disabled={busy}>Spielstättenfassung übernehmen</button>}
              {!readOnly && <button className="quiet" type="button" onClick={() => void duplicate(scene.id)} disabled={busy}>Szene duplizieren</button>}
              {!readOnly && <button className="quiet" type="button" onClick={() => void startCopy(scene.id)} disabled={busy}>In andere Spielstätte kopieren</button>}
              {!readOnly && <button className="quiet" type="button" onClick={() => { dismissForms(); setCapturing({ id: scene.id, name: scene.name }); }} disabled={busy}>Als Szenenvorlage speichern</button>}
              {!readOnly && <button className="quiet" type="button" onClick={() => void removeScene(scene.id, `${scene.productionName} · ${scene.name}`)} disabled={busy}>Löschen</button>}
            </div>)}</div>
          </div>;
        })}
        <PackageExport workspaceId={me.workspace.id} productionId={item.productionId}
          scenes={productionScenes.map(scene => ({ id: scene.id, name: `${scene.name} · ${scene.venueName}` }))}
          readOnly={readOnly} freezeDisabled={busy} />
      </section>;
    })}
    <div className="section-heading"><h2>Szenenvorlagen</h2></div>
    {!busy && !templates.length && !capturing && !instantiating && !error && <p className="muted">Noch keine Szenenvorlagen vorhanden.{!readOnly && ' Speichern Sie eine Szene als schreibgeschützte Szenenvorlage.'}</p>}
    <div className="scene-list">{templates.map(template => <div className="scene-card" key={template.id}>
      <div className="scene-open"><strong>{template.name}</strong><span>schreibgeschützt</span></div>
      {!readOnly && <button className="quiet" type="button" onClick={() => void startInstantiate(template.id)} disabled={busy}>In Produktion einfügen</button>}
      {!readOnly && <button className="quiet" type="button" onClick={() => void removeTemplate(template.id, template.name)} disabled={busy}>Löschen</button>}
    </div>)}</div>
  </section>;
}
