/** Payment values the browser needs too, kept free of zod. */
export const PAYMENT_KINDS = ["deposit", "balance", "full", "other", "refund"] as const;
export const PAYMENT_METHODS = ["bank_transfer", "cash", "card", "other"] as const;
