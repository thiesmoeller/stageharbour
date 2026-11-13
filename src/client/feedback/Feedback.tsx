import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type ClipboardEventHandler } from 'react';
import { createPortal } from 'react-dom';
import type { Me } from '../../shared/contracts.js';
import { FEEDBACK_ATTACHMENT_BYTES, feedbackHash, feedbackPageLabel, feedbackOptionsSchema, feedbackSchema, type FeedbackImage, type FeedbackReport, type FeedbackWork } from '../../shared/feedback.js';
import { request } from '../api.js';
import { parseWorkspaceLocation } from '../workspaceRoutes.js';
import { useModalFocus } from '../editor/useModalFocus.js';
import { enableFeedbackActivity, feedbackActivity, recordFeedbackActivity } from './activity.js';
import { readFeedbackImage } from './capture.js';
import './feedback.css';

type Adapter = { work: FeedbackWork; snapshot?: string; capture?: () => Promise<FeedbackImage> };
type Registration = { priority: number; read: () => Adapter };
type FeedbackControls = { enabled: boolean; open: () => void; register: (entry: Registration) => () => void };
const FeedbackContext = createContext<FeedbackControls | null>(null);
// Editor registration stays stable while users type in the reporting dialog.
const RegistrationContext = createContext<FeedbackControls['register'] | null>(null);

export function useFeedbackAdapter(read: () => Adapter, priority = 1) {
  const register = useContext(RegistrationContext);
  const latest = useRef(read); latest.current = read;
  useEffect(() => register?.({ priority, read: () => latest.current() }), [register, priority]);
}
export function FeedbackButton() {
  const controls = useContext(FeedbackContext);
  return controls?.enabled ? <button type="button" className="quiet" onClick={controls.open}>Feedback</button> : null;
}

function FeedbackModal({ onClose, onPaste, children }: { onClose: () => void; onPaste: ClipboardEventHandler<HTMLDivElement>; children: ReactNode }) {
  // Owning focus inside the portal reinitializes the trap when fullscreen changes its host.
  const modal = useModalFocus<HTMLDivElement>(true, onClose);
  return <div className="feedback-backdrop" onKeyDown={event => event.stopPropagation()}>
    <div ref={modal} className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title" tabIndex={-1} onPaste={onPaste}>
      {children}
    </div>
  </div>;
}

type Draft = { report: FeedbackReport; snapshot?: string; workIncluded: boolean; activityIncluded: boolean; snapshotIncluded: boolean };
export function FeedbackProvider({ me, children }: { me?: Me; children: ReactNode }) {
  const entries = useRef(new Set<Registration>());
  const [enabled, setEnabled] = useState(false);
  const [version, setVersion] = useState('');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>();
  const [capturing, setCapturing] = useState(false);
  const [pending, setPending] = useState(false);
  const [readingImages, setReadingImages] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [success, setSuccess] = useState(false);
  const [portal, setPortal] = useState<Element | null>(null);
  const generation = useRef(0);
  const activeMe = useRef(me); activeMe.current = me;
  const register = useCallback((entry: Registration) => { entries.current.add(entry); return () => { entries.current.delete(entry); }; }, []);
  useEffect(() => {
    const sync = () => setPortal(document.fullscreenElement ?? document.body);
    sync(); document.addEventListener('fullscreenchange', sync); return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  useEffect(() => {
    let cancelled = false;
    setEnabled(false); setOpen(false); setDraft(undefined); setError(''); setNotice(''); setSuccess(false); setCapturing(false); setPending(false); setReadingImages(false); generation.current++;
    enableFeedbackActivity(false);
    if (me) request('/api/feedback-options').then(value => {
      if (cancelled) return;
      const options = feedbackOptionsSchema.parse(value);
      setEnabled(options.enabled); setVersion(options.version); enableFeedbackActivity(options.enabled);
    }).catch(() => {});
    return () => { cancelled = true; generation.current++; enableFeedbackActivity(false); };
  }, [me?.user.id, me?.workspace.id]);
  useEffect(() => {
    if (!enabled) return;
    const record = () => { const page = parseWorkspaceLocation(location.hash); if (page) recordFeedbackActivity({ action: 'navigation', area: page.section }); };
    record(); window.addEventListener('hashchange', record); return () => window.removeEventListener('hashchange', record);
  }, [enabled]);
  function show() {
    if (!enabled || !me) return;
    setOpen(true); setSuccess(false);
    if (draft) return;
    setError(''); setNotice('');
    const page = parseWorkspaceLocation(location.hash) ?? { section: 'plans' as const };
    let adapter: Adapter | undefined;
    try { adapter = [...entries.current].sort((a, b) => b.priority - a.priority)[0]?.read(); }
    catch { setNotice('Arbeitskontext konnte nicht vollständig erfasst werden. Sie können trotzdem berichten.'); }
    const snapshot = adapter?.snapshot;
    const snapshotFits = snapshot !== undefined && new TextEncoder().encode(snapshot).length <= FEEDBACK_ATTACHMENT_BYTES;
    if (snapshot && !snapshotFits) setNotice('Der Entwurf ist zu groß zum Anhängen (maximal 2 MiB).');
    const report: FeedbackReport = {
      category: 'issue', message: '', capturedAt: new Date().toISOString(),
      page: { section: page.section, ...('sceneId' in page ? { sceneId: page.sceneId } : {}), ...('venueId' in page ? { venueId: page.venueId } : {}), ...('partId' in page && /^[0-9a-f-]{36}$/i.test(page.partId) ? { partId: page.partId } : {}) },
      browser: navigator.userAgent.slice(0, 500), viewport: { width: innerWidth, height: innerHeight },
      work: adapter?.work ? structuredClone(adapter.work) : undefined, activity: feedbackActivity(), images: [],
    };
    setDraft({ report, snapshot: snapshotFits ? snapshot : undefined, workIncluded: true, activityIncluded: true, snapshotIncluded: false });
    if (adapter?.capture) {
      const token = ++generation.current;
      setCapturing(true);
      let timeout: ReturnType<typeof setTimeout>;
      const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Aufnahme-Timeout')), 20_000); });
      const captureOnce = () => adapter.capture!();
      const captureWithRetry = async () => {
        try { return await captureOnce(); }
        catch (first) {
          await new Promise<void>(resolve => setTimeout(resolve, 400));
          if (generation.current !== token) throw first;
          return await captureOnce();
        }
      };
      void Promise.race([captureWithRetry(), deadline]).then(image => {
        if (generation.current === token) setDraft(value => value ? { ...value, report: { ...value.report, images: [...value.report.images, image].slice(0, 2) } } : value);
      }).catch(error => {
        if (generation.current !== token) return;
        const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
        setNotice(`Automatische Bildaufnahme fehlgeschlagen.${detail} Sie können ein Bild einfügen oder ohne Bild senden.`);
      }).finally(() => { clearTimeout(timeout); if (generation.current === token) setCapturing(false); });
    }
  }
  function patchReport(patch: Partial<FeedbackReport>) { setDraft(value => value ? { ...value, report: { ...value.report, ...patch } } : value); }
  async function addImages(files: File[]) {
    if (readingImages || pending || !files.length) return;
    setReadingImages(true);
    const token = generation.current;
    try {
      const images = await Promise.all(files.slice(0, 2).map(readFeedbackImage));
      if (token !== generation.current) return;
      setDraft(value => value ? { ...value, report: { ...value.report, images: [...value.report.images, ...images].slice(0, 2) } } : value);
      setError('');
    } catch (error) { if (token === generation.current) setError(error instanceof Error ? error.message : 'Bild konnte nicht gelesen werden.'); }
    finally { if (token === generation.current) setReadingImages(false); }
  }
  function payload(): FeedbackReport | undefined {
    if (!draft) return;
    return { ...draft.report, work: draft.workIncluded ? draft.report.work : undefined, activity: draft.activityIncluded ? draft.report.activity : undefined, snapshot: draft.snapshotIncluded ? draft.snapshot : undefined };
  }
  async function send() {
    const report = payload();
    if (!me || !report || pending || capturing || readingImages) return;
    const parsed = feedbackSchema.safeParse(report);
    if (!parsed.success) { setError('Bitte Nachricht und Anhänge prüfen.'); return; }
    setPending(true); setError('');
    const token = generation.current;
    try {
      await request(`/api/workspaces/${me.workspace.id}/feedback`, parsed.data);
      if (token !== generation.current || activeMe.current?.user.id !== me.user.id) return;
      generation.current++; setDraft(undefined); setSuccess(true); setNotice('');
    } catch (error) { if (token === generation.current) setError(error instanceof Error ? error.message : 'Versand fehlgeschlagen.'); }
    finally { if (activeMe.current?.user.id === me.user.id) setPending(false); }
  }
  const close = () => { if (!pending) setOpen(false); };
  const report = payload();
  return <RegistrationContext value={register}><FeedbackContext value={{ enabled, open: show, register }}>
    {children}
    {open && portal && createPortal(<FeedbackModal onClose={close}
        onPaste={event => { const files = [...event.clipboardData.files]; if (files.length && !pending && !capturing) { event.preventDefault(); void addImages(files); } }}>
        <h2 id="feedback-title">Feedback</h2>
        {success ? <p role="status">Danke! Ihr Feedback wurde an den E-Mail-Dienst übergeben.</p> : draft && <form onSubmit={event => { event.preventDefault(); void send(); }}>
          <fieldset disabled={pending}>
            <label htmlFor="feedback-category">Worum geht es?</label>
            <select id="feedback-category" value={draft.report.category} onChange={event => {
              const category = event.target.value === 'feature' ? 'feature' : 'issue';
              setDraft(value => value ? { ...value, activityIncluded: category === 'issue', report: { ...value.report, category } } : value);
            }}><option value="issue">Problem melden</option><option value="feature">Verbesserung vorschlagen</option></select>
            <label htmlFor="feedback-message">{draft.report.category === 'issue' ? 'Was ist passiert, und was hätten Sie erwartet?' : 'Was möchten Sie einfacher erledigen können?'}</label>
            <textarea id="feedback-message" required maxLength={4000} rows={4} value={draft.report.message} onChange={event => patchReport({ message: event.target.value })} placeholder="Ein kurzer Satz reicht oft." />
            <p className="feedback-hint">Antwort an {me?.user.email} · {draft.report.work?.layout ?? draft.report.work?.venue ?? feedbackPageLabel(draft.report.page)}</p>
            {draft.report.work && <label className="feedback-check"><input type="checkbox" checked={draft.workIncluded} onChange={event => setDraft({ ...draft, workIncluded: event.target.checked })} />Arbeitsdetails mitsenden</label>}
            <label className="feedback-check"><input type="checkbox" checked={draft.activityIncluded} onChange={event => setDraft({ ...draft, activityIncluded: event.target.checked })} />Letzte Aktivitäten mitsenden ({draft.report.activity?.length ?? 0})</label>
            {draft.snapshot && <><label className="feedback-check"><input type="checkbox" checked={draft.snapshotIncluded} onChange={event => setDraft({ ...draft, snapshotIncluded: event.target.checked })} />Aktuellen Entwurf anhängen</label><p className="feedback-hint">Enthält ungespeicherte Modelländerungen. Nicht übernommene Eingaben und Modelldateien sind nicht enthalten.</p></>}
            <div className="feedback-images">{draft.report.images.map((image, index) => <figure key={index}>
              <img src={`data:${image.type};base64,${image.base64}`} alt={`Bildvorschau ${index + 1}`} />
              <button type="button" className="quiet" onClick={() => patchReport({ images: draft.report.images.filter((_, i) => i !== index) })}>Bild {index + 1} entfernen</button>
            </figure>)}</div>
            {capturing && <p role="status">Arbeitsansicht wird aufgenommen … <button type="button" className="quiet" onClick={() => { generation.current++; setCapturing(false); }}>Ohne Aufnahme fortfahren</button></p>}
            {readingImages && <p role="status">Bild wird gelesen …</p>}
            <label htmlFor="feedback-images">Bild hinzufügen oder hier einfügen (PNG/JPEG, je 2 MiB, höchstens 2)</label>
            <input id="feedback-images" type="file" accept="image/png,image/jpeg" multiple disabled={capturing || readingImages || draft.report.images.length >= 2} onChange={event => { void addImages([...(event.target.files ?? [])]); event.target.value = ''; }} />
            <details><summary>Wird mitgesendet</summary><p>Ihr Name und Ihre E-Mail-Adresse, Arbeitsbereich, App-Version, Seite, Browser und die unten ausgewählten Angaben.</p>
              <pre>{JSON.stringify({ sender: me?.user, workspace: me?.workspace, version, ...report, images: report?.images.map(image => ({ type: image.type, bytes: Math.floor(image.base64.length * 3 / 4) })), snapshot: report?.snapshot ? 'Diagnoseentwurf als JSON-Textdatei' : undefined, url: location.origin + feedbackHash(draft.report.page) }, null, 2)}</pre>
              {report?.snapshot && <details><summary>Entwurf ansehen</summary><pre>{report.snapshot}</pre></details>}
            </details>
          </fieldset>
          {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="error">{error}</p>}
          <button type="submit" disabled={pending || capturing || readingImages || !draft.report.message.trim()}>{pending ? 'Wird gesendet …' : 'Feedback senden'}</button>
        </form>}
        <button type="button" className="quiet" disabled={pending} onClick={close}>Schließen</button>
    </FeedbackModal>, portal)}
  </FeedbackContext></RegistrationContext>;
}
