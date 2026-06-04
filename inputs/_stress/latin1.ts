import { test, expect } from '@playwright/test';

// French and German chars: café, naïve, Zürich, Köln, déjà vu.
// This source is UTF-8; the deliverable on disk is windows-1252 encoded
// via iconv. Stage 0 `file --mime-encoding -b` should NOT report utf-8.

test.describe('latin1-encoded spec', () => {
  test('café page renders', async ({ page }) => {
    await page.goto('https://shop.example.test/café');
    await expect(page.getByRole('heading', { name: 'naïve' })).toBeVisible();
  });
});
