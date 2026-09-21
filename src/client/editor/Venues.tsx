import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Me } from '../../shared/contracts.js';
import { createVenueSchema, renameVenueSchema, venueListSchema, venueRecordSchema, type VenueRecord } from '../../shared/venueLibrary.js';
import { ApiError, request } from '../api.js';
import { ToolIcon } from './ToolIcon.js';
import { VenuePanel } from './VenuePanel.js';
import { PlanPreview } from './PlanPreview.js';
import { can } from '../../shared/permissions.js';
import { useEditingLease } from './useEditingLease.js';

export function Venues({ me, onDirty }: { me: Me; onDirty: (dirty: boolean) => void }) {
  const [venues, setVenues] = useState<ReturnType<typeof venueListSchema.parse>>([]);
  const [opened, setOpened] = useState<VenueRecord>();
  const openedRef = useRef(opened);
  openedRef.current = opened;
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const readOnly = !can(me.workspace.role, 'venues');
  const base = `/api/workspaces/${me.workspace.id}/venues`;
  const lease = useEditingLease(`${base}/${opened?.id ?? ''}`, !!opened && !readOnly);
  useEffect(() => { if (opened && !readOnly) void lease.acquire(); }, [opened?.id, readOnly]);
  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    request(base).then(data => { if (active) setVenues(venueListSchema.parse(data)); })
      .catch(() => { if (active) setError('Spielstätten konnten nicht geladen werden.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [base, attempt]);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  async function open(id: string) {
    setBusy(true); setError('');
    try { setOpened(venueRecordSchema.parse(await request(`${base}/${id}`))); }
    catch { setError('Die Spielstätte konnte nicht geöffnet werden.'); }
    finally { setBusy(false); }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = createVenueSchema.safeParse({ name: data.get('name'), width: Number(data.get('width')), depth: Number(data.get('depth')) });
    if (!parsed.success) { setError('Bitte geben Sie einen Namen und gültige Maße ein.'); return; }
    setBusy(true); setError('');
    try { setOpened(venueRecordSchema.parse(await request(base, parsed.data))); setCreating(false); }
    catch { setError('Die Spielstätte konnte nicht angelegt werden.'); }
    finally { setBusy(false); }
  }
  async function rename(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = renameVenueSchema.safeParse({ name: data.get('name') });
    if (!parsed.success) { setError('Bitte geben Sie einen gültigen Namen ein.'); return; }
    setBusy(true); setError('');
    try {
      const result = venueRecordSchema.parse(await request(`${base}/${id}`, parsed.data, 'PATCH'));
      setVenues(current => current.map(item => item.id === id ? { ...item, name: result.name, venueVersionId: result.venueVersionId } : item).sort((a, b) => a.name.localeCompare(b.name, 'de')));
      setOpened(current => current?.id === id ? { ...current, name: result.name, venueVersionId: result.venueVersionId } : current);
      setRenamingId(undefined);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Die Spielstätte konnte nicht umbenannt werden.');
    } finally { setBusy(false); }
  }
  async function remove(id: string, name: string) {
    if (!window.confirm(`Spielstätte „${name}“ wirklich löschen? Nur möglich, wenn keine Produktion sie mehr verwendet.`)) return;
    setBusy(true); setError('');
    try { await request(`${base}/${id}`, undefined, 'DELETE'); setAttempt(value => value + 1); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Die Spielstätte konnte nicht gelöscht werden.'); setBusy(false); }
  }
  if (opened) return <section className="editor venue-workspace" aria-label="Spielstätte unabhängig bearbeiten">
    <div className="editor-heading"><button className="quiet back-button" disabled={dirty} onClick={() => { setOpened(undefined); setAttempt(value => value + 1); }} aria-label="Zur Spielstättenübersicht" title={dirty ? 'Entwurf zuerst speichern oder verwerfen' : 'Zur Spielstättenübersicht'}><ToolIcon name="back" /></button>
      <div><p className="eyebrow">SPIELSTÄTTEN & BÜHNEN</p><h2>{opened.name}</h2></div><span className="document-kind">{readOnly ? 'Nur Ansicht' : 'Spielstätte bearbeiten'}</span></div>
    <p className="venue-independence">Raum einmal anlegen · Produktionen übernehmen Fassungen auf Wunsch.</p>
    {!readOnly && <p role="status">{lease.message || 'Bearbeitung wird angefordert …'} {!lease.holding && <button onClick={() => void lease.acquire()}>Bearbeitung erneut anfordern</button>}</p>}
    <VenuePanel key={opened.id} workspaceId={me.workspace.id} venue={opened.venue} venueId={opened.id} venueName={opened.name}
      readOnly={readOnly || !lease.holding} onDirty={setDirty}
      onVenueRenamed={({ name, venueVersionId }) => setOpened(current => current ? { ...current, name, venueVersionId } : current)}
      onPublish={async geometry => {
        const current = openedRef.current;
        if (!current) return;
        const result = venueRecordSchema.parse(await request(`${base}/${current.id}`, { venueVersionId: current.venueVersionId, venue: geometry }, 'PUT'));
        setOpened(result);
      }} />
  </section>;
  return <section className="plans venue-library" aria-label="Spielstätten und Bühnen">
    <div className="section-heading"><div><h2>Spielstätten & Bühnen</h2><p className="muted">Räume einmal anlegen. Für viele Produktionen verwenden.</p></div>
      {!readOnly && <button disabled={busy || creating} onClick={() => setCreating(true)}>Neue Spielstätte</button>}</div>
    {error && <p className="error" role="alert">{error} <button className="quiet" onClick={() => setAttempt(value => value + 1)}>Erneut versuchen</button></p>}
    {creating && <form className="create-plan" onSubmit={event => void create(event)}><fieldset disabled={busy}>
      <h3>Eine Spielstätte anlegen</h3><label htmlFor="new-venue-name">Name der Spielstätte</label><input id="new-venue-name" name="name" required maxLength={120} />
      <div className="numeric-fields"><label>Breite (mm)<input name="width" type="number" required min="1" max="100000" defaultValue="8000" /></label><label>Tiefe (mm)<input name="depth" type="number" required min="1" max="100000" defaultValue="6000" /></label></div>
      <p className="muted">Starten Sie mit einem Rechteck. Umriss, Podeste, Treppen und feste Einrichtungen bearbeiten Sie anschließend.</p>
      <div className="form-actions"><button>Spielstätte anlegen</button><button type="button" className="quiet" onClick={() => setCreating(false)}>Abbrechen</button></div>
    </fieldset></form>}
    {busy && <p role="status">Spielstätten werden geladen …</p>}
    {!busy && !error && !venues.length && <p className="muted">Noch keine Spielstätten vorhanden. Eine Spielstätte ist unabhängig von einer Produktion oder Szene.</p>}
    <div className="venue-cards">{venues.map(item => <div className="venue-card-wrap" key={item.id}>
      <button className="venue-card quiet" disabled={busy} onClick={() => void open(item.id)}>
        <span className="venue-card-art" aria-hidden="true">
          <PlanPreview preview={{ width: item.width, depth: item.depth, walls: [], platforms: [] }} label={`Grundriss ${item.name}`} />
        </span>
        <strong>{item.name}</strong>
        <span>{(item.width / 1000).toLocaleString('de-DE')} × {(item.depth / 1000).toLocaleString('de-DE')} m</span>
        <span className="venue-card-action">{readOnly ? 'Spielstätte ansehen' : 'Spielstätte gestalten'} →</span>
      </button>
      {!readOnly && renamingId === item.id && <form className="create-plan venue-rename" onSubmit={event => void rename(event, item.id)}>
        <label htmlFor={`rename-venue-${item.id}`}>Neuer Name</label>
        <input id={`rename-venue-${item.id}`} name="name" required maxLength={120} defaultValue={item.name} autoFocus />
        <div className="form-actions">
          <button type="submit" disabled={busy}>Umbenennen</button>
          <button type="button" className="quiet" disabled={busy} onClick={() => setRenamingId(undefined)}>Abbrechen</button>
        </div>
      </form>}
      {!readOnly && <div className="form-actions">
        <button className="quiet" type="button" disabled={busy} onClick={() => setRenamingId(item.id)}>Umbenennen</button>
        <button className="quiet" type="button" disabled={busy} onClick={() => void remove(item.id, item.name)}>Löschen</button>
      </div>}
    </div>)}</div>
  </section>;
}
