-- DropIndex
DROP INDEX IF EXISTS "ai_performance_statistics_camera_id_stat_date_idx";

-- CreateIndex
CREATE UNIQUE INDEX "ai_performance_statistics_camera_id_stat_date_key" ON "ai_performance_statistics"("camera_id", "stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_versions_model_id_version_key" ON "ai_model_versions"("model_id", "version");
