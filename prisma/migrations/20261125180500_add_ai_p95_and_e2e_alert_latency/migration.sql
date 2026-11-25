-- AlterTable
ALTER TABLE "ai_performance_statistics"
ADD COLUMN "p95_latency_ms" DECIMAL(10,2),
ADD COLUMN "e2e_alert_latency_ms" DECIMAL(10,2);
