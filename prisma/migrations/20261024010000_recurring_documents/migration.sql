-- Documents on recurring costs (GitLab #130): the contract, the yearly
-- statement or an invoice, kept like a transaction's receipts and in the
-- same table, so downloads, removal, dedup and the file sweep are shared.
ALTER TABLE "transaction_attachments" ALTER COLUMN "transaction_id" DROP NOT NULL;
ALTER TABLE "transaction_attachments" ADD COLUMN "recurring_expense_id" UUID;

CREATE INDEX "transaction_attachments_recurring_expense_id_idx" ON "transaction_attachments"("recurring_expense_id");

ALTER TABLE "transaction_attachments" ADD CONSTRAINT "transaction_attachments_recurring_expense_id_fkey" FOREIGN KEY ("recurring_expense_id") REFERENCES "recurring_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Each file belongs to exactly one: a transaction or a rule.
ALTER TABLE "transaction_attachments"
  ADD CONSTRAINT "transaction_attachments_one_owner" CHECK (
    num_nonnulls("transaction_id", "recurring_expense_id") = 1
  );
