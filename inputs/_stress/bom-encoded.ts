import { test, expect } from '@playwright/test';

// UTF-8 BOM prefix (0xEF 0xBB 0xBF) at byte 0. Valid TS file otherwise.
// `file --mime-encoding -b` usually reports utf-8 (BOM is part of utf-8 family),
// so this MAY pass. If `file` reports `utf-8-bom` or similar, Stage 0 warns.
// Documents the "encoding warning case" — fixture exists to keep this surface
// covered if `file` behavior changes between distro versions.

test.describe('bom-prefixed spec', () => {
  test('renders the homepage', async ({ page }) => {
    await page.goto('https://shop.example.test/');
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  });
});
