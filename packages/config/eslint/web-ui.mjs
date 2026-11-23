// Rules for apps/web only. Every action uses the shared `Button` or `LinkButton` from
// packages/ui/src/form.tsx, so a raw button element is refused.
export default {
  files: ['apps/web/src/**/*.tsx', 'apps/web/src/**/*.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "JSXOpeningElement[name.name='button']",
        message:
          'Use Button (or LinkButton for a link that acts as an action) from @erp/ui, so every action looks the same.',
      },
    ],
  },
};
