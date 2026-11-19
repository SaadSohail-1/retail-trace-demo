ALTER TABLE "IntegrationConfig"
ADD COLUMN "schemaMappings" JSONB NOT NULL DEFAULT '{}'::jsonb;
