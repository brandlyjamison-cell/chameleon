/**
 * The only 404 the data plane may emit. INV-EDGE-04.
 *
 * Body is 65 bytes, status is 404, headers are exactly the allow-list below.
 * No cookie, no logo, no footer, no analytics. There is one constant so drift is
 * a diff and not a review argument.
 */
export const NOT_FOUND_BODY =
  "<!doctype html><title>Not Found</title>404 This link has expired.";

export const NOT_FOUND_STATUS = 404 as const;

export const NOT_FOUND_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "content-type": "text/html; charset=utf-8",
  "content-length": "65",
  "cache-control": "public, max-age=30",
  "x-robots-tag": "noindex",
});

/** Header names the response may carry, in addition to the platform's `server`/`date`. */
export const NOT_FOUND_ALLOWED_HEADERS: readonly string[] = Object.freeze([
  "content-type",
  "content-length",
  "cache-control",
  "x-robots-tag",
  "server",
  "date",
]);

/** Renders exactly the contract above. `Retry-After` is the one permitted addition (429). */
export function notFoundInit(retryAfterSeconds?: number): ResponseInit {
  const headers: Record<string, string> = { ...NOT_FOUND_HEADERS };
  if (retryAfterSeconds !== undefined) {
    headers["retry-after"] = String(retryAfterSeconds);
  }
  return { status: NOT_FOUND_STATUS, headers };
}

export function notFoundResponse(retryAfterSeconds?: number): Response {
  return new Response(NOT_FOUND_BODY, notFoundInit(retryAfterSeconds));
}
