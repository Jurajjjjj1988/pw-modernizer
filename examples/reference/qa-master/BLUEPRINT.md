# The blueprint — adapting it to your app

This tree is the **reference architecture** every PWmodernizer migration is built to
match: a layered Playwright suite (spec → page objects → fixtures → helpers) a senior
SDET would write. The conformance validator checks generated output against the
*structure* here (not the content), so the same shape lands for every migration.

It's a **template, not a finished suite** — it models a generic example shop. To adopt
it for your own app, fill in the marked points below. Nothing here is tied to a specific
company; swap the placeholders for your app's specifics.

## Fill-in points (where YOUR app goes)

| What | Where | How |
| --- | --- | --- |
| **Base URL** | `.env.example` → `URL_BASE` | Set `URL_BASE=https://your-app…` (the tests run against this). `IS_PRODUCTION=true` selects the production base. |
| **Routes** | `helper/test-data/urls.ts` → `URLS.paths` | Replace the example shop routes (`/sign_in`, `/account/orders`, …) with your app's real paths. The page objects read these keys. |
| **Pages** | `helper/page-object/pages/*.page.ts` | The example models shop pages (sign-in, cart, account). Replace them with your app's pages — keep the conventions (readonly locators with `.describe('[LABEL] …')`, no own constructor). |
| **Labels & constants** | `helper/test-data/*.ts` | `LABEL_*` prefixes, ids, cookies — swap for your app's. |
| **Auth / data setup** | `helper/api/*.api.ts` | The example creates a user via a signup API. Point this at your app's setup endpoints. |
| **Specs** | `tests/**/*.spec.ts` | The example journeys (sign-in, add-to-cart, sign-up) are illustrative — write your own against your pages. |

## The conventions to keep (the architecture)

These are what the conformance gate enforces — keep them when you adapt:

- A spec imports `test`/`expect` only from `@fixtures/base.fixture` (never `@playwright/test`); locators live in page objects, not specs.
- A `PageClass` / `BlockClass` has **no own constructor** (`BasePage` / `BaseBlock` wire `page`); locators are `readonly` fields with `.describe('[LABEL] …')`.
- Web-first assertions only — no hard waits, no `.nth()`, no CSS-class primary locators.
- Helpers split by role: `page-object/` · `fixtures/` · `api/` · `actions/` · `utilities/` (pure) · `test-data/` (constants) · `types/`.

Full structural spec: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
