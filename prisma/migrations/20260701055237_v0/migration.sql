-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('generated', 'pending_review', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'rejected', 'manual_required');

-- CreateEnum
CREATE TYPE "ContentFormat" AS ENUM ('text', 'image', 'carousel', 'infographic', 'poll');

-- CreateEnum
CREATE TYPE "PublishMode" AS ENUM ('draft', 'auto', 'silent');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('image', 'pdf', 'infographic');

-- CreateEnum
CREATE TYPE "ReviewActionType" AS ENUM ('approve', 'reject', 'edit');

-- CreateTable
CREATE TABLE "content_items" (
    "id" UUID NOT NULL,
    "pillar" TEXT NOT NULL,
    "format" "ContentFormat" NOT NULL,
    "status" "ContentStatus" NOT NULL,
    "mode" "PublishMode" NOT NULL,
    "title" TEXT,
    "hook" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "hashtags" TEXT[],
    "cta" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "scheduled_at" TIMESTAMPTZ,
    "published_at" TIMESTAMPTZ,
    "linkedin_urn" TEXT,
    "linkedin_url" TEXT,
    "source_topic_id" UUID,
    "generation_meta" JSONB,
    "dedupe_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "content_item_id" UUID NOT NULL,
    "type" "AssetType" NOT NULL,
    "path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" UUID NOT NULL,
    "pillar" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "raw" JSONB,
    "summary" TEXT,
    "used_at" TIMESTAMPTZ,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "pillar_rotation" JSONB NOT NULL,
    "format_rotation" JSONB NOT NULL,
    "mode" "PublishMode" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_logs" (
    "id" UUID NOT NULL,
    "content_item_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "request" JSONB,
    "response" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publish_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics" (
    "id" UUID NOT NULL,
    "content_item_id" UUID NOT NULL,
    "impressions" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "clicks" INTEGER,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_tokens" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "scope" TEXT NOT NULL,
    "member_urn" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_actions" (
    "id" UUID NOT NULL,
    "content_item_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "action" "ReviewActionType" NOT NULL,
    "actor" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" UUID NOT NULL,
    "format" "ContentFormat" NOT NULL,
    "version" INTEGER NOT NULL,
    "template" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_items_dedupe_key_key" ON "content_items"("dedupe_key");

-- CreateIndex
CREATE INDEX "content_items_status_idx" ON "content_items"("status");

-- CreateIndex
CREATE INDEX "content_items_scheduled_at_idx" ON "content_items"("scheduled_at");

-- CreateIndex
CREATE INDEX "content_items_pillar_created_at_idx" ON "content_items"("pillar", "created_at");

-- CreateIndex
CREATE INDEX "topics_pillar_fetched_at_idx" ON "topics"("pillar", "fetched_at");

-- CreateIndex
CREATE INDEX "topics_used_at_idx" ON "topics"("used_at");

-- CreateIndex
CREATE INDEX "analytics_content_item_id_fetched_at_idx" ON "analytics"("content_item_id", "fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_tokens_provider_key" ON "oauth_tokens"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_format_version_key" ON "prompt_templates"("format", "version");

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_source_topic_id_fkey" FOREIGN KEY ("source_topic_id") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_logs" ADD CONSTRAINT "publish_logs_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics" ADD CONSTRAINT "analytics_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
