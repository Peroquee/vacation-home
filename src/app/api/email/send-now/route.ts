import { outboxStatus } from "@/lib/email/outbox";
import { runOutbox } from "@/lib/email/worker";

/**
 * Runs the email outbox now rather than within the minute (GitLab #111):
 * after setting up SMTP, or to retry. Answers with the outbox's status.
 */
export async function POST() {
  await runOutbox();
  return Response.json(await outboxStatus());
}
