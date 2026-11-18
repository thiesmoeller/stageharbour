import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { ValueReadout } from './ModelCanvas.js';
import { parseValueBox } from './tools.js';

export type ValueBoxHandle = { type: (text: string) => void };

/**
 * „Maße“: what the running tool measures, and where typed values go. Typing digits anywhere over
 * the canvas lands here; Enter applies them to the running or the last operation.
 */
export const ValueBox = forwardRef<ValueBoxHandle, {
  readout: ValueReadout | undefined;
  status: string | undefined;
  onApply: (values: number[]) => string | undefined;
  disabled: boolean;
}>(function ValueBox({ readout, status, onApply, disabled }, ref) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({
    type(next: string) {
      setText(current => current + next);
      setError(undefined);
      input.current?.focus();
    },
  }), []);
  function submit() {
    const values = parseValueBox(text);
    if (!values) { setError('Zahlen eingeben, mehrere mit „;“ getrennt.'); return; }
    const problem = onApply(values);
    if (problem) { setError(problem); return; }
    setText(''); setError(undefined);
    input.current?.blur();
  }
  return <div className="model-value-box" data-testid="designer-value-bar">
    <label>
      <span className="model-value-label">{readout?.label ?? 'Maße'}</span>
      <input ref={input} value={text} disabled={disabled} placeholder={readout?.value ?? ''} data-testid="designer-value-box"
        aria-invalid={!!error} aria-label={`Maße: ${readout?.label ?? 'Wert'}`} inputMode="decimal"
        onChange={event => { setText(event.target.value); setError(undefined); }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
          if (event.key === 'Escape') { setText(''); setError(undefined); input.current?.blur(); }
        }} />
    </label>
    <p className={error ? 'model-status error-text' : 'model-status'} role="status" data-testid="designer-model-status">{error ?? status ?? ''}</p>
  </div>;
});
