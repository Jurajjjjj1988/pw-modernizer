// Valid TypeScript module with utility helpers only.
// Contains NO recognizable spec/suite/case markers.
// Stage 0 should reject this with the "no recognizable file" error
// even though the filename ends in .spec.ts — content must match.

export function formatCurrency(amount: number, currency: string): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  });
  return formatter.format(amount);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface Address {
  street: string;
  city: string;
  zip: string;
}

export function formatAddress(addr: Address): string {
  return `${addr.street}, ${addr.city} ${addr.zip}`;
}

export const APP_VERSION = '1.0.0';
