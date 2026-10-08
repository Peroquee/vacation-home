/** The header carrying a request's correlation id, in both directions. */
export const REQUEST_ID_HEADER = "x-request-id";

// An id from upstream (a load balancer) is kept only if it is a plain token,
// so a client cannot inject newlines or JSON into log lines through it.
const ACCEPTABLE_ID = /^[\w.:-]{8,128}$/;

/** The upstream id when it is safe to log, otherwise a fresh one. */
export function requestIdFrom(incoming: string | null): string {
  return incoming && ACCEPTABLE_ID.test(incoming) ? incoming : crypto.randomUUID();
}
