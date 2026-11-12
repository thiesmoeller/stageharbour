import { startTransition, useDeferredValue, useEffect, useId, useState, type ReactNode } from 'react';
import type { Formula, FormulaScope } from '../../shared/parts/formula.js';
import { formulaFromText, formulaText, previewFormula } from './formulaPreview.js';

export type FieldIssue = { severity: 'error' | 'warning'; message: string; field?: string };

/** Issues of one field, or of its list entries (`at` also matches `at[1]`). */
export function fieldIssues(issues: readonly FieldIssue[], field: string): FieldIssue[] {
  return issues.filter(item => item.field === field || item.field?.startsWith(`${field}[`) === true || item.field?.startsWith(`${field}.`) === true);
}

export function IssueLines({ issues }: { issues: readonly FieldIssue[] }) {
  if (!issues.length) return null;
  return <ul className="designer-field-issues">
    {issues.map((item, index) => <li key={index} className={item.severity}>{item.message}</li>)}
  </ul>;
}

/**
 * A formula input: plain numbers or formula text. Next to it the value the formula has with the
 * current variant and defaults, or the German formula error when it cannot be evaluated.
 */
export function FormulaField({ label, value, onChange, scope, issues = [], disabled, placeholder, testId, compact }: {
  label: ReactNode;
  value: Formula | undefined;
  onChange: (value: Formula) => void;
  scope: FormulaScope | undefined;
  issues?: readonly FieldIssue[];
  disabled?: boolean;
  placeholder?: string;
  testId?: string;
  compact?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(() => formulaText(value));
  useEffect(() => {
    setText(current => formulaFromText(current) === value ? current : formulaText(value));
  }, [value]);
  const deferred = useDeferredValue(text);
  const preview = previewFormula(formulaFromText(deferred), scope);
  const invalid = preview.kind === 'error' || issues.some(item => item.severity === 'error');
  return <div className={compact ? 'formula-field compact' : 'formula-field'}>
    <label htmlFor={id}>{label}</label>
    <div className="formula-input">
      <input id={id} value={text} disabled={disabled} placeholder={placeholder} spellCheck={false} autoComplete="off"
        aria-invalid={invalid || undefined} data-testid={testId}
        onChange={event => {
          const next = event.target.value;
          setText(next);
          startTransition(() => onChange(formulaFromText(next)));
        }} />
      <output className={preview.kind === 'error' ? 'formula-value error' : 'formula-value'} htmlFor={id} aria-live="polite"
        title={preview.kind === 'error' ? preview.message : undefined}>
        {preview.kind === 'value' ? `= ${preview.text}` : preview.kind === 'error' ? preview.message : ''}
      </output>
    </div>
    <IssueLines issues={issues} />
  </div>;
}

/** Number input that applies every complete number at once and keeps incomplete text (`-`, `12.`) local. */
export function NumberInput({ value, onChange, label, disabled, testId, step }: {
  value: number; onChange: (value: number) => void; label: string; disabled?: boolean; testId?: string; step?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(current => Number(current) === value && current.trim() !== '' ? current : String(value));
  }, [value]);
  return <input type="number" step={step ?? 'any'} aria-label={label} value={text} disabled={disabled} data-testid={testId}
    onChange={event => {
      const next = event.target.value;
      setText(next);
      const number = Number(next);
      if (next.trim() !== '' && Number.isFinite(number)) startTransition(() => onChange(number));
    }}
    onBlur={() => setText(String(value))} />;
}

const AXES = ['X', 'Y', 'Z'] as const;

/** Three formula fields for a point or direction in the part frame. */
export function Vec3Field({ label, value, onChange, scope, issues = [], field, disabled, testId }: {
  label: string;
  value: readonly [Formula, Formula, Formula];
  onChange: (value: [Formula, Formula, Formula]) => void;
  scope: FormulaScope | undefined;
  issues?: readonly FieldIssue[];
  field: string;
  disabled?: boolean;
  testId?: string;
}) {
  return <fieldset className="vec-field">
    <legend>{label}</legend>
    <div className="vec-inputs">
      {AXES.map((axis, index) => <FormulaField key={axis} compact label={axis} value={value[index]} scope={scope} disabled={disabled}
        testId={testId ? `${testId}-${axis.toLowerCase()}` : undefined}
        issues={issues.filter(item => item.field === `${field}[${index}]`)}
        onChange={next => {
          const copy: [Formula, Formula, Formula] = [value[0], value[1], value[2]];
          copy[index] = next;
          onChange(copy);
        }} />)}
    </div>
    <IssueLines issues={issues.filter(item => item.field === field)} />
  </fieldset>;
}

/** A vector the definition may leave out (rotation, pivot): a checkbox adds or removes it. */
export function OptionalVec3Field({ label, value, onChange, fallback, ...rest }: {
  label: string;
  value: readonly [Formula, Formula, Formula] | undefined;
  onChange: (value: [Formula, Formula, Formula] | undefined) => void;
  fallback: [Formula, Formula, Formula];
  scope: FormulaScope | undefined;
  issues?: readonly FieldIssue[];
  field: string;
  disabled?: boolean;
}) {
  return <div className="optional-field">
    <label className="checkbox-line">
      <input type="checkbox" checked={!!value} disabled={rest.disabled} onChange={event => onChange(event.target.checked ? fallback : undefined)} />
      {label}
    </label>
    {value && <Vec3Field label={label} value={value} onChange={onChange} {...rest} />}
  </div>;
}

/** A formula the definition may leave out (`when`, `roll`, `length`). */
export function OptionalFormulaField({ label, value, onChange, fallback, hint, ...rest }: {
  label: string;
  value: Formula | undefined;
  onChange: (value: Formula | undefined) => void;
  fallback: Formula;
  hint?: string;
  scope: FormulaScope | undefined;
  issues?: readonly FieldIssue[];
  disabled?: boolean;
  testId?: string;
}) {
  return <div className="optional-field">
    <label className="checkbox-line">
      <input type="checkbox" checked={value !== undefined} disabled={rest.disabled}
        onChange={event => onChange(event.target.checked ? fallback : undefined)} />
      {label}{hint && <span className="muted-inline"> · {hint}</span>}
    </label>
    {value !== undefined && <FormulaField label={label} value={value} onChange={onChange} {...rest} />}
  </div>;
}
