import { describe, expect, it } from 'vitest';

import { checkCatalogue, extractUses, findForeignLetters } from './translations.js';

describe('reading what the source says', () => {
  it('reads a key with its English, a plural, a declared message and a <Trans>', () => {
    const { uses, problems } = extractUses(
      'page.tsx',
      [
        "const a = t('page.title', 'Devices');",
        "const b = t('page.count', { count, defaultValue_one: '{{count}} device', defaultValue_other: '{{count}} devices' });",
        "const c = defineMessage('rail.home', 'Home');",
        "const d = translate('lib.when', 'Now');",
        'const e = <Trans i18nKey="page.help" defaults="Read <0>the guide</0>" />;',
      ].join('\n'),
    );

    expect(problems).toEqual([]);
    expect(uses.map((use) => [use.key, use.isPlural])).toEqual([
      ['page.title', false],
      ['page.count', true],
      ['rail.home', false],
      ['lib.when', false],
      ['page.help', false],
    ]);
    expect(uses[1]?.english).toEqual({ one: '{{count}} device', other: '{{count}} devices' });
  });

  it('refuses a key that is not written out, and a string with no English', () => {
    const { problems } = extractUses('page.ts', "t(key, 'Devices'); t('page.title');");

    expect(problems.map((problem) => problem.message)).toEqual([
      'The key must be written out in full',
      '"page.title" has no English written beside it',
    ]);
  });
});

describe('holding a catalogue to the source', () => {
  const uses = [
    { key: 'page.title', english: { '': 'Devices of {{name}}' }, isPlural: false, where: 'a:1' },
    {
      key: 'page.count',
      english: { one: '{{count}} device', other: '{{count}} devices' },
      isPlural: true,
      where: 'a:2',
    },
  ];

  it('passes a complete catalogue', () => {
    const catalogue = {
      page: {
        title: 'Dispositivi di {{name}}',
        count_one: 'un dispositivo',
        count_many: '{{count}} di dispositivi',
        count_other: '{{count}} dispositivi',
      },
    };

    expect(checkCatalogue(uses, catalogue, 'it')).toEqual([]);
  });

  it('names a missing key, a missing plural form, a stale key and a stray placeholder', () => {
    const catalogue = {
      page: { title: 'Dispositivi di {{room}}', count_one: 'un dispositivo', count_other: 'x' },
      old: 'vecchio',
    };

    expect(checkCatalogue(uses, catalogue, 'it').map((problem) => problem.message)).toEqual([
      'it.json "page.title" fills {{room}}, which the English does not have',
      'it.json has no "page.count_many"',
      '"old" is not said anywhere',
    ]);
  });

  it('refuses a key said two ways in English', () => {
    const twice = [...uses, { ...uses[0], english: { '': 'Things' }, where: 'b:9' }];

    expect(
      checkCatalogue(twice as typeof uses, {}, 'it').some((problem) =>
        problem.message.includes('says something else in English'),
      ),
    ).toBe(true);
  });
});

describe('finding other languages in the code', () => {
  it('finds an accented letter and leaves typography alone', () => {
    expect(findForeignLetters('a.ts', "const a = 'Città';\nconst b = '– … ×';")).toEqual([
      { where: 'a.ts:1', message: 'Only English is written outside the catalogues' },
    ]);
  });
});
