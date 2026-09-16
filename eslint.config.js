import tseslint from 'typescript-eslint';
import eslintPluginPrettier from 'eslint-config-prettier';

export default tseslint.config(
  // 1. Identify which files to lint
  {
    files: ['src/**/*.ts'],
  },
  // 2. Load recommended TypeScript rules
  ...tseslint.configs.recommended,
  // 3. Add custom rules or overrides
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // 4. Turn off formatting rules that conflict with Prettier (Must be last)
  eslintPluginPrettier,
);
