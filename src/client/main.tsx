import { StrictMode, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { invitationSchema, loginOptionsSchema, meSchema, membersSchema, invitationPreviewSchema, passwordResetPreviewSchema, brandingSchema, DEFAULT_BRANDING, type Branding, type Me, type Member, type Role } from '../shared/contracts.js';
import { ApiError, request, upload } from './api.js';
import { Venues } from './editor/Venues.js';
import { Plans } from './editor/Plans.js';
import { can } from '../shared/permissions.js';
import { AuditLog } from './AuditLog.js';
import './style.css';
import './workspace.css';

const roleNames: Record<Role, string> = { administrator: 'Administration', editor: 'Bearbeitung', viewer: 'Ansicht' };
const linkedSchema = z.array(z.object({ id: z.string(), providerId: z.string() }));
const roles: Role[] = ['administrator', 'editor', 'viewer'];
type Screen = { kind: 'loading' } | { kind: 'login' } | { kind: 'workspace'; me: Me } | { kind: 'error'; message: string; denied: boolean };
type HashRoute = { kind: 'app' } | { kind: 'invite'; token: string } | { kind: 'reset'; token: string } | { kind: 'forgot' };

function readHash(): HashRoute {
  const raw = location.hash.replace(/^#/, '');
  const invite = /^\/einladung\/([^/]+)$/.exec(raw);
  if (invite) return { kind: 'invite', token: invite[1]! };
  const reset = /^\/passwort\/([^/]+)$/.exec(raw);
  if (reset) return { kind: 'reset', token: reset[1]! };
  if (raw === '/passwort-vergessen') return { kind: 'forgot' };
  return { kind: 'app' };
}

async function startPocketId(path: '/api/auth/sign-in/social' | '/api/auth/link-social') {
  const data = z.object({ url: z.string() }).parse(await request(path, {
    provider: 'pocket-id', callbackURL: '/', errorCallbackURL: '/', disableRedirect: true,
  }));
  window.location.assign(data.url);
}

function App() {
  const [route, setRoute] = useState(readHash);
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [signOutError, setSignOutError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [logoKey, setLogoKey] = useState(0);
  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    let cancelled = false;
    request('/api/branding').then(data => {
      if (cancelled) return;
      const next = brandingSchema.parse(data);
      setBranding(next);
      document.title = next.productName;
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const applyBranding = useCallback((next: Branding) => {
    setBranding(next);
    setLogoKey(value => value + 1);
    document.title = next.productName;
  }, []);
  const load = useCallback(async () => {
    setScreen({ kind: 'loading' });
    try {
      setScreen({ kind: 'workspace', me: meSchema.parse(await request('/api/me')) });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setScreen({ kind: 'login' });
      else {
        const denied = error instanceof ApiError && [403, 404].includes(error.status);
        setScreen({ kind: 'error', denied, message: denied
          ? 'Ihr Konto hat keinen Zugang zu diesem Arbeitsbereich. Bitte wenden Sie sich an die Administration Ihrer Theatergruppe.'
          : 'Der Arbeitsbereich konnte nicht geladen werden. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.' });
      }
    }
  }, []);
  useEffect(() => { if (route.kind === 'app') void load(); }, [load, route.kind]);
  async function signOut() {
    setSigningOut(true);
    setSignOutError('');
    try { await request('/api/auth/sign-out', {}); setScreen({ kind: 'login' }); }
    catch { setSignOutError('Abmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.'); }
    finally { setSigningOut(false); }
  }
  const homeLabel = `${branding.productName} Startseite`;
  return <div className="app">
    <header className="masthead">
      <a className="brand" href="/" aria-label={homeLabel}>
        {branding.hasLogo
          ? <img className="brand-logo" src={`/api/branding/logo?v=${logoKey}`} alt="" />
          : <span className="brand-icon" aria-hidden="true">▱</span>}
        {branding.productName}
      </a>
      {branding.tagline ? <span className="edition">{branding.tagline}</span> : null}
      {(screen.kind === 'workspace' || (screen.kind === 'error' && screen.denied)) && route.kind === 'app' && <button className="quiet" onClick={() => void signOut()} disabled={signingOut || dirty} title={dirty ? 'Bitte zuerst Änderungen speichern oder sichern.' : undefined}>{signingOut ? 'Abmeldung …' : 'Abmelden'}</button>}
    </header>
    {signOutError && <p className="error banner" role="alert">{signOutError}</p>}
    {route.kind === 'invite' && <AcceptInvite token={route.token} />}
    {route.kind === 'reset' && <CompleteReset token={route.token} />}
    {route.kind === 'forgot' && <ForgotPassword />}
    {route.kind === 'app' && screen.kind === 'loading' && <main className="loading" role="status">Arbeitsbereich wird geladen …</main>}
    {route.kind === 'app' && screen.kind === 'login' && <Login onSuccess={load} />}
    {route.kind === 'app' && screen.kind === 'workspace' && <Workspace me={screen.me} branding={branding} onBranding={applyBranding} onDirty={setDirty} />}
    {route.kind === 'app' && screen.kind === 'error' && <main className="error-page"><p className="eyebrow">ARBEITSBEREICH</p><h1>{screen.denied ? 'Zugang erforderlich' : 'Verbindung unterbrochen'}</h1><p role="alert">{screen.message}</p><button onClick={() => void load()}>Erneut versuchen</button></main>}
    <footer>{branding.footerText}</footer>
  </div>;
}

function Login({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(() => new URLSearchParams(window.location.search).has('error')
    ? 'Anmeldung mit Pocket ID fehlgeschlagen. Bitte versuchen Sie es erneut.' : '');
  const [oidc, setOidc] = useState(false);
  useEffect(() => {
    let cancelled = false;
    request('/api/login-options').then(data => { if (!cancelled) setOidc(loginOptionsSchema.parse(data).oidc); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    try {
      await request('/api/auth/sign-in/email', { email: data.get('email'), password: data.get('password'), rememberMe: false });
      await onSuccess();
    } catch (error) {
      setError(error instanceof ApiError && [400, 401, 403].includes(error.status)
        ? 'Anmeldung fehlgeschlagen. Bitte prüfen Sie E-Mail-Adresse und Passwort.'
        : error instanceof Error ? error.message : 'Anmeldung fehlgeschlagen.');
    } finally { setPending(false); }
  }
  async function signInOidc() {
    setPending(true); setError('');
    try { await startPocketId('/api/auth/sign-in/social'); }
    catch { setError('Anmeldung mit Pocket ID fehlgeschlagen. Bitte versuchen Sie es erneut.'); setPending(false); }
  }
  return <main className="login-layout">
    <section className="introduction">
      <p className="eyebrow">EURE BÜHNE BEGINNT HIER</p>
      <h1>Eine Bühne.<br />Viele Möglichkeiten.</h1>
      <p className="lead">Der gemeinsame Arbeitsbereich für eure Theatergruppe.</p>
      <div className="stage-art" aria-hidden="true"><div className="stage-grid" /><div className="wall wall-one" /><div className="wall wall-two" /><div className="wall wall-three" /><span className="stage-caption">RAUM FÜR EURE IDEEN</span></div>
    </section>
    <section className="login-card" aria-labelledby="login-title">
      <span className="card-mark" aria-hidden="true">↗</span><h2 id="login-title">Willkommen zurück</h2>
      <p>Meldet euch mit eurem persönlichen Konto an.</p>
      {oidc && <button className="oidc" type="button" onClick={() => void signInOidc()} disabled={pending}>Mit Pocket ID anmelden</button>}
      {oidc && <p className="login-divider">oder mit E-Mail und Passwort</p>}
      <form onSubmit={event => void submit(event)}>
        <label htmlFor="email">E-Mail-Adresse</label><input id="email" name="email" type="email" autoComplete="username" required disabled={pending} />
        <label htmlFor="password">Passwort</label><input id="password" name="password" type="password" autoComplete="current-password" required disabled={pending} />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={pending}>{pending ? 'Anmeldung läuft …' : 'Anmelden'}<span aria-hidden="true">→</span></button>
      </form>
      <p className="forgot"><a href="#/passwort-vergessen">Passwort vergessen?</a></p>
      <p className="access-note">Der Zugang wird von eurer Administration eingerichtet. Eine öffentliche Registrierung ist nicht möglich.</p>
    </section>
  </main>;
}

function TokenCard({ title, children }: { title: string; children: ReactNode }) {
  return <main className="login-layout"><section className="login-card" aria-labelledby="token-title">
    <span className="card-mark" aria-hidden="true">↗</span><h2 id="token-title">{title}</h2>{children}
  </section></main>;
}

function AcceptInvite({ token }: { token: string }) {
  const [preview, setPreview] = useState<ReturnType<typeof invitationPreviewSchema.parse>>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let cancelled = false;
    request(`/api/invitations/${token}`).then(data => { if (!cancelled) setPreview(invitationPreviewSchema.parse(data)); })
      .catch(() => { if (!cancelled) setError('Diese Einladung ist nicht mehr gültig.'); });
    return () => { cancelled = true; };
  }, [token]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') ?? '');
    if (password !== String(data.get('confirm'))) { setError('Die Passwörter stimmen nicht überein.'); return; }
    setPending(true); setError('');
    try {
      await request(`/api/invitations/${token}/accept`, { password });
      location.hash = '';
    } catch {
      setError('Das Konto konnte nicht eingerichtet werden. Der Link ist möglicherweise abgelaufen.');
    } finally { setPending(false); }
  }
  if (!preview && !error) return <main className="loading" role="status">Einladung wird geprüft …</main>;
  if (!preview) return <TokenCard title="Einladung ungültig"><p role="alert">{error}</p><p className="forgot"><a href="/">Zur Anmeldung</a></p></TokenCard>;
  return <TokenCard title="Konto einrichten">
    <p>{preview.name}, Sie wurden als {roleNames[preview.role]} zum Arbeitsbereich {preview.workspaceName} eingeladen.</p>
    <form onSubmit={event => void submit(event)}>
      <label htmlFor="invite-password">Passwort</label><input id="invite-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={pending} />
      <label htmlFor="invite-confirm">Passwort bestätigen</label><input id="invite-confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={pending} />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={pending}>{pending ? 'Konto wird eingerichtet …' : 'Passwort speichern'}<span aria-hidden="true">→</span></button>
    </form>
  </TokenCard>;
}

function ForgotPassword() {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true); setError('');
    try {
      await request('/api/password-resets', { email: data.get('email') });
      setDone(true);
    } catch { setError('Die Anfrage konnte nicht gesendet werden. Bitte versuchen Sie es erneut.'); }
    finally { setPending(false); }
  }
  return <TokenCard title="Passwort zurücksetzen">
    {done ? <p role="status">Wenn ein Konto mit dieser E-Mail-Adresse existiert, senden wir einen Link zum Zurücksetzen.</p>
      : <form onSubmit={event => void submit(event)}>
        <label htmlFor="reset-email">E-Mail-Adresse</label><input id="reset-email" name="email" type="email" autoComplete="username" required disabled={pending} />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={pending}>{pending ? 'Wird gesendet …' : 'Link senden'}<span aria-hidden="true">→</span></button>
      </form>}
    <p className="forgot"><a href="#/">Zur Anmeldung</a></p>
  </TokenCard>;
}

function CompleteReset({ token }: { token: string }) {
  const [preview, setPreview] = useState<ReturnType<typeof passwordResetPreviewSchema.parse>>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let cancelled = false;
    request(`/api/password-resets/${token}`).then(data => { if (!cancelled) setPreview(passwordResetPreviewSchema.parse(data)); })
      .catch(() => { if (!cancelled) setError('Dieser Link zum Zurücksetzen ist nicht mehr gültig.'); });
    return () => { cancelled = true; };
  }, [token]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') ?? '');
    if (password !== String(data.get('confirm'))) { setError('Die Passwörter stimmen nicht überein.'); return; }
    setPending(true); setError('');
    try {
      await request(`/api/password-resets/${token}`, { password });
      location.hash = '';
    } catch { setError('Das Passwort konnte nicht geändert werden. Der Link ist möglicherweise abgelaufen.'); }
    finally { setPending(false); }
  }
  if (!preview && !error) return <main className="loading" role="status">Link wird geprüft …</main>;
  if (!preview) return <TokenCard title="Link ungültig"><p role="alert">{error}</p><p className="forgot"><a href="/">Zur Anmeldung</a></p></TokenCard>;
  return <TokenCard title="Neues Passwort">
    <p>Legen Sie ein neues Passwort für {preview.email} fest.</p>
    <form onSubmit={event => void submit(event)}>
      <label htmlFor="new-password">Neues Passwort</label><input id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={pending} />
      <label htmlFor="new-confirm">Passwort bestätigen</label><input id="new-confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={pending} />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={pending}>{pending ? 'Wird gespeichert …' : 'Passwort speichern'}<span aria-hidden="true">→</span></button>
    </form>
  </TokenCard>;
}

function Workspace({ me, branding, onBranding, onDirty }: {
  me: Me; branding: Branding; onBranding: (value: Branding) => void; onDirty: (value: boolean) => void;
}) {
  const [section, setSection] = useState<'plans' | 'venues'>('plans');
  return <main className="workspace">
    <div className="workspace-heading"><div><p className="eyebrow">EUER ARBEITSBEREICH</p><h1>{me.workspace.name}</h1><p>Angemeldet als {me.user.name}</p></div><span className="role-badge">{roleNames[me.workspace.role]}</span></div>
    <nav className="workspace-navigation" aria-label="Arbeitsbereiche">
      <button className="quiet" aria-current={section === 'plans' ? 'page' : undefined} onClick={() => setSection('plans')}>Produktionen & Szenen<span>Bühnenbilder entwerfen und planen</span></button>
      <button className="quiet" aria-current={section === 'venues' ? 'page' : undefined} onClick={() => setSection('venues')}>Spielstätten & Bühnen<span>Räume, Grundrisse und feste Einrichtungen</span></button>
    </nav>
    {section === 'plans' ? <Plans me={me} onDirty={onDirty} /> : <Venues me={me} onDirty={onDirty} />}
    <div className="workspace-management"><LinkedAccounts />
    {can(me.workspace.role, 'members') && <><SiteBranding workspaceId={me.workspace.id} branding={branding} onBranding={onBranding} /><Members me={me} /><AuditLog workspaceId={me.workspace.id} /></>}</div>
  </main>;
}

function SiteBranding({ workspaceId, branding, onBranding }: {
  workspaceId: string; branding: Branding; onBranding: (value: Branding) => void;
}) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [logoRevision, setLogoRevision] = useState(0);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true); setError(''); setNotice('');
    try {
      const next = brandingSchema.parse(await request(`/api/workspaces/${workspaceId}/branding`, {
        productName: data.get('productName'),
        tagline: data.get('tagline'),
        footerText: data.get('footerText'),
      }, 'PUT'));
      onBranding(next);
      setNotice('Darstellung wurde gespeichert.');
    } catch { setError('Die Darstellung konnte nicht gespeichert werden.'); }
    finally { setPending(false); }
  }
  async function replaceLogo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get('logo');
    if (!(file instanceof File) || !file.size) { setError('Bitte eine PNG- oder JPEG-Datei wählen.'); return; }
    setPending(true); setError(''); setNotice('');
    try {
      const next = brandingSchema.parse(await upload(`/api/workspaces/${workspaceId}/branding/logo`, file));
      onBranding(next);
      setLogoRevision(value => value + 1);
      setNotice('Logo wurde übernommen.');
      event.currentTarget.reset();
    } catch { setError('Das Logo konnte nicht übernommen werden. Bitte PNG oder JPEG bis 2 MB verwenden.'); }
    finally { setPending(false); }
  }
  async function clearLogo() {
    setPending(true); setError(''); setNotice('');
    try {
      const next = brandingSchema.parse(await request(`/api/workspaces/${workspaceId}/branding/logo`, undefined, 'DELETE'));
      onBranding(next);
      setNotice('Logo wurde entfernt.');
    } catch { setError('Das Logo konnte nicht entfernt werden.'); }
    finally { setPending(false); }
  }
  return <section className="members site-branding" aria-labelledby="branding-title">
    <div className="section-heading"><h2 id="branding-title">Darstellung</h2><span>Nur für die Administration sichtbar</span></div>
    <p>Name, Unterzeile, Fußzeile und Logo erscheinen auf der Anmeldeseite und im Kopfbereich für alle Nutzer dieser Installation.</p>
    <form className="invite-form" onSubmit={event => void save(event)}>
      <label htmlFor="product-name">Produktname</label>
      <input id="product-name" name="productName" required maxLength={80} defaultValue={branding.productName} key={`name-${branding.productName}`} disabled={pending} />
      <label htmlFor="tagline">Unterzeile</label>
      <input id="tagline" name="tagline" maxLength={120} defaultValue={branding.tagline} key={`tag-${branding.tagline}`} disabled={pending} />
      <label htmlFor="footer-text">Fußzeile</label>
      <input id="footer-text" name="footerText" maxLength={200} defaultValue={branding.footerText} key={`foot-${branding.footerText}`} disabled={pending} />
      <button className="primary" type="submit" disabled={pending}>{pending ? 'Wird gespeichert …' : 'Darstellung speichern'}<span aria-hidden="true">→</span></button>
    </form>
    <form className="invite-form" onSubmit={event => void replaceLogo(event)}>
      <h3>Logo</h3>
      {branding.hasLogo
        ? <p className="branding-preview"><img src={`/api/branding/logo?v=${logoRevision}`} alt="Aktuelles Logo" /></p>
        : <p>Noch kein eigenes Logo · Standardzeichen ▱</p>}
      <label htmlFor="brand-logo">PNG oder JPEG</label>
      <input id="brand-logo" name="logo" type="file" accept="image/png,image/jpeg" disabled={pending} />
      <div className="member-actions">
        <button className="primary" type="submit" disabled={pending}>Logo hochladen</button>
        {branding.hasLogo && <button className="quiet" type="button" disabled={pending} onClick={() => void clearLogo()}>Logo entfernen</button>}
      </div>
    </form>
    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

function LinkedAccounts() {
  const [oidc, setOidc] = useState(false);
  const [pocketId, setPocketId] = useState<{ id: string } | undefined>();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const options = loginOptionsSchema.parse(await request('/api/login-options'));
      setOidc(options.oidc);
      if (!options.oidc) return;
      const linked = linkedSchema.parse(await request('/api/auth/list-accounts')).find(row => row.providerId === 'pocket-id');
      setPocketId(linked ? { id: linked.id } : undefined);
      setStatus('');
    } catch { setStatus('Verknüpfte Anmeldung konnte nicht geladen werden.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!oidc && !status) return null;
  async function link() {
    setBusy(true); setStatus('');
    try { await startPocketId('/api/auth/link-social'); }
    catch { setStatus('Pocket ID konnte nicht verknüpft werden. Bitte erneut anmelden und es noch einmal versuchen.'); setBusy(false); }
  }
  async function unlink() {
    if (!pocketId) return;
    setBusy(true); setStatus('');
    try { await request('/api/auth/unlink-account', { accountId: pocketId.id }); await load(); }
    catch { setStatus('Die Verknüpfung konnte nicht aufgehoben werden.'); }
    finally { setBusy(false); }
  }
  return <section className="members linked-accounts" aria-labelledby="linked-title">
    <div className="section-heading"><h2 id="linked-title">Verknüpfte Anmeldung</h2><span>Nur für Ihr Konto</span></div>
    {status && <p role="alert">{status}</p>}
    {oidc && pocketId && <p>Pocket ID ist mit diesem Konto verknüpft.</p>}
    {oidc && !pocketId && <p>Eine übereinstimmende E-Mail-Adresse allein verbindet die Konten nicht. Die Verknüpfung bestätigt die Anmeldung bei Pocket ID.</p>}
    {oidc && (pocketId
      ? <button className="quiet" onClick={() => void unlink()} disabled={busy}>Verknüpfung aufheben</button>
      : <button className="quiet" onClick={() => void link()} disabled={busy}>Pocket ID-Konto verknüpfen</button>)}
  </section>;
}

function Members({ me }: { me: Me }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [status, setStatus] = useState('Mitglieder werden geladen …');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const base = `/api/workspaces/${me.workspace.id}`;
  useEffect(() => {
    let cancelled = false;
    setStatus('Mitglieder werden geladen …');
    request(`${base}/members`).then(data => {
      if (!cancelled) { setMembers(membersSchema.parse(data)); setStatus(''); }
    }).catch(() => { if (!cancelled) setStatus('Mitglieder konnten nicht geladen werden.'); });
    return () => { cancelled = true; };
  }, [base, attempt]);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true); setError(''); setNotice('');
    try {
      const invited = await request(`${base}/invitations`, { email: data.get('email'), name: data.get('name'), role: data.get('role') });
      const parsed = invitationSchema.parse(invited);
      setNotice(`Einladung wurde an ${parsed.email} gesendet.`);
      form.reset();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409
        ? 'Diese Person gehört bereits zum Arbeitsbereich.'
        : caught instanceof ApiError && caught.status === 503
          ? 'Die Einladung wurde gespeichert, die E-Mail konnte nicht gesendet werden. Bitte erneut einladen.'
          : 'Die Einladung konnte nicht gesendet werden.');
    } finally { setPending(false); }
  }
  async function changeRole(userId: string, role: Role) {
    setError('');
    try {
      await request(`${base}/members/${userId}`, { role }, 'PATCH');
      setAttempt(value => value + 1);
    } catch { setError('Die Berechtigung konnte nicht geändert werden.'); }
  }
  async function revoke(userId: string) {
    setError('');
    try {
      await request(`${base}/members/${userId}`, undefined, 'DELETE');
      setAttempt(value => value + 1);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409
        ? 'Die letzte Administration kann nicht entfernt oder herabgestuft werden.'
        : 'Der Zugang konnte nicht entzogen werden.');
    }
  }
  return <section className="members" aria-labelledby="members-title"><div className="section-heading"><h2 id="members-title">Mitglieder</h2><span>Nur für die Administration sichtbar</span></div>
    {status ? <div><p role="status">{status}</p>{status.includes('nicht') && <button className="quiet" onClick={() => setAttempt(value => value + 1)}>Erneut versuchen</button>}</div>
      : <div className="table-scroll"><table><thead><tr><th scope="col">Name</th><th scope="col">E-Mail-Adresse</th><th scope="col">Berechtigung</th></tr></thead>
        <tbody>{members.map(member => <tr key={member.userId}><td>{member.name}</td><td>{member.email}</td><td>
          <div className="member-actions"><select className="member-role" aria-label={`Berechtigung für ${member.name}`} value={member.role} onChange={event => void changeRole(member.userId, event.target.value as Role)}>
            {roles.map(role => <option key={role} value={role}>{roleNames[role]}</option>)}
          </select><button className="quiet" type="button" onClick={() => void revoke(member.userId)}>Zugang entziehen</button></div>
        </td></tr>)}</tbody></table></div>}
    <form className="invite-form" onSubmit={event => void invite(event)}>
      <h3>Mitglied einladen</h3>
      <label htmlFor="invite-name">Name</label><input id="invite-name" name="name" required maxLength={120} disabled={pending} />
      <label htmlFor="invite-email">E-Mail-Adresse</label><input id="invite-email" name="email" type="email" required disabled={pending} />
      <label htmlFor="invite-role">Berechtigung</label>
      <select id="invite-role" name="role" defaultValue="editor" disabled={pending}>{roles.map(role => <option key={role} value={role}>{roleNames[role]}</option>)}</select>
      {notice && <p className="success" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={pending}>{pending ? 'Einladung wird gesendet …' : 'Einladen'}<span aria-hidden="true">→</span></button>
    </form>
  </section>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
