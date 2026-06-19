// Calibration fixture (good case): every exported auth helper is consumed —
// login in the test body, revokeSession in the teardown hook.

import { type APIRequestContext, expect } from "@playwright/test";

const SESSION_API_PATH = "/api/session";

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

export async function revokeSession(request: APIRequestContext): Promise<void> {
  const response = await request.delete(SESSION_API_PATH);
  expect([200, 204].includes(response.status())).toBeTruthy();
}
