/**
 * What `nebula/no-untranslated-text` finds, and what it leaves alone.
 */
import { test } from 'node:test';

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';

import rule from './no-untranslated-text.js';

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

test('no-untranslated-text', () => {
  tester.run('no-untranslated-text', rule, {
    valid: [
      { code: 'const a = <p>{t("page.title", "Devices")}</p>;' },
      { code: 'const a = <p>{count} – {total}…</p>;' },
      { code: 'const a = <div className="flex gap-2" role="list" />;' },
      { code: 'const a = <Button variant="ghost" size="compact" />;' },
      { code: 'const a = <Field label={t("field.name", "Name")} />;' },
      { code: 'const a = <p>{isOn ? "●" : "○"}</p>;' },
      { code: 'const a = <Card title={name} />;' },
    ],
    invalid: [
      { code: 'const a = <p>Devices</p>;', errors: [{ messageId: 'untranslated' }] },
      { code: 'const a = <p>{"Devices"}</p>;', errors: [{ messageId: 'untranslated' }] },
      {
        code: 'const a = <p>{isCopied ? "Copied" : "Copy"}</p>;',
        errors: [{ messageId: 'untranslated' }, { messageId: 'untranslated' }],
      },
      { code: 'const a = <p>{isOn && "Busy"}</p>;', errors: [{ messageId: 'untranslated' }] },
      { code: 'const a = <Field label="Name" />;', errors: [{ messageId: 'untranslated' }] },
      { code: 'const a = <Icon aria-label="Close" />;', errors: [{ messageId: 'untranslated' }] },
      { code: 'const a = <Modal closeLabel="Close" />;', errors: [{ messageId: 'untranslated' }] },
      {
        code: 'const a = <Row note={`Up by one every ${n} s.`} />;',
        errors: [{ messageId: 'untranslated' }],
      },
      {
        code: 'const a = <Chip status="Online" />;',
        options: [{ attributes: ['status'] }],
        errors: [{ messageId: 'untranslated' }],
      },
    ],
  });
});
