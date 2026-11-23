# @erp/ui

## What it is responsible for

The shared component library that the server-rendered web interface in `apps/web` is built from. It holds the design tokens (colours, spacing, type sizes), the one style sheet the root layout emits, and the presentational components every page repeats: page frame, banners, forms and buttons, queues, record heads, the step strip and the Act now panel.

The components follow [004](../../docs/decisions/004-server-first-web-ui.md). Each one is a plain function with no hooks, state or client script, so a React Server Component can render it. Styling is inline style objects over the tokens. Where inline styles cannot reach (hover, print, a narrow screen, the fold glyphs) the rule lives in `THEME_STYLE` and the component carries a class name for it.

## Public surface

- Import from `@erp/ui` only. [`src/index.ts`](src/index.ts) lists what is exported. `FACE_CLASS` and `rendersNothing` are internal.
- `THEME_STYLE` and `THEMES`: the root layout puts the sheet in `<head>` and writes the chosen theme on `<html>` as `data-theme`. See [`apps/web/src/app/layout.tsx`](../../apps/web/src/app/layout.tsx).
- `COLOR` resolves each colour role to a CSS variable, so one style object serves the light and dark palettes. Pages use `COLOR`, never a hex value.
- `PRINT_CLASS.hide` marks page chrome that a printed report drops.
- The package depends only on React as a peer. It imports nothing from modules or from `@erp/types`, and it renders no business rule. A page decides what a gate says and whether it is clear. The component only draws it.

## State it owns

None.

## Rules it enforces

- Every action is a `Button`, or a `LinkButton` for a link that acts. The lint rule in [`packages/config/eslint/web-ui.mjs`](../config/eslint/web-ui.mjs) refuses a raw `<button>` in `apps/web`.
- Links are plain anchors, so every navigation is a full page load. [004](../../docs/decisions/004-server-first-web-ui.md)
- A record page opens with `ActNow`: the one act for this reader, or the desk it is waiting on. `StepStrip` shows where the record stands. [R12](../../docs/product/requirements.md), [UX direction](../../docs/product/ux-direction.md)
- A blocked act shows its conditions before the click, through `GateList`, with `ButtonReason` beside a disabled button. [R8](../../docs/product/requirements.md)
- Rarely needed fields and acts sit in a `Fold` or under `RareActs`, not on the face of the page. [R3](../../docs/product/requirements.md), [UX direction](../../docs/product/ux-direction.md)
- Every text colour in both palettes clears WCAG AA contrast on the page and on each soft fill. `src/tokens.test.ts` checks it.

## The components

- Frame: `PageShell` (the centred page, optionally printable), `Section`, `Box`, `DL`, `ResetList`, `TableScroll`, `EmptyState`.
- Words: `PageLede` under a page title, `SectionNote` under a section title, `DataLine` for a line of figures and `Explainer` for help a reader opens on purpose.
- Messages: `ErrorBanner` for a refused submission, `DangerBanner` for a failure that needs markup, `WarnBanner` and `InfoBanner` read in place. Each renders nothing when it has nothing to say.
- Forms: `Field`, `FieldLabel`, `FieldRow`, `Hint`, `Input`, `Select`, `CheckboxLabel`, `Button`, `LinkButton`.
- Queues: `QueueTable` with `QueueCell`, `QueueGroupRow`, `RowLink` and `AgeCell` for a list page. `QueueCard` and `QueueCardRow` for a desk's queue on Your work. `CountBadge` for a count in the top bar.
- Records: `RecordHead` (breadcrumb, title, status chip, lede), `StatusChip`, `StepStrip`, `ActNow`, `ActRow`, `GateList`, `ButtonReason`, `KV`, `LineSummary`, `FoldGroup`, `Fold`, `RareActs`.

## Where to start reading

- [`src/tokens.ts`](src/tokens.ts): the palettes, the scales and the sheet built from them.
- [`src/act-now.tsx`](src/act-now.tsx): the panel and gate list every record page opens with.
- [`src/record.tsx`](src/record.tsx): the record head, the step strip and the folds below them.
- [`src/form.tsx`](src/form.tsx): native form controls and the two button kinds.
- [`apps/web/src/app/quoting/quotes/[id]/review/act-now-panel.tsx`](../../apps/web/src/app/quoting/quotes/[id]/review/act-now-panel.tsx): a page putting them together.

## Tests

Each component file has a test beside it. The tests call a component as a function and inspect the element it returns, with no DOM and no browser. They pin the parts a page relies on: landmarks and labels, which colour role each tone uses, and when a component renders nothing. `tokens.test.ts` computes contrast ratios for both palettes and checks that the style sheet defines every variable.

Run them with `pnpm test` (every package, no database) or `pnpm test:db` (the same suite against a throwaway local Postgres).
