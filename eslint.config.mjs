import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
export default ts.config(
  { ignores: ['**/dist/**', '**/out/**', '**/.next/**', '**/next-env.d.ts', 'artifacts/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // The Cubase driver script runs inside Cubase's CommonJS script host, not
    // in this project's module system, and probes for its API with require().
    files: ['resources/cubase/**/*.js'],
    languageOptions: { sourceType: 'commonjs', ecmaVersion: 5 },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { caughtErrors: 'none', argsIgnorePattern: '^_' },
      ],
      'no-var': 'off',
    },
  },
);
