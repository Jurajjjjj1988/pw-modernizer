// Migrated from cypress on 2026-06-17 by Migrator. See outputs/plans/checkout-flow.cy.js.md for plan.

export type CartItem = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: string;
};

export type CartApiResponse = {
  items: CartItem[];
};
