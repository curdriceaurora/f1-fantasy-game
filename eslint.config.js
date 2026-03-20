import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'season/**',
      'data/**',
      'test/fixtures/**',
      'public/images/**',
      '**/* 2.*',
      'test/fixtures 2/**',
      'test/helpers 2/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        fetch: 'readonly',
        Buffer: 'readonly',
      },
      sourceType: 'module',
    },
    rules: {
      'no-console': 'off',
    },
  },
];
