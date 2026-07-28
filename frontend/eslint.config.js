import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

// Config mínima y con poco ruido: lo que buscamos es atrapar errores reales
// (identificadores sin importar, hooks mal usados), no imponer estilo.
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // JSX cuenta como uso: sin esto, cada componente importado da "no usado".
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      // Un catch vacío es intencional en varios sitios.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // Error: rompe la app en runtime.
      //   no-undef            → un identificador sin importar (ya nos pasó)
      //   rules-of-hooks      → hooks llamados condicionalmente
      'react-hooks/rules-of-hooks': 'error',

      // Warning: reglas nuevas de react-hooks v6 sobre patrones que este
      // frontend usa de punta a punta (cargar datos en un efecto, refs
      // mutables). Son deuda real y quedan visibles en `npm run lint`, pero
      // arreglarlas es rediseñar el fetching de la app, no un cambio de estilo.
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
];
