/**
 * instrumentation.ts
 *
 * Next.js server startup hook. Runs once in the Node.js runtime when the
 * server process boots — before any requests are handled.
 *
 * Renews the Google Calendar push-notification watch if it is within 24 hours
 * of expiring. The watch state (channel ID, resource ID, expiration) is
 * persisted in the Config sheet tab by renewCalendarWatchIfNeeded().
 *
 * Failures are logged but never crash the server — if setup hasn't been run
 * yet the function exits immediately and silently.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { renewCalendarWatchIfNeeded } = await import(
    "./lib/google/calendar"
  );

  await renewCalendarWatchIfNeeded().catch((err: Error) => {
    console.warn("[startup] Calendar watch renewal skipped:", err.message);
  });
}
