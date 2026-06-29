# Migration plan — login.spec.ts

## Source framework

bad-playwright

## Locator translation table

| Original | New | Confidence | Notes |
|---|---|---|---|
| `page.locator('#email')` | `page.getByLabel(/email/i)` | high | label-associated input |
| `page.locator('.submit-btn')` | `page.getByRole('button', { name: /sign in/i })` | high | accessible button |
| `page.locator('.welcome')` | `page.getByRole('heading', { name: /welcome/i })` | high | landing heading |
