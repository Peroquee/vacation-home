-- Accounts allowed to sign in, managed in the app (GitLab #122), on top of
-- AUTH_ALLOWED_EMAILS, which stays the fixed list the owner can never lose
-- (src/lib/allowed-emails.ts). Addresses in lower case.
CREATE TABLE "allowed_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allowed_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "allowed_accounts_email_lower" CHECK ("email" = lower(btrim("email")) AND "email" LIKE '%_@_%')
);

CREATE UNIQUE INDEX "allowed_accounts_email_key" ON "allowed_accounts"("email");
