// ESLint (flat config): `npm run lint`.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'streamdeck/dist/**', 'src/renderer/vendor/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-await-in-loop': 'off',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'warn',
      'no-unreachable-loop': 'error',
      'no-use-before-define': ['error', { functions: false, classes: true, variables: false }],
      'no-control-regex': 'off', // stripping control characters on purpose
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['src/renderer/**/*.js', 'test/ui/page-*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  {
    // Test scripts that also run code inside the page (page.evaluate).
    files: ['test/ui/**/*.js'],
    languageOptions: { globals: { ...globals.browser, MM: 'readonly' } },
  },
  {
    files: ['streamdeck/**/ui/*.js', 'src/phone/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  {
    // The Stream Deck plugin runs on Node; its own `crypto` require is fine.
    files: ['streamdeck/**/bin/*.js'],
    rules: { 'no-redeclare': ['error', { builtinGlobals: false }] },
  },
];
