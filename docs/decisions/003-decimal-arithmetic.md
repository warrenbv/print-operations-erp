# 003. Decimal arithmetic for money and rates

Status: Accepted. Decided by Warren Vogel, project owner.

## Context

An earlier decision stored decimals in PostgreSQL `numeric` columns with explicit scale, read back as strings so a value never silently becomes a floating-point number. When the paper grade master, the first feature to store cost inputs, was being built, nothing yet turned those strings into something arithmetic could be done on.

The forces:

- **Not every decimal is money.** Alongside monetary amounts there are rates and margins, quantities, unit prices, and dimensionless grade inputs such as waste percentage and basis weight.
- **Rounding is a business rule, not a formatting detail.** Sales tax rounds half-up per tax line. The margin floor blocks a quote outright, so a figure that rounds the wrong way could approve a quote the business meant to stop.
- **Sub-cent precision is real.** The business prices per roll from measured weights, so unit rates and freight carry more than two decimal places.
- **The system is long-lived.** A small, stable dependency beats a large one used for a fraction of its surface.

## Decision

Use `big.js` for all decimal arithmetic, and pass decimal values across module boundaries as strings, with money and its sibling scalar types defined and validated in `packages/types`.

- `number` is banned at the persistence boundary and in pricing arithmetic. It remains fine for counts, indexes and limits.
- Values are parsed into `Big` at the point of calculation and serialised back at an explicit scale. Conversion happens at the edges.
- Scale is explicit at every boundary and matches the column: four places for money, six for rates and margins.
- Arithmetic uses an isolated `Big` constructor, so no helper changes the library's global settings. The original record proposed one constructor per scale. The code settled on one isolated constructor and applies each scale when a value is serialised.
- Rounding is stated in code even where it matches the library default, so the requirement is visible.

## Alternatives considered

- **`decimal.js` and `bignumber.js`.** Supersets of the same library with features invoice arithmetic does not need. A larger API is more ways to misuse it.
- **`dinero.js`.** Purpose-built for money and good at it. Rejected on fit: waste percentage and basis weight are not amounts in a currency, so it would cover part of the domain and leave a second numeric system beside it. The business is single-currency, so its strongest feature earns little.
- **Native `BigInt` with hand-written scaling.** No dependency, but hand-written division and rounding in the module where errors are financial.
- **Keep using `number`.** Binary floating point cannot represent 0.1 or 0.01 exactly, and cent-level drift compounds across lines and fails reconciliation.

## Consequences

- One arithmetic type serves pricing, orders and, in the original system, invoicing and reporting. Those last two are not in this edition.
- Rounding behaviour is explicit and testable, and the path from database to calculation has no float in it.
- Every calculation constructs a `Big` instead of using operators. That is more verbose and easy to forget.
- The library has no currency formatting, so the interface and documents format money with their own small helpers.

## Where to see it

- [`packages/types/src/decimal.ts`](../../packages/types/src/decimal.ts): the scales and the parse and serialise helpers.
- [`modules/quoting/src/cost-build-up.ts`](../../modules/quoting/src/cost-build-up.ts) and [`modules/quoting/src/quote-calculation.ts`](../../modules/quoting/src/quote-calculation.ts): pricing arithmetic on those types.
