/**
 * ESLint flat configuration for React packages: web-ui and the ui design system.
 *
 * Extends the Node configuration with the component, hook and accessibility rules from
 * RULES.md 15. Accessibility rules are errors, not warnings: a smart home UI gets used
 * one-handed, in the dark, by people who did not install it.
 */
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import noUntranslatedText from './rules/no-untranslated-text.js';

import base from './index.js';

export default tseslint.config(
  ...base,

  {
    files: ['**/*.{ts,tsx}'],

    languageOptions: {
      globals: { ...globals.browser },
    },

    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      nebula: { rules: { 'no-untranslated-text': noUntranslatedText } },
    },

    settings: {
      // Pinned rather than 'detect': eslint-plugin-react's detection path calls
      // context.getFilename(), which ESLint 10 removed, and crashes the whole run.
      react: { version: '19.0' },
    },

    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,

      // --- RULES.md 15.1: components ---------------------------------------------------
      'react/function-component-definition': [
        'error',
        { namedComponents: 'function-declaration', unnamedComponents: 'arrow-function' },
      ],
      'react/jsx-no-useless-fragment': 'error',
      'react/self-closing-comp': 'error',
      'react/no-array-index-key': 'error',
      // Props are typed in TypeScript; propTypes would be a second, weaker declaration.
      'react/prop-types': 'off',

      // --- RULES.md 15.2: hooks --------------------------------------------------------
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // --- RULES.md 15.3: styling ------------------------------------------------------
      'react/forbid-dom-props': [
        'error',
        {
          forbid: [
            {
              propName: 'style',
              message:
                'Use Tailwind classes and design tokens, not inline styles (RULES.md 15.3). Inline styles bypass theming and dark mode.',
            },
          ],
        },
      ],

      // --- RULES.md 1: every word a person reads goes through the catalogue -----------
      // Off here and turned on by each package for the files it holds to it: a package moves
      // to the catalogue a folder at a time.
      'nebula/no-untranslated-text': 'off',

      // Component names are PascalCase even though files are kebab-case (RULES.md 6).
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'forbid' },
        { selector: 'variable', format: ['camelCase', 'PascalCase', 'UPPER_CASE'] },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        { selector: 'parameter', format: ['camelCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'typeParameter', format: ['PascalCase'], prefix: ['T'] },
        { selector: 'objectLiteralProperty', format: null },
        { selector: 'typeProperty', format: null },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
      ],
    },
  },

  // Route modules are lazy-loaded by React Router, which requires a default export.
  {
    files: ['**/routes/**/*.tsx', '**/pages/**/*.tsx'],
    rules: { 'import-x/no-default-export': 'off' },
  },
);
