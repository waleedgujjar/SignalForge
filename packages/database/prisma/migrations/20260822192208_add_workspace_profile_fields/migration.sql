-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "defaultFromName" TEXT,
ADD COLUMN     "defaultReplyTo" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "WorkspaceMember" ALTER COLUMN "updatedAt" DROP DEFAULT;
