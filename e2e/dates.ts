/**
 * Calendar dates for the specs (GitLab #147), read when a test asks, not
 * once when its file loads: a run that crosses midnight would otherwise mix
 * yesterday's dates with today's. In UTC, as the specs' properties are.
 */

/** Today's date, in UTC. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The date `offset` days from today, in UTC. */
export function day(offset: number): string {
  const date = new Date(`${today()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
