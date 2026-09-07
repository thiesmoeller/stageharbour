import { useEffect, useState, type FormEvent } from 'react';
import { createSceneSchema, sceneListSchema, sceneSchema, type Scene } from '../../shared/layout.js';
import { leaseHolderSchema } from '../../shared/leases.js';
import type { Me } from '../../shared/contracts.js';
import { ApiError, request } from '../api.js';
import { Editor } from './Editor.js';

export function Plans({ me, onDirty }: { me: Me; onDirty: (value: boolean) => void }) {
  const [scenes, setScenes] = useState<ReturnType<typeof sceneListSchema.parse>>([]);
  const [opened, setOpened] = useState<{ scene: Scene; holdsLease: boolean }>();
  const [creating, setCreating] = useState(false);
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
  function leave() {
    if (opened?.holdsLease) void request(`${base}/${opened.scene.id}/lease/release`, {}).catch(() => {});
    setOpened(undefined); setAttempt(value => value + 1);
  }
  if (opened) return <Editor key={opened.scene.id} initial={opened.scene} workspaceId={me.workspace.id} readOnly={readOnly || !opened.holdsLease} onDirty={onDirty} onClose={leave} />;
  return <section className="plans"><div className="section-heading"><h2>Bühnenbilder</h2>{!readOnly && !creating && <button onClick={() => setCreating(true)} disabled={busy}>Neues Bühnenbild</button>}</div>
    {error && <div className="error" role="alert">{error} <button className="quiet" onClick={() => setAttempt(value => value + 1)} disabled={busy}>Übersicht neu laden</button></div>}
    {creating && <form className="create-plan" onSubmit={event => void create(event)}><fieldset disabled={busy}>
      <h3>Produktion und Spielstätte anlegen</h3><p className="muted">Für dieses Bühnenbild werden eine neue Produktion und eine rechteckige Spielstätte angelegt.</p>
      <label htmlFor="production-name">Produktion</label><input id="production-name" name="productionName" required maxLength={120} />
      <label htmlFor="venue-name">Spielstätte</label><input id="venue-name" name="venueName" required maxLength={120} />
      <label htmlFor="scene-name">Szene</label><input id="scene-name" name="sceneName" defaultValue="Szene 1" required maxLength={120} />
      <div className="numeric-fields"><div><label htmlFor="venue-width">Spielstättenbreite (mm)</label><input id="venue-width" name="width" type="number" min="1" max="100000" step="any" required /></div><div><label htmlFor="venue-depth">Spielstättentiefe (mm)</label><input id="venue-depth" name="depth" type="number" min="1" max="100000" step="any" required /></div></div>
      <div className="form-actions"><button type="submit">Bühnenbild anlegen</button><button className="quiet" type="button" onClick={() => setCreating(false)}>Abbrechen</button></div>
    </fieldset></form>}
    {busy && <p role="status">Bühnenbilder werden geladen …</p>}
    {!busy && !scenes.length && !creating && !error && <p className="muted">Noch keine Bühnenbilder vorhanden.{!readOnly && ' Legen Sie Ihre erste Produktion mit Spielstätte und Szene an.'}</p>}
    <div className="scene-list">{scenes.map(scene => <button className="scene-card quiet" key={scene.id} onClick={() => void open(scene.id)} disabled={busy}><strong>{scene.productionName} · {scene.name}</strong><span>{scene.venueName}{scene.lease ? ` · Bearbeitung durch ${scene.lease.holderName}` : ''} →</span></button>)}</div>
  </section>;
}
