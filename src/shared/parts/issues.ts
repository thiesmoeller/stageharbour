import type { FormulaError, FormulaErrorCode } from './formula.js';

export type PartIssueSeverity = 'error' | 'warning';

export type PartIssueCode =
  | 'schema' | 'duplicate-key' | 'reserved-name' | 'parameter-domain' | 'variant-value' | 'forward-reference'
  | 'formula' | 'unknown-name' | 'trait-reference' | 'empty-part'
  | 'unknown-parameter' | 'wrong-scope' | 'value-adjusted' | 'unknown-variant' | 'variant-unmatched'
  | 'unknown-material' | 'material-kind' | 'body-too-small' | 'out-of-range' | 'outline-invalid'
  | 'hole-outside' | 'hole-overlap' | 'hole-splits-sheet' | 'hole-covers-sheet' | 'hole-unsupported'
  | 'repeat-count' | 'too-many-solids' | 'unknown-part' | 'child-cycle' | 'child-depth'
  | 'surface-not-horizontal' | 'connector-axis' | 'hardware-quantity';

/**
 * One finding about a definition or about the data it was resolved with. `message` is German
 * and complete on its own; the key fields name what it is about so a UI can jump there.
 */
export type PartIssue = {
  severity: PartIssueSeverity;
  code: PartIssueCode;
  message: string;
  /** Child instance the finding lies in, such as `fuss[0,1]`; absent for the part itself. */
  path?: string;
  parameter?: string;
  derived?: string;
  variant?: string;
  body?: string;
  hole?: string;
  child?: string;
  connector?: string;
  hardware?: string;
  face?: string;
  material?: string;
  /** Field of the named element, such as `size[1]` or `repeat[0].count`. */
  field?: string;
  formula?: { code: FormulaErrorCode; position: number; source: string };
};

export type PartIssueSubject = Pick<PartIssue,
  'path' | 'parameter' | 'derived' | 'variant' | 'body' | 'hole' | 'child' | 'connector' | 'hardware' | 'face' | 'material' | 'field'>;

const numberFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2, useGrouping: false });

/** German number with at most two decimals, for messages. */
export function formatNumber(value: number): string {
  return Number.isFinite(value) ? numberFormat.format(value) : String(value);
}

/** "Körper „deck“", "Unterbauteil „fuss“" … for the element an issue is about. */
export function describeSubject(subject: PartIssueSubject): string {
  const named = (noun: string, key: string) => `${noun} „${key}“`;
  const base = subject.body !== undefined
    ? subject.hole !== undefined ? `${named('Ausschnitt', subject.hole)} in ${named('Körper', subject.body)}` : named('Körper', subject.body)
    : subject.child !== undefined ? named('Unterbauteil', subject.child)
      : subject.connector !== undefined ? named('Verbinder', subject.connector)
        : subject.hardware !== undefined ? named('Zubehör', subject.hardware)
          : subject.derived !== undefined ? named('Hilfswert', subject.derived)
            : subject.variant !== undefined ? named('Variante', subject.variant)
              : subject.face !== undefined ? named('Fläche', subject.face)
                : subject.parameter !== undefined ? named('Parameter', subject.parameter)
                  : subject.material !== undefined ? named('Material', subject.material)
                    : 'Bauteil';
  return subject.path ? `${base} (in ${subject.path})` : base;
}

export function issue(
  severity: PartIssueSeverity, code: PartIssueCode, subject: PartIssueSubject, text: string,
): PartIssue {
  return { severity, code, message: `${describeSubject(subject)}: ${text}`, ...subject };
}

export function formulaIssue(subject: PartIssueSubject, source: string | number, error: FormulaError): PartIssue {
  const field = subject.field ? `Feld ${subject.field}, ` : '';
  return {
    ...issue('error', error.code === 'unknown-identifier' ? 'unknown-name' : 'formula', subject,
      `${field}Formel „${source}“: ${error.message}`),
    formula: { code: error.code, position: error.position, source: String(source) },
  };
}

export const hasErrors = (issues: readonly PartIssue[]): boolean => issues.some(item => item.severity === 'error');
