// Migrated from bad-playwright on 2026-06-17 by Migrator. See outputs/plans/silent-conditionals.spec.ts.md for plan and rationale.

/**
 * Authenticated fixture layer — extends base.fixture.
 * Auth session setup (createSession via @api/accounts.api) lives in base.fixture.ts so that
 * specs import from the single source @fixtures/base.fixture per qa-master discipline.
 * Extend this file to add auth-layer-specific fixtures or per-session state variants.
 */
export { test, expect } from "@fixtures/base.fixture";
