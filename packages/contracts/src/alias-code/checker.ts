/**
 * Static checking of alias code, for the editor and before an alias is saved.
 *
 * Finds what can be known without running: syntax errors and refused constructs, unknown names,
 * entities that are not in the house, unknown parts, a builtin given a computed entity id where
 * a written one is needed, a part with no function or a function that takes arguments, literal
 * returns that do not fit the part, and defs nothing uses. It also reports what the code reads
 * and uses, so the engine knows when to run it again: the entities and fields, the other parts,
 * and whether it depends on the clock, mem, HTTP, history or the sun.
 */
import { ENTITY_DOMAINS, ENTITY_ID_PATTERN } from '../entity-id.js';

import { BUILTINS_BY_NAME } from './builtins.js';
import { CodeSyntaxError, type SourceSpan } from './errors.js';
import { fitReturn, type Expectation } from './fit.js';
import {
  parseModule,
  type CodeProblem,
  type Expr,
  type FunctionDef,
  type Module,
  type Stmt,
} from './parser.js';
import { arityProblem, type SignatureParam } from './signature.js';

/** A part of the alias and the function it is bound to. */
export type PartBinding = {
  readonly key: string;
  readonly expectation: Expectation;

  /** The part's name in messages; the key, capitalised, unless said. */
  readonly label?: string;

  /** The function that computes it; the key unless said. */
  readonly functionName?: string;
};

/** What the checker knows about the alias and the house. */
export type CheckContext = {
  /** The parts bound to functions. */
  readonly parts: readonly PartBinding[];

  /** Whether an entity is in the house. */
  readonly knownEntity: (entityId: string) => boolean;

  /** Every part `part.<key>` may read. */
  readonly partKeys: readonly string[];
};

/** A literal a function may return. */
export type LiteralReturn = string | number | boolean | null;

/** A top-level function, as the editor lists it. */
export type CheckedFunction = {
  readonly name: string;
  readonly params: readonly string[];
  readonly line: number;
  readonly endLine: number;

  /** The literal values it returns, None when it can fall off the end. */
  readonly literalReturns: readonly LiteralReturn[];

  /** Whether every return gives a literal. */
  readonly returnsOnlyLiterals: boolean;
};

/** What the code reads. */
export type CodeReads = {
  /** Sorted and unique; entities read through builtins included. */
  readonly entityIds: readonly string[];
  readonly fields: readonly { readonly entityId: string; readonly field: string }[];
  readonly parts: readonly string[];
};

/** What the code depends on besides entities and parts. */
export type CodeUses = {
  readonly time: boolean;
  readonly mem: boolean;
  readonly http: boolean;
  readonly history: boolean;
  readonly sun: boolean;
};

/** What the check found. */
export type CheckResult = {
  readonly problems: readonly CodeProblem[];
  readonly functions: readonly CheckedFunction[];
  readonly reads: CodeReads;
  readonly uses: CodeUses;
};

const DOMAINS: ReadonlySet<string> = new Set(ENTITY_DOMAINS);

const HINTS: Readonly<Record<string, string>> = {
  true: 'True',
  false: 'False',
  null: 'None',
  none: 'None',
};

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** A history builtin's minutes argument, checked when written as a number. */
const MAX_HISTORY_MINUTES = 1440;

/**
 * A part key as a name for messages: `current_temperature` → `Current temperature`.
 *
 * @param key - The key.
 * @returns The label.
 */
function humanize(key: string): string {
  const spaced = key.replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The literal value of an expression, when it is one.
 *
 * @param expression - The expression, or null for a bare return.
 * @returns The value, or undefined when it is not a literal.
 */
function literalOf(expression: Expr | null): LiteralReturn | undefined {
  if (expression === null) {
    return null;
  }

  switch (expression.type) {
    case 'num':
    case 'str':
    case 'const': {
      return expression.value;
    }
    case 'unary': {
      const operand = expression.operand;
      return expression.op === '-' && operand.type === 'num' ? -operand.value : undefined;
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Whether a block can end without a return.
 *
 * @param body - The block.
 * @returns False when its last statement always returns.
 */
function canFallThrough(body: readonly Stmt[]): boolean {
  const last = body.at(-1);

  if (last === undefined) {
    return true;
  }

  if (last.type === 'return') {
    return false;
  }

  if (last.type === 'if') {
    return canFallThrough(last.body) || canFallThrough(last.orelse);
  }

  return true;
}

/**
 * The return statements of a block, at any depth.
 *
 * @param body - The block.
 * @returns The returns, in order.
 */
function returnsOf(body: readonly Stmt[]): Extract<Stmt, { type: 'return' }>[] {
  const found: Extract<Stmt, { type: 'return' }>[] = [];

  for (const statement of body) {
    if (statement.type === 'return') {
      found.push(statement);
    } else if (statement.type === 'if') {
      found.push(...returnsOf(statement.body), ...returnsOf(statement.orelse));
    } else if (statement.type === 'for' || statement.type === 'while') {
      found.push(...returnsOf(statement.body));
    }
  }

  return found;
}

/**
 * The names a target binds.
 *
 * @param target - A name, a subscript, or a tuple of targets.
 * @param into - Where to add them.
 */
function targetNames(target: Expr, into: Set<string>): void {
  if (target.type === 'name') {
    into.add(target.id);
  } else if (target.type === 'tuple' || target.type === 'list') {
    for (const item of target.items) {
      targetNames(item, into);
    }
  }
}

/**
 * The names a block assigns, at any depth: the locals of a function.
 *
 * @param body - The block.
 * @param into - Where to add them.
 * @returns The same set.
 */
function assignedNames(body: readonly Stmt[], into = new Set<string>()): Set<string> {
  for (const statement of body) {
    switch (statement.type) {
      case 'assign': {
        for (const target of statement.targets) {
          targetNames(target, into);
        }

        break;
      }
      case 'augassign': {
        targetNames(statement.target, into);
        break;
      }
      case 'for': {
        targetNames(statement.target, into);
        assignedNames(statement.body, into);
        break;
      }
      case 'while': {
        assignedNames(statement.body, into);
        break;
      }
      case 'if': {
        assignedNames(statement.body, into);
        assignedNames(statement.orelse, into);
        break;
      }
      default: {
        break;
      }
    }
  }

  return into;
}

/**
 * Walks a module and collects problems, reads and uses.
 */
class Checker {
  readonly #module: Module;
  readonly #context: CheckContext;
  readonly #problems: CodeProblem[] = [];
  readonly #entityIds = new Set<string>();
  readonly #fields = new Map<string, { readonly entityId: string; readonly field: string }>();
  readonly #parts = new Set<string>();
  readonly #uses = { time: false, mem: false, http: false, history: false, sun: false };
  readonly #referenced = new Set<string>();
  readonly #functions = new Map<string, FunctionDef>();
  readonly #globals: Set<string>;

  /**
   * @param module - The parsed code.
   * @param context - The alias's parts and the house.
   */
  public constructor(module: Module, context: CheckContext) {
    this.#module = module;
    this.#context = context;
    this.#globals = assignedNames(module.body.filter((statement) => statement.type !== 'def'));
  }

  /**
   * Checks the whole module.
   *
   * @returns What the check found.
   */
  public run(): CheckResult {
    const definitions = this.#module.body.filter(
      (statement): statement is FunctionDef => statement.type === 'def',
    );

    for (const definition of definitions) {
      if (this.#functions.has(definition.name)) {
        this.#error(definition.nameSpan, `${definition.name}() is defined twice`);
      } else {
        this.#functions.set(definition.name, definition);
      }
    }

    for (const statement of this.#module.body) {
      if (statement.type === 'def') {
        const locals = assignedNames(statement.body);

        for (const param of statement.params) {
          locals.add(param.name);

          if (param.default !== null) {
            this.#expression(param.default, new Set());
          }
        }

        this.#block(statement.body, locals);
      } else {
        this.#statement(statement, new Set());
      }
    }

    const bound = this.#checkBindings();

    for (const definition of definitions) {
      if (!bound.has(definition.name) && !this.#referenced.has(definition.name)) {
        this.#warning(definition.nameSpan, `${definition.name}() is unused: no part calls it`);
      }
    }

    return {
      problems: this.#problems.toSorted(
        (left, right) => left.line - right.line || left.column - right.column,
      ),
      functions: definitions.map((definition) => this.#describe(definition)),
      reads: {
        entityIds: [...this.#entityIds].toSorted(),
        fields: [...this.#fields.values()].toSorted(
          (left, right) =>
            left.entityId.localeCompare(right.entityId) || left.field.localeCompare(right.field),
        ),
        parts: [...this.#parts].toSorted(),
      },
      uses: { ...this.#uses },
    };
  }

  /**
   * Records an error.
   *
   * @param span - Where.
   * @param message - What.
   */
  #error(span: SourceSpan, message: string): void {
    this.#problems.push({ ...this.#span(span), message, severity: 'error' });
  }

  /**
   * Records a warning.
   *
   * @param span - Where.
   * @param message - What.
   */
  #warning(span: SourceSpan, message: string): void {
    this.#problems.push({ ...this.#span(span), message, severity: 'warning' });
  }

  /**
   * Only the place of a node.
   *
   * @param span - The node.
   * @returns Its span.
   */
  #span(span: SourceSpan): SourceSpan {
    return {
      line: span.line,
      column: span.column,
      endLine: span.endLine,
      endColumn: span.endColumn,
    };
  }

  /**
   * Checks the parts' bindings: each has a function, without parameters, whose literal returns
   * fit the part.
   *
   * @returns The names of the bound functions.
   */
  #checkBindings(): Set<string> {
    const bound = new Set<string>();

    for (const binding of this.#context.parts) {
      const name = binding.functionName ?? binding.key;
      const partLabel = binding.label ?? humanize(binding.key);
      const definition = this.#functions.get(name);
      bound.add(name);

      if (definition === undefined) {
        this.#error(
          { line: 1, column: 1, endLine: 1, endColumn: 1 },
          `No function ${name}() for ${partLabel}`,
        );
        continue;
      }

      if (definition.params.length > 0) {
        this.#error(
          definition.nameSpan,
          `${name}() gives ${partLabel}, so it cannot take arguments`,
        );
      }

      for (const statement of returnsOf(definition.body)) {
        const literal = literalOf(statement.value);

        if (literal === undefined) {
          continue;
        }

        const fit = fitReturn(literal, binding.expectation);

        if (!fit.ok) {
          this.#warning(statement.value ?? statement, `${partLabel}: ${fit.message}`);
        }
      }
    }

    return bound;
  }

  /**
   * A def, as the editor lists it.
   *
   * @param definition - The def.
   * @returns Its description.
   */
  #describe(definition: FunctionDef): CheckedFunction {
    const returns = returnsOf(definition.body);
    const literals = returns.map((statement) => literalOf(statement.value));
    const values = new Set<LiteralReturn>();

    for (const literal of literals) {
      if (literal !== undefined) {
        values.add(literal);
      }
    }

    if (canFallThrough(definition.body)) {
      values.add(null);
    }

    return {
      name: definition.name,
      params: definition.params.map((param) => param.name),
      line: definition.line,
      endLine: definition.endLine,
      literalReturns: [...values],
      returnsOnlyLiterals: literals.every((literal) => literal !== undefined),
    };
  }

  /**
   * Checks a block.
   *
   * @param body - The statements.
   * @param locals - The names local to the enclosing function.
   */
  #block(body: readonly Stmt[], locals: ReadonlySet<string>): void {
    for (const statement of body) {
      this.#statement(statement, locals);
    }
  }

  /**
   * Checks one statement.
   *
   * @param statement - The statement.
   * @param locals - The names local to the enclosing function.
   */
  #statement(statement: Stmt, locals: ReadonlySet<string>): void {
    switch (statement.type) {
      case 'expr': {
        this.#expression(statement.value, locals);
        break;
      }
      case 'return': {
        if (statement.value !== null) {
          this.#expression(statement.value, locals);
        }

        break;
      }
      case 'assign': {
        this.#expression(statement.value, locals);

        for (const target of statement.targets) {
          this.#target(target, locals);
        }

        break;
      }
      case 'augassign': {
        this.#expression(statement.target, locals);
        this.#target(statement.target, locals);
        this.#expression(statement.value, locals);
        break;
      }
      case 'if': {
        this.#expression(statement.test, locals);
        this.#block(statement.body, locals);
        this.#block(statement.orelse, locals);
        break;
      }
      case 'while': {
        this.#expression(statement.test, locals);
        this.#block(statement.body, locals);
        break;
      }
      case 'for': {
        this.#expression(statement.iter, locals);
        this.#target(statement.target, locals);
        this.#block(statement.body, locals);
        break;
      }
      default: {
        break;
      }
    }
  }

  /**
   * Checks an assignment target: reserved names, and the expressions inside a subscript.
   *
   * @param target - The target.
   * @param locals - The names in scope.
   */
  #target(target: Expr, locals: ReadonlySet<string>): void {
    switch (target.type) {
      case 'name': {
        if (target.id === 'mem') {
          this.#error(
            target,
            'mem cannot be assigned: change its keys instead, like mem["key"] = value',
          );
        } else if (target.id === 'http') {
          this.#error(target, 'http cannot be assigned');
        }

        break;
      }
      case 'subscript': {
        this.#expression(target.object, locals);
        this.#expression(target.index, locals);
        break;
      }
      case 'tuple':
      case 'list': {
        for (const item of target.items) {
          this.#target(item, locals);
        }

        break;
      }
      default: {
        break;
      }
    }
  }

  /**
   * Checks a name that is read.
   *
   * @param node - The name.
   * @param locals - The names in scope.
   */
  #name(node: Extract<Expr, { type: 'name' }>, locals: ReadonlySet<string>): void {
    const id = node.id;
    this.#referenced.add(id);

    if (locals.has(id) || this.#globals.has(id) || this.#functions.has(id)) {
      return;
    }

    if (id === 'mem') {
      this.#uses.mem = true;
      return;
    }

    if (id === 'http') {
      this.#error(node, 'http is used to call http.get(...), http.post(...) and the others');
      return;
    }

    const builtin = BUILTINS_BY_NAME.get(id);

    if (builtin !== undefined) {
      this.#use(builtin.uses);
      return;
    }

    if (DOMAINS.has(id)) {
      this.#error(node, `${id} needs an entity: ${id}.<object_id>`);
      return;
    }

    if (id === 'part') {
      this.#error(node, 'part needs a key: part.<key>');
      return;
    }

    const hint = HINTS[id];
    this.#error(
      node,
      hint === undefined
        ? `name '${id}' is not defined`
        : `name '${id}' is not defined: did you mean ${hint}?`,
    );
  }

  /**
   * Notes what a builtin depends on.
   *
   * @param use - The dependency, or null.
   */
  #use(use: 'time' | 'sun' | 'history' | 'http' | null): void {
    if (use === 'sun') {
      this.#uses.sun = true;
      this.#uses.time = true;
    } else if (use !== null) {
      this.#uses[use] = true;
    }
  }

  /**
   * Checks an entity id written in the code.
   *
   * @param span - Where it is written.
   * @param entityId - The id.
   */
  #entity(span: SourceSpan, entityId: string): void {
    if (!ENTITY_ID_PATTERN.test(entityId)) {
      this.#error(span, `${entityId} is not a valid entity id`);
      return;
    }

    this.#entityIds.add(entityId);

    if (!this.#context.knownEntity(entityId)) {
      this.#error(span, `${entityId} is not in this house`);
    }
  }

  /**
   * Checks an expression and everything inside it.
   *
   * @param node - The expression.
   * @param locals - The names in scope.
   */
  #expression(node: Expr, locals: ReadonlySet<string>): void {
    switch (node.type) {
      case 'num':
      case 'str':
      case 'const': {
        return;
      }
      case 'name': {
        this.#name(node, locals);
        return;
      }
      case 'entity': {
        this.#entity(node, node.entityId);

        if (node.field !== null) {
          this.#fields.set(`${node.entityId}\n${node.field}`, {
            entityId: node.entityId,
            field: node.field,
          });
        }

        return;
      }
      case 'part': {
        this.#parts.add(node.key);

        if (!this.#context.partKeys.includes(node.key)) {
          this.#error(node, `part.${node.key} is not a part of this alias`);
        }

        return;
      }
      case 'call': {
        this.#call(node, locals);
        return;
      }
      case 'listcomp': {
        this.#expression(node.iter, locals);
        const inner = new Set(locals);
        targetNames(node.target, inner);
        this.#target(node.target, inner);

        if (node.condition !== null) {
          this.#expression(node.condition, inner);
        }

        this.#expression(node.element, inner);
        return;
      }
      default: {
        for (const child of this.#children(node)) {
          this.#expression(child, locals);
        }
      }
    }
  }

  /**
   * The sub-expressions of an expression that needs no special check.
   *
   * @param node - The expression.
   * @returns Its children.
   */
  #children(node: Expr): readonly Expr[] {
    switch (node.type) {
      case 'fstring': {
        return node.parts.flatMap((part) => (typeof part === 'string' ? [] : [part.expression]));
      }
      case 'attribute': {
        return [node.object];
      }
      case 'subscript': {
        return [node.object, node.index];
      }
      case 'slice': {
        return [node.object, node.lower, node.upper, node.step].filter(
          (child): child is Expr => child !== null,
        );
      }
      case 'binary':
      case 'bool': {
        return [node.left, node.right];
      }
      case 'unary': {
        return [node.operand];
      }
      case 'compare': {
        return [node.left, ...node.comparators];
      }
      case 'ifexp': {
        return [node.test, node.body, node.orelse];
      }
      case 'list':
      case 'tuple': {
        return node.items;
      }
      case 'dict': {
        return [...node.keys, ...node.values];
      }
      default: {
        return [];
      }
    }
  }

  /**
   * Checks a call: http methods, builtins' arguments, and the arity of the code's own defs.
   *
   * @param node - The call.
   * @param locals - The names in scope.
   */
  #call(node: Extract<Expr, { type: 'call' }>, locals: ReadonlySet<string>): void {
    const { func } = node;
    const keywordNames = node.keywords.map((keyword) => keyword.name);

    for (const value of [...node.args, ...node.keywords.map((keyword) => keyword.value)]) {
      this.#expression(value, locals);
    }

    if (
      func.type === 'attribute' &&
      func.object.type === 'name' &&
      func.object.id === 'http' &&
      !locals.has('http')
    ) {
      this.#uses.http = true;

      if (!HTTP_METHODS.includes(func.name)) {
        this.#error(func, `http has no method ${func.name}(): use get, post, put, patch or delete`);
        return;
      }

      const entry = BUILTINS_BY_NAME.get(`http.${func.name}`);

      if (entry !== undefined) {
        this.#arity(node, entry.name, entry.params, keywordNames);
      }

      return;
    }

    this.#expression(func, locals);

    if (func.type !== 'name' || locals.has(func.id) || this.#globals.has(func.id)) {
      return;
    }

    const definition = this.#functions.get(func.id);

    if (definition !== undefined) {
      const params = definition.params.map((param) => ({
        name: param.name,
        optional: param.default !== null,
        variadic: false,
      }));
      this.#arity(node, func.id, params, keywordNames);
      return;
    }

    const entry = BUILTINS_BY_NAME.get(func.id);

    if (entry?.kind !== 'function') {
      return;
    }

    if (!this.#arity(node, entry.name, entry.params, keywordNames)) {
      return;
    }

    if (entry.entityArgument) {
      const [first] = node.args;

      if (first?.type === 'str') {
        this.#entity(first, first.value);
      } else if (first !== undefined) {
        this.#error(
          first,
          `${entry.name}() needs the entity id written in quotes, like ${entry.name}("sensor.kitchen_temperature")`,
        );
      }
    }

    if (entry.uses === 'history') {
      const minutes = literalOf(node.args[1] ?? null);

      if (
        node.args[1] !== undefined &&
        typeof minutes === 'number' &&
        !(minutes >= 1 && minutes <= MAX_HISTORY_MINUTES)
      ) {
        this.#error(node.args[1], `${entry.name}() minutes must be between 1 and 1440`);
      }
    }
  }

  /**
   * Checks a call's argument count and keywords.
   *
   * @param node - The call.
   * @param name - The function's name.
   * @param params - Its parameters.
   * @param keywordNames - The keywords passed.
   * @returns Whether the call fits.
   */
  #arity(
    node: Extract<Expr, { type: 'call' }>,
    name: string,
    params: readonly SignatureParam[],
    keywordNames: readonly string[],
  ): boolean {
    const problem = arityProblem(name, params, node.args.length, keywordNames);

    if (problem !== null) {
      this.#error(node, problem);
    }

    return problem === null;
  }
}

/**
 * Checks a code file against the alias's parts and the house.
 *
 * @param source - The code.
 * @param context - The parts bound to functions, the entities of the house and the part keys.
 * @returns The problems, the functions, what the code reads and what it uses.
 * @throws {Error} Only on a fault of the parser itself; code errors come back as problems.
 */
export function checkCode(source: string, context: CheckContext): CheckResult {
  let module: Module;

  try {
    module = parseModule(source);
  } catch (error) {
    if (!(error instanceof CodeSyntaxError)) {
      throw error;
    }

    return {
      problems: [{ ...error.span, message: error.message, severity: 'error' }],
      functions: [],
      reads: { entityIds: [], fields: [], parts: [] },
      uses: { time: false, mem: false, http: false, history: false, sun: false },
    };
  }

  return new Checker(module, context).run();
}
