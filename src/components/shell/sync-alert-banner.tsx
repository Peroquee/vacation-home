import { TriangleAlert } from "lucide-react";
import Link from "next/link";

import { formatDateTime } from "@/lib/format";
import { calendarConnectAvailable, getConnectionStatus } from "@/lib/google/connection";
import { syncSummary } from "@/lib/google/sync-summary";
import { getCurrentUser } from "@/lib/session";

/**
 * Shown on every page while syncing to Google Calendar has been failing for
 * over an hour: a stale Google calendar is worse than none, because the
 * owner would trust it. Nothing otherwise, and nothing at all without
 * Google Calendar. Server-rendered, so it needs no polling.
 */
export async function SyncAlertBanner() {
  if (!calendarConnectAvailable()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  const status = await getConnectionStatus(user.id);
  if (status.status !== "connected") return null;
  const sync = await syncSummary(user.id);
  if (!sync.alert) return null;

  return (
    <div
      role="status"
      className="border-destructive/40 bg-destructive/10 text-destructive mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm"
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0" />
      <p className="font-medium">
        Google Calendar sync has been failing
        {sync.failingSince ? ` since ${formatDateTime(sync.failingSince, "UTC")} (UTC)` : ""}.
        Google may be out of date.
      </p>
      <Link href="/settings#google-sync" className="underline">
        Review sync problems
      </Link>
    </div>
  );
}
