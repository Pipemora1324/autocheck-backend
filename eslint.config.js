import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/', 'eval-images/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { project: './tsconfig.test.json', tsconfigRootDir: import.meta.dirname }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }
      ],
      // Los números en plantillas de texto (años, puertos, códigos HTTP) son seguros y habituales aquí.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }]
    }
  },
  {
    // Las pruebas leen cuerpos HTTP sin tipar a propósito: un cuerpo inesperado hace fallar la aserción.
    files: ['test/**/*.ts'],
    rules: {
      // describe e it de node:test devuelven promesas que el propio runner espera.
      '@typescript-eslint/no-floating-promises': [
        'error',
        { allowForKnownSafeCalls: [{ from: 'package', name: ['describe', 'it'], package: 'node:test' }] }
      ],
      // Los repositorios simulados implementan interfaces asíncronas sin necesitar await.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off'
    }
  },
  { files: ['eslint.config.js'], ...tseslint.configs.disableTypeChecked },
  prettier
);
