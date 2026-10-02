/**
 * Writes `dist/styles.css`: the design system's tokens and utilities - `@nebulahome/ui`'s
 * `theme.css`, which emits nothing on its own - over Tailwind's theme, for a package's stylesheet
 * to `@reference`. Tailwind is the author's (an optional peer dependency), so the import resolves
 * from the package's own `node_modules`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const theme = await readFile(require.resolve('@nebulahome/ui/theme.css'), 'utf8');

await writeFile(
  new URL('../dist/styles.css', import.meta.url),
  `/* @nebulahome/package-sdk/styles.css: @reference it; it draws nothing. */\n@import 'tailwindcss/theme.css' layer(theme);\n\n${theme}`,
);
