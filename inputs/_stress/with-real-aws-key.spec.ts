import { test, expect } from '@playwright/test';

// Contains AKIAIOSFODNN7EXAMPLE — the well-known AWS *documentation sample*
// access key ID. NOT a real credential; it appears in official AWS docs as
// a placeholder. Stage 0 secret-scan regex `AKIA[0-9A-Z]{16}` will match it
// and emit a `::warning::` (NOT an error). Verify that the scan flags it
// at the correct line/file in the step summary.

test.describe('S3 upload flow', () => {
  test('uploads object using configured credentials', async ({ page }) => {
    // BAD pattern intentionally — the plan should recommend moving this
    // to a secrets store and reading via process.env.
    const accessKeyId = 'AKIAIOSFODNN7EXAMPLE';
    await page.goto(`https://shop.example.test/admin/uploads?key=${accessKeyId}`);
    await expect(page.getByRole('heading', { name: 'Upload object' })).toBeVisible();
  });
});
