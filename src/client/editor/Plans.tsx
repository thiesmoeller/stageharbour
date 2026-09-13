import { useEffect, useState, type FormEvent } from 'react';
import { captureTemplateSchema, copySceneSchema, createSceneSchema, instantiateTemplateSchema, sceneListSchema, sceneSchema, sceneTemplateListSchema, sceneTemplateSchema, type Scene, type SceneTemplate, type VenueGeometry } from '../../shared/layout.js';
import { venueListSchema, venueRecordSchema } from '../../shared/venueLibrary.js';
import { leaseHolderSchema } from '../../shared/leases.js';
import { AUDIENCE_FLOOR_ID } from '../../shared/levels.js';
import { copiedSceneName } from '../../shared/scenes.js';
import type { Me } from '../../shared/contracts.js';
import { ApiError, request } from '../api.js';
import { Editor } from './Editor.js';
import { PackageExport } from './ExportPanel.js';

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter(item => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; });
}

export function Plans({ me, onDirty }: { me: Me; onDirty: (value: boolean) => void }) {
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
  const readOnly = me.workspace.role === 'viewer';
  const base = `/api/workspaces/${me.workspace.id}/scenes`;
  const templatesBase = `/api/workspaces/${me.workspace.id}/scene-templates`;
  const editingForm = creating || copying || capturing || instantiating;
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
    if (readOnly) { setOpened({ scene, holdsLease: false }); return; }
    try {
      const lease = leaseHolderSchema.parse(await request(`${base}/${scene.id}/lease`, {}));
      setOpened({ scene: { ...scene, lease }, holdsLease: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 423) setOpened({ scene, holdsLease: false });
      else throw error;
    }
  }
  async function open(id: string) {
    setBusy(true); setError('');
    try { await enter(sceneSchema.parse(await request(`${base}/${id}`))); }
    catch { setError('Die Szene konnte nicht geladen werden.'); }
    finally { setBusy(false); }
  }
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
  function leave() {
    if (opened?.holdsLease) void request(`${base}/${opened.scene.id}/lease/release`, {}).catch(() => {});
    setOpened(undefined); setAttempt(value => value + 1);
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
  if (opened) return <Editor key={opened.scene.id} initial={opened.scene} workspaceId={me.workspace.id} readOnly={readOnly || !opened.holdsLease} onDirty={onDirty} onClose={leave} />;
  return <section className="plans"><div className="section-heading"><h2>Bühnenbilder</h2>{!readOnly && !editingForm && <button onClick={() => { setSelectedVenueVersion(''); setCreating(true); }} disabled={busy}>Neues Bühnenbild</button>}</div>
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
    <div className="scene-list">{scenes.map(scene => <div className="scene-card" key={scene.id}>
      <button className="quiet scene-open" onClick={() => void open(scene.id)} disabled={busy}>
        <strong>{scene.productionName} · {scene.name}</strong>
        <span>{scene.venueName}{scene.venueUpdateAvailable ? ' · Aktualisierung verfügbar' : ''}{scene.lease ? ` · Bearbeitung durch ${scene.lease.holderName}` : ''} →</span>
      </button>
      {!readOnly && scene.venueUpdateAvailable && <button className="quiet" type="button" onClick={() => void applyVenue(scene.id)} disabled={busy}>Spielstättenfassung übernehmen</button>}
      {!readOnly && <button className="quiet" type="button" onClick={() => void duplicate(scene.id)} disabled={busy}>Szene duplizieren</button>}
      {!readOnly && <button className="quiet" type="button" onClick={() => void startCopy(scene.id)} disabled={busy}>In andere Spielstätte kopieren</button>}
      {!readOnly && <button className="quiet" type="button" onClick={() => { dismissForms(); setCapturing({ id: scene.id, name: scene.name }); }} disabled={busy}>Als Szenenvorlage speichern</button>}
    </div>)}</div>
    <div className="section-heading"><h2>Szenenvorlagen</h2></div>
    {!busy && !templates.length && !capturing && !instantiating && !error && <p className="muted">Noch keine Szenenvorlagen vorhanden.{!readOnly && ' Speichern Sie eine Szene als schreibgeschützte Szenenvorlage.'}</p>}
    <div className="scene-list">{templates.map(template => <div className="scene-card" key={template.id}>
      <div className="scene-open"><strong>{template.name}</strong><span>schreibgeschützt</span></div>
      {!readOnly && <button className="quiet" type="button" onClick={() => void startInstantiate(template.id)} disabled={busy}>In Produktion einfügen</button>}
    </div>)}</div>
    {productions.map(item => <PackageExport key={item.productionId} workspaceId={me.workspace.id} productionId={item.productionId}
      scenes={scenes.filter(scene => scene.productionId === item.productionId).map(scene => ({ id: scene.id, name: `${scene.productionName} · ${scene.name}` }))}
      readOnly={readOnly} freezeDisabled={busy} />)}
  </section>;
}
