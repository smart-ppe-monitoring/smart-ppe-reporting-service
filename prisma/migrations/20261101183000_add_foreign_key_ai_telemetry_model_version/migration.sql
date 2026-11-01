-- AddForeignKey
ALTER TABLE "ai_performance_statistics" ADD CONSTRAINT "ai_performance_statistics_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "ai_model_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
