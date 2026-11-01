-- DropForeignKey
ALTER TABLE "report_generations" DROP CONSTRAINT IF EXISTS "report_generations_template_id_fkey";

-- AddForeignKey
ALTER TABLE "report_generations" ADD CONSTRAINT "report_generations_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "report_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
