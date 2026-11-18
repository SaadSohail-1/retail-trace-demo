ALTER TABLE "RetailTraceSync"
ADD COLUMN "retailTraceStatus" TEXT,
ADD COLUMN "submissionUncertain" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "submissionStartedAt" TIMESTAMP(3);
