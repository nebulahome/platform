import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { precompressFolder } from './compression.js';

/** A script large enough to be worth compressing. */
const SCRIPT = `console.log(${JSON.stringify('x'.repeat(4096))});`;

describe('precompressFolder', () => {
  let folder = '';

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'nebula-assets-'));
    mkdirSync(path.join(folder, 'nested'));
    writeFileSync(path.join(folder, 'index-abc123.js'), SCRIPT);
    writeFileSync(path.join(folder, 'nested', 'style.css'), `.a{color:red}${' '.repeat(2048)}`);
    writeFileSync(path.join(folder, 'tiny.json'), '{}');
    writeFileSync(path.join(folder, 'photo.png'), SCRIPT);
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('writes a brotli and a gzip twin that read back as the file', async () => {
    await precompressFolder(folder);

    const file = path.join(folder, 'index-abc123.js');

    expect(brotliDecompressSync(readFileSync(`${file}.br`)).toString()).toBe(SCRIPT);
    expect(gunzipSync(readFileSync(`${file}.gz`)).toString()).toBe(SCRIPT);
    expect(existsSync(path.join(folder, 'nested', 'style.css.br'))).toBe(true);
  });

  it('leaves out images, and twins that would not be smaller', async () => {
    await precompressFolder(folder);

    expect(existsSync(path.join(folder, 'photo.png.br'))).toBe(false);
    expect(existsSync(path.join(folder, 'tiny.json.br'))).toBe(false);
    expect(existsSync(path.join(folder, 'tiny.json.gz'))).toBe(false);
  });
});
