-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_preferences_tenant_user_idx" ON "notification_preferences"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_unique" ON "notification_preferences"("tenant_id", "user_id", "channel");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable Row-Level Security
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_preferences_tenant_select"
    ON "notification_preferences"
    FOR SELECT
    USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "notification_preferences_tenant_insert"
    ON "notification_preferences"
    FOR INSERT
    WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "notification_preferences_tenant_update"
    ON "notification_preferences"
    FOR UPDATE
    USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text)
    WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::text);

CREATE POLICY "notification_preferences_tenant_delete"
    ON "notification_preferences"
    FOR DELETE
    USING ("tenant_id" = current_setting('app.current_tenant_id', true)::text);
