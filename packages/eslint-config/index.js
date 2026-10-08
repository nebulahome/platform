/**
 * Shared ESLint flat configuration for every Node package in the platform.
 *
 * This file is the executable half of RULES.md: each block below cites the rule it enforces.
 * A rule that RULES.md marks [CI] must appear here at `error`, never `warn` - a warning is a
 * rule nobody obeys.
 */
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import jsdoc from 'eslint-plugin-jsdoc';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/coverage/**', '**/.turbo/**', '**/node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  jsdoc.configs['flat/recommended-typescript-error'],

  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },

    plugins: {
      unicorn,
      'import-x': importX,
    },

    settings: {
      'import-x/resolver': { typescript: true, node: true },
    },

    rules: {
      // --- RULES.md 3.2: forbidden constructs ------------------------------------------
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message:
            'Use a const object plus a union type instead of an enum (RULES.md 3.2). Enums emit runtime code and their numeric form accepts any number.',
        },
        {
          selector: 'TSModuleDeclaration[kind="namespace"]',
          message: 'Use ES modules, not namespaces (RULES.md 3.2).',
        },
      ],
      'import-x/no-default-export': 'error',

      // --- RULES.md 4: every function is documented ------------------------------------
      'jsdoc/require-jsdoc': [
        'error',
        {
          require: {
            FunctionDeclaration: true,
            FunctionExpression: true,
            ArrowFunctionExpression: true,
            ClassDeclaration: true,
            ClassExpression: true,
            MethodDefinition: true,
          },
          contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSMethodSignature'],
          enableFixer: false,
        },
      ],
      'jsdoc/require-description': ['error', { checkConstructors: false }],
      'jsdoc/require-param': 'error',
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-returns': 'error',
      'jsdoc/require-returns-description': 'error',
      'jsdoc/require-throws': 'error',
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': 'error',
      'jsdoc/check-alignment': 'error',
      // One blank line between the description and the first tag: that is the house style
      // used across the design documents, and it keeps long blocks readable.
      'jsdoc/tag-lines': ['error', 'any', { startLines: 1 }],
      // Types live in TypeScript. A type repeated in a doc block is a lie waiting to happen.
      'jsdoc/no-types': 'error',
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-returns-type': 'off',

      // --- RULES.md 5: comments --------------------------------------------------------
      // NOTE: the exact `TODO(handle): text (#issue)` shape is not expressible as a stock
      // rule. This flags the untracked forms; the full format stays a review check until we
      // ship a small custom rule for it.
      'no-warning-comments': [
        'error',
        { terms: ['todo:', 'fixme:', 'xxx', 'hack:'], location: 'start' },
      ],

      // --- RULES.md 6: naming ----------------------------------------------------------
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'forbid' },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE'] },
        { selector: 'parameter', format: ['camelCase'] },
        { selector: 'function', format: ['camelCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'typeParameter', format: ['PascalCase'], prefix: ['T'] },
        { selector: 'objectLiteralProperty', format: null },
        { selector: 'typeProperty', format: null },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
      ],

      // --- RULES.md 7: imports ---------------------------------------------------------
      'import-x/no-cycle': ['error', { maxDepth: 8 }],
      'import-x/no-self-import': 'error',
      // `@/**` is listed explicitly, and that is not tidiness. Without it the rule classifies
      // the alias by whether the resolver can follow it, which depends on where eslint was
      // started from: per-package it resolves and lands in `internal`, from the repository root
      // it does not and lands elsewhere. The pre-commit hook runs from the root and the lint
      // gate runs per package, so the two disagreed - `eslint --fix` moved an import and
      // `eslint` then flagged the result, silently reverting the same file on every commit.
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          pathGroups: [
            { pattern: '@nebulahome/**', group: 'internal', position: 'before' },
            { pattern: '@/**', group: 'internal', position: 'after' },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../*'],
              message:
                'Do not climb more than one level (RULES.md 7.2). Use the @/ path alias instead.',
            },
          ],
        },
      ],

      // --- RULES.md 8: errors ----------------------------------------------------------
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],

      // --- RULES.md 9: async -----------------------------------------------------------
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      'no-await-in-loop': 'error',

      // --- RULES.md 10: logging --------------------------------------------------------
      'no-console': 'error',

      // --- RULES.md 11: configuration --------------------------------------------------
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Read configuration through @nebulahome/config, not process.env (RULES.md 11). The config package is the only place allowed to touch the environment.',
        },
      ],

      // --- RULES.md 16: security -------------------------------------------------------
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },

  // Plain JavaScript files - flat configs and tooling - belong to no tsconfig project,
  // so the type-aware rules cannot run against them.
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      'import-x/no-default-export': 'off',
      'jsdoc/require-jsdoc': 'off',
    },
  },

  // Each service reads the environment in exactly one file. The `@nebulahome/config` package
  // itself is exempted by its own flat config: ESLint runs with the package as its base path,
  // so a pattern naming `packages/config/` here would never match anything.
  {
    files: ['**/src/config.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },

  // Tool configuration files are expected to export a default.
  {
    files: ['**/*.config.{js,ts,mjs}', '**/vite.config.ts', 'eslint.config.js'],
    rules: {
      'import-x/no-default-export': 'off',
      'jsdoc/require-jsdoc': 'off',
      'no-restricted-properties': 'off',
    },
  },

  // Tests may reach for shapes production code may not.
  {
    files: ['**/*.test.{ts,tsx}', '**/tests/**/*.{ts,tsx}'],
    rules: {
      'jsdoc/require-jsdoc': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-await-in-loop': 'off',
    },
  },

  prettier,
);
