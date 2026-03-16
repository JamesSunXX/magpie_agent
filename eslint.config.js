import js from '@eslint/js'
import tseslint from 'typescript-eslint'

const lintedTsFiles = [
  'src/capabilities/**/*.ts',
  'src/cli/**/*.ts',
  'src/commands/**/*.ts',
  'src/core/**/*.ts',
  'src/platform/**/*.ts',
  'tests/capabilities/**/*.ts',
  'tests/cli/**/*.ts',
  'tests/commands/**/*.ts',
  'tests/platform/**/*.ts',
]

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**'],
  },
  {
    ...js.configs.recommended,
    files: lintedTsFiles,
  },
  ...tseslint.configs.recommended.map(config => ({
    ...config,
    files: lintedTsFiles,
  })),
  {
    files: lintedTsFiles,
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  }
)
