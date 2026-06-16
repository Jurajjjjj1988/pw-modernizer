// Calibration fixture (bad case): the auth-token setup wrapper is exported but
// the spec never calls it, so the intended pre-seeded session never happens.
// Another orphaned-API-helper variant of the PR #126 finding.

import { type APIRequestContext, expect } from "@playwright/test";

const SESSION_API_PATH = "/api/session";
const TOKEN_API_PATH = "/api/token";

export async function login(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<void> {
  const response = await request.post(SESSION_API_PATH, {
    data: { username, password },
  });
  expect(response.status()).toBe(200);
}

export async function seedAuthToken(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const response = await request.post(TOKEN_API_PATH, { data: { token } });
  expect([200, 201].includes(response.status())).toBeTruthy();
}
