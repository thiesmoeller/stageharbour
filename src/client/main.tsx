import { StrictMode, useCallback, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { loginOptionsSchema, meSchema, membersSchema, type Me, type Member, type Role } from '../shared/contracts.js';
import { ApiError, request } from './api.js';
import { Plans } from './editor/Plans.js';
import './style.css';

const roleNames: Record<Role, string> = { administrator: 'Administration', editor: 'Bearbeitung', viewer: 'Ansicht' };
const linkedSchema = z.array(z.object({ id: z.string(), providerId: z.string() }));
type Screen = { kind: 'loading' } | { kind: 'login' } | { kind: 'workspace'; me: Me } | { kind: 'error'; message: string; denied: boolean };

async function startPocketId(path: '/api/auth/sign-in/social' | '/api/auth/link-social') {
  const data = z.object({ url: z.string() }).parse(await request(path, {
    provider: 'pocket-id', callbackURL: '/', errorCallbackURL: '/', disableRedirect: true,
  }));
  window.location.assign(data.url);
}

function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [signOutError, setSignOutError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [dirty, setDirty] = useState(false);
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
  useEffect(() => { void load(); }, [load]);
  async function signOut() {
    setSigningOut(true);
    setSignOutError('');
    try { await request('/api/auth/sign-out', {}); setScreen({ kind: 'login' }); }
    catch { setSignOutError('Abmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.'); }
    finally { setSigningOut(false); }
  }
  return <div className="app">
    <header className="masthead">
      <a className="brand" href="/" aria-label="Bühnenplaner Startseite"><span className="brand-icon" aria-hidden="true">▱</span> Bühnenplaner</a>
      <span className="edition">GEMEINSAM THEATER MACHEN</span>
      {(screen.kind === 'workspace' || (screen.kind === 'error' && screen.denied)) && <button className="quiet" onClick={() => void signOut()} disabled={signingOut || dirty} title={dirty ? 'Bitte zuerst Änderungen speichern oder sichern.' : undefined}>{signingOut ? 'Abmeldung …' : 'Abmelden'}</button>}
    </header>
    {signOutError && <p className="error banner" role="alert">{signOutError}</p>}
    {screen.kind === 'loading' && <main className="loading" role="status">Arbeitsbereich wird geladen …</main>}
    {screen.kind === 'login' && <Login onSuccess={load} />}
    {screen.kind === 'workspace' && <Workspace me={screen.me} onDirty={setDirty} />}
    {screen.kind === 'error' && <main className="error-page"><p className="eyebrow">ARBEITSBEREICH</p><h1>{screen.denied ? 'Zugang erforderlich' : 'Verbindung unterbrochen'}</h1><p role="alert">{screen.message}</p><button onClick={() => void load()}>Erneut versuchen</button></main>}
    <footer>Für die Bühne. Für die Menschen dahinter.</footer>
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
      <p className="access-note">Der Zugang wird von eurer Administration eingerichtet. Eine öffentliche Registrierung ist nicht möglich.</p>
    </section>
  </main>;
}

function Workspace({ me, onDirty }: { me: Me; onDirty: (value: boolean) => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [status, setStatus] = useState('Mitglieder werden geladen …');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (me.workspace.role !== 'administrator') return;
    setStatus('Mitglieder werden geladen …');
    request(`/api/workspaces/${me.workspace.id}/members`).then(data => {
      if (!cancelled) { setMembers(membersSchema.parse(data)); setStatus(''); }
    }).catch(() => { if (!cancelled) setStatus('Mitglieder konnten nicht geladen werden.'); });
    return () => { cancelled = true; };
  }, [me.workspace.id, me.workspace.role, attempt]);
  return <main className="workspace">
    <div className="workspace-heading"><div><p className="eyebrow">EUER ARBEITSBEREICH</p><h1>{me.workspace.name}</h1><p>Angemeldet als {me.user.name}</p></div><span className="role-badge">{roleNames[me.workspace.role]}</span></div>
    <LinkedAccounts />
    <Plans me={me} onDirty={onDirty} />
    {me.workspace.role === 'administrator' && <section className="members" aria-labelledby="members-title"><div className="section-heading"><h2 id="members-title">Mitglieder</h2><span>Nur für die Administration sichtbar</span></div>
      {status ? <div><p role="status">{status}</p>{status.includes('nicht') && <button className="quiet" onClick={() => setAttempt(value => value + 1)}>Erneut versuchen</button>}</div> : <div className="table-scroll"><table><thead><tr><th scope="col">Name</th><th scope="col">E-Mail-Adresse</th><th scope="col">Berechtigung</th></tr></thead><tbody>{members.map(member => <tr key={member.userId}><td>{member.name}</td><td>{member.email}</td><td>{roleNames[member.role]}</td></tr>)}</tbody></table></div>}
      <p className="muted">Einladungen und die Verwaltung von Berechtigungen folgen in einem späteren Schritt.</p>
    </section>}
  </main>;
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

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
