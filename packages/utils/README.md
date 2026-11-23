# Utilities package

## What it is responsible for

`@erp/utils` holds small helpers with no I/O and no business meaning. Its two helpers read text fields from a submitted `FormData` in the web app's server actions.

## Public surface

Import from `@erp/utils`, which is [src/index.ts](src/index.ts):

- `requireString(form, key)`: the field's value, or an error naming the missing field. An empty field or a file counts as missing.
- `optionalString(form, key)`: the trimmed value, or `undefined` for an absent, blank or file field.

It may import other packages only, never a module: [packages/config/eslint/boundaries.mjs](../config/eslint/boundaries.mjs). A helper that carries a business rule or a policy belongs elsewhere: [docs/decisions/007-persistence-switch-at-the-composition-root.md](../../docs/decisions/007-persistence-switch-at-the-composition-root.md) records that bar.

## State it owns

None.

## Rules it enforces

None of the business rules. The helpers only decide what counts as a missing form field.

## Where to start reading

- [src/form-data.ts](src/form-data.ts): both helpers.
- [apps/web/src/app/approvals/actions.ts](../../apps/web/src/app/approvals/actions.ts): a typical caller.

## Tests

[test/form-data.test.ts](test/form-data.test.ts) pins the edge cases: empty fields, whitespace, files, and a key submitted twice. `pnpm test` and `pnpm test:db` run it the same way, since it needs no database.
