import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'apps/api/src/generated/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  // Backend (NestJS / Node)
  {
    files: ['apps/api/**/*.{ts,js}'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  {
    // El motor puede registrar handlers de configuraciones heterogéneas.
    files: ['apps/api/src/modules/challenges/rules/rule-engine.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  // Frontend (React / navegador)
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // El refresco en caliente no aplica a las pruebas: pueden mezclar componentes auxiliares y utilidades.
    files: ['apps/web/src/test/**/*.{ts,tsx}', 'apps/web/**/*.test.{ts,tsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  eslintConfigPrettier,
);
