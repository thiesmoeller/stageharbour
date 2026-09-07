import { useEffect, useState, type FormEvent } from 'react';
import { copySceneSchema, createSceneSchema, sceneListSchema, sceneSchema, type Scene, type VenueGeometry } from '../../shared/layout.js';
import { leaseHolderSchema } from '../../shared/leases.js';
import { AUDIENCE_FLOOR_ID } from '../../shared/levels.js';
import { copiedSceneName } from '../../shared/scenes.js';
import type { Me } from '../../shared/contracts.js';
import { ApiError, request } from '../api.js';
import { Editor } from './Editor.js';

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter(item => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; });
}

export function Plans({ me, onDirty }: { me: Me; onDirty: (value: boolean) => void }) {
  const [scenes, setScenes] = useState<ReturnType<typeof sceneListSchema.parse>>([]);
  const [opened, setOpened] = useState<{ scene: Scene; holdsLease: boolean }>();
  const [creating, setCreating] = useState(false);
  const [copying, setCopying] = useState<{ source: Scene; destVenue?: VenueGeometry }>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const readOnly = me.workspace.role === 'viewer';
  const base = `/api/workspaces/${me.workspace.id}/scenes`;
  useEffect(() => {
    let cancelled = false;
    setBusy(true); setError('');
    request(base).then(data => { if (!cancelled) setScenes(sceneListSchema.parse(data)); })
      .catch(() => { if (!cancelled) setError('Bühnenbilder konnten nicht geladen werden.'); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [base, attempt]);
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
    const input = createSceneSchema.safeParse({ productionName: data.get('productionName'), venueName: data.get('venueName'), sceneName: data.get('sceneName'), width: Number(data.get('width')), depth: Number(data.get('depth')) });
    if (!input.success) { setError('Bitte geben Sie gültige Namen und Maße ein.'); return; }
    setBusy(true); setError('');
    try { await enter(sceneSchema.parse(await request(base, input.data))); setCreating(false); }
    catch { setError('Das Bühnenbild konnte nicht angelegt werden. Prüfen Sie vor einem erneuten Versuch die Übersicht.'); }
    finally { setBusy(false); }
  }
  async function duplicate(id: string) {
    setBusy(true); setError('');
    try { await request(`${base}/${id}/duplicate`, {}); setAttempt(value => value + 1); }
    catch { setError('Die Szene konnte nicht dupliziert werden.'); setBusy(false); }
  }
  async function startCopy(id: string) {
    setBusy(true); setError(''); setCreating(false);
    try {
      const source = sceneSchema.parse(await request(`${base}/${id}`));
      setCopying({ source, destVenue: source.venue });
    } catch { setError('Die Szene konnte nicht geladen werden.'); }
    finally { setBusy(false); }
  }
  async function chooseDestVenue(venueVersionId: string) {
    if (!copying) return;
    const match = scenes.find(scene => scene.venueVersionId === venueVersionId);
    if (!match) { setCopying({ ...copying, destVenue: undefined }); return; }
    if (match.venueVersionId === copying.source.venueVersionId) { setCopying({ ...copying, destVenue: copying.source.venue }); return; }
    setBusy(true); setError('');
    try {
      const dest = sceneSchema.parse(await request(`${base}/${match.id}`));
      setCopying({ ...copying, destVenue: dest.venue });
    } catch { setError('Die Zielspielstätte konnte nicht geladen werden.'); }
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
  function leave() {
    if (opened?.holdsLease) void request(`${base}/${opened.scene.id}/lease/release`, {}).catch(() => {});
    setOpened(undefined); setAttempt(value => value + 1);
  }
  const productions = uniqueBy(scenes, scene => scene.productionId);
  const venues = uniqueBy(scenes, scene => scene.venueVersionId);
  const sourcePlatforms = copying?.source.venue.platforms ?? [];
  const destSurfaces = [
    { id: AUDIENCE_FLOOR_ID, label: 'Zuschauerboden' },
    ...(copying?.destVenue?.platforms ?? []).map(platform => ({ id: platform.id, label: platform.label })),
  ];
  if (opened) return <Editor key={opened.scene.id} initial={opened.scene} workspaceId={me.workspace.id} readOnly={readOnly || !opened.holdsLease} onDirty={onDirty} onClose={leave} />;
  return <section className="plans"><div className="section-heading"><h2>Bühnenbilder</h2>{!readOnly && !creating && !copying && <button onClick={() => setCreating(true)} disabled={busy}>Neues Bühnenbild</button>}</div>
    {error && <div className="error" role="alert">{error} <button className="quiet" onClick={() => setAttempt(value => value + 1)} disabled={busy}>Übersicht neu laden</button></div>}
    {creating && <form className="create-plan" onSubmit={event => void create(event)}><fieldset disabled={busy}>
      <h3>Produktion und Spielstätte anlegen</h3><p className="muted">Für dieses Bühnenbild werden eine neue Produktion und eine rechteckige Spielstätte angelegt.</p>
      <label htmlFor="production-name">Produktion</label><input id="production-name" name="productionName" required maxLength={120} />
      <label htmlFor="venue-name">Spielstätte</label><input id="venue-name" name="venueName" required maxLength={120} />
      <label htmlFor="scene-name">Szene</label><input id="scene-name" name="sceneName" defaultValue="Szene 1" required maxLength={120} />
      <div className="numeric-fields"><div><label htmlFor="venue-width">Spielstättenbreite (mm)</label><input id="venue-width" name="width" type="number" min="1" max="100000" step="any" required /></div><div><label htmlFor="venue-depth">Spielstättentiefe (mm)</label><input id="venue-depth" name="depth" type="number" min="1" max="100000" step="any" required /></div></div>
      <div className="form-actions"><button type="submit">Bühnenbild anlegen</button><button className="quiet" type="button" onClick={() => setCreating(false)}>Abbrechen</button></div>
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
      {sourcePlatforms.length > 0 && <>
        <h4>Auflageflächen zuordnen</h4>
        <p className="muted">Übertragene Teile behalten ihre relative Anordnung. Nicht zugeordnete Auflageflächen müssen in der Zielspielstätte neu gewählt werden.</p>
        {sourcePlatforms.map(platform => <div key={platform.id}>
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
    {busy && <p role="status">Bühnenbilder werden geladen …</p>}
    {!busy && !scenes.length && !creating && !copying && !error && <p className="muted">Noch keine Bühnenbilder vorhanden.{!readOnly && ' Legen Sie Ihre erste Produktion mit Spielstätte und Szene an.'}</p>}
    <div className="scene-list">{scenes.map(scene => <div className="scene-card" key={scene.id}>
      <button className="quiet scene-open" onClick={() => void open(scene.id)} disabled={busy}>
        <strong>{scene.productionName} · {scene.name}</strong>
        <span>{scene.venueName}{scene.lease ? ` · Bearbeitung durch ${scene.lease.holderName}` : ''} →</span>
      </button>
      {!readOnly && <button className="quiet" type="button" onClick={() => void duplicate(scene.id)} disabled={busy}>Szene duplizieren</button>}
      {!readOnly && <button className="quiet" type="button" onClick={() => void startCopy(scene.id)} disabled={busy}>In andere Spielstätte kopieren</button>}
    </div>)}</div>
  </section>;
}
