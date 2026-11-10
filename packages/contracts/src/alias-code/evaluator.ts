/**
 * The evaluator of alias code: walks the syntax tree, with limits and a trace.
 *
 * The walk is written as generators that yield only where the host must be awaited (history and
 * HTTP); a small driver awaits those and resumes the walk. Between two awaits nothing else runs,
 * so the time measured between them is the code's own: that is the CPU budget, and waiting for
 * the host is not charged to it. A whole-run deadline covers the waits.
 *
 * A run never throws: a failing line, a broken limit or a fault of the evaluator itself all come
 * back as a result, with the line and column, and the `mem` the run started with.
 */
import type { JsonObject, JsonValue } from '../json.js';

import { BUILTINS_BY_NAME, type BuiltinContext, type BuiltinEntry } from './builtins.js';
import { CodeLimitError, CodeRunError, placed, type SourceSpan } from './errors.js';
import { formatWithSpec } from './format-spec.js';
import { byteLength, HttpPolicy, sendHttp, type HttpLogEntry, type HttpSession } from './http.js';
import { callMethod, getAttribute } from './methods.js';
import type { CodeProgram, Expr, FunctionDef, Stmt } from './parser.js';
import { bindArguments } from './signature.js';
import {
  DEFAULT_RUN_LIMITS,
  type CodeHost,
  type HttpMethod,
  type HttpReply,
  type RunLimits,
} from './types.js';
import {
  binaryOp,
  compare,
  dict,
  dictToJson,
  float,
  fromJson,
  fromNumber,
  getItem,
  int,
  isObject,
  iterate,
  label,
  list,
  repr,
  setItem,
  shorten,
  sliceOf,
  str,
  text,
  thousands,
  toJson,
  truthy,
  tuple,
  typeName,
  unaryOp,
  type ArithmeticOperator,
  type PyDict,
  type PyValue,
} from './values.js';

/** How a run may go. */
export type RunOptions = {
  readonly host: CodeHost;

  /** The mem the last run left. */
  readonly mem: JsonObject;

  /** Whether to record a trace of the lines run. */
  readonly trace: boolean;

  /** Whether this is a trial: writes are not sent. */
  readonly trial: boolean;

  /** What a write answers in a trial; status 200 and an empty body unless said. */
  readonly pretendResponse?: Partial<HttpReply>;

  /** Limits other than the defaults. */
  readonly limits?: Partial<RunLimits>;

  /** The GET cache and write rate limit to keep across runs; a fresh one when left out. */
  readonly httpPolicy?: HttpPolicy;
};

/** Where a run failed, and why. */
export type RunError = {
  readonly message: string;
  readonly line: number;
  readonly column: number;
};

/** One line a run printed. */
export type PrintedLine = { readonly line: number; readonly text: string };

/** What the trace shows for one line. */
export type TraceLine = {
  readonly line: number;

  /** Short value labels, such as `False`, `20.4 < 21.2 → True` or `→ "heating"`. */
  readonly chips: readonly string[];

  /** For a condition line, whether it held; true for other lines. */
  readonly taken: boolean;

  /** How many times the line ran. */
  readonly runs: number;
};

/** The lines a run went through. */
export type Trace = {
  readonly lines: readonly TraceLine[];
  readonly executedLines: readonly number[];
  readonly errorLine?: number;
};

/** What a run gives back. */
export type RunResult = {
  readonly kind: 'value' | 'error' | 'limit';

  /** What the function returned, as JSON; null after an error or a limit. */
  readonly value: JsonValue;
  readonly error?: RunError;

  /** The mem to keep: changed by a run that ended well, as it was otherwise. */
  readonly mem: JsonObject;
  readonly steps: number;
  readonly cpuMs: number;
  readonly prints: readonly PrintedLine[];
  readonly trace?: Trace;

  /** The entity ids the run read, sorted. */
  readonly reads: readonly string[];
  readonly http: readonly HttpLogEntry[];
};

/** The largest mem, as UTF-8 JSON. */
export const MAX_MEM_BYTES = 16 * 1024;

/** How many prints a run keeps, and how long each. */
const MAX_PRINTS = 100;
const MAX_PRINT_LENGTH = 1000;

/** How many chips a line keeps, and how long a message chip may be. */
const MAX_CHIPS = 6;
const MAX_CHIP = 64;

/** Comparisons whose trace chip shows both sides. */
const ORDERINGS: ReadonlySet<string> = new Set(['<', '<=', '>', '>=']);

/** What a block of statements ended with. */
type Flow = null | 'break' | 'continue' | { readonly value: PyValue };

/** The walk: yields the host promises to await, returns its result. */
type Walk<TResult> = Generator<Promise<unknown>, TResult, unknown>;

/** What the driver sends back into the walk after an await. */
type Settled =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: unknown };

/** What the trace keeps for a line while the run goes. */
type TraceEntry = { chips: string[]; taken: boolean; runs: number };

/**
 * Names in scope: a function's locals over the module's globals; a comprehension's own over them.
 */
class Scope {
  readonly #values = new Map<string, PyValue>();
  readonly #parent: Scope | null;

  /**
   * @param parent - The enclosing scope, null for the module's.
   */
  public constructor(parent: Scope | null) {
    this.#parent = parent;
  }

  /**
   * Looks a name up here and outward.
   *
   * @param name - The name.
   * @returns Its value, or undefined when no scope has it.
   */
  public get(name: string): PyValue | undefined {
    // has(), not ??: a name bound to None holds null.
    return this.#values.has(name) ? this.#values.get(name) : this.#parent?.get(name);
  }

  /**
   * Binds a name in this scope.
   *
   * @param name - The name.
   * @param value - The value.
   */
  public set(name: string, value: PyValue): void {
    this.#values.set(name, value);
  }
}

/**
 * Whether an expression is a call of print, whose value the trace leaves out.
 *
 * @param expression - The expression.
 * @returns True for `print(...)`.
 */
function isPrint(expression: Expr): boolean {
  return (
    expression.type === 'call' && expression.func.type === 'name' && expression.func.id === 'print'
  );
}

/**
 * One run of one function.
 */
class Interpreter {
  readonly #program: CodeProgram;
  readonly #options: RunOptions;
  readonly #limits: RunLimits;
  readonly #zone: string;
  readonly #globals = new Scope(null);
  readonly #reads = new Set<string>();
  readonly #prints: PrintedLine[] = [];
  readonly #trace: Map<number, TraceEntry> | null;
  readonly #context: BuiltinContext;
  readonly #http: HttpSession;
  #mem: PyDict = dict();
  #steps = 0;
  #cpuMs = 0;
  #segmentStart = 0;
  #startedAt = 0;
  #depth = 0;
  #line = 0;
  #column = 0;
  #tracedLine = 0;

  /**
   * @param program - The compiled code.
   * @param options - How to run it.
   */
  public constructor(program: CodeProgram, options: RunOptions) {
    this.#program = program;
    this.#options = options;
    this.#limits = { ...DEFAULT_RUN_LIMITS, ...options.limits };
    this.#zone = options.host.timeZone;
    this.#trace = options.trace ? new Map() : null;
    this.#context = {
      host: options.host,
      limits: this.#limits,
      read: this.#read.bind(this),
      print: this.#print.bind(this),
      http: this.#sendHttp.bind(this),
    };
    this.#http = {
      host: options.host,
      policy: options.httpPolicy ?? new HttpPolicy(),
      trial: options.trial,
      pretend: {
        status: options.pretendResponse?.status ?? 200,
        headers: options.pretendResponse?.headers ?? {},
        text: options.pretendResponse?.text ?? '',
      },
      log: [],
      note: this.#note.bind(this),
    };
  }

  /**
   * Runs a function of the program.
   *
   * @param name - The function.
   * @returns The result; never throws.
   */
  public async run(name: string): Promise<RunResult> {
    this.#startedAt = performance.now();

    try {
      const start = fromJson(this.#options.mem, this.#zone);
      this.#mem = isObject(start) && start.kind === 'dict' ? start : dict();
      const value = await this.#drive(this.#main(name));
      const result = toJson(value, `${name}() returned`);
      const mem = dictToJson(this.#mem, 'mem');

      if (byteLength(JSON.stringify(mem)) > MAX_MEM_BYTES) {
        throw new CodeRunError('mem is over 16 KB');
      }

      return this.#result('value', result, mem, null);
    } catch (error) {
      return this.#failure(error);
    }
  }

  /**
   * Runs the walk to its end, awaiting what it yields, charging only the walk's own time.
   *
   * @param walk - The walk.
   * @param settled - What the last await gave.
   * @returns What the walk returns.
   */
  async #drive<TResult>(
    walk: Walk<TResult>,
    settled: Settled = { ok: true, value: undefined },
  ): Promise<TResult> {
    this.#segmentStart = performance.now();
    let step: IteratorResult<Promise<unknown>, TResult>;

    try {
      step = settled.ok ? walk.next(settled.value) : walk.throw(settled.error);
    } finally {
      this.#cpuMs += performance.now() - this.#segmentStart;
    }

    if (step.done === true) {
      return step.value;
    }

    let next: Settled;

    try {
      next = { ok: true, value: await this.#withDeadline(step.value) };
    } catch (error) {
      next = { ok: false, error };
    }

    return this.#drive(walk, next);
  }

  /**
   * Awaits a host promise, but not past the run's deadline.
   *
   * @param promise - The promise.
   * @returns What it resolved to.
   * @throws {CodeLimitError} When the deadline passes first.
   */
  async #withDeadline(promise: Promise<unknown>): Promise<unknown> {
    const remaining = this.#limits.deadlineMs - (performance.now() - this.#startedAt);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((resolve, reject) => {
      timer = setTimeout(
        () => {
          reject(new CodeLimitError(this.#deadlineMessage()));
        },
        Math.max(0, remaining),
      );
    });

    try {
      return await Promise.race([promise, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The message of the whole-run deadline.
   *
   * @returns For example "Took longer than 15 s".
   */
  #deadlineMessage(): string {
    return `Took longer than ${String(this.#limits.deadlineMs / 1000)} s`;
  }

  /**
   * Counts one step and checks the limits.
   *
   * @throws {CodeLimitError} When a limit is reached.
   */
  #tick(): void {
    this.#steps += 1;

    if (this.#steps > this.#limits.steps) {
      throw new CodeLimitError(`Stopped after ${thousands(this.#limits.steps)} steps`);
    }

    const now = performance.now();

    if (this.#cpuMs + (now - this.#segmentStart) > this.#limits.cpuMs) {
      throw new CodeLimitError(`Took longer than ${String(this.#limits.cpuMs)} ms`);
    }

    if (now - this.#startedAt > this.#limits.deadlineMs) {
      throw new CodeLimitError(this.#deadlineMessage());
    }
  }

  /**
   * Runs an operation, placing a run error it throws at a node.
   *
   * @param span - The node.
   * @param operation - The operation.
   * @returns What it returns.
   * @throws {CodeRunError} What the operation threw, placed.
   */
  #at<TResult>(span: SourceSpan, operation: () => TResult): TResult {
    try {
      return operation();
    } catch (error) {
      throw placed(error, span);
    }
  }

  // --- trace -----------------------------------------------------------------------------

  /**
   * The trace entry of a line, made when missing.
   *
   * @param line - The line.
   * @returns The entry, or null without a trace.
   */
  #entry(line: number): TraceEntry | null {
    if (this.#trace === null) {
      return null;
    }

    let entry = this.#trace.get(line);

    if (entry === undefined) {
      entry = { chips: [], taken: true, runs: 0 };
      this.#trace.set(line, entry);
    }

    return entry;
  }

  /**
   * Marks a line as run again: its chips start over.
   *
   * @param line - The line.
   */
  #traceRun(line: number): void {
    const entry = this.#entry(line);

    if (entry !== null) {
      entry.runs += 1;
      entry.chips = [];
      entry.taken = true;
      this.#tracedLine = line;
    }
  }

  /**
   * Marks a statement's line as run, unless the statement before was on the same line.
   *
   * @param line - The line.
   */
  #traceStart(line: number): void {
    if (line !== this.#tracedLine) {
      this.#traceRun(line);
    }
  }

  /**
   * Adds a chip to a line.
   *
   * @param line - The line.
   * @param chip - The label.
   */
  #chip(line: number, chip: string): void {
    const entry = this.#entry(line);

    if (entry !== null) {
      entry.chips.push(shorten(chip, MAX_CHIP));

      if (entry.chips.length > MAX_CHIPS) {
        entry.chips.shift();
      }
    }
  }

  /**
   * Records whether a condition line held.
   *
   * @param line - The line.
   * @param taken - Whether it held.
   */
  #taken(line: number, taken: boolean): void {
    const entry = this.#entry(line);

    if (entry !== null) {
      entry.taken = taken;
    }
  }

  // --- builtin context -------------------------------------------------------------------

  /**
   * Records an entity id as read.
   *
   * @param entityId - The id.
   */
  #read(entityId: string): void {
    this.#reads.add(entityId);
  }

  /**
   * Records printed text at the current line.
   *
   * @param printed - The text.
   */
  #print(printed: string): void {
    const shown = shorten(printed, MAX_PRINT_LENGTH);

    if (this.#prints.length < MAX_PRINTS) {
      this.#prints.push({ line: this.#line, text: shown });
    }

    this.#chip(this.#line, shown);
  }

  /**
   * Adds a note to the current line's trace.
   *
   * @param note - The note.
   */
  #note(note: string): void {
    this.#chip(this.#line, note);
  }

  /**
   * Runs one HTTP call of the code.
   *
   * @param method - The method.
   * @param args - The bound arguments.
   * @returns The Response.
   */
  #sendHttp(method: HttpMethod, args: readonly (PyValue | undefined)[]): Promise<PyValue> {
    return sendHttp(method, args, this.#http);
  }

  // --- statements ------------------------------------------------------------------------

  /**
   * Runs the module's top-level statements, then the function.
   *
   * @param name - The function.
   * @yields {Promise<unknown>} Host promises to await.
   * @returns What the function returned.
   * @throws {CodeRunError} When there is no such function.
   */
  *#main(name: string): Walk<PyValue> {
    for (const statement of this.#program.module.body) {
      if (statement.type !== 'def') {
        yield* this.#statement(statement, this.#globals);
      }
    }

    const definition = this.#program.functions.get(name);

    if (definition === undefined) {
      throw new CodeRunError(`No function ${name}()`);
    }

    return yield* this.#callFunction(definition, [], new Map(), definition.nameSpan);
  }

  /**
   * Runs statements until one ends the block.
   *
   * @param statements - The block.
   * @param scope - The scope.
   * @yields {Promise<unknown>} Host promises to await.
   * @returns How the block ended.
   */
  *#block(statements: readonly Stmt[], scope: Scope): Walk<Flow> {
    for (const statement of statements) {
      const flow = yield* this.#statement(statement, scope);

      if (flow !== null) {
        return flow;
      }
    }

    return null;
  }

  /**
   * Runs one statement.
   *
   * @param node - The statement.
   * @param scope - The scope.
   * @yields {Promise<unknown>} Host promises to await.
   * @returns How it ended.
   * @throws {CodeRunError} On a def inside a function, which the parser already refuses.
   */
  *#statement(node: Stmt, scope: Scope): Walk<Flow> {
    this.#tick();
    this.#line = node.line;
    this.#column = node.column;
    const isDocstring = node.type === 'expr' && node.value.type === 'str';

    if (!isDocstring) {
      this.#traceStart(node.line);
    }

    switch (node.type) {
      case 'expr': {
        const value = yield* this.#expression(node.value, scope);

        if (!isDocstring && value !== null && !isPrint(node.value)) {
          this.#chip(node.line, label(value));
        }

        return null;
      }
      case 'assign': {
        const value = yield* this.#expression(node.value, scope);

        for (const target of node.targets) {
          yield* this.#assign(target, value, scope);
        }

        this.#chip(node.line, label(value));
        return null;
      }
      case 'augassign': {
        yield* this.#augmented(node.target, node.op, node.value, node, scope);
        return null;
      }
      case 'if': {
        const holds = yield* this.#condition(node.test, scope, node.line);
        return yield* this.#block(holds ? node.body : node.orelse, scope);
      }
      case 'while': {
        return yield* this.#while(node.test, node.body, node.line, scope);
      }
      case 'for': {
        return yield* this.#for(node.target, node.iter, node.body, node.line, scope);
      }
      case 'return': {
        const value = node.value === null ? null : yield* this.#expression(node.value, scope);
        this.#chip(node.line, `→ ${label(value)}`);
        return { value };
      }
      case 'break':
      case 'continue': {
        return node.type;
      }
      case 'pass': {
        return null;
      }
      case 'def': {
        throw new CodeRunError('functions can only be defined at the top level');
      }
    }
  }

  /**
   * Evaluates the condition of an if, elif or while, and traces it.
   *
   * @param test - The condition.
   * @param scope - The scope.
   * @param line - The statement's line.
   * @yields {Promise<unknown>} Host promises to await.
   * @returns Whether it held.
   */
  *#condition(test: Expr, scope: Scope, line: number): Walk<boolean> {
    let chip: string;
    let holds: boolean;
    const [operator] = test.type === 'compare' ? test.ops : [];
    const [rightNode] = test.type === 'compare' ? test.comparators : [];

    if (
      test.type === 'compare' &&
      test.ops.length === 1 &&
      operator !== undefined &&
      rightNode !== undefined &&
      ORDERINGS.has(operator)
    ) {
      this.#tick();
      const left = yield* this.#expression(test.left, scope);
      const right = yield* this.#expression(rightNode, scope);
      holds = this.#at(test, () => compare(operator, left, right));
      chip = `${label(left)} ${operator} ${label(right)} → ${holds ? 'True' : 'False'}`;
    } else {
      const value = yield* this.#expression(test, scope);
      holds = truthy(value);
      chip = label(value);
    }

    this.#chip(line, chip);
    this.#taken(line, holds);
    return holds;
  }

  /**
   * Runs a while loop.
   *
   * @param test - The condition.
   * @param body - The body.
   * @param line - The loop's line.
   * @param scope - The scope.
   * @yields {Promise<unknown>} Host promises to await.
   * @returns How it ended.
   */
  *#while(test: Expr, body: readonly Stmt[], line: number, scope: Scope): Walk<Flow> {
    for (;;) {
      if (!(yield* this.#condition(test, scope, line))) {
        return null;
      }

      const flow = yield* this.#block(body, scope);

      if (flow === 'break') {
        return null;
      }

      if (flow !== null && flow !== 'continue') {
        return flow;
      }

      this.#tick();
      this.#traceRun(line);
      this.#line = line;
    }
  }

  /**
   * Runs a for loop over a snapshot of its iterable.
   *
   * @param target - The loop variable or tuple.
   * @param iter - The iterable.
   * @param body - The body.
   * @param line - The loop's line.
   * @param scope - The scope.
   * @yields {Promise<unknown>} Host promises to await.
   * @returns How it ended.
   */
  *#for(target: Expr, iter: Expr, body: readonly Stmt[], line: number, scope: Scope): Walk<Flow> {
    const iterable = yield* this.#expression(iter, scope);
    const items = this.#at(iter, () => iterate(iterable));
    this.#taken(line, items.length > 0);

    for (const [index, item] of items.entries()) {
      if (index > 0) {
        this.#tick();
        this.#traceRun(line);
        this.#line = line;
      }

      yield* this.#assign(target, item, scope);
      this.#chip(line, label(item));
      const flow = yield* this.#block(body, scope);

      if (flow === 'break') {
        return null;
      }

      if (flow !== null && flow !== 'continue') {
        return flow;
      }
    }

    return null;
  }

  /**
   * Assigns a value to a target: a name, a subscript, or a tuple to unpack into.
   *
   * @param target - The target.
   * @param value - The value.
   * @param scope - The scope.
   * @yields {Promise<unknown>} Host promises to await.
   * @throws {CodeRunError} When unpacking does not fit.
   */
  *#assign(target: Expr, value: PyValue, scope: Scope): Walk<void> {
    switch (target.type) {
      case 'name': {
        scope.set(target.id, value);
        return;
      }
      case 'subscript': {
        const container = yield* this.#expression(target.object, scope);
        const index = yield* this.#expression(target.index, scope);
        this.#at(target, () => {
          setItem(container, index, value);
        });
        return;
      }
      case 'tuple':
      case 'list': {
        const items = this.#at(target, () => {
          try {
            return iterate(value);
          } catch {
            throw new CodeRunError(`cannot unpack ${typeName(value)}`);
          }
        });
        const expected = target.items.length;

        if (items.length !== expected) {
          throw new CodeRunError(
            items.length < expected
              ? `not enough values to unpack (expected ${String(expected)}, got ${String(items.length)})`
              : `too many values to unpack (expected ${String(expected)})`,
          ).placeAt(target);
        }

        for (const [index, item] of target.items.entries()) {
          yield* this.#assign(item, items[index] ?? null, scope);
        }

        return;
      }
      default: {
        throw new CodeRunError('cannot assign to this expression').placeAt(target);
      }
    }
  }

  /**
   * Runs an augmented assignment such as `total += x`.
   *
   * @param target - A name or a subscript.
   * @param operator - The arithmetic operator.
   * @param valueNode - The right side.
   * @param node - The statement, for errors.
   * @param scope - The scope.
   * @yields {Promise<unknown>} Host promises to await.
   * @throws {CodeRunError} When the name is not defined or the operator does not apply.
   */
  *#augmented(
    target: Expr,
    operator: ArithmeticOperator,
    valueNode: Expr,
    node: Stmt,
    scope: Scope,
  ): Walk<void> {
    let result: PyValue;

    if (target.type === 'subscript') {
      const container = yield* this.#expression(target.object, scope);
      const index = yield* this.#expression(target.index, scope);
      const current = this.#at(target, () => this.#getItem(container, index));
      const operand = yield* this.#expression(valueNode, scope);
      result = this.#at(node, () => this.#combine(operator, current, operand));
      this.#at(target, () => {
        setItem(container, index, result);
      });
    } else if (target.type === 'name') {
      const current = this.#at(target, () => this.#lookup(target.id, scope));
      const operand = yield* this.#expression(valueNode, scope);
      result = this.#at(node, () => this.#combine(operator, current, operand));
      scope.set(target.id, result);
    } else {
      throw new CodeRunError('illegal expression for augmented assignment').placeAt(target);
    }

    this.#chip(node.line, label(result));
  }

  /**
   * An augmented operator applied: `list += list` extends in place, as in Python.
   *
   * @param operator - The operator.
   * @param current - The target's value.
   * @param operand - The right side.
   * @returns The new value.
   */
  #combine(operator: ArithmeticOperator, current: PyValue, operand: PyValue): PyValue {
    if (
      operator === '+' &&
      isObject(current) &&
      current.kind === 'list' &&
      isObject(operand) &&
      (operand.kind === 'list' || operand.kind === 'tuple')
    ) {
      list([...current.items, ...operand.items], this.#limits);
      current.items.push(...operand.items);
      return current;
    }

    return binaryOp(operator, current, operand, this.#limits);
  }

  // --- expressions -----------------------------------------------------------------------

  /**
   * Looks a name up: locals, globals, the code's functions, mem, then the builtins.
   *
   * @param name - The name.
   * @param scope - The scope.
   * @returns Its value.
   * @throws {CodeRunError} When it is not defined.
   */
  #lookup(name: string, scope: Scope): PyValue {
    const found = scope.get(name);

    if (found !== undefined) {
      return found;
    }

    if (this.#program.functions.has(name)) {
      return { kind: 'function', name };
    }

    if (name === 'mem') {
      return this.#mem;
    }

    if (name === 'http') {
      throw new CodeRunError('http is used to call http.get(...), http.post(...) and the others');
    }

    const builtin = BUILTINS_BY_NAME.get(name);

    if (builtin !== undefined) {
      if (builtin.kind === 'constant') {
        const value = builtin.implementation([], this.#context);
        return value instanceof Promise ? null : value;
      }

      return { kind: 'builtin', name };
    }

    throw new CodeRunError(`name '${name}' is not defined`);
  }

  /**
   * `container[index]`, where a missing key of mem reads as None.
   *
   * @param container - The container.
   * @param index - The index or key.
   * @returns The item.
   */
  #getItem(container: PyValue, index: PyValue): PyValue {
    if (container === this.#mem && typeof index === 'string' && !this.#mem.entries.has(index)) {
      return null;
    }

    return getItem(container, index);
  }

  /**
   * Evaluates an expression.
   *
   * @param node - The expression.
   * @param scope - The scope.
   * @yields {Promise<unknown>} Host promises to await.
   * @returns Its value.
   * @throws {CodeRunError} When it fails.
   */
  *#expression(node: Expr, scope: Scope): Walk<PyValue> {
    this.#tick();

    switch (node.type) {
      case 'num': {
        return node.isInt ? int(node.value) : float(node.value);
      }
      case 'str': {
        return node.value;
      }
      case 'const': {
        return node.value;
      }
      case 'fstring': {
        let built = '';

        for (const part of node.parts) {
          if (typeof part === 'string') {
            built += part;
            continue;
          }

          const value = yield* this.#expression(part.expression, scope);
          built += this.#at(part.expression, () => {
            const shown = part.conversion === 'r' ? repr(value) : value;
            return part.spec === null ? str(shown) : formatWithSpec(shown, part.spec, this.#limits);
          });
        }

        return this.#at(node, () => text(built, this.#limits));
      }
      case 'name': {
        return this.#at(node, () => this.#lookup(node.id, scope));
      }
      case 'entity': {
        this.#reads.add(node.entityId);
        const host = this.#options.host;

        if (node.field !== null) {
          return fromJson(host.field(node.entityId, node.field), this.#zone);
        }

        const value = host.entity(node.entityId);
        return typeof value === 'number' ? fromNumber(value) : (value ?? null);
      }
      case 'part': {
        return fromJson(this.#options.host.part(node.key), this.#zone);
      }
      case 'attribute': {
        const object = yield* this.#expression(node.object, scope);
        return this.#at(node, () => getAttribute(object, node.name));
      }
      case 'subscript': {
        const container = yield* this.#expression(node.object, scope);
        const index = yield* this.#expression(node.index, scope);
        return this.#at(node, () => this.#getItem(container, index));
      }
      case 'slice': {
        const container = yield* this.#expression(node.object, scope);
        const lower = node.lower === null ? null : yield* this.#expression(node.lower, scope);
        const upper = node.upper === null ? null : yield* this.#expression(node.upper, scope);
        const step = node.step === null ? null : yield* this.#expression(node.step, scope);
        return this.#at(node, () => sliceOf(container, lower, upper, step));
      }
      case 'call': {
        return yield* this.#call(node.func, node.args, node.keywords, node, scope);
      }
      case 'binary': {
        const left = yield* this.#expression(node.left, scope);
        const right = yield* this.#expression(node.right, scope);
        return this.#at(node, () => binaryOp(node.op, left, right, this.#limits));
      }
      case 'unary': {
        const operand = yield* this.#expression(node.operand, scope);
        return this.#at(node, () => unaryOp(node.op, operand));
      }
      case 'bool': {
        const left = yield* this.#expression(node.left, scope);

        if (node.op === 'and' ? !truthy(left) : truthy(left)) {
          return left;
        }

        return yield* this.#expression(node.right, scope);
      }
      case 'compare': {
        let left = yield* this.#expression(node.left, scope);

        for (const [index, operator] of node.ops.entries()) {
          const rightNode = node.comparators[index];

          if (rightNode === undefined) {
            break;
          }

          const right = yield* this.#expression(rightNode, scope);
          const before = left;

          if (!this.#at(node, () => compare(operator, before, right))) {
            return false;
          }

          left = right;
        }

        return true;
      }
      case 'ifexp': {
        const test = yield* this.#expression(node.test, scope);
        return yield* this.#expression(truthy(test) ? node.body : node.orelse, scope);
      }
      case 'list':
      case 'tuple': {
        const items: PyValue[] = [];

        for (const item of node.items) {
          items.push(yield* this.#expression(item, scope));
        }

        return node.type === 'tuple'
          ? tuple(items)
          : this.#at(node, () => list(items, this.#limits));
      }
      case 'dict': {
        const entries = new Map<string, PyValue>();

        for (const [index, keyNode] of node.keys.entries()) {
          const key = yield* this.#expression(keyNode, scope);
          const valueNode = node.values[index];
          const value = valueNode === undefined ? null : yield* this.#expression(valueNode, scope);

          if (typeof key !== 'string') {
            throw new CodeRunError(`dict keys must be str, got ${typeName(key)}`).placeAt(keyNode);
          }

          entries.set(key, value);
        }

        return dict(entries);
      }
      case 'listcomp': {
        const iterable = yield* this.#expression(node.iter, scope);
        const items = this.#at(node.iter, () => iterate(iterable));
        const inner = new Scope(scope);
        const results: PyValue[] = [];

        for (const item of items) {
          this.#tick();
          yield* this.#assign(node.target, item, inner);

          if (node.condition !== null && !truthy(yield* this.#expression(node.condition, inner))) {
            continue;
          }

          results.push(yield* this.#expression(node.element, inner));
          this.#at(node, () => list(results, this.#limits));
        }

        return { kind: 'list', items: results };
      }
    }
  }

  /**
   * Evaluates a call's arguments, in order.
   *
   * @param args - Positional argument expressions.
   * @param keywords - Keyword argument expressions.
   * @param scope - The scope.
   * @yields {Promise<unknown>} Host promises to await.
   * @returns The values.
   */
  *#arguments(
    args: readonly Expr[],
    keywords: readonly { readonly name: string; readonly value: Expr }[],
    scope: Scope,
  ): Walk<{ readonly positional: PyValue[]; readonly named: Map<string, PyValue> }> {
    const positional: PyValue[] = [];
    const named = new Map<string, PyValue>();

    for (const arg of args) {
      positional.push(yield* this.#expression(arg, scope));
    }

    for (const keyword of keywords) {
      named.set(keyword.name, yield* this.#expression(keyword.value, scope));
    }

    return { positional, named };
  }

  /**
   * Evaluates a call: a method, an `http.<method>`, a builtin or a def of the code.
   *
   * @param func - What is called.
   * @param args - Positional argument expressions.
   * @param keywords - Keyword argument expressions.
   * @param node - The call, for errors.
   * @param scope - The scope.
   * @yields {Promise<unknown>} Host promises to await.
   * @returns What the call returns.
   * @throws {CodeRunError} When the value is not callable or the call fails.
   */
  *#call(
    func: Expr,
    args: readonly Expr[],
    keywords: readonly { readonly name: string; readonly value: Expr }[],
    node: SourceSpan,
    scope: Scope,
  ): Walk<PyValue> {
    if (func.type === 'attribute') {
      const object = func.object;

      if (object.type === 'name' && object.id === 'http' && scope.get('http') === undefined) {
        const entry = BUILTINS_BY_NAME.get(`http.${func.name}`);

        if (entry === undefined) {
          throw new CodeRunError(
            `http has no method ${func.name}(): use get, post, put, patch or delete`,
          ).placeAt(func);
        }

        const values = yield* this.#arguments(args, keywords, scope);
        return yield* this.#callBuiltin(entry, values.positional, values.named, node);
      }

      const receiver = yield* this.#expression(object, scope);
      const values = yield* this.#arguments(args, keywords, scope);
      return this.#at(node, () =>
        callMethod(receiver, func.name, values.positional, values.named, this.#limits),
      );
    }

    const callee = yield* this.#expression(func, scope);
    const values = yield* this.#arguments(args, keywords, scope);

    if (isObject(callee) && callee.kind === 'function') {
      const definition = this.#program.functions.get(callee.name);

      if (definition !== undefined) {
        return yield* this.#callFunction(definition, values.positional, values.named, node);
      }
    }

    if (isObject(callee) && callee.kind === 'builtin') {
      const entry = BUILTINS_BY_NAME.get(callee.name);

      if (entry !== undefined) {
        return yield* this.#callBuiltin(entry, values.positional, values.named, node);
      }
    }

    throw new CodeRunError(`${typeName(callee)} is not callable`).placeAt(node);
  }

  /**
   * Calls a builtin, yielding its promise when it has to wait for the host.
   *
   * @param entry - The builtin.
   * @param positional - Positional arguments.
   * @param named - Keyword arguments.
   * @param node - The call, for errors.
   * @yields {Promise<unknown>} The builtin's promise, when it returns one.
   * @returns What it returns.
   * @throws {CodeRunError} What the builtin threw, placed at the call.
   */
  *#callBuiltin(
    entry: BuiltinEntry,
    positional: readonly PyValue[],
    named: ReadonlyMap<string, PyValue>,
    node: SourceSpan,
  ): Walk<PyValue> {
    const bound = this.#at(node, () => bindArguments(entry.name, entry.params, positional, named));
    const result = this.#at(node, () => entry.implementation(bound, this.#context));

    if (!(result instanceof Promise)) {
      return result;
    }

    try {
      const value = yield result;
      return value as PyValue;
    } catch (error) {
      throw placed(error, node);
    }
  }

  /**
   * Calls a def of the code.
   *
   * @param definition - The def.
   * @param positional - Positional arguments.
   * @param named - Keyword arguments.
   * @param node - The call, for errors.
   * @yields {Promise<unknown>} Host promises to await.
   * @returns What it returns; None when it falls off the end.
   * @throws {CodeLimitError} When calls nest too deeply.
   */
  *#callFunction(
    definition: FunctionDef,
    positional: readonly PyValue[],
    named: ReadonlyMap<string, PyValue>,
    node: SourceSpan,
  ): Walk<PyValue> {
    if (this.#depth >= this.#limits.callDepth) {
      throw new CodeLimitError(`Stopped after ${String(this.#limits.callDepth)} nested calls`);
    }

    const params = definition.params.map((param) => ({
      name: param.name,
      optional: param.default !== null,
      variadic: false,
    }));
    const bound = this.#at(node, () => bindArguments(definition.name, params, positional, named));
    const local = new Scope(this.#globals);

    for (const [index, param] of definition.params.entries()) {
      const given = bound[index];
      const value =
        given !== undefined
          ? given
          : param.default === null
            ? null
            : yield* this.#expression(param.default, this.#globals);
      local.set(param.name, value);
    }

    const line = this.#line;
    const column = this.#column;
    this.#depth += 1;

    try {
      const flow = yield* this.#block(definition.body, local);
      // Only on a normal return: a failure keeps the line it failed at.
      this.#line = line;
      this.#column = column;
      return typeof flow === 'object' && flow !== null ? flow.value : null;
    } finally {
      this.#depth -= 1;
    }
  }

  // --- results ---------------------------------------------------------------------------

  /**
   * The run's result.
   *
   * @param kind - How it ended.
   * @param value - The returned value.
   * @param mem - The mem to keep.
   * @param error - The error, or null.
   * @returns The result.
   */
  #result(
    kind: RunResult['kind'],
    value: JsonValue,
    mem: JsonObject,
    error: RunError | null,
  ): RunResult {
    const trace = this.#buildTrace(error?.line ?? null);

    return {
      kind,
      value,
      ...(error === null ? {} : { error }),
      mem,
      steps: this.#steps,
      cpuMs: Math.round(this.#cpuMs * 100) / 100,
      prints: this.#prints,
      ...(trace === null ? {} : { trace }),
      reads: [...this.#reads].toSorted(),
      http: this.#http.log,
    };
  }

  /**
   * The trace, when one was asked for.
   *
   * @param errorLine - The line that failed, or null.
   * @returns The trace, or null.
   */
  #buildTrace(errorLine: number | null): Trace | null {
    if (this.#trace === null) {
      return null;
    }

    const lines = [...this.#trace]
      .map(([line, entry]) => ({ line, chips: entry.chips, taken: entry.taken, runs: entry.runs }))
      .toSorted((left, right) => left.line - right.line);

    return {
      lines,
      executedLines: lines.map((line) => line.line),
      ...(errorLine === null ? {} : { errorLine }),
    };
  }

  /**
   * The result of a run that failed or hit a limit.
   *
   * @param error - What was thrown.
   * @returns The result, with the mem the run started with.
   */
  #failure(error: unknown): RunResult {
    const fallback = { line: Math.max(1, this.#line), column: Math.max(1, this.#column) };

    if (error instanceof CodeLimitError) {
      return this.#result('limit', null, this.#options.mem, {
        message: error.message,
        ...fallback,
      });
    }

    if (error instanceof CodeRunError) {
      const place = error.span ?? fallback;
      return this.#result('error', null, this.#options.mem, {
        message: error.message,
        line: place.line,
        column: place.column,
      });
    }

    const message =
      error instanceof RangeError && /call stack/iu.test(error.message)
        ? 'values nest too deeply'
        : `internal error: ${error instanceof Error ? error.message : String(error)}`;

    return this.#result('error', null, this.#options.mem, { message, ...fallback });
  }
}

/**
 * Runs one function of a compiled program, the way a part of the alias is computed.
 *
 * @param program - The program, from `compile`.
 * @param name - The function to call, with no arguments.
 * @param options - The host, the mem, and whether to trace or to run as a trial.
 * @returns The result; a failing line or a broken limit is a result, never a thrown error.
 */
export function runFunction(
  program: CodeProgram,
  name: string,
  options: RunOptions,
): Promise<RunResult> {
  return new Interpreter(program, options).run(name);
}
