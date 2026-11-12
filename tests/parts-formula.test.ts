import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FORMULA_MAX_LENGTH, FormulaError, calculateFormula, evaluateFormula, formulaIdentifiers,
  formulaSyntaxError, parseFormula, type FormulaErrorCode, type FormulaScope,
} from '../src/shared/parts/formula.js';

const scope = { B: 2000, T: 1000, H: 600, n: 4, open: 0 };

function failure(source: string | number, values: FormulaScope = scope): FormulaError {
  try {
    calculateFormula(source, values);
  } catch (error) {
    assert(error instanceof FormulaError, `expected a FormulaError for ${source}`);
    return error;
  }
  throw new assert.AssertionError({ message: `formula ${source} did not fail` });
}

function assertFails(source: string, code: FormulaErrorCode, position: number, values: FormulaScope = scope) {
  const error = failure(source, values);
  assert.equal(error.code, code, `${source}: ${error.message}`);
  assert.equal(error.position, position, `${source}: ${error.message}`);
  assert.match(error.message, new RegExp(`Zeichen ${position + 1}\\)$`));
}

test('a plain number is a formula', () => {
  assert.equal(calculateFormula(12.5, {}), 12.5);
  assert.equal(calculateFormula('12.5', {}), 12.5);
  assert.equal(calculateFormula('.5', {}), 0.5);
  assert.deepEqual(parseFormula(40), { type: 'number', value: 40, position: 0 });
});

test('operators follow the usual precedence and associate to the left', () => {
  assert.equal(calculateFormula('2 + 3 * 4', {}), 14);
  assert.equal(calculateFormula('(2 + 3) * 4', {}), 20);
  assert.equal(calculateFormula('20 - 5 - 3', {}), 12);
  assert.equal(calculateFormula('120 / 4 / 3', {}), 10);
  assert.equal(calculateFormula('B / 2 - 33', scope), 967);
  assert.equal(calculateFormula('1 + 2 < 4 == 1', {}), 1);
  assert.equal(calculateFormula('2 * 3 > 5 + 2', {}), 0);
});

test('unary minus binds tighter than multiplication and may repeat', () => {
  assert.equal(calculateFormula('-B / 2', scope), -1000);
  assert.equal(calculateFormula('-2 * -3', {}), 6);
  assert.equal(calculateFormula('--4', {}), 4);
  assert.equal(calculateFormula('3 - -2', {}), 5);
  assert.equal(calculateFormula('-(T - 40)', scope), -960);
});

test('functions', () => {
  assert.equal(calculateFormula('min(B, T, H)', scope), 600);
  assert.equal(calculateFormula('max(B, T, H)', scope), 2000);
  assert.equal(calculateFormula('max(7)', {}), 7);
  assert.equal(calculateFormula('abs(T - B)', scope), 1000);
  assert.equal(calculateFormula('sqrt(460 * 460 + 1160 * 1160)', {}), Math.hypot(460, 1160));
  assert.equal(calculateFormula('round(2.5)', {}), 3);
  assert.equal(calculateFormula('round(-2.5)', {}), -3);
  assert.equal(calculateFormula('round(1234, 50)', {}), 1250);
  assert.equal(calculateFormula('floor(1234, 500)', {}), 1000);
  assert.equal(calculateFormula('ceil(1234, 500)', {}), 1500);
  assert.equal(calculateFormula('floor(-0.5)', {}), -1);
  assert.equal(calculateFormula('ceil(7 / 2)', {}), 4);
  assert.equal(calculateFormula('max(1, round(H / 160))', scope), 4);
});

test('comparisons yield 1 or 0', () => {
  const cases: [string, number][] = [
    ['1 < 2', 1], ['2 < 2', 0], ['2 <= 2', 1], ['3 <= 2', 0], ['3 > 2', 1], ['2 > 2', 0],
    ['2 >= 2', 1], ['1 >= 2', 0], ['2 == 2', 1], ['2 == 3', 0], ['2 != 3', 1], ['2 != 2', 0],
  ];
  for (const [source, expected] of cases) assert.equal(calculateFormula(source, {}), expected, source);
});

test('if takes the branch its condition selects and leaves the other unevaluated', () => {
  assert.equal(calculateFormula('if(open, 90, 0)', scope), 0);
  assert.equal(calculateFormula('if(n >= 2, 1, 0)', scope), 1);
  assert.equal(calculateFormula('if(open > 0, B / open, 0)', scope), 0);
  assert.equal(calculateFormula('if(1, 5, unknown)', {}), 5);
  assert.equal(calculateFormula('if(if(0, 1, 0) == 0, 2 * 3, 4)', {}), 6);
});

test('identifiers are listed once in order of first use', () => {
  assert.deepEqual(formulaIdentifiers(parseFormula('if(T > B, T - inset, B) + max(T, n)')), ['T', 'B', 'inset', 'n']);
  assert.deepEqual(formulaIdentifiers(parseFormula(12)), []);
});

test('a scope may be a Map or a plain object', () => {
  assert.equal(evaluateFormula(parseFormula('a + b'), new Map([['a', 1], ['b', 2]])), 3);
  assert.equal(evaluateFormula(parseFormula('a + b'), { a: 1, b: 2 }), 3);
});

test('syntax errors carry the position of the offending character', () => {
  assertFails('2 +', 'syntax', 3);
  assertFails('2 + * 3', 'syntax', 4);
  assertFails('(2 + 3', 'syntax', 6);
  assertFails('2 + 3)', 'syntax', 5);
  assertFails('2 3', 'syntax', 2);
  assertFails('B $ 2', 'syntax', 2);
  assertFails('1,5', 'syntax', 1);
  assertFails('1.', 'syntax', 2);
  assertFails('2B', 'syntax', 1);
  assertFails('B = 2', 'syntax', 2);
  assertFails('min', 'syntax', 0);
  assertFails('', 'syntax', 0);
  assertFails('   ', 'syntax', 0);
  assertFails('1 + '.repeat(80) + '1', 'syntax', FORMULA_MAX_LENGTH);
  assertFails(`${'('.repeat(60)}1${')'.repeat(60)}`, 'syntax', 48);
  assert.match(failure('1,5').message, /Dezimalzahlen werden mit Punkt geschrieben/);
});

test('unknown identifiers are reported where they stand', () => {
  assertFails('B + breite', 'unknown-identifier', 4);
  assert.match(failure('B + breite').message, /Unbekannter Name „breite“/);
});

test('wrong argument counts are parse errors at the function name', () => {
  assertFails('2 + abs()', 'arity', 4);
  assertFails('abs(1, 2)', 'arity', 0);
  assertFails('if(1, 2)', 'arity', 0);
  assertFails('round(1, 2, 3)', 'arity', 0);
  assertFails('min()', 'arity', 0);
  assert.equal(formulaSyntaxError('sqrt(1, 2)')?.code, 'arity');
});

test('division by zero names the operator', () => {
  assertFails('B / (T - 1000)', 'division-by-zero', 2);
  assertFails('round(B, 0)', 'division-by-zero', 9);
});

test('non-finite results are rejected', () => {
  assertFails('sqrt(T - B)', 'non-finite', 0);
  assertFails('1 + big * big', 'non-finite', 8, { big: 1e200 });
  assertFails('x + 1', 'non-finite', 0, { x: Number.NaN });
  assert.equal(failure(Number.POSITIVE_INFINITY).code, 'non-finite');
});

test('parse errors are found without a scope', () => {
  assert.equal(formulaSyntaxError('B / 2 - 33'), undefined);
  assert.equal(formulaSyntaxError(5), undefined);
  assert.equal(formulaSyntaxError('B /')?.code, 'syntax');
  assert.equal(formulaSyntaxError('foo(1)')?.code, 'unknown-function');
});

test('no formula text reaches JavaScript evaluation', () => {
  const marker = '__partsFormulaTestMarker';
  const globals = globalThis as Record<string, unknown>;
  delete globals[marker];
  const inherited = Object.create({ leaked: 7 }) as Record<string, number>;
  inherited.own = 1;

  assertFails('constructor', 'unknown-identifier', 0, {});
  assertFails('__proto__', 'unknown-identifier', 0, {});
  assertFails('toString', 'unknown-identifier', 0, {});
  assertFails('hasOwnProperty', 'unknown-identifier', 0, {});
  assertFails('own + leaked', 'unknown-identifier', 6, inherited);
  assertFails('constructor(1)', 'unknown-function', 0, {});
  assertFails('eval(1)', 'unknown-function', 0, {});
  assertFails('Function(1)', 'unknown-function', 0, {});
  assertFails('own(1)', 'unknown-function', 0, { own: 1 });
  assertFails('B.constructor', 'syntax', 1);
  assertFails('B["constructor"]', 'syntax', 1);
  assertFails('B[0]', 'syntax', 1);
  assertFails('`${1}`', 'syntax', 0);
  assertFails("'a'", 'syntax', 0);
  assertFails('1; 2', 'syntax', 1);
  assertFails('x => x', 'syntax', 2, { x: 1 });
  assertFails('new Date', 'syntax', 4);
  assertFails('B ? 1 : 2', 'syntax', 2);
  assertFails('1e3', 'syntax', 1);
  assertFails(`globalThis.${marker} = 1`, 'syntax', 10);
  assertFails(`(function(){ globalThis.${marker} = 1 })()`, 'syntax', 11);

  assert.equal(globals[marker], undefined);
  assert.equal(calculateFormula('constructor + 1', new Map([['constructor', 2]])), 3);
});
