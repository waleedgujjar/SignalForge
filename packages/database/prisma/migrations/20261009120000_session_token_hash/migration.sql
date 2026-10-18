-- Stage 15: Hash session tokens before storage
-- This migration renames Session.token to Session.tokenHash.
-- All existing sessions are invalidated (users must re-login).

-- Drop existing indexes on the old column
DROP INDEX IF EXISTS "Session_token_idx";
DROP INDEX IF EXISTS "Session_token_key";

-- Rename the column
ALTER TABLE "Session" RENAME COLUMN "token" TO "tokenHash";

-- Truncate all sessions (existing tokens are plaintext, not hashed)
TRUNCATE TABLE "Session";

-- Re-create the unique constraint and index on the new column name
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_tokenHash_idx" ON "Session"("tokenHash");
