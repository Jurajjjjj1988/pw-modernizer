// Migrated from selenium-java on 2026-06-16 by Migrator.
// See outputs/plans/EmployeesTest.java.md for plan and rationale.

/** Relative URL for the HR employees management page (KB-1.1.14: absolute URL removed). */
export const EMPLOYEES_PATH = "/employees";

/**
 * Base local-part for the invite-employee test email address.
 * Append workerIndex at runtime to avoid parallel-worker email collisions when
 * the backend enforces uniqueness (Risk callout #4 — KB-1.2.49 pattern):
 *   `${INVITE_EMAIL_LOCAL}+${test.info().workerIndex}@${INVITE_EMAIL_DOMAIN}`
 */
export const INVITE_EMAIL_LOCAL = "new.hire";

/** Domain for invite-employee test emails. */
export const INVITE_EMAIL_DOMAIN = "beacon.test";
