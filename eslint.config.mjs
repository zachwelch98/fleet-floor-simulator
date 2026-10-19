// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.angular/**',
      '**/coverage/**',
      '.claude/**',
      'e2e/.tmp/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // The engine must stay pure: no IO, no clock, no framework. Enforced here so a
    // boundary violation fails `npm run verify` deterministically.
    files: ['packages/engine/src/**/*.ts'],
    ignores: ['packages/engine/src/cli/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'child_process', 'os'],
              message: 'Engine must be pure (no IO).',
            },
            {
              group: ['@nestjs/*', '@angular/*', 'better-sqlite3', 'socket.io*'],
              message: 'Engine must not depend on frameworks.',
            },
            {
              group: ['@fleet/protocol', '**/apps/**'],
              message: 'Engine must not depend on outer layers.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Engine must be deterministic (no clock).' },
        { name: 'setTimeout', message: 'Engine must be deterministic.' },
        { name: 'setInterval', message: 'Engine must be deterministic.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Engine must be deterministic.' },
      ],
    },
  },
);
