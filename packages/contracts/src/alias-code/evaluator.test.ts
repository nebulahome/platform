import { describe, expect, it } from 'vitest';

import type { JsonObject } from '../json.js';
import { nextSunEvent, sunPhaseLabel, sunState, sunTimes } from '../sun.js';

import { runFunction, type RunOptions, type RunResult } from './evaluator.js';
import { HttpPolicy } from './http.js';
import { compile, type CodeProgram } from './parser.js';
import type { CodeHost, EntityScalar, HttpReply, HttpRequest } from './types.js';

type HostSetup = {
  readonly entities?: Readonly<Record<string, EntityScalar | null>>;
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly parts?: Readonly<Record<string, unknown>>;
  readonly now?: number;
  readonly timeZone?: string;
  readonly position?: { readonly latitude: number; readonly longitude: number } | null;
  readonly history?: number | null;
  readonly reply?: HttpReply;
};

type TestHost = CodeHost & { readonly requests: HttpRequest[] };

const NOON_UTC = Date.UTC(2026, 10, 9, 12);

/**
 * A host with fixed answers that records the requests it is sent.
 *
 * @param setup - The answers.
 * @returns The host.
 */
function testHost(setup: HostSetup = {}): TestHost {
  const requests: HttpRequest[] = [];
  const entities = new Map(Object.entries(setup.entities ?? {}));
  const fields = new Map(Object.entries(setup.fields ?? {}));
  const parts = new Map(Object.entries(setup.parts ?? {}));
  const now = setup.now ?? NOON_UTC;

  return {
    requests,
    entity: (entityId) => entities.get(entityId) ?? null,
    field: (entityId, field) => fields.get(`${entityId}.${field}`) ?? null,
    part: (key) => parts.get(key) ?? null,
    available: (entityId) => entities.has(entityId),
    lastChanged: () => now - 5 * 60_000,
    nameOf: (entityId) => `Name of ${entityId}`,
    unitOf: () => '°C',
    now: () => now,
    timeZone: setup.timeZone ?? 'Europe/Rome',
    position: () => setup.position ?? null,
    history: () => Promise.resolve(setup.history ?? null),
    http: (request) => {
      requests.push(request);
      return Promise.resolve(setup.reply ?? { status: 200, headers: {}, text: '{"ok": true}' });
    },
  };
}

/**
 * Compiles code, failing the test when it does not.
 *
 * @param source - The code.
 * @returns The program.
 * @throws {Error} When it does not compile.
 */
function compiled(source: string): CodeProgram {
  const result = compile(source);

  if (!result.ok) {
    throw new Error(result.problems.map((problem) => problem.message).join('; '));
  }

  return result.program;
}

/**
 * Compiles and runs one function.
 *
 * @param source - The code.
 * @param name - The function.
 * @param options - Run options besides the defaults.
 * @returns The result.
 */
function run(
  source: string,
  name = 'f',
  options: Partial<RunOptions> & { readonly mem?: JsonObject } = {},
): Promise<RunResult> {
  return runFunction(compiled(source), name, {
    host: testHost(),
    mem: {},
    trace: false,
    trial: false,
    ...options,
  });
}

/**
 * Evaluates one expression in a function and gives its Python repr.
 *
 * @param expression - The expression.
 * @param host - The host.
 * @returns The repr, or the error message.
 */
async function py(expression: string, host: CodeHost = testHost()): Promise<string> {
  const result = await run(`def f():\n    return f"{(${expression})!r}"\n`, 'f', { host });
  return result.kind === 'value'
    ? typeof result.value === 'string'
      ? result.value
      : JSON.stringify(result.value)
    : `${result.kind}: ${result.error?.message ?? ''}`;
}

/**
 * Runs a function body and gives the error message.
 *
 * @param body - The body, already indented.
 * @returns The message, or an empty string when there was none.
 */
async function errorOf(body: string): Promise<string> {
  const result = await run(`def f():\n${body}\n`);
  return result.error?.message ?? '';
}

const SAMPLE_ONE = `"""Living room thermostat: what the heating is doing."""

def action():
    if part.mode == "off":
        return "off"
    if binary_sensor.lr_window:
        return "idle"              # window open: no heating
    room = part.current_temperature
    if room is None:
        return None                # unknown until it reports again
    if room < part.target_temperature - 0.3:
        return "heating"
    return "idle"
`;

const SAMPLE_TWO = `"""Washing done: on once the washer has gone quiet."""

def on():
    power = sensor.washing_machine_plug_power
    recent = mem["recent"] or []
    recent = (recent + [power])[-10:]
    mem["recent"] = recent
    quiet = avg(recent) < 3
    return quiet and minutes_since(mem["started"]) > 30
`;

describe('the sample programs', () => {
  it('runs the thermostat action and traces each line', async () => {
    const host = testHost({
      entities: { 'binary_sensor.lr_window': false },
      parts: { mode: 'heat', current_temperature: 20.4, target_temperature: 21.5 },
    });
    const result = await run(SAMPLE_ONE, 'action', { host, trace: true });

    expect(result.kind).toBe('value');
    expect(result.value).toBe('heating');
    expect(result.reads).toEqual(['binary_sensor.lr_window']);
    expect(result.trace?.executedLines).toEqual([4, 6, 8, 9, 11, 12]);

    const chips = Object.fromEntries(
      (result.trace?.lines ?? []).map((line) => [line.line, line.chips]),
    );

    expect(chips).toEqual({
      4: ['False'],
      6: ['False'],
      8: ['20.4'],
      9: ['False'],
      11: ['20.4 < 21.2 → True'],
      12: ['→ "heating"'],
    });
    expect(result.trace?.lines.find((line) => line.line === 11)?.taken).toBe(true);
    expect(result.trace?.lines.find((line) => line.line === 4)?.taken).toBe(false);
  });

  it('stops the washer sensor at avg() with None, keeping mem as it was', async () => {
    const mem = { recent: [0.4, 0.3, 0.3] };
    const result = await run(SAMPLE_TWO, 'on', {
      host: testHost({ entities: { 'sensor.washing_machine_plug_power': null } }),
      mem,
      trace: true,
    });

    expect(result.kind).toBe('error');
    expect(result.error).toEqual({ message: 'avg() got None', line: 8, column: 13 });
    expect(result.trace?.errorLine).toBe(8);
    expect(result.mem).toEqual(mem);
  });

  it('keeps mem when the washer sensor runs to the end', async () => {
    const result = await run(SAMPLE_TWO, 'on', {
      host: testHost({ entities: { 'sensor.washing_machine_plug_power': 1.5 } }),
      mem: { recent: [0.4, 0.3, 0.3] },
    });

    expect(result.kind).toBe('error');
    expect(result.error?.message).toBe('unsupported comparison: None > int');

    const started = await run(SAMPLE_TWO, 'on', {
      host: testHost({ entities: { 'sensor.washing_machine_plug_power': 1.5 } }),
      mem: { recent: [0.4], started: { $time: new Date(NOON_UTC - 45 * 60_000).toISOString() } },
    });

    expect(started.kind).toBe('value');
    expect(started.value).toBe(true);
    expect(started.mem['recent']).toEqual([0.4, 1.5]);
  });
});

describe('Python semantics', () => {
  it.each([
    ['7 // 2', '3'],
    ['-7 // 2', '-4'],
    ['7 / 2', '3.5'],
    ['4 / 2', '2.0'],
    ['2 ** 3', '8'],
    ['2 ** -1', '0.5'],
    ['2.0 ** 3', '8.0'],
    ['-7 % 3', '2'],
    ['7 % -3', '-2'],
    ['5.5 % 2', '1.5'],
    ['7.5 // 2', '3.0'],
    ['1 // 0.1', '9.0'],
    ['1 + 2.0', '3.0'],
    ['0.1 + 0.2', '0.30000000000000004'],
    ['1e16', '1e+16'],
    ['0.00001', '1e-05'],
    ['True + 1', '2'],
    ['10 ** 20', '100000000000000000000'],
    ['1 < 2 < 3', 'True'],
    ['1 < 3 < 2', 'False'],
    ['1 == 1.0', 'True'],
    ['[1, [2]] == [1, [2]]', 'True'],
    ['{"a": 1} == {"a": 1}', 'True'],
    ['[1] == (1,)', 'False'],
    ['0 or "x"', "'x'"],
    ['"" and 1', "''"],
    ['None or [] or 0', '0'],
    ['1 and 2', '2'],
    ['not []', 'True'],
    ['not "a"', 'False'],
    ['bool({})', 'False'],
    ['bool(0.0)', 'False'],
    ['None is None', 'True'],
    ['1 is not None', 'True'],
    ['"b" in "abc"', 'True'],
    ['3 not in [1, 2]', 'True'],
    ['"k" in {"k": 1}', 'True'],
    ['[1, 2, 3, 4][1:3]', '[2, 3]'],
    ['[1, 2, 3, 4][-2:]', '[3, 4]'],
    ['[1, 2, 3, 4][::2]', '[1, 3]'],
    ['[1, 2, 3, 4][::-1]', '[4, 3, 2, 1]'],
    ['"hello"[1:-1]', "'ell'"],
    ['[1, 2, 3][-1]', '3'],
    ['"abc"[-1]', "'c'"],
    ['(1,)', '(1,)'],
    ['"a" * 3', "'aaa'"],
    ['[0] * 3', '[0, 0, 0]'],
    ['1 if [] else 2', '2'],
    ['-(3)', '-3'],
    ['[x * 2 for x in range(5) if x % 2 == 0]', '[0, 4, 8]'],
    ['[k for k in {"a": 1, "b": 2}]', "['a', 'b']"],
    ['sum(x for x in [1, 2, 3])', '6'],
    ['"it\'s"', '"it\'s"'],
    ['"a\\nb"', "'a\\nb'"],
  ])('%s is %s', async (expression, expected) => {
    expect(await py(expression)).toBe(expected);
  });

  it.each([
    ['f"{20.456:.1f}"', '20.5'],
    ['f"{7:d}"', '7'],
    ['f"{"ab":>8}"', '      ab'],
    ['f"{"ab":<5}|"', 'ab   |'],
    ['f"{"ab":^6}"', '  ab  '],
    ['f"{3.14159:8.3f}"', '   3.142'],
    ['f"{42:05d}"', '00042'],
    ['f"{1234567:,}"', '1,234,567'],
    ['f"{0.256:.1%}"', '25.6%'],
    ['f"{12345.678:.2e}"', '1.23e+04'],
    ['f"{255:x}"', 'ff'],
    ['f"{2.5:.0f}"', '2'],
    ['f"{0.125:.2f}"', '0.12'],
    ['f"{-3:+d}"', '-3'],
    ['f"{3:+d}"', '+3'],
    ['f"{None}"', 'None'],
    ['f"{[1, \'a\']}"', "[1, 'a']"],
    ['f"{{x}}"', '{x}'],
    ['f"{1.0}"', '1.0'],
  ])('%s gives %s', async (expression, expected) => {
    const result = await run(`def f():\n    return ${expression}\n`);
    expect(result.value).toBe(expected);
  });

  it('runs dict and list methods', async () => {
    const result = await run(`
def f():
    d = {"a": 1, "b": 2}
    d["c"] = 3
    total = 0
    for key, value in d.items():
        total += value
    xs = [3, 1, 2]
    xs.append(4)
    last = xs.pop()
    first = xs.pop(0)
    return [total, d.get("x", 9), d.get("a"), d.pop("a"), list_keys(d), xs.index(2), xs.count(1), last, first, len(d)]

def list_keys(d):
    return d.keys()
`);

    expect(result.value).toEqual([6, 9, 1, 1, ['b', 'c'], 1, 1, 4, 3, 2]);
  });

  it('runs str methods', async () => {
    const result = await run(`
def f():
    s = "  Hello World  "
    return [s.strip(), s.lower().strip(), "a,b,,c".split(","), "a b  c".split(), "a b c".split(None, 1), "-".join(["x", "y"]), "aaa".replace("a", "b", 2), "living room".title(), "abc".startswith("ab"), "abc".endswith(("x", "c")), "abc".find("c"), "xxhixx".strip("x"), "UP".upper()]
`);

    expect(result.value).toEqual([
      'Hello World',
      'hello world',
      ['a', 'b', '', 'c'],
      ['a', 'b', 'c'],
      ['a', 'b c'],
      'x-y',
      'bba',
      'Living Room',
      true,
      true,
      2,
      'hi',
      'UP',
    ]);
  });

  it('unpacks tuples and keeps ints and floats apart', async () => {
    const result = await run(`
def f():
    a, b = 1, 2
    a, b = b, a
    (c, d), e = (3, 4.0), "x"
    n = 10
    n //= 3
    m = 2
    m **= 3
    xs = [1]
    ys = xs
    xs += [2]
    return [a, b, c, d, e, n, m, ys, f"{d}", f"{n}"]
`);

    expect(result.value).toEqual([2, 1, 3, 4, 'x', 3, 8, [1, 2], '4.0', '3']);
  });

  it('calls defs with defaults and keywords, and module-level values', async () => {
    const result = await run(`
LIMIT = 20

def scaled(x, factor=2, offset=0):
    return x * factor + offset

def f():
    return [scaled(3), scaled(3, 3), scaled(3, offset=1), LIMIT]
`);

    expect(result.value).toEqual([6, 9, 7, 20]);
  });

  it.each([
    ['    return x', "name 'x' is not defined"],
    ['    return "a" + 1', 'unsupported operand: str + int'],
    ['    return [1][5]', 'list index out of range'],
    ['    return 1 / 0', 'division by zero'],
    ['    return 1 % 0', 'division by zero'],
    ['    return {"a": 1}["b"]', "key 'b' not found"],
    ['    return None < 1', 'unsupported comparison: None < int'],
    ['    return avg([1, None])', 'avg() got None'],
    ['    return avg([])', 'avg() got an empty list'],
    ['    return round("a")', 'round() needs a number, got str'],
    ['    return round(1, 2, 3)', 'round() takes at most 2 arguments (3 given)'],
    ['    return sqrt(-1)', 'math domain error'],
    ['    a, b = [1, 2, 3]', 'too many values to unpack (expected 2)'],
    ['    return int("3.5")', 'invalid literal for int(): "3.5"'],
    ['    return (1, 2)[0:1].append', "tuple has no attribute 'append'"],
    ['    return "x".lower', 'lower is a method: call it, like lower()'],
    ['    return 5()', 'int is not callable'],
    ['    return http', 'http is used to call http.get(...), http.post(...) and the others'],
  ])('%s fails with %s', async (body, message) => {
    expect(await errorOf(body)).toBe(message);
  });

  it('reads mem: a missing key is None', async () => {
    const result = await run(
      `def f():\n    mem["n"] = (mem["n"] or 0) + 1\n    return [mem["n"], mem["missing"], "n" in mem]\n`,
      'f',
      { mem: { n: 4 } },
    );

    expect(result.value).toEqual([5, null, true]);
    expect(result.mem).toEqual({ n: 5 });
  });

  it('keeps Times in mem as $time', async () => {
    const result = await run(
      `def f():\n    mem["at"] = now()\n    return minutes_since(mem["at"])\n`,
    );

    expect(result.value).toBe(0);
    expect(result.mem).toEqual({ at: { $time: new Date(NOON_UTC).toISOString() } });

    const again = await run(`def f():\n    return mem["at"].hour\n`, 'f', { mem: result.mem });
    expect(again.value).toBe(13);
  });

  it('refuses a mem over 16 KB', async () => {
    const result = await run(
      `def f():\n    mem["big"] = "x" * 4000\n    mem["more"] = ["y" * 4000] * 4\n    return 1\n`,
    );

    expect(result.kind).toBe('error');
    expect(result.error?.message).toBe('mem is over 16 KB');
    expect(result.mem).toEqual({});
  });

  it('records prints with their lines', async () => {
    const result = await run(
      `def f():\n    x = 2\n    print("x is", x, None)\n    return x\n`,
      'f',
      { trace: true },
    );

    expect(result.prints).toEqual([{ line: 3, text: 'x is 2 None' }]);
    expect(result.trace?.lines.find((line) => line.line === 3)?.chips).toEqual(['x is 2 None']);
  });
});

describe('refused constructs', () => {
  it.each([
    ['class A:\n    pass', 1, 'classes are not supported'],
    ['import os', 1, 'import is not supported: everything available is already there'],
    ['from math import pi', 1, 'import is not supported: everything available is already there'],
    [
      'def f():\n    try:\n        pass\n    except:\n        pass',
      2,
      'try/except is not supported',
    ],
    ['def f():\n    raise ValueError()', 2, 'raise is not supported'],
    ['f = lambda x: x', 1, 'lambda is not supported'],
    ['def f():\n    with x:\n        pass', 2, 'with is not supported'],
    ['def f():\n    global x', 2, 'global is not supported'],
    ['def f():\n    nonlocal x', 2, 'nonlocal is not supported'],
    ['def f():\n    yield 1', 2, 'yield is not supported'],
    ['async def f():\n    pass', 1, 'async and await are not supported'],
    ['def f():\n    return await x', 2, 'async and await are not supported'],
    ['def f():\n    del x', 2, 'del is not supported'],
    ['@decorate\ndef f():\n    pass', 1, 'decorators are not supported'],
    ['def f(*args):\n    pass', 1, '*args and **kwargs are not supported'],
    ['def f(**kwargs):\n    pass', 1, '*args and **kwargs are not supported'],
    ['def f():\n    return g(*xs)', 2, '*args and **kwargs are not supported'],
    ['def f():\n    if (n := 1):\n        pass', 2, 'the walrus operator := is not supported'],
    ['def f():\n    assert x', 2, 'assert is not supported'],
    ['def f():\n    def g():\n        pass', 2, 'functions can only be defined at the top level'],
    ['return 1', 1, "'return' outside a function"],
    ['def f():\n    break', 2, "'break' outside a loop"],
    ['def f():\n    return {1, 2}', 2, 'sets are not supported'],
  ])('%s is refused at line %i', (source, line, message) => {
    const result = compile(source);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.problems[0]?.line).toBe(line);
      expect(result.problems[0]?.message).toContain(message);
    }
  });

  it('points at the column of the refused token', () => {
    const result = compile('def f():\n    x = lambda: 1');

    expect(result.ok ? null : result.problems[0]).toMatchObject({ line: 2, column: 9 });
  });

  it('reports indentation errors', () => {
    expect(compile('def f():\nreturn 1').ok).toBe(false);
    expect(compile('x = 1\n    y = 2').ok ? '' : 'unexpected').toBe('unexpected');
    const result = compile('def f():\n        x = 1\n    return x');
    expect(result.ok ? '' : result.problems[0]?.message).toBe(
      'unindent does not match any outer indentation level',
    );
  });
});

describe('limits', () => {
  it('stops an infinite loop with a limit result', async () => {
    const result = await run('def f():\n    while True:\n        pass\n');

    expect(result.kind).toBe('limit');
    expect(result.error?.message).toBe('Stopped after 10 000 steps');
    expect(result.error?.line).toBeGreaterThanOrEqual(2);
  });

  it('stops deep recursion', async () => {
    const result = await run('def f(n=0):\n    return f(n + 1)\n');

    expect(result.kind).toBe('limit');
    expect(result.error?.message).toBe('Stopped after 32 nested calls');
  });

  it('refuses a huge list and a huge string', async () => {
    expect(await errorOf('    return [0] * 100000')).toBe('list is longer than 1 000 items');
    expect(await errorOf('    return range(5000)')).toBe('range() is longer than 1 000 items');
    expect(await errorOf('    return "ab" * 5000')).toBe('str is longer than 4 096 characters');
    expect(
      await errorOf(
        '    xs = []\n    for i in range(1000):\n        xs.append(i)\n    xs.append(1)',
      ),
    ).toBe('list is longer than 1 000 items');
  });

  it('stops a run that takes too long', async () => {
    const result = await run('def f():\n    n = 0\n    while True:\n        n += 1\n', 'f', {
      limits: { steps: 10_000_000, cpuMs: 5 },
    });

    expect(result.kind).toBe('limit');
    expect(result.error?.message).toBe('Took longer than 5 ms');
  });

  it('does not charge time spent waiting for the host', async () => {
    const host = testHost({ history: 2 });
    const slow: CodeHost = {
      ...host,
      history: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(2);
          }, 30);
        }),
    };
    const result = await run('def f():\n    return avg_over("sensor.power", 10)\n', 'f', {
      host: slow,
      limits: { cpuMs: 20 },
    });

    expect(result.kind).toBe('value');
    expect(result.value).toBe(2);
  });

  it('gives up on a host call past the deadline', async () => {
    const host: CodeHost = { ...testHost(), history: () => new Promise(() => undefined) };
    const result = await run('def f():\n    return avg_over("sensor.power", 10)\n', 'f', {
      host,
      limits: { deadlineMs: 20 },
    });

    expect(result.kind).toBe('limit');
    expect(result.error?.message).toBe('Took longer than 0.02 s');
  });
});

describe('time', () => {
  const evening = Date.UTC(2026, 10, 9, 21, 30);

  it('reads the local fields in the house zone', async () => {
    const host = testHost({ now: evening });

    expect(await py('now().hour', host)).toBe('22');
    expect(await py('now().weekday', host)).toBe('0');
    expect(await py('now().weekday()', host)).toBe('0');
    expect(await py('now().isoformat()', host)).toBe("'2026-11-09T22:30:00+01:00'");
    expect(await py('str(now())', host)).toBe("'2026-11-09 22:30:00+01:00'");
    expect(await py('now().timestamp', host)).toBe(String(evening / 1000) + '.0');
    expect(await py('is_weekend()', host)).toBe('False');
  });

  it('wraps time_between across midnight', async () => {
    expect(await py('time_between("22:00", "06:00")', testHost({ now: evening }))).toBe('True');
    expect(await py('time_between("22:00", "06:00")', testHost({ now: NOON_UTC }))).toBe('False');
    expect(await py('time_between("08:00", "18:00")', testHost({ now: NOON_UTC }))).toBe('True');
    expect(await py('time_between("08:00", "18:00")', testHost({ now: evening }))).toBe('False');
  });

  it('places today_at on the right side of a DST change', async () => {
    const springDay = testHost({ now: Date.UTC(2026, 2, 29, 8) });
    const dayBefore = testHost({ now: Date.UTC(2026, 2, 28, 8) });

    expect(await py('today_at("12:00").timestamp', springDay)).toBe(
      `${String(Date.UTC(2026, 2, 29, 10) / 1000)}.0`,
    );
    expect(await py('today_at("12:00").timestamp', dayBefore)).toBe(
      `${String(Date.UTC(2026, 2, 28, 11) / 1000)}.0`,
    );
    expect(await py('today_at("02:30").hour', springDay)).toBe('3');
  });

  it('counts minutes since a Time, and None through', async () => {
    const host = testHost({ now: evening });

    expect(await py('minutes_since(add_minutes(now(), -90))', host)).toBe('90.0');
    expect(await py('hours_since(add_minutes(now(), -90))', host)).toBe('1.5');
    expect(await py('minutes_since(None)', host)).toBe('None');
    expect(await py('now() > add_minutes(now(), -1)', host)).toBe('True');
    expect(await py('minutes_since(last_changed("sensor.x"))', host)).toBe('5.0');
  });
});

describe('sun', () => {
  const rome = { latitude: 41.9, longitude: 12.5 };
  const summer = Date.UTC(2026, 5, 21, 12);
  const host = testHost({ now: summer, position: rome });

  /**
   * The Unix seconds a sun function gives.
   *
   * @param call - The call.
   * @returns The seconds.
   */
  const seconds = async (call: string): Promise<number> =>
    Number(await py(`${call}.timestamp`, host));

  it('agrees with sun.ts on sunrise, sunset and noon', async () => {
    const times = sunTimes(new Date(summer), rome);

    expect(await seconds('sunrise()')).toBe((times.sunrise?.getTime() ?? 0) / 1000);
    expect(await seconds('sunset()')).toBe((times.sunset?.getTime() ?? 0) / 1000);
    expect(await seconds('solar_noon()')).toBe(times.solarNoon.getTime() / 1000);
  });

  it('agrees with sun.ts on dawn, dusk and the golden hour', async () => {
    const start = new Date(sunTimes(new Date(summer), rome).solarNoon.getTime() - 43_200_000);
    const dawn = nextSunEvent({ event: 'dawn' }, rome, start);
    const dusk = nextSunEvent({ event: 'dusk' }, rome, start);
    const golden = nextSunEvent({ event: 'golden_hour_start', period: 'evening' }, rome, start);
    const morning = nextSunEvent({ event: 'golden_hour_start', period: 'morning' }, rome, start);

    expect(await seconds('dawn()')).toBe((dawn?.getTime() ?? 0) / 1000);
    expect(await seconds('dusk()')).toBe((dusk?.getTime() ?? 0) / 1000);
    expect(await seconds('golden_hour_start()')).toBe((golden?.getTime() ?? 0) / 1000);
    expect(await seconds('golden_hour_start("morning")')).toBe((morning?.getTime() ?? 0) / 1000);
    expect(await seconds('dawn()')).toBeLessThan(await seconds('sunrise()'));
  });

  it('gives the phase, the next event and the position', async () => {
    const state = sunState(new Date(summer), rome);
    const next = nextSunEvent({ event: 'sunset' }, rome, new Date(summer));

    expect(await py('sun_phase()', host)).toBe(`'${sunPhaseLabel(state)}'`);
    expect(await py('is_daytime()', host)).toBe('True');
    expect(await py('is_sun_phase("night")', host)).toBe('False');
    expect(await py('is_sun_phase("above", 30)', host)).toBe(
      state.elevation > 30 ? 'True' : 'False',
    );
    expect(await py('is_sun_rising()', host)).toBe(state.isRising ? 'True' : 'False');
    expect(await py('is_midnight_sun()', host)).toBe('False');
    expect(await seconds('next_sun_event("sunset")')).toBe((next?.getTime() ?? 0) / 1000);
    expect(Number(await py('minutes_to("sunset")', host))).toBeCloseTo(
      ((next?.getTime() ?? 0) - summer) / 60_000,
      6,
    );
    expect(Number(await py('minutes_since_sun("sunrise")', host))).toBeGreaterThan(0);
    expect(Number(await py('sun_elevation_at(now())', host))).toBeCloseTo(state.elevation, 9);
    expect(Number(await py('sun_azimuth_at(now())', host))).toBeCloseTo(state.azimuth, 9);
  });

  it('gives None without a position, and refuses unknown events', async () => {
    expect(await py('sunrise()', testHost({ now: summer }))).toBe('None');
    expect(await py('sun_phase()', testHost({ now: summer }))).toBe('None');
    expect(await py('next_sun_event("teatime")', host)).toContain('needs a sun event');
  });
});

describe('entities, parts, history', () => {
  it('reads entity values, fields and parts', async () => {
    const host = testHost({
      entities: { 'sensor.power': 21, 'sensor.1st_floor': 'on' },
      fields: { 'climate.living_room.current_temperature': 20.5 },
      parts: { hs: { hue: 120, saturation: 50 } },
    });
    const result = await run(
      `def f():\n    return [sensor.power, sensor.missing, climate.living_room.current_temperature, part.hs["hue"], sensor.1st_floor.upper(), available("sensor.power"), name_of("sensor.power"), unit_of("sensor.power")]\n`,
      'f',
      { host },
    );

    expect(result.value).toEqual([21, null, 20.5, 120, 'ON', true, 'Name of sensor.power', '°C']);
    expect(result.reads).toEqual([
      'climate.living_room',
      'sensor.1st_floor',
      'sensor.missing',
      'sensor.power',
    ]);
  });

  it('reads history through the host', async () => {
    const result = await run('def f():\n    return avg_over("sensor.power", 10)\n', 'f', {
      host: testHost({ history: 12.5 }),
    });

    expect(result.value).toBe(12.5);
    expect(await errorOf('    return avg_over("sensor.power", 5000)')).toBe(
      'avg_over() minutes must be between 1 and 1440',
    );
  });
});

describe('http', () => {
  it('sends a GET with params and reads the JSON', async () => {
    const host = testHost({ reply: { status: 200, headers: { 'X-A': '1' }, text: '{"t": 21.5}' } });
    const result = await run(
      'def f():\n    r = http.get("https://api.test/now", params={"city": "Rome"})\n    return [r.status, r.ok, r.json()["t"], r.headers["x-a"]]\n',
      'f',
      { host },
    );

    expect(result.value).toEqual([200, true, 21.5, '1']);
    expect(host.requests[0]).toMatchObject({
      method: 'GET',
      url: 'https://api.test/now?city=Rome',
      timeoutMs: 5000,
    });
    expect(result.http).toEqual([
      {
        method: 'GET',
        url: 'https://api.test/now?city=Rome',
        sent: true,
        cached: false,
        status: 200,
      },
    ]);
  });

  it('answers a repeated GET from the policy cache', async () => {
    const host = testHost();
    const policy = new HttpPolicy(() => 0);
    const source = 'def f():\n    return http.get("https://api.test/a").status\n';

    await run(source, 'f', { host, httpPolicy: policy });
    const second = await run(source, 'f', { host, httpPolicy: policy });

    expect(host.requests).toHaveLength(1);
    expect(second.http[0]?.cached).toBe(true);
  });

  it('does not send a write in a trial', async () => {
    const host = testHost();
    const result = await run(
      'def f():\n    r = http.post("https://api.test/w", json={"on": True})\n    return r.status\n',
      'f',
      { host, trial: true, trace: true, pretendResponse: { status: 202 } },
    );

    expect(host.requests).toHaveLength(0);
    expect(result.value).toBe(202);
    expect(result.trace?.lines[0]?.chips).toContain('Would send POST https://api.test/w');
    expect(result.http[0]).toMatchObject({ method: 'POST', sent: false });
  });

  it('sends a write with a JSON body, and refuses a second one too soon', async () => {
    const host = testHost();
    const policy = new HttpPolicy(() => 1000);
    const source =
      'def f():\n    return http.post("https://api.test/w", json={"on": True}).status\n';
    const first = await run(source, 'f', { host, httpPolicy: policy });
    const second = await run(source, 'f', { host, httpPolicy: policy });

    expect(first.value).toBe(200);
    expect(host.requests[0]).toMatchObject({
      body: '{"on":true}',
      headers: { 'content-type': 'application/json' },
    });
    expect(second.error?.message).toContain('Too frequent');
  });

  it('enforces the request rules', async () => {
    expect(await errorOf('    http.get("ftp://x")')).toContain(
      'url must start with http:// or https://',
    );
    expect(await errorOf('    http.get("https://x.test", timeout=30)')).toContain(
      'at most 10 seconds',
    );
    expect(
      await errorOf('    for i in range(6):\n        http.get("https://x.test/" + str(i))'),
    ).toBe('at most 5 http requests per run');
    expect(await errorOf('    http.fetch("https://x.test")')).toContain(
      'http has no method fetch()',
    );
  });

  it('reads a failed request as status 0', async () => {
    const host: CodeHost = { ...testHost(), http: () => Promise.reject(new Error('refused')) };
    const result = await run(
      'def f():\n    r = http.get("https://x.test")\n    return [r.status, r.ok, r.text]\n',
      'f',
      {
        host,
      },
    );

    expect(result.value).toEqual([0, false, 'refused']);
  });

  it('refuses a response over 256 KB', async () => {
    const host = testHost({ reply: { status: 200, headers: {}, text: 'x'.repeat(300 * 1024) } });
    const result = await run('def f():\n    return http.get("https://x.test").status\n', 'f', {
      host,
    });

    expect(result.error?.message).toBe('the response is over 256 KB');
  });
});
