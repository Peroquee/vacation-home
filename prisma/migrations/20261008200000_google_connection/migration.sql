-- CreateEnum
CREATE TYPE "google_connection_status" AS ENUM ('connected', 'disconnected');

-- CreateTable
CREATE TABLE "google_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "google_account_id" TEXT NOT NULL,
    "google_email" TEXT,
    "scope" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "access_token_encrypted" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "status" "google_connection_status" NOT NULL DEFAULT 'connected',
    "disconnected_reason" TEXT,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_connections_user_id_key" ON "google_connections"("user_id");

-- AddForeignKey
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Sign-in no longer keeps Google tokens (calendar access is a separate,
-- encrypted connection): erase those stored in plain text so far.
UPDATE "accounts" SET "refresh_token" = NULL, "access_token" = NULL, "id_token" = NULL, "expires_at" = NULL;
