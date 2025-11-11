-- AlterTable
ALTER TABLE "tasks"
  ADD COLUMN "jobId" TEXT,
  ADD COLUMN "queueName" TEXT;

-- CreateIndex
CREATE INDEX "tasks_jobId_idx" ON "tasks"("jobId");
CREATE INDEX "tasks_queueName_idx" ON "tasks"("queueName");
