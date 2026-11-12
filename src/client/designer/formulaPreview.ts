import { FormulaError, evaluateFormula, parseFormula, type Formula, type FormulaScope } from '../../shared/parts/formula.js';
import { formatNumber } from '../../shared/parts/issues.js';
import type { ResolvedPart } from '../../shared/parts/resolve.js';

export type FormulaPreview =
  | { kind: 'value'; value: number; text: string }
  | { kind: 'error'; message: string; position: number }
  | { kind: 'empty' };

/** Evaluates one formula field against the current variant and defaults; never throws for bad input. */
export function previewFormula(formula: Formula | undefined, scope: FormulaScope | undefined): FormulaPreview {
  if (formula === undefined || (typeof formula === 'string' && !formula.trim())) return { kind: 'empty' };
  try {
    const node = parseFormula(formula);
    if (!scope) return { kind: 'empty' };
    const value = evaluateFormula(node, scope);
    return { kind: 'value', value, text: formatNumber(value) };
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    return { kind: 'error', message: error.message, position: error.position };
  }
}

/**
 * Names a formula of the open definition can read in the preview: every parameter as resolved,
 * derived values and, for fields inside a repeat, the index names at their first instance (0).
 */
export function previewScope(resolved: Pick<ResolvedPart, 'values' | 'derived'> | undefined, indices: readonly string[] = []): Map<string, number> | undefined {
  if (!resolved) return undefined;
  const scope = new Map<string, number>(Object.entries(resolved.values));
  for (const [key, value] of Object.entries(resolved.derived)) scope.set(key, value);
  for (const index of indices) scope.set(index, 0);
  return scope;
}

const PLAIN_NUMBER = /^-?(\d+(\.\d+)?|\.\d+)$/;

/** Field text to the stored formula: plain numbers stay numbers, everything else is formula text. */
export function formulaFromText(text: string): Formula {
  const trimmed = text.trim();
  if (PLAIN_NUMBER.test(trimmed)) {
    const value = Number(trimmed);
    if (Number.isFinite(value) && Math.abs(value) <= 1_000_000) return value;
  }
  return text;
}

export const formulaText = (formula: Formula | undefined): string => formula === undefined ? '' : String(formula);
