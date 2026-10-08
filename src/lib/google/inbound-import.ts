/**
 * Inbound sync, part two: turning changed Google events into blocks
 * (GitLab #73, next). Until then the changes are only counted.
 *
 * NOTE for #73: the sync tokens stored before the import exists have
 * already moved past events nobody imported. #73's migration must clear
 * them (`UPDATE calendar_watches SET sync_token = NULL`) so the first poll
 * after it is a full list.
 */
import { logger } from "@/lib/logger";

import type { InboundBatch } from "./inbound";

export async function importInboundEvents(batch: InboundBatch): Promise<void> {
  logger.debug(
    { propertyId: batch.propertyId, changes: batch.events.length, full: batch.full },
    "google calendar changes received (not imported yet)",
  );
}
