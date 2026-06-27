// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.gen.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    // Type-enforced HTML injection discipline: raw innerHTML assignment and
    // insertAdjacentHTML are banned in package source. The ONLY sanctioned sinks
    // are setHtml / insertSafeHtml from @jects/core, which require a branded
    // SafeHtml value (produced by safeHtml / staticHtml / trustedHtml). This makes
    // unsafe HTML injection impossible to write, not merely grep-discouraged.
    files: ['packages/**/src/**/*.{ts,tsx}'],
    ignores: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.stories.ts',
      '**/*.stories.tsx',
      // sanitize.ts defines setHtml/insertSafeHtml themselves — the only place
      // raw innerHTML / insertAdjacentHTML may be written.
      'packages/core/src/sanitize.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.property.name='innerHTML']",
          message:
            'Use setHtml(el, safeHtml|trustedHtml|staticHtml(...)) from @jects/core instead of raw innerHTML.',
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message:
            'Use insertSafeHtml(el, pos, safeHtml|trustedHtml|staticHtml(...)) from @jects/core instead of raw insertAdjacentHTML.',
        },
      ],
    },
  },
  {
    // The signals engine intentionally aliases `this` to the current reactive
    // node (the dependency-tracking primitive); this is by design.
    files: ['**/signals.ts'],
    rules: { '@typescript-eslint/no-this-alias': 'off' },
  },
  {
    // Enforce React hooks rules in the React wrapper. rules-of-hooks is the
    // correctness rule (no conditional hook calls); exhaustive-deps is enforced
    // too, with rule-aware inline disables where the wrapper intentionally runs
    // a mount-once effect / bridges props imperatively (documented at each site).
    files: ['packages/react/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
