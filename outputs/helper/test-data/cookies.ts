// Migrated from bad-playwright on 2026-06-17 by Migrator. See outputs/plans/silent-conditionals.spec.ts.md for plan and rationale.

// TODO: Q4 — confirm cookie name and value that forces the welcome-banner A/B variant ON
//        with the FE/product team. Update domain to match the test environment hostname.
export const COOKIE_AB_WELCOME_BANNER = {
  name: "feature_welcome_banner",
  value: "enabled",
  domain: "localhost",
  path: "/",
} as const;
