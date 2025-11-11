/*
  Warnings:

  - A unique constraint covering the columns `[board_action_item_id]` on the table `tasks` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "board_persona_turns" ALTER COLUMN "streamed_at" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "tasks_board_action_item_id_key" ON "tasks"("board_action_item_id");

-- RenameIndex
ALTER INDEX "action_approvals_tenant_status_idx" RENAME TO "action_approvals_tenant_id_status_idx";

-- RenameIndex
ALTER INDEX "board_action_items_assignee_idx" RENAME TO "board_action_items_assignee_id_idx";

-- RenameIndex
ALTER INDEX "board_action_items_tenant_meeting_idx" RENAME TO "board_action_items_tenant_id_meeting_id_idx";

-- RenameIndex
ALTER INDEX "board_persona_turns_meeting_sequence_idx" RENAME TO "board_persona_turns_meeting_id_sequence_idx";

-- RenameIndex
ALTER INDEX "board_persona_turns_tenant_meeting_idx" RENAME TO "board_persona_turns_tenant_id_meeting_id_idx";

-- RenameIndex
ALTER INDEX "notifications_tenant_user_idx" RENAME TO "notifications_tenant_id_user_id_idx";

-- RenameIndex
ALTER INDEX "notifications_user_read_idx" RENAME TO "notifications_user_id_read_at_idx";
