import { useEffect, useId, useState, type FormEvent } from 'react';
import { useModalFocus } from './editor/useModalFocus.js';

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive action — confirm button uses danger styling. */
  danger?: boolean;
};

export type PromptOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  inputLabel?: string;
};

type ConfirmJob = ConfirmOptions & { kind: 'confirm'; resolve: (ok: boolean) => void };
type PromptJob = PromptOptions & { kind: 'prompt'; resolve: (value: string | null) => void };
type Job = ConfirmJob | PromptJob;

type Listener = (job: Job) => void;

let listener: Listener | undefined;
let pending: Job | undefined;

function publish(job: Job) {
  if (listener) listener(job);
  else pending = job;
}

/** App-styled confirm; resolves true when the user confirms. */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    publish({ kind: 'confirm', ...options, resolve });
  });
}

/** App-styled single-line prompt; resolves null when cancelled or empty after trim. */
export function askPrompt(options: PromptOptions): Promise<string | null> {
  return new Promise(resolve => {
    publish({ kind: 'prompt', ...options, resolve });
  });
}

/** Mount once near the app root so askConfirm / askPrompt can render. */
export function ConfirmHost() {
  const [job, setJob] = useState<Job>();
  useEffect(() => {
    listener = next => setJob(current => {
      if (current?.kind === 'prompt') current.resolve(null);
      else if (current?.kind === 'confirm') current.resolve(false);
      return next;
    });
    if (pending) {
      const queued = pending;
      pending = undefined;
      setJob(queued);
    }
    return () => {
      listener = undefined;
    };
  }, []);

  function finishConfirm(ok: boolean) {
    if (!job || job.kind !== 'confirm') return;
    job.resolve(ok);
    setJob(undefined);
  }
  function finishPrompt(value: string | null) {
    if (!job || job.kind !== 'prompt') return;
    job.resolve(value);
    setJob(undefined);
  }

  if (!job) return null;
  if (job.kind === 'prompt') {
    return <PromptDialog job={job} onDone={finishPrompt} />;
  }
  return <ConfirmDialogView job={job} onDone={finishConfirm} />;
}

function ConfirmDialogView({ job, onDone }: { job: ConfirmJob; onDone: (ok: boolean) => void }) {
  const titleId = useId();
  const messageId = useId();
  const close = () => onDone(false);
  const dialog = useModalFocus<HTMLDivElement>(true, close);
  const confirmLabel = job.confirmLabel ?? (job.danger ? 'Löschen' : 'Bestätigen');
  const cancelLabel = job.cancelLabel ?? 'Abbrechen';
  return <div className="modal-backdrop" role="presentation" data-testid="confirm-backdrop"
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialog} className="modal confirm-dialog" role="dialog" aria-modal="true"
      aria-labelledby={titleId} aria-describedby={messageId} tabIndex={-1} data-testid="confirm-dialog">
      <h2 id={titleId}>{job.title}</h2>
      <p id={messageId}>{job.message}</p>
      <div className="form-actions">
        <button type="button" className="quiet" onClick={close}>{cancelLabel}</button>
        <button type="button" className={job.danger ? 'danger' : undefined}
          data-testid="confirm-accept" onClick={() => onDone(true)}>{confirmLabel}</button>
      </div>
    </div>
  </div>;
}

function PromptDialog({ job, onDone }: { job: PromptJob; onDone: (value: string | null) => void }) {
  const titleId = useId();
  const inputId = useId();
  const [value, setValue] = useState(job.defaultValue ?? '');
  const close = () => onDone(null);
  const dialog = useModalFocus<HTMLFormElement>(true, close);
  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    onDone(trimmed.length ? trimmed : null);
  }
  return <div className="modal-backdrop" role="presentation" data-testid="confirm-backdrop"
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <form ref={dialog} className="modal confirm-dialog" role="dialog" aria-modal="true"
      aria-labelledby={titleId} tabIndex={-1} data-testid="prompt-dialog" onSubmit={submit}>
      <h2 id={titleId}>{job.title}</h2>
      {job.message && <p className="muted">{job.message}</p>}
      <label htmlFor={inputId}>{job.inputLabel ?? 'Name'}</label>
      <input id={inputId} name="prompt" value={value} autoComplete="off"
        onChange={event => setValue(event.target.value)} />
      <div className="form-actions">
        <button type="button" className="quiet" onClick={close}>{job.cancelLabel ?? 'Abbrechen'}</button>
        <button type="submit" data-testid="confirm-accept">{job.confirmLabel ?? 'Sichern'}</button>
      </div>
    </form>
  </div>;
}
