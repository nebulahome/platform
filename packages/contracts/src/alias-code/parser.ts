/**
 * The parser of alias code: tokens to a syntax tree, every node with its place in the source.
 *
 * A recursive-descent reading of the Python grammar, cut to the subset the interpreter runs. What
 * the language leaves out on purpose - classes, imports, try, lambda and the rest - is refused at
 * the token where it appears with a message that says so, never a bare "invalid syntax". Two
 * readings are the language's own: `<domain>.<object_id>` (one of the entity domains, a dot, an
 * id) is an entity, with an optional third name for a field, and `part.<key>` is another part of
 * the alias.
 */
import { ENTITY_DOMAINS } from '../entity-id.js';

import { CodeSyntaxError, type SourceSpan } from './errors.js';
import { tokenize, type Token } from './lexer.js';

/** An arithmetic operator. */
export type BinaryOperator = '+' | '-' | '*' | '/' | '//' | '%' | '**';

/** A comparison operator. */
export type CompareOperator =
  '<' | '>' | '==' | '>=' | '<=' | '!=' | 'in' | 'not in' | 'is' | 'is not';

/** One piece of an f-string, its expressions parsed. */
export type FStringPart =
  | string
  | {
      readonly expression: Expr;
      readonly conversion: 'r' | 's' | null;
      readonly spec: string | null;
    };

/** A keyword argument of a call. */
export type Keyword = SourceSpan & { readonly name: string; readonly value: Expr };

/** An expression. */
export type Expr = SourceSpan &
  (
    | { readonly type: 'num'; readonly value: number; readonly isInt: boolean }
    | { readonly type: 'str'; readonly value: string }
    | { readonly type: 'fstring'; readonly parts: readonly FStringPart[] }
    | { readonly type: 'const'; readonly value: boolean | null }
    | { readonly type: 'name'; readonly id: string }
    | { readonly type: 'entity'; readonly entityId: string; readonly field: string | null }
    | { readonly type: 'part'; readonly key: string }
    | { readonly type: 'attribute'; readonly object: Expr; readonly name: string }
    | { readonly type: 'subscript'; readonly object: Expr; readonly index: Expr }
    | {
        readonly type: 'slice';
        readonly object: Expr;
        readonly lower: Expr | null;
        readonly upper: Expr | null;
        readonly step: Expr | null;
      }
    | {
        readonly type: 'call';
        readonly func: Expr;
        readonly args: readonly Expr[];
        readonly keywords: readonly Keyword[];
      }
    | {
        readonly type: 'binary';
        readonly op: BinaryOperator;
        readonly left: Expr;
        readonly right: Expr;
      }
    | { readonly type: 'unary'; readonly op: '-' | '+' | 'not'; readonly operand: Expr }
    | {
        readonly type: 'bool';
        readonly op: 'and' | 'or';
        readonly left: Expr;
        readonly right: Expr;
      }
    | {
        readonly type: 'compare';
        readonly left: Expr;
        readonly ops: readonly CompareOperator[];
        readonly comparators: readonly Expr[];
      }
    | { readonly type: 'ifexp'; readonly test: Expr; readonly body: Expr; readonly orelse: Expr }
    | { readonly type: 'list' | 'tuple'; readonly items: readonly Expr[] }
    | { readonly type: 'dict'; readonly keys: readonly Expr[]; readonly values: readonly Expr[] }
    | {
        readonly type: 'listcomp';
        readonly element: Expr;
        readonly target: Expr;
        readonly iter: Expr;
        readonly condition: Expr | null;
      }
  );

/** A parameter of a def. */
export type Param = SourceSpan & { readonly name: string; readonly default: Expr | null };

/** A top-level function. */
export type FunctionDef = SourceSpan & {
  readonly type: 'def';
  readonly name: string;
  readonly nameSpan: SourceSpan;
  readonly params: readonly Param[];
  readonly body: readonly Stmt[];
};

/** A statement. */
export type Stmt =
  | FunctionDef
  | (SourceSpan &
      (
        | { readonly type: 'return'; readonly value: Expr | null }
        | {
            readonly type: 'if';
            readonly test: Expr;
            readonly body: readonly Stmt[];
            readonly orelse: readonly Stmt[];
          }
        | {
            readonly type: 'for';
            readonly target: Expr;
            readonly iter: Expr;
            readonly body: readonly Stmt[];
          }
        | { readonly type: 'while'; readonly test: Expr; readonly body: readonly Stmt[] }
        | { readonly type: 'break' | 'continue' | 'pass' }
        | { readonly type: 'assign'; readonly targets: readonly Expr[]; readonly value: Expr }
        | {
            readonly type: 'augassign';
            readonly target: Expr;
            readonly op: BinaryOperator;
            readonly value: Expr;
          }
        | { readonly type: 'expr'; readonly value: Expr }
      ));

/** A whole file. */
export type Module = { readonly body: readonly Stmt[] };

/** A compiled code file, ready to run. */
export type CodeProgram = {
  readonly source: string;
  readonly module: Module;

  /** The top-level functions by name; a later def of the same name wins, as in Python. */
  readonly functions: ReadonlyMap<string, FunctionDef>;
};

const KEYWORDS: ReadonlySet<string> = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

const NO_TRY = 'try/except is not supported: a failing line stops the run and shows its error';
const NO_ASYNC = 'async and await are not supported: http calls already wait for the answer';
const NO_IMPORT = 'import is not supported: everything available is already there';

/** The keywords the language refuses, with what to do instead. */
export const REFUSED_KEYWORDS: Readonly<Record<string, string>> = {
  class: 'classes are not supported',
  import: NO_IMPORT,
  from: NO_IMPORT,
  try: NO_TRY,
  except: NO_TRY,
  finally: NO_TRY,
  raise: 'raise is not supported: return None when there is no answer',
  lambda: 'lambda is not supported: write a def',
  with: 'with is not supported',
  global: 'global is not supported: keep values between runs in mem',
  nonlocal: 'nonlocal is not supported',
  yield: 'yield is not supported',
  async: NO_ASYNC,
  await: NO_ASYNC,
  del: 'del is not supported: use pop() to remove a key or an item',
  assert: 'assert is not supported: use if and return',
};

const AUGMENTED: Readonly<Record<string, BinaryOperator>> = {
  '+=': '+',
  '-=': '-',
  '*=': '*',
  '/=': '/',
  '//=': '//',
  '%=': '%',
  '**=': '**',
};

const COMPARE_OPERATORS: Readonly<Record<string, CompareOperator>> = {
  '<': '<',
  '>': '>',
  '==': '==',
  '>=': '>=',
  '<=': '<=',
  '!=': '!=',
};

const TERM_OPERATORS: Readonly<Record<string, BinaryOperator>> = {
  '*': '*',
  '/': '/',
  '//': '//',
  '%': '%',
};

const DOMAINS: ReadonlySet<string> = new Set(ENTITY_DOMAINS);

/** How deep expressions may nest before the parser refuses them. */
const MAX_DEPTH = 100;

/**
 * The span from the start of one node to the end of another.
 *
 * @param start - The first.
 * @param end - The last.
 * @returns The span covering both.
 */
function spanFrom(start: SourceSpan, end: SourceSpan): SourceSpan {
  return {
    line: start.line,
    column: start.column,
    endLine: end.endLine,
    endColumn: end.endColumn,
  };
}

/**
 * Only the place of a node or token.
 *
 * @param node - The node.
 * @returns Its span.
 */
function spanOf(node: SourceSpan): SourceSpan {
  return spanFrom(node, node);
}

/**
 * Reads tokens into a syntax tree.
 */
class Parser {
  readonly #tokens: readonly Token[];
  #position = 0;
  #inFunction = false;
  #loops = 0;
  #depth = 0;

  /**
   * @param tokens - The tokens, ending with `eof`.
   */
  public constructor(tokens: readonly Token[]) {
    this.#tokens = tokens;
  }

  /**
   * Reads a whole file.
   *
   * @returns The module.
   */
  public module(): Module {
    const body: Stmt[] = [];

    while (this.#peek().kind !== 'eof') {
      if (this.#peek().kind === 'newline') {
        this.#next();
        continue;
      }

      body.push(...this.#statement());
    }

    return { body };
  }

  /**
   * Reads one expression, or a bare tuple, and nothing after it.
   *
   * @returns The expression.
   * @throws {CodeSyntaxError} When text follows it.
   */
  public expressionOnly(): Expr {
    const expression = this.#testList();
    const after = this.#peek();

    if (after.kind !== 'eof') {
      throw this.#unexpected(after);
    }

    return expression;
  }

  /**
   * The token at an offset from the cursor.
   *
   * @param offset - How far ahead.
   * @returns The token; `eof` past the end.
   */
  #peek(offset = 0): Token {
    const token = this.#tokens[this.#position + offset] ?? this.#tokens.at(-1);

    if (token === undefined) {
      return { kind: 'eof', text: '', line: 1, column: 1, endLine: 1, endColumn: 1 };
    }

    return token;
  }

  /**
   * Consumes the token at the cursor.
   *
   * @returns It.
   */
  #next(): Token {
    const token = this.#peek();

    if (this.#position < this.#tokens.length - 1) {
      this.#position += 1;
    }

    return token;
  }

  /**
   * Whether a token is a given operator.
   *
   * @param text - The operator.
   * @param offset - How far ahead.
   * @returns True when it is.
   */
  #isOp(text: string, offset = 0): boolean {
    const token = this.#peek(offset);
    return token.kind === 'op' && token.text === text;
  }

  /**
   * Whether the token at the cursor is a given name or keyword.
   *
   * @param text - The name.
   * @returns True when it is.
   */
  #isName(text: string): boolean {
    const token = this.#peek();
    return token.kind === 'name' && token.text === text;
  }

  /**
   * The error for a token nothing expected.
   *
   * @param token - The token.
   * @returns The error to throw.
   */
  #unexpected(token: Token): CodeSyntaxError {
    if (token.kind === 'name') {
      const refused = REFUSED_KEYWORDS[token.text];

      if (refused !== undefined) {
        return new CodeSyntaxError(refused, spanOf(token));
      }
    }

    if (token.kind === 'indent') {
      return new CodeSyntaxError('unexpected indent', spanOf(token));
    }

    if (token.kind === 'eof') {
      return new CodeSyntaxError('unexpected end of code', spanOf(token));
    }

    if (token.kind === 'op' && token.text === '=') {
      return new CodeSyntaxError('invalid syntax: use == to compare', spanOf(token));
    }

    return new CodeSyntaxError('invalid syntax', spanOf(token));
  }

  /**
   * Consumes an operator that must be there.
   *
   * @param text - The operator.
   * @returns Its token.
   * @throws {CodeSyntaxError} When something else is there.
   */
  #expectOp(text: string): Token {
    const token = this.#peek();

    if (token.kind !== 'op' || token.text !== text) {
      if (token.kind === 'newline' || token.kind === 'eof') {
        throw new CodeSyntaxError(`expected '${text}'`, spanOf(token));
      }

      throw this.#unexpected(token);
    }

    return this.#next();
  }

  /**
   * Consumes a name that must be there and must not be a keyword.
   *
   * @param what - What the name is for, for the message.
   * @returns Its token.
   * @throws {CodeSyntaxError} When something else is there.
   */
  #expectName(what: string): Token {
    const token = this.#peek();

    if (token.kind !== 'name' || KEYWORDS.has(token.text)) {
      if (token.kind === 'name' && REFUSED_KEYWORDS[token.text] !== undefined) {
        throw this.#unexpected(token);
      }

      throw new CodeSyntaxError(`expected ${what}`, spanOf(token));
    }

    return this.#next();
  }

  /**
   * Refuses a statement that starts with a keyword the language leaves out.
   *
   * @param token - The first token of the statement.
   * @throws {CodeSyntaxError} When it is one.
   */
  #refuse(token: Token): void {
    if (token.kind === 'name' && REFUSED_KEYWORDS[token.text] !== undefined) {
      throw this.#unexpected(token);
    }
  }

  /**
   * Counts one level of nesting.
   *
   * @param token - Where, for the message.
   * @throws {CodeSyntaxError} When expressions nest too deeply.
   */
  #enter(token: Token): void {
    this.#depth += 1;

    if (this.#depth > MAX_DEPTH) {
      throw new CodeSyntaxError('expression is nested too deeply', spanOf(token));
    }
  }

  /**
   * Reads one statement; a line of simple statements may give several.
   *
   * @returns The statements.
   * @throws {CodeSyntaxError} When the statement is malformed or refused.
   */
  #statement(): Stmt[] {
    const token = this.#peek();

    if (token.kind === 'indent') {
      throw this.#unexpected(token);
    }

    this.#refuse(token);

    if (token.kind === 'name') {
      switch (token.text) {
        case 'def': {
          return [this.#def()];
        }
        case 'if': {
          return [this.#if()];
        }
        case 'for': {
          return [this.#for()];
        }
        case 'while': {
          return [this.#while()];
        }
        case 'elif':
        case 'else': {
          throw new CodeSyntaxError(`'${token.text}' without a matching if`, spanOf(token));
        }
        default: {
          break;
        }
      }
    }

    return this.#simpleLine();
  }

  /**
   * Reads the block after a compound statement's colon: an indented suite, or simple statements
   * on the same line.
   *
   * @param owner - The keyword that opened it, for the message.
   * @returns The statements.
   * @throws {CodeSyntaxError} When the block is missing.
   */
  #block(owner: Token): Stmt[] {
    this.#expectOp(':');

    if (this.#peek().kind !== 'newline') {
      return this.#simpleLine();
    }

    this.#next();

    if (this.#peek().kind !== 'indent') {
      throw new CodeSyntaxError(
        `expected an indented block after '${owner.text}' on line ${String(owner.line)}`,
        spanOf(this.#peek()),
      );
    }

    this.#next();
    const body: Stmt[] = [];

    while (this.#peek().kind !== 'dedent' && this.#peek().kind !== 'eof') {
      body.push(...this.#statement());
    }

    if (this.#peek().kind === 'dedent') {
      this.#next();
    }

    return body;
  }

  /**
   * Reads simple statements separated by semicolons, to the end of the line.
   *
   * @returns The statements.
   * @throws {CodeSyntaxError} When the line does not end after them.
   */
  #simpleLine(): Stmt[] {
    const statements = [this.#small()];

    while (this.#isOp(';')) {
      this.#next();
      const after = this.#peek().kind;

      if (after === 'newline' || after === 'eof') {
        break;
      }

      statements.push(this.#small());
    }

    const end = this.#peek();

    if (end.kind === 'newline') {
      this.#next();
    } else if (end.kind !== 'eof') {
      throw this.#unexpected(end);
    }

    return statements;
  }

  /**
   * Reads one simple statement: pass, break, continue, return, an assignment or an expression.
   *
   * @returns The statement.
   * @throws {CodeSyntaxError} When it is malformed, refused or out of place.
   */
  #small(): Stmt {
    const token = this.#peek();
    this.#refuse(token);

    if (token.kind === 'name') {
      switch (token.text) {
        case 'pass': {
          this.#next();
          return { type: 'pass', ...spanOf(token) };
        }
        case 'break':
        case 'continue': {
          if (this.#loops === 0) {
            throw new CodeSyntaxError(`'${token.text}' outside a loop`, spanOf(token));
          }

          this.#next();
          return { type: token.text === 'break' ? 'break' : 'continue', ...spanOf(token) };
        }
        case 'return': {
          return this.#return();
        }
        case 'def':
        case 'if':
        case 'for':
        case 'while':
        case 'elif':
        case 'else': {
          throw this.#unexpected(token);
        }
        default: {
          break;
        }
      }
    }

    const first = this.#testList();

    if (this.#isOp('=')) {
      const targets = [this.#target(first, true)];
      this.#next();
      let value = this.#testList();

      while (this.#isOp('=')) {
        this.#next();
        targets.push(this.#target(value, true));
        value = this.#testList();
      }

      return { type: 'assign', targets, value, ...spanFrom(first, value) };
    }

    const operator = this.#peek();
    const augmented = operator.kind === 'op' ? AUGMENTED[operator.text] : undefined;

    if (augmented !== undefined) {
      const target = this.#target(first, false);
      this.#next();
      const value = this.#testList();
      return { type: 'augassign', target, op: augmented, value, ...spanFrom(first, value) };
    }

    return { type: 'expr', value: first, ...spanOf(first) };
  }

  /**
   * Checks that an expression can be assigned to.
   *
   * @param expression - The would-be target.
   * @param allowTuple - Whether unpacking is allowed here.
   * @returns The same expression.
   * @throws {CodeSyntaxError} When it cannot be assigned.
   */
  #target(expression: Expr, allowTuple: boolean): Expr {
    switch (expression.type) {
      case 'name':
      case 'subscript': {
        return expression;
      }
      case 'tuple':
      case 'list': {
        if (!allowTuple) {
          throw new CodeSyntaxError(
            'illegal expression for augmented assignment',
            spanOf(expression),
          );
        }

        for (const item of expression.items) {
          this.#target(item, true);
        }

        return expression;
      }
      case 'entity': {
        throw new CodeSyntaxError(
          'entities cannot be assigned: alias code only reads them',
          spanOf(expression),
        );
      }
      case 'part': {
        throw new CodeSyntaxError(
          'parts cannot be assigned: a part takes what its function returns',
          spanOf(expression),
        );
      }
      case 'slice': {
        throw new CodeSyntaxError('slice assignment is not supported', spanOf(expression));
      }
      case 'attribute': {
        throw new CodeSyntaxError('attributes cannot be assigned', spanOf(expression));
      }
      default: {
        throw new CodeSyntaxError('cannot assign to this expression', spanOf(expression));
      }
    }
  }

  /**
   * Reads a return statement.
   *
   * @returns The statement.
   * @throws {CodeSyntaxError} When it is outside a function.
   */
  #return(): Stmt {
    const token = this.#next();

    if (!this.#inFunction) {
      throw new CodeSyntaxError("'return' outside a function", spanOf(token));
    }

    const after = this.#peek();

    if (after.kind === 'newline' || after.kind === 'eof' || this.#isOp(';')) {
      return { type: 'return', value: null, ...spanOf(token) };
    }

    const value = this.#testList();
    return { type: 'return', value, ...spanFrom(token, value) };
  }

  /**
   * Reads a def.
   *
   * @returns The function.
   * @throws {CodeSyntaxError} When it is nested, or its parameters are malformed or refused.
   */
  #def(): FunctionDef {
    const keyword = this.#next();

    if (this.#inFunction) {
      throw new CodeSyntaxError(
        'functions can only be defined at the top level, not inside another def',
        spanOf(keyword),
      );
    }

    const name = this.#expectName('a function name');
    this.#expectOp('(');
    const params: Param[] = [];

    while (!this.#isOp(')')) {
      const token = this.#peek();

      if (this.#isOp('*') || this.#isOp('**')) {
        throw new CodeSyntaxError('*args and **kwargs are not supported', spanOf(token));
      }

      const param = this.#expectName('a parameter name');

      if (params.some((existing) => existing.name === param.text)) {
        throw new CodeSyntaxError(
          `duplicate argument '${param.text}' in function definition`,
          spanOf(param),
        );
      }

      if (this.#isOp(':')) {
        this.#next();
        this.#test();
      }

      let defaultValue: Expr | null = null;

      if (this.#isOp('=')) {
        this.#next();
        defaultValue = this.#test();
      } else if (params.some((existing) => existing.default !== null)) {
        throw new CodeSyntaxError('non-default argument follows default argument', spanOf(param));
      }

      params.push({ name: param.text, default: defaultValue, ...spanOf(param) });

      if (!this.#isOp(',')) {
        break;
      }

      this.#next();
    }

    this.#expectOp(')');

    if (this.#isOp('->')) {
      this.#next();
      this.#test();
    }

    const loops = this.#loops;
    this.#inFunction = true;
    this.#loops = 0;
    const body = this.#block(keyword);
    this.#inFunction = false;
    this.#loops = loops;

    return {
      type: 'def',
      name: name.text,
      nameSpan: spanOf(name),
      params,
      body,
      ...spanFrom(keyword, body.at(-1) ?? name),
    };
  }

  /**
   * Reads an if or elif statement, with its elif and else branches.
   *
   * @returns The statement.
   * @throws {CodeSyntaxError} When it is malformed.
   */
  #if(): Stmt {
    const keyword = this.#next();
    const test = this.#test();
    const body = this.#block(keyword);
    let orelse: Stmt[] = [];

    if (this.#isName('elif')) {
      orelse = [this.#if()];
    } else if (this.#isName('else')) {
      orelse = this.#block(this.#next());
    }

    return {
      type: 'if',
      test,
      body,
      orelse,
      ...spanFrom(keyword, orelse.at(-1) ?? body.at(-1) ?? test),
    };
  }

  /**
   * Reads a for loop.
   *
   * @returns The statement.
   * @throws {CodeSyntaxError} When it is malformed, or has an else.
   */
  #for(): Stmt {
    const keyword = this.#next();
    const target = this.#target(this.#targetList(), true);

    if (!this.#isName('in')) {
      throw new CodeSyntaxError("expected 'in'", spanOf(this.#peek()));
    }

    this.#next();
    const iter = this.#testList();
    this.#loops += 1;
    const body = this.#block(keyword);
    this.#loops -= 1;

    if (this.#isName('else')) {
      throw new CodeSyntaxError('for … else is not supported', spanOf(this.#peek()));
    }

    return { type: 'for', target, iter, body, ...spanFrom(keyword, body.at(-1) ?? iter) };
  }

  /**
   * Reads a while loop.
   *
   * @returns The statement.
   * @throws {CodeSyntaxError} When it is malformed, or has an else.
   */
  #while(): Stmt {
    const keyword = this.#next();
    const test = this.#test();
    this.#loops += 1;
    const body = this.#block(keyword);
    this.#loops -= 1;

    if (this.#isName('else')) {
      throw new CodeSyntaxError('while … else is not supported', spanOf(this.#peek()));
    }

    return { type: 'while', test, body, ...spanFrom(keyword, body.at(-1) ?? test) };
  }

  /**
   * Reads the target of a for loop or a comprehension: names, subscripts, tuples of them.
   *
   * @returns The target expression.
   */
  #targetList(): Expr {
    const first = this.#postfix();

    if (!this.#isOp(',')) {
      return first;
    }

    const items = [first];

    while (this.#isOp(',')) {
      this.#next();

      if (this.#isName('in')) {
        break;
      }

      items.push(this.#postfix());
    }

    return { type: 'tuple', items, ...spanFrom(first, items.at(-1) ?? first) };
  }

  /**
   * Whether the token at the cursor can start an expression, for a tuple's trailing comma.
   *
   * @returns True when it can.
   */
  #startsExpression(): boolean {
    const token = this.#peek();

    switch (token.kind) {
      case 'number':
      case 'string':
      case 'fstring': {
        return true;
      }
      case 'name': {
        return !['in', 'for', 'if', 'else', 'and', 'or', 'is'].includes(token.text);
      }
      case 'op': {
        return ['(', '[', '{', '-', '+', '~', '*'].includes(token.text);
      }
      default: {
        return false;
      }
    }
  }

  /**
   * expression (',' expression)* - a bare tuple when there is a comma.
   *
   * @returns The expression.
   */
  #testList(): Expr {
    const first = this.#test();

    if (!this.#isOp(',')) {
      return first;
    }

    const items = [first];

    while (this.#isOp(',')) {
      this.#next();

      if (!this.#startsExpression()) {
        break;
      }

      items.push(this.#test());
    }

    return { type: 'tuple', items, ...spanFrom(first, items.at(-1) ?? first) };
  }

  /**
   * or_test ['if' or_test 'else' test]
   *
   * @returns The expression.
   * @throws {CodeSyntaxError} On lambda, yield or await, or a conditional without else.
   */
  #test(): Expr {
    const token = this.#peek();
    this.#enter(token);
    this.#refuse(token);
    const body = this.#orTest();

    if (!this.#isName('if')) {
      this.#depth -= 1;
      return body;
    }

    this.#next();
    const test = this.#orTest();

    if (!this.#isName('else')) {
      throw new CodeSyntaxError("expected 'else' after 'if' expression", spanOf(this.#peek()));
    }

    this.#next();
    const orelse = this.#test();
    this.#depth -= 1;
    return { type: 'ifexp', test, body, orelse, ...spanFrom(body, orelse) };
  }

  /**
   * and_test ('or' and_test)*
   *
   * @returns The expression.
   */
  #orTest(): Expr {
    let left = this.#andTest();

    while (this.#isName('or')) {
      this.#next();
      const right = this.#andTest();
      left = { type: 'bool', op: 'or', left, right, ...spanFrom(left, right) };
    }

    return left;
  }

  /**
   * not_test ('and' not_test)*
   *
   * @returns The expression.
   */
  #andTest(): Expr {
    let left = this.#notTest();

    while (this.#isName('and')) {
      this.#next();
      const right = this.#notTest();
      left = { type: 'bool', op: 'and', left, right, ...spanFrom(left, right) };
    }

    return left;
  }

  /**
   * 'not' not_test | comparison
   *
   * @returns The expression.
   */
  #notTest(): Expr {
    if (!this.#isName('not')) {
      return this.#comparison();
    }

    const token = this.#next();
    this.#enter(token);
    const operand = this.#notTest();
    this.#depth -= 1;
    return { type: 'unary', op: 'not', operand, ...spanFrom(token, operand) };
  }

  /**
   * arith (compare_op arith)* - chained comparisons stay one node.
   *
   * @returns The expression.
   */
  #comparison(): Expr {
    const left = this.#arith();
    const ops: CompareOperator[] = [];
    const comparators: Expr[] = [];

    for (;;) {
      const operator = this.#compareOperator();

      if (operator === null) {
        break;
      }

      ops.push(operator);
      comparators.push(this.#arith());
    }

    const last = comparators.at(-1);

    if (last === undefined) {
      return left;
    }

    return { type: 'compare', left, ops, comparators, ...spanFrom(left, last) };
  }

  /**
   * Consumes a comparison operator, when one is at the cursor.
   *
   * @returns The operator, or null.
   */
  #compareOperator(): CompareOperator | null {
    const token = this.#peek();

    if (token.kind === 'op') {
      const operator = COMPARE_OPERATORS[token.text];

      if (operator !== undefined) {
        this.#next();
      }

      return operator ?? null;
    }

    if (token.kind !== 'name') {
      return null;
    }

    if (token.text === 'in') {
      this.#next();
      return 'in';
    }

    if (token.text === 'not' && this.#peek(1).kind === 'name' && this.#peek(1).text === 'in') {
      this.#next();
      this.#next();
      return 'not in';
    }

    if (token.text === 'is') {
      this.#next();

      if (this.#isName('not')) {
        this.#next();
        return 'is not';
      }

      return 'is';
    }

    return null;
  }

  /**
   * term (('+' | '-') term)*
   *
   * @returns The expression.
   */
  #arith(): Expr {
    let left = this.#term();

    while (this.#isOp('+') || this.#isOp('-')) {
      const op = this.#next().text === '+' ? '+' : '-';
      const right = this.#term();
      left = { type: 'binary', op, left, right, ...spanFrom(left, right) };
    }

    return left;
  }

  /**
   * factor (('*' | '/' | '//' | '%') factor)*
   *
   * @returns The expression.
   */
  #term(): Expr {
    let left = this.#factor();

    for (;;) {
      const token = this.#peek();
      const op = token.kind === 'op' ? TERM_OPERATORS[token.text] : undefined;

      if (op === undefined) {
        return left;
      }

      this.#next();
      const right = this.#factor();
      left = { type: 'binary', op, left, right, ...spanFrom(left, right) };
    }
  }

  /**
   * ('+' | '-') factor | power
   *
   * @returns The expression.
   * @throws {CodeSyntaxError} On a bitwise operator or await.
   */
  #factor(): Expr {
    const token = this.#peek();

    if (this.#isOp('-') || this.#isOp('+')) {
      this.#next();
      this.#enter(token);
      const operand = this.#factor();
      this.#depth -= 1;
      return {
        type: 'unary',
        op: token.text === '-' ? '-' : '+',
        operand,
        ...spanFrom(token, operand),
      };
    }

    if (this.#isOp('~')) {
      throw new CodeSyntaxError('bitwise operators are not supported', spanOf(token));
    }

    this.#refuse(token);
    const base = this.#postfix();

    if (!this.#isOp('**')) {
      return base;
    }

    this.#next();
    const exponent = this.#factor();
    return { type: 'binary', op: '**', left: base, right: exponent, ...spanFrom(base, exponent) };
  }

  /**
   * atom trailer* - calls, subscripts, slices and attributes.
   *
   * @returns The expression.
   */
  #postfix(): Expr {
    let expression = this.#atom();

    for (;;) {
      if (this.#isOp('(')) {
        expression = this.#call(expression);
      } else if (this.#isOp('[')) {
        expression = this.#subscript(expression);
      } else if (this.#isOp('.')) {
        this.#next();
        const name = this.#expectName('an attribute name');
        expression = {
          type: 'attribute',
          object: expression,
          name: name.text,
          ...spanFrom(expression, name),
        };
      } else {
        return expression;
      }
    }
  }

  /**
   * Reads a call's arguments, the cursor on its opening bracket.
   *
   * @param func - What is called.
   * @returns The call.
   * @throws {CodeSyntaxError} On *args, **kwargs, or a misplaced keyword argument.
   */
  #call(func: Expr): Expr {
    this.#next();
    const args: Expr[] = [];
    const keywords: Keyword[] = [];

    while (!this.#isOp(')')) {
      const token = this.#peek();

      if (this.#isOp('*') || this.#isOp('**')) {
        throw new CodeSyntaxError('*args and **kwargs are not supported', spanOf(token));
      }

      if (token.kind === 'name' && this.#isOp('=', 1)) {
        this.#next();
        this.#next();

        if (keywords.some((keyword) => keyword.name === token.text)) {
          throw new CodeSyntaxError(`keyword argument repeated: ${token.text}`, spanOf(token));
        }

        const value = this.#test();
        keywords.push({ name: token.text, value, ...spanFrom(token, value) });
      } else {
        if (keywords.length > 0) {
          throw new CodeSyntaxError('positional argument follows keyword argument', spanOf(token));
        }

        const value = this.#test();
        args.push(this.#isName('for') ? this.#comprehension(value, value) : value);
      }

      if (!this.#isOp(',')) {
        break;
      }

      this.#next();
    }

    const close = this.#expectOp(')');
    return { type: 'call', func, args, keywords, ...spanFrom(func, close) };
  }

  /**
   * Reads an index or a slice, the cursor on its opening bracket.
   *
   * @param object - What is indexed.
   * @returns The subscript or slice.
   */
  #subscript(object: Expr): Expr {
    this.#next();
    let lower: Expr | null = null;

    if (!this.#isOp(':')) {
      lower = this.#test();

      if (!this.#isOp(':')) {
        const close = this.#expectOp(']');
        return { type: 'subscript', object, index: lower, ...spanFrom(object, close) };
      }
    }

    this.#expectOp(':');
    const upper = this.#isOp(':') || this.#isOp(']') ? null : this.#test();
    let step: Expr | null = null;

    if (this.#isOp(':')) {
      this.#next();

      if (!this.#isOp(']')) {
        step = this.#test();
      }
    }

    const close = this.#expectOp(']');
    return { type: 'slice', object, lower, upper, step, ...spanFrom(object, close) };
  }

  /**
   * Reads an atom: a literal, a name, an entity, a part, or a bracketed form.
   *
   * @returns The expression.
   * @throws {CodeSyntaxError} When no expression starts here.
   */
  #atom(): Expr {
    const token = this.#peek();

    switch (token.kind) {
      case 'number': {
        this.#next();
        return { type: 'num', value: token.value, isInt: token.isInt, ...spanOf(token) };
      }
      case 'string':
      case 'fstring': {
        return this.#strings();
      }
      case 'name': {
        return this.#name();
      }
      case 'op': {
        if (token.text === '(') {
          return this.#parenthesis();
        }

        if (token.text === '[') {
          return this.#list();
        }

        if (token.text === '{') {
          return this.#dict();
        }

        if (token.text === '*') {
          throw new CodeSyntaxError('* unpacking is not supported', spanOf(token));
        }

        throw this.#unexpected(token);
      }
      default: {
        throw this.#unexpected(token);
      }
    }
  }

  /**
   * Reads a name: a constant, an entity, a part, or a plain name.
   *
   * @returns The expression.
   * @throws {CodeSyntaxError} When the name is a keyword.
   */
  #name(): Expr {
    const token = this.#next();

    switch (token.text) {
      case 'True': {
        return { type: 'const', value: true, ...spanOf(token) };
      }
      case 'False': {
        return { type: 'const', value: false, ...spanOf(token) };
      }
      case 'None': {
        return { type: 'const', value: null, ...spanOf(token) };
      }
      default: {
        break;
      }
    }

    if (KEYWORDS.has(token.text)) {
      throw this.#unexpected(token);
    }

    const hasDotName = this.#isOp('.') && this.#peek(1).kind === 'name';

    if (DOMAINS.has(token.text) && hasDotName) {
      this.#next();
      const object = this.#next();
      let field: string | null = null;
      let end = object;

      // A third name is a field, unless it is called: then it is a method of the value.
      if (this.#isOp('.') && this.#peek(1).kind === 'name' && !this.#isOp('(', 2)) {
        this.#next();
        end = this.#next();
        field = end.text;
      }

      return {
        type: 'entity',
        entityId: `${token.text}.${object.text}`,
        field,
        ...spanFrom(token, end),
      };
    }

    if (token.text === 'part' && hasDotName) {
      this.#next();
      const key = this.#next();
      return { type: 'part', key: key.text, ...spanFrom(token, key) };
    }

    return { type: 'name', id: token.text, ...spanOf(token) };
  }

  /**
   * Reads adjacent string literals, joined as Python joins them.
   *
   * @returns A plain string, or an f-string when any piece is one.
   */
  #strings(): Expr {
    const first = this.#peek();
    let last = first;
    const parts: FStringPart[] = [];
    let isPlain = true;

    for (;;) {
      const token = this.#peek();

      if (token.kind === 'string') {
        parts.push(token.value);
      } else if (token.kind === 'fstring') {
        isPlain = false;

        for (const piece of token.pieces) {
          parts.push(
            piece.kind === 'text'
              ? piece.value
              : {
                  expression: parseExpression(piece.source, piece.line, piece.column),
                  conversion: piece.conversion,
                  spec: piece.spec,
                },
          );
        }
      } else {
        break;
      }

      last = this.#next();
    }

    const span = spanFrom(first, last);

    if (isPlain) {
      return {
        type: 'str',
        value: parts.filter((part) => typeof part === 'string').join(''),
        ...span,
      };
    }

    return { type: 'fstring', parts, ...span };
  }

  /**
   * Reads a bracketed expression, a tuple, or a generator expression (read as a list).
   *
   * @returns The expression.
   */
  #parenthesis(): Expr {
    const open = this.#next();

    if (this.#isOp(')')) {
      const close = this.#next();
      return { type: 'tuple', items: [], ...spanFrom(open, close) };
    }

    this.#enter(open);
    const first = this.#test();

    if (this.#isName('for')) {
      const comprehension = this.#comprehension(first, open);
      this.#expectOp(')');
      this.#depth -= 1;
      return comprehension;
    }

    if (!this.#isOp(',')) {
      this.#expectOp(')');
      this.#depth -= 1;
      return first;
    }

    const items = [first];

    while (this.#isOp(',')) {
      this.#next();

      if (this.#isOp(')')) {
        break;
      }

      items.push(this.#test());
    }

    const close = this.#expectOp(')');
    this.#depth -= 1;
    return { type: 'tuple', items, ...spanFrom(open, close) };
  }

  /**
   * Reads a list display or a list comprehension.
   *
   * @returns The expression.
   */
  #list(): Expr {
    const open = this.#next();
    const items: Expr[] = [];
    this.#enter(open);

    if (!this.#isOp(']')) {
      const first = this.#test();

      if (this.#isName('for')) {
        const comprehension = this.#comprehension(first, open);
        const close = this.#expectOp(']');
        this.#depth -= 1;
        return { ...comprehension, ...spanFrom(open, close) };
      }

      items.push(first);

      while (this.#isOp(',')) {
        this.#next();

        if (this.#isOp(']')) {
          break;
        }

        items.push(this.#test());
      }
    }

    const close = this.#expectOp(']');
    this.#depth -= 1;
    return { type: 'list', items, ...spanFrom(open, close) };
  }

  /**
   * Reads a dict display.
   *
   * @returns The expression.
   * @throws {CodeSyntaxError} On a set or a dict comprehension.
   */
  #dict(): Expr {
    const open = this.#next();
    const keys: Expr[] = [];
    const values: Expr[] = [];
    this.#enter(open);

    while (!this.#isOp('}')) {
      const key = this.#test();

      if (!this.#isOp(':')) {
        throw new CodeSyntaxError('sets are not supported: use a list', spanOf(key));
      }

      this.#next();
      const value = this.#test();

      if (this.#isName('for')) {
        throw new CodeSyntaxError('dict comprehensions are not supported', spanOf(this.#peek()));
      }

      keys.push(key);
      values.push(value);

      if (!this.#isOp(',')) {
        break;
      }

      this.#next();
    }

    const close = this.#expectOp('}');
    this.#depth -= 1;
    return { type: 'dict', keys, values, ...spanFrom(open, close) };
  }

  /**
   * Reads the `for … in … [if …]` of a comprehension, the cursor on `for`.
   *
   * @param element - The expression before `for`.
   * @param start - Where the comprehension starts.
   * @returns The comprehension.
   * @throws {CodeSyntaxError} When it has more than one for or if.
   */
  #comprehension(element: Expr, start: SourceSpan): Expr {
    this.#next();
    const target = this.#target(this.#targetList(), true);

    if (!this.#isName('in')) {
      throw new CodeSyntaxError("expected 'in'", spanOf(this.#peek()));
    }

    this.#next();
    const iter = this.#orTest();
    let condition: Expr | null = null;

    if (this.#isName('if')) {
      this.#next();
      condition = this.#orTest();
    }

    if (this.#isName('for') || this.#isName('if')) {
      throw new CodeSyntaxError(
        'a comprehension may have one for and one if',
        spanOf(this.#peek()),
      );
    }

    return {
      type: 'listcomp',
      element,
      target,
      iter,
      condition,
      ...spanFrom(start, condition ?? iter),
    };
  }
}

/**
 * Parses one expression that starts somewhere in a file, as an f-string's braces hold.
 *
 * @param source - The expression text.
 * @param line - The line it starts on.
 * @param column - The column it starts at.
 * @returns The expression.
 * @throws {CodeSyntaxError} When it is not one expression.
 */
export function parseExpression(source: string, line: number, column: number): Expr {
  return new Parser(tokenize(source, { line, column, expression: true })).expressionOnly();
}

/**
 * Parses a whole code file.
 *
 * @param source - The code.
 * @returns The module.
 * @throws {CodeSyntaxError} At the first syntax error or refused construct.
 */
export function parseModule(source: string): Module {
  return new Parser(tokenize(source)).module();
}

/** A problem the editor shows: where, what, and how bad. */
export type CodeProblem = SourceSpan & {
  readonly message: string;
  readonly severity: 'error' | 'warning';
};

/** What compiling gives: a program, or the syntax problem that stopped it. */
export type CompileResult =
  | { readonly ok: true; readonly program: CodeProgram }
  | { readonly ok: false; readonly problems: readonly CodeProblem[] };

/**
 * Compiles a code file into a program `runFunction` can run.
 *
 * Only the syntax is checked here; the checker finds the rest (unknown names, unknown entities,
 * functions no part uses).
 *
 * @param source - The code.
 * @returns The program, or the problem.
 * @throws {Error} Only on a fault of the parser itself; code errors come back as problems.
 */
export function compile(source: string): CompileResult {
  try {
    const module = parseModule(source);
    const functions = new Map<string, FunctionDef>();

    for (const statement of module.body) {
      if (statement.type === 'def') {
        functions.set(statement.name, statement);
      }
    }

    return { ok: true, program: { source, module, functions } };
  } catch (error) {
    if (error instanceof CodeSyntaxError) {
      return {
        ok: false,
        problems: [{ ...error.span, message: error.message, severity: 'error' }],
      };
    }

    throw error;
  }
}
