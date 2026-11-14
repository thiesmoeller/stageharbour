import { variantValues, type PartDefinition, type PartParameter } from './definition.js';
import { calculateFormula, evaluateFormula, parseFormula, type Formula, type FormulaNode, type FormulaScope } from './formula.js';
import { definitionFormulaSites, type FormulaSite } from './sites.js';

function knownValue(scope: FormulaScope, name: string): number | undefined {
  if (scope instanceof Map) return scope.get(name);
  const record = scope as Readonly<Record<string, number>>;
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

function tryCalculate(formula: Formula, scope: FormulaScope): number | undefined {
  try {
    return calculateFormula(formula, scope);
  } catch {
    return undefined;
  }
}

/** `off` when variant values make the condition constantly false. */
function gate(formula: Formula | undefined, known: FormulaScope): 'on' | 'off' | 'dynamic' {
  if (formula === undefined) return 'on';
  const value = tryCalculate(formula, known);
  if (value === undefined) return 'dynamic';
  return value !== 0 ? 'on' : 'off';
}

/** Names still free once variant values (and derived values that follow from them) are substituted. `if` keeps only the branch it takes. */
function liveIdentifiers(formula: Formula, known: FormulaScope): string[] {
  let node: FormulaNode;
  try {
    node = parseFormula(formula);
  } catch {
    return [];
  }
  const names: string[] = [];
  const add = (name: string) => {
    if (knownValue(known, name) !== undefined) return;
    if (!names.includes(name)) names.push(name);
  };
  const walk = (current: FormulaNode) => {
    switch (current.type) {
      case 'number': return;
      case 'identifier': add(current.name); return;
      case 'negate': walk(current.operand); return;
      case 'binary': walk(current.left); walk(current.right); return;
      case 'call':
        if (current.name === 'if') {
          const condition = current.args[0]!;
          walk(condition);
          let taken: FormulaNode | undefined;
          try {
            taken = evaluateFormula(condition, known) !== 0 ? current.args[1] : current.args[2];
          } catch {
            taken = undefined;
          }
          if (taken) walk(taken);
          else { walk(current.args[1]!); walk(current.args[2]!); }
          return;
        }
        current.args.forEach(walk);
        return;
      default: return;
    }
  };
  walk(node);
  return names;
}

function knownValues(definition: PartDefinition, variantKey: string | undefined): Map<string, number> {
  const variant = variantKey ? definition.variants?.find(item => item.key === variantKey) : undefined;
  const known = new Map<string, number>(Object.entries(variantValues(definition, variant)));
  const pending = [...(definition.derived ?? [])];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const derived = pending[index]!;
      const value = tryCalculate(derived.formula, known);
      if (value === undefined) continue;
      known.set(derived.key, value);
      pending.splice(index, 1);
      progressed = true;
    }
  }
  return known;
}

function elementGate(definition: PartDefinition, site: FormulaSite, known: FormulaScope): 'on' | 'off' | 'dynamic' {
  if (site.owner.kind === 'derived') return 'on';
  if (site.owner.kind === 'body') {
    const body = definition.bodies[site.owner.index];
    const bodyGate = gate(body?.when, known);
    if (!site.hole) return bodyGate;
    if (bodyGate === 'off') return 'off';
    const hole = body?.kind === 'sheet' ? body.holes?.find(item => item.key === site.hole) : undefined;
    const holeGate = gate(hole?.when, known);
    if (bodyGate === 'dynamic' || holeGate === 'dynamic') return holeGate === 'off' ? 'off' : 'dynamic';
    return holeGate;
  }
  if (site.owner.kind === 'child') return gate(definition.children?.[site.owner.index]?.when, known);
  if (site.owner.kind === 'connector') return gate(definition.connectors?.[site.owner.index]?.when, known);
  return gate(definition.hardware?.[site.owner.index]?.when, known);
}

/**
 * Placement and state parameters the inspector should offer for this variant.
 * Opening parameters stay hidden while their hole or child is switched off by the variant.
 * A parameter that itself enables a feature stays visible, and so does any parameter no formula reads.
 */
export function visibleParameters(definition: PartDefinition, variantKey?: string): PartParameter[] {
  const known = knownValues(definition, variantKey);
  const live = new Set<string>();
  const referenced = new Set<string>();
  for (const site of definitionFormulaSites(definition)) {
    for (const name of liveIdentifiers(site.formula, new Map())) referenced.add(name);
    if (site.owner.kind === 'derived') continue;
    const state = elementGate(definition, site, known);
    if (state === 'off') continue;
    if (site.field === 'when' && state !== 'dynamic') continue;
    for (const name of liveIdentifiers(site.formula, known)) live.add(name);
  }
  const derived = new Map((definition.derived ?? []).map(item => [item.key, item.formula]));
  const queue = [...live];
  const expanded = new Set<string>();
  while (queue.length) {
    const name = queue.pop()!;
    if (expanded.has(name)) continue;
    expanded.add(name);
    const formula = derived.get(name);
    if (formula === undefined) continue;
    for (const id of liveIdentifiers(formula, known)) {
      live.add(id);
      queue.push(id);
    }
  }
  return definition.parameters.filter(parameter =>
    parameter.scope !== 'variant' && (live.has(parameter.key) || !referenced.has(parameter.key)));
}
