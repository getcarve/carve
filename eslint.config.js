import eslint from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'data/**', 'node_modules/**', 'out/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'desktop/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts', 'vite.config.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.json' },
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['ui/src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { project: './tsconfig.ui.json' },
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['desktop/**/*.cjs'],
    languageOptions: { globals: globals.node, ecmaVersion: 2023, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node, ecmaVersion: 2023, sourceType: 'module' },
  },
  {
    files: ['public/app.js'],
    languageOptions: { globals: globals.browser, ecmaVersion: 2023, sourceType: 'module' },
  },
)
