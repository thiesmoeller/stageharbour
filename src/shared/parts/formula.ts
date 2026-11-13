/**
 * Formula language for part definitions: numbers, names, `+ - * /`, unary minus, brackets,
 * comparisons (1 or 0) and a fixed set of functions. Formulas are parsed to an AST and
 * interpreted; no part of a formula is ever handed to the JavaScript engine.
 */

/** A schema field that takes a formula accepts a plain number or formula text. */
export type Formula = number | string;

export const FORMULA_MAX_LENGTH = 240;
const MAX_DEPTH = 48;
const MAX_ARGUMENTS = 16;

export const FORMULA_FUNCTIONS = ['min', 'max', 'abs', 'round', 'floor', 'ceil', 'sqrt', 'if'] as const;
export type FormulaFunction = (typeof FORMULA_FUNCTIONS)[number];

const ARITY: Record<FormulaFunction, { min: number; max: number }> = {
  min: { min: 1, max: MAX_ARGUMENTS },
  max: { min: 1, max: MAX_ARGUMENTS },
  abs: { min: 1, max: 1 },
  sqrt: { min: 1, max: 1 },
  round: { min: 1, max: 2 },
  floor: { min: 1, max: 2 },
  ceil: { min: 1, max: 2 },
  if: { min: 3, max: 3 },
};

export function isFormulaFunction(name: string): name is FormulaFunction {
  return (FORMULA_FUNCTIONS as readonly string[]).includes(name);
}

export type FormulaBinaryOperator = '+' | '-' | '*' | '/' | '<' | '<=' | '>' | '>=' | '==' | '!=';

export type FormulaNode =
  | { type: 'number'; value: number; position: number }
  | { type: 'identifier'; name: string; position: number }
  | { type: 'negate'; operand: FormulaNode; position: number }
  | { type: 'binary'; operator: FormulaBinaryOperator; left: FormulaNode; right: FormulaNode; position: number }
  | { type: 'call'; name: FormulaFunction; args: FormulaNode[]; position: number };

export type FormulaErrorCode =
  | 'syntax' | 'unknown-identifier' | 'unknown-function' | 'arity' | 'division-by-zero' | 'non-finite';

/** `position` is the zero-based character offset into the formula text. `message` is German. */
export class FormulaError extends Error {
  readonly code: FormulaErrorCode;
  readonly position: number;
  constructor(code: FormulaErrorCode, position: number, message: string) {
    super(`${message} (Zeichen ${position + 1})`);
    this.name = 'FormulaError';
    this.code = code;
    this.position = position;
  }
}

/** Values by name. Only own entries are visible; inherited object properties never resolve. */
export type FormulaScope = ReadonlyMap<string, number> | Readonly<Record<string, number>>;

type Token =
  | { kind: 'number'; value: number; position: number }
  | { kind: 'name'; name: string; position: number }
  | { kind: 'operator'; operator: FormulaBinaryOperator; position: number }
  | { kind: '(' | ')' | ','; position: number }
  | { kind: 'end'; position: number };

const isDigit = (char: string) => char >= '0' && char <= '9';
const isNameStart = (char: string) => (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_';
const isNamePart = (char: string) => isNameStart(char) || isDigit(char);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { index++; continue; }
    const position = index;
    if (isDigit(char) || (char === '.' && isDigit(source[index + 1] ?? ''))) {
      while (isDigit(source[index] ?? '')) index++;
      if (source[index] === '.') {
        index++;
        if (!isDigit(source[index] ?? '')) throw new FormulaError('syntax', index, 'Nach dem Dezimalpunkt fehlt eine Ziffer');
        while (isDigit(source[index] ?? '')) index++;
      }
      if (isNameStart(source[index] ?? '')) {
        throw new FormulaError('syntax', index, `Unerwartetes Zeichen „${source[index]}“ nach einer Zahl`);
      }
      const value = Number(source.slice(position, index));
      if (!Number.isFinite(value)) throw new FormulaError('non-finite', position, 'Die Zahl ist zu groß');
      tokens.push({ kind: 'number', value, position });
      continue;
    }
    if (isNameStart(char)) {
      while (isNamePart(source[index] ?? '')) index++;
      tokens.push({ kind: 'name', name: source.slice(position, index), position });
      continue;
    }
    const pair = source.slice(index, index + 2);
    if (pair === '<=' || pair === '>=' || pair === '==' || pair === '!=') {
      tokens.push({ kind: 'operator', operator: pair, position });
      index += 2;
      continue;
    }
    if (char === '+' || char === '-' || char === '*' || char === '/' || char === '<' || char === '>') {
      tokens.push({ kind: 'operator', operator: char, position });
      index++;
      continue;
    }
    if (char === '(' || char === ')' || char === ',') {
      tokens.push({ kind: char, position });
      index++;
      continue;
    }
    if (char === '=') throw new FormulaError('syntax', position, 'Für einen Vergleich „==“ schreiben');
    throw new FormulaError('syntax', position, `Unerwartetes Zeichen „${char}“`);
  }
  tokens.push({ kind: 'end', position: source.length });
  return tokens;
}

function describe(token: Token): string {
  switch (token.kind) {
    case 'number': return `Zahl ${token.value}`;
    case 'name': return `Name „${token.name}“`;
    case 'operator': return `Operator „${token.operator}“`;
    case 'end': return 'Ende der Formel';
    default: return `Zeichen „${token.kind}“`;
  }
}

class Parser {
  private index = 0;
  private depth = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): FormulaNode {
    const node = this.equality();
    const rest = this.peek();
    if (rest.kind !== 'end') {
      throw new FormulaError('syntax', rest.position, rest.kind === ','
        ? 'Unerwartetes Komma; Dezimalzahlen werden mit Punkt geschrieben'
        : `Unerwartet: ${describe(rest)}`);
    }
    return node;
  }

  private peek(): Token { return this.tokens[this.index]!; }
  private next(): Token { return this.tokens[this.index++]!; }
  private operator(...operators: FormulaBinaryOperator[]): (Token & { kind: 'operator' }) | undefined {
    const token = this.peek();
    if (token.kind !== 'operator' || !operators.includes(token.operator)) return undefined;
    this.index++;
    return token;
  }

  private nested<T>(position: number, parse: () => T): T {
    if (++this.depth > MAX_DEPTH) throw new FormulaError('syntax', position, 'Die Formel ist zu tief verschachtelt');
    try { return parse(); } finally { this.depth--; }
  }

  private binary(operand: () => FormulaNode, ...operators: FormulaBinaryOperator[]): FormulaNode {
    let left = operand();
    for (let token = this.operator(...operators); token; token = this.operator(...operators)) {
      left = { type: 'binary', operator: token.operator, left, right: operand(), position: token.position };
    }
    return left;
  }

  private equality(): FormulaNode { return this.binary(() => this.relational(), '==', '!='); }
  private relational(): FormulaNode { return this.binary(() => this.additive(), '<', '<=', '>', '>='); }
  private additive(): FormulaNode { return this.binary(() => this.multiplicative(), '+', '-'); }
  private multiplicative(): FormulaNode { return this.binary(() => this.unary(), '*', '/'); }

  private unary(): FormulaNode {
    const minus = this.operator('-');
    if (minus) return this.nested(minus.position, () => ({ type: 'negate', operand: this.unary(), position: minus.position }));
    return this.primary();
  }

  private primary(): FormulaNode {
    const token = this.next();
    if (token.kind === 'number') return { type: 'number', value: token.value, position: token.position };
    if (token.kind === '(') {
      return this.nested(token.position, () => {
        const node = this.equality();
        const close = this.next();
        if (close.kind !== ')') throw new FormulaError('syntax', close.position, `Schließende Klammer fehlt vor: ${describe(close)}`);
        return node;
      });
    }
    if (token.kind === 'name') {
      if (this.peek().kind === '(') return this.nested(token.position, () => this.call(token));
      if (isFormulaFunction(token.name)) {
        throw new FormulaError('syntax', token.position, `Die Funktion „${token.name}“ braucht Argumente in Klammern`);
      }
      return { type: 'identifier', name: token.name, position: token.position };
    }
    throw new FormulaError('syntax', token.position, `Zahl, Name oder Klammer erwartet statt: ${describe(token)}`);
  }

  private call(token: Token & { kind: 'name' }): FormulaNode {
    if (!isFormulaFunction(token.name)) {
      throw new FormulaError('unknown-function', token.position, `Unbekannte Funktion „${token.name}“`);
    }
    this.next();
    const args: FormulaNode[] = [];
    if (this.peek().kind === ')') {
      this.next();
    } else {
      for (;;) {
        args.push(this.equality());
        const separator = this.next();
        if (separator.kind === ')') break;
        if (separator.kind !== ',') {
          throw new FormulaError('syntax', separator.position, `Komma oder schließende Klammer erwartet statt: ${describe(separator)}`);
        }
      }
    }
    const arity = ARITY[token.name];
    if (args.length < arity.min || args.length > arity.max) {
      const expected = arity.min === arity.max ? `${arity.min}` : `${arity.min} bis ${arity.max}`;
      throw new FormulaError('arity', token.position,
        `Die Funktion „${token.name}“ erwartet ${expected} Argumente, erhalten: ${args.length}`);
    }
    return { type: 'call', name: token.name, args, position: token.position };
  }
}

const parseCache = new Map<string, FormulaNode | FormulaError>();
const PARSE_CACHE_LIMIT = 4000;

/**
 * Parse a formula once to an AST. Throws `FormulaError` for syntax errors, unknown functions
 * and wrong argument counts. A plain number is a valid formula.
 */
export function parseFormula(source: Formula): FormulaNode {
  if (typeof source === 'number') {
    if (!Number.isFinite(source)) throw new FormulaError('non-finite', 0, 'Der Wert ist keine endliche Zahl');
    return { type: 'number', value: source, position: 0 };
  }
  const cached = parseCache.get(source);
  if (cached) {
    if (cached instanceof FormulaError) throw cached;
    return cached;
  }
  let result: FormulaNode | FormulaError;
  try {
    if (source.length > FORMULA_MAX_LENGTH) {
      throw new FormulaError('syntax', FORMULA_MAX_LENGTH, `Die Formel ist länger als ${FORMULA_MAX_LENGTH} Zeichen`);
    }
    if (!source.trim()) throw new FormulaError('syntax', 0, 'Die Formel ist leer');
    result = new Parser(tokenize(source)).parse();
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    result = error;
  }
  if (parseCache.size >= PARSE_CACHE_LIMIT) parseCache.clear();
  parseCache.set(source, result);
  if (result instanceof FormulaError) throw result;
  return result;
}

/** The parse error of a formula, or `undefined` when it parses. */
export function formulaSyntaxError(source: Formula): FormulaError | undefined {
  try {
    parseFormula(source);
    return undefined;
  } catch (error) {
    if (error instanceof FormulaError) return error;
    throw error;
  }
}

function lookup(scope: FormulaScope, name: string): number | undefined {
  if (scope instanceof Map) return scope.get(name);
  return Object.hasOwn(scope, name) ? (scope as Record<string, number>)[name] : undefined;
}

function finite(value: number, position: number): number {
  if (!Number.isFinite(value)) throw new FormulaError('non-finite', position, 'Das Ergebnis ist keine endliche Zahl');
  return value;
}

/** Half steps round away from zero so mirrored parts stay mirrored. */
function roundHalfAway(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

function stepped(node: FormulaNode & { type: 'call' }, scope: FormulaScope, apply: (value: number) => number): number {
  const value = evaluateFormula(node.args[0]!, scope);
  const stepNode = node.args[1];
  if (!stepNode) return apply(value);
  const step = Math.abs(evaluateFormula(stepNode, scope));
  if (step === 0) throw new FormulaError('division-by-zero', stepNode.position, 'Die Schrittweite darf nicht null sein');
  return apply(value / step) * step;
}

function callFunction(node: FormulaNode & { type: 'call' }, scope: FormulaScope): number {
  switch (node.name) {
    case 'if':
      return evaluateFormula(node.args[0]!, scope) !== 0
        ? evaluateFormula(node.args[1]!, scope)
        : evaluateFormula(node.args[2]!, scope);
    case 'min': return Math.min(...node.args.map(arg => evaluateFormula(arg, scope)));
    case 'max': return Math.max(...node.args.map(arg => evaluateFormula(arg, scope)));
    case 'abs': return Math.abs(evaluateFormula(node.args[0]!, scope));
    case 'sqrt': {
      const value = evaluateFormula(node.args[0]!, scope);
      if (value < 0) throw new FormulaError('non-finite', node.position, 'Wurzel aus einer negativen Zahl');
      return Math.sqrt(value);
    }
    case 'round': return stepped(node, scope, roundHalfAway);
    case 'floor': return stepped(node, scope, Math.floor);
    case 'ceil': return stepped(node, scope, Math.ceil);
  }
}

/**
 * Evaluate a parsed formula. Throws `FormulaError` for unknown names, division by zero and
 * non-finite results. `if` evaluates only the branch it takes.
 */
export function evaluateFormula(node: FormulaNode, scope: FormulaScope): number {
  switch (node.type) {
    case 'number': return node.value;
    case 'identifier': {
      const value = lookup(scope, node.name);
      if (typeof value !== 'number') {
        throw new FormulaError('unknown-identifier', node.position, `Unbekannter Name „${node.name}“`);
      }
      return finite(value, node.position);
    }
    case 'negate': return -evaluateFormula(node.operand, scope);
    case 'call': return finite(callFunction(node, scope), node.position);
    case 'binary': {
      const left = evaluateFormula(node.left, scope);
      const right = evaluateFormula(node.right, scope);
      switch (node.operator) {
        case '+': return finite(left + right, node.position);
        case '-': return finite(left - right, node.position);
        case '*': return finite(left * right, node.position);
        case '/':
          if (right === 0) throw new FormulaError('division-by-zero', node.position, 'Division durch null');
          return finite(left / right, node.position);
        case '<': return left < right ? 1 : 0;
        case '<=': return left <= right ? 1 : 0;
        case '>': return left > right ? 1 : 0;
        case '>=': return left >= right ? 1 : 0;
        case '==': return left === right ? 1 : 0;
        case '!=': return left !== right ? 1 : 0;
      }
    }
  }
}

/** Parse and evaluate in one step. */
export function calculateFormula(source: Formula, scope: FormulaScope): number {
  return evaluateFormula(parseFormula(source), scope);
}

/** Names a formula reads, in order of first appearance. */
export function formulaIdentifiers(node: FormulaNode): string[] {
  const names: string[] = [];
  const visit = (current: FormulaNode) => {
    switch (current.type) {
      case 'identifier':
        if (!names.includes(current.name)) names.push(current.name);
        return;
      case 'negate': visit(current.operand); return;
      case 'binary': visit(current.left); visit(current.right); return;
      case 'call': current.args.forEach(visit); return;
      case 'number': return;
    }
  };
  visit(node);
  return names;
}
