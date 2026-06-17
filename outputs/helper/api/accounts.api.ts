// Migrated from bad-playwright on 2026-06-17 by Migrator. See outputs/plans/silent-conditionals.spec.ts.md for plan and rationale.

import { type APIRequestContext } from "@playwright/test";

// TODO: Q7 — confirm auth API endpoint path and request/response shape with the backend team;
//        placeholder assumes POST /api/auth/login with { email, password } JSON body.
const SESSION_ENDPOINT = "/api/auth/login";

/**
 * Authenticate the test user via the API and persist the session in the shared request context.
 * Uses BrowserContext's request so session cookies propagate automatically to browser navigations.
 * Called from fixtures only — never from a Page or spec.
 */
export async function createSession(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  const response = await request.post(SESSION_ENDPOINT, {
    data: { email, password },
  });
  if (!response.ok()) {
    throw new Error(
      `[accounts.api] createSession failed (${response.status()}) for user: ${email}`,
    );
  }
}
