/**
 * lib/google/calendar.ts
 *
 * Google Calendar integration for appointment scheduling.
 *
 * Responsibilities:
 *   - Query free/busy windows for availability checks
 *   - Create, update, and cancel calendar events
 *   - Two-way sync: on event update in Google Calendar, the webhook
 *     handler calls updateAppointment() to keep the Sheets row in sync
 */

import { google, calendar_v3 } from "googleapis";
import { getServiceAccountAuth } from "./auth";
import { getConfig, setConfig } from "./sheets";
import type { AvailabilitySlot } from "@/types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getCalendarClient(): calendar_v3.Calendar {
  const auth = getServiceAccountAuth();
  return google.calendar({ version: "v3", auth });
}

const CALENDAR_ID = () =>
  process.env.GOOGLE_CALENDAR_ID ?? "primary";

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * Returns free/busy information for the given time range.
 * Slots are broken into `slotMinutes`-minute increments and flagged
 * available/busy based on existing events.
 */
export async function getAvailability(
  startIso: string,
  endIso: string,
  slotMinutes = 60
): Promise<AvailabilitySlot[]> {
  const calendar = getCalendarClient();

  const freeBusyRes = await calendar.freebusy.query({
    requestBody: {
      timeMin: startIso,
      timeMax: endIso,
      items: [{ id: CALENDAR_ID() }],
    },
  });

  const busyPeriods =
    freeBusyRes.data.calendars?.[CALENDAR_ID()]?.busy ?? [];

  // Build a slot grid
  const slots: AvailabilitySlot[] = [];
  let cursor = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();

  while (cursor < end) {
    const slotStart = new Date(cursor);
    const slotEnd = new Date(cursor + slotMinutes * 60_000);

    const isBusy = busyPeriods.some((b) => {
      const bStart = new Date(b.start!).getTime();
      const bEnd = new Date(b.end!).getTime();
      // Overlap: slot starts before busy ends AND slot ends after busy starts
      return slotStart.getTime() < bEnd && slotEnd.getTime() > bStart;
    });

    slots.push({
      start: slotStart.toISOString(),
      end: slotEnd.toISOString(),
      available: !isBusy,
    });

    cursor += slotMinutes * 60_000;
  }

  return slots;
}

// ---------------------------------------------------------------------------
// Event CRUD
// ---------------------------------------------------------------------------

/**
 * Creates a Google Calendar event and returns the event ID.
 * The event ID is stored back on the Appointment and Order rows.
 */
export async function createCalendarEvent(params: {
  title: string;
  description: string;
  startIso: string;
  endIso: string;
  timezone: string;
  location?: string;
  attendeeEmails?: string[];
  meetLink?: boolean; // request a Google Meet conference
}): Promise<{ eventId: string; meetLink: string }> {
  const calendar = getCalendarClient();

  const event: calendar_v3.Schema$Event = {
    summary: params.title,
    description: params.description,
    start: { dateTime: params.startIso, timeZone: params.timezone },
    end: { dateTime: params.endIso, timeZone: params.timezone },
    location: params.location,
    attendees: params.attendeeEmails?.map((email) => ({ email })),
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 24 * 60 },
        { method: "popup", minutes: 30 },
      ],
    },
    ...(params.meetLink && {
      conferenceData: {
        createRequest: {
          requestId: `francine-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    }),
  };

  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID(),
    conferenceDataVersion: params.meetLink ? 1 : 0,
    sendNotifications: true,
    requestBody: event,
  });

  const eventId = res.data.id!;
  const meetLink =
    res.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")
      ?.uri ?? "";

  return { eventId, meetLink };
}

/** Update an existing calendar event */
export async function updateCalendarEvent(
  eventId: string,
  updates: Partial<{
    title: string;
    description: string;
    startIso: string;
    endIso: string;
    timezone: string;
    location: string;
  }>
): Promise<void> {
  const calendar = getCalendarClient();

  const patch: calendar_v3.Schema$Event = {};
  if (updates.title) patch.summary = updates.title;
  if (updates.description) patch.description = updates.description;
  if (updates.startIso)
    patch.start = { dateTime: updates.startIso, timeZone: updates.timezone };
  if (updates.endIso)
    patch.end = { dateTime: updates.endIso, timeZone: updates.timezone };
  if (updates.location) patch.location = updates.location;

  await calendar.events.patch({
    calendarId: CALENDAR_ID(),
    eventId,
    sendNotifications: true,
    requestBody: patch,
  });
}

/** Cancel (delete) a calendar event */
export async function cancelCalendarEvent(eventId: string): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.events.delete({
    calendarId: CALENDAR_ID(),
    eventId,
    sendNotifications: true,
  });
}

/** Fetch a single event — used by the webhook sync handler */
export async function getCalendarEvent(
  eventId: string
): Promise<calendar_v3.Schema$Event | null> {
  const calendar = getCalendarClient();
  try {
    const res = await calendar.events.get({
      calendarId: CALENDAR_ID(),
      eventId,
    });
    return res.data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Watch channel (push notifications / webhooks)
// ---------------------------------------------------------------------------

/**
 * Registers a push-notification watch on the calendar.
 * Google will POST to `webhookUrl` whenever any event changes.
 * The watch expires after 7 days and must be renewed.
 */
export async function registerCalendarWatch(webhookUrl: string): Promise<{
  channelId: string;
  resourceId: string;
  expiration: string;
}> {
  const calendar = getCalendarClient();
  const channelId = `francine-watch-${Date.now()}`;

  const res = await calendar.events.watch({
    calendarId: CALENDAR_ID(),
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: webhookUrl,
      expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  return {
    channelId: res.data.id!,
    resourceId: res.data.resourceId!,
    expiration: res.data.expiration!,
  };
}

/** Stop an active watch channel (called before registering a replacement). */
export async function stopCalendarWatch(
  channelId: string,
  resourceId: string
): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.channels.stop({
    requestBody: { id: channelId, resourceId },
  });
}

/**
 * Checks the stored watch expiration and renews the watch if it will expire
 * within 24 hours. Safe to call on every server startup and from the webhook
 * handler — skips silently when not needed or when setup hasn't been run.
 *
 * Requires AUTH_URL to be an https:// URL (Google only accepts public HTTPS
 * endpoints for push notifications).
 */
export async function renewCalendarWatchIfNeeded(): Promise<void> {
  const authUrl = process.env.AUTH_URL ?? "";
  if (!authUrl.startsWith("https://")) return; // local dev or misconfigured — skip
  if (!process.env.GOOGLE_SHEET_ID) return;     // setup not run yet — skip

  const webhookUrl = `${authUrl}/api/webhooks/calendar`;
  const renewWindow = 24 * 60 * 60 * 1000; // renew when < 24 h remain

  const [expirationStr, channelId, resourceId] = await Promise.all([
    getConfig("CALENDAR_WATCH_EXPIRATION"),
    getConfig("CALENDAR_WATCH_CHANNEL_ID"),
    getConfig("CALENDAR_WATCH_RESOURCE_ID"),
  ]);

  if (expirationStr && channelId && resourceId) {
    const expiration = Number(expirationStr);
    if (expiration - Date.now() > renewWindow) return; // still valid

    // Attempt to stop the old channel (may already be expired — ignore errors)
    try {
      await stopCalendarWatch(channelId, resourceId);
    } catch {
      // expired or already stopped
    }
  }

  // Register a fresh watch and persist the new state
  const watch = await registerCalendarWatch(webhookUrl);
  await Promise.all([
    setConfig("CALENDAR_WATCH_CHANNEL_ID", watch.channelId),
    setConfig("CALENDAR_WATCH_RESOURCE_ID", watch.resourceId),
    setConfig("CALENDAR_WATCH_EXPIRATION", watch.expiration),
  ]);
}
