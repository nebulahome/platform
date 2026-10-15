/**
 * A package's catalogues: found beside its config, checked for what the interface can load, and
 * measured against the strings its code says.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  catalogueCoverage,
  catalogueProblems,
  findCatalogues,
  namedCatalogues,
} from './catalogues.js';

let root = '';

/**
 * Writes a catalogue.
 *
 * @param name - Its file name.
 * @param content - What it holds.
 */
async function catalogue(name: string, content: string): Promise<void> {
  await writeFile(path.join(root, 'locales', name), content);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nebula-catalogues-'));
  await mkdir(path.join(root, 'locales'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the catalogues', () => {
  it('are none without a locales folder', async () => {
    expect(await findCatalogues(path.join(root, 'nowhere'))).toEqual([]);
  });

  it('are found by language, and only a language reaches the interface', async () => {
    await catalogue('it.json', '{ "title": "Titolo" }');
    await catalogue('pt-BR.json', '{ "title": "Título" }');
    await catalogue('italian.json', '{}');
    await writeFile(path.join(root, 'locales', 'notes.txt'), 'not a catalogue');

    const found = await findCatalogues(root);

    expect(found.map((each) => each.language)).toEqual(['it', 'italian', 'pt-BR']);
    expect(namedCatalogues(found).map((each) => each.language)).toEqual(['it', 'pt-BR']);
  });

  it('hold together when they are objects of strings', async () => {
    await catalogue(
      'it.json',
      JSON.stringify({
        clients: { title: 'Client', count_one: '{{count}}', count_other: '{{count}}' },
      }),
    );

    expect(await catalogueProblems(await findCatalogues(root), root)).toEqual([]);
  });

  it('say what does not hold', async () => {
    await catalogue('italian.json', '{}');
    await catalogue('de.json', 'not json');
    await catalogue('fr.json', '["a"]');
    await catalogue('es.json', JSON.stringify({ 'a.b': 'x', n: 3, count_one: 'uno' }));
    await catalogue('nl.json', JSON.stringify({ big: 'x'.repeat(300 * 1024) }));

    expect(await catalogueProblems(await findCatalogues(root), root)).toEqual([
      'locales/de.json: is not JSON',
      'locales/es.json: a.b: a key has no dots of its own - nest it instead',
      'locales/es.json: n: is not a string or an object of strings',
      'locales/es.json: count: a plural needs its _other form',
      'locales/fr.json: is not an object of strings',
      'locales/italian.json: is not named by a language, as it.json or pt-BR.json',
      'locales/nl.json: a catalogue is at most 256 KB',
    ]);
  });

  it('are measured against the strings the code says', () => {
    expect(
      catalogueCoverage(new Set(['title', 'count', 'empty']), [
        'title',
        'count_one',
        'count_other',
        'old',
      ]),
    ).toEqual({ missing: ['empty'], unknown: ['old'] });
  });
});
