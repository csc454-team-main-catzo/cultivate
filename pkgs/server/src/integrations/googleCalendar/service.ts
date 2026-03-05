/**
 * Google Calendar integration service: ensure valid access token, list calendars, create/update events.
 */

import type { Types } from "mongoose";
import GoogleCalendarIntegration from "../../models/GoogleCalendarIntegration.js";
import { encrypt, decrypt } from "./crypto.js";
import { fromZonedTime } from "date-fns-tz";
import {
  refreshAccessToken,
  listCalendars as apiListCalendars,
  insertEvent,
  updateEvent,
  listEvents,
  type CalendarEventInput,
  type CalendarListEntry,
  type CalendarEventItem,
} from "./googleApi.js";
import CFG from "../../config.js";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly";

function isExpiredSoon(expiryISO: string, bufferMinutes = 5): boolean {
  const expiry = new Date(expiryISO).getTime();
  return Date.now() >= expiry - bufferMinutes * 60 * 1000;
}

/**
 * Get a valid access token for the user's Google Calendar integration.
 * Refreshes and persists if expired. Sets needsReconnect if refresh token is missing or invalid.
 */
export async function getValidAccessToken(
  userId: Types.ObjectId
): Promise<{ accessToken: string; calendarId: string } | null> {
  const integration = await GoogleCalendarIntegration.findOne({ userId }).lean();
  if (!integration) return null;
  if (integration.needsReconnect) return null;

  let accessToken: string;
  let tokenExpiryISO = integration.tokenExpiryISO;

  if (isExpiredSoon(integration.tokenExpiryISO)) {
    const refreshEnc = integration.refreshTokenEncrypted;
    if (!refreshEnc) {
      await GoogleCalendarIntegration.updateOne(
        { userId },
        { $set: { needsReconnect: true } }
      );
      return null;
    }
    try {
      const refreshToken = decrypt(refreshEnc);
      const result = await refreshAccessToken({
        refreshToken,
        clientId: CFG.GOOGLE_CLIENT_ID,
        clientSecret: CFG.GOOGLE_CLIENT_SECRET,
      });
      accessToken = result.access_token;
      const expiry = new Date(Date.now() + result.expires_in * 1000);
      tokenExpiryISO = expiry.toISOString();
      const accessEnc = encrypt(accessToken);
      await GoogleCalendarIntegration.updateOne(
        { userId },
        { $set: { accessTokenEncrypted: accessEnc, tokenExpiryISO } }
      );
    } catch (e) {
      console.error("[googleCalendar] Token refresh failed for user", userId, (e as Error).message);
      await GoogleCalendarIntegration.updateOne(
        { userId },
        { $set: { needsReconnect: true } }
      );
      return null;
    }
  } else {
    accessToken = decrypt(integration.accessTokenEncrypted);
  }

  return { accessToken, calendarId: integration.calendarId };
}

/**
 * List calendars for the user (requires valid token).
 */
export async function listCalendarsForUser(
  userId: Types.ObjectId
): Promise<CalendarListEntry[]> {
  const tokenResult = await getValidAccessToken(userId);
  if (!tokenResult) return [];
  return apiListCalendars(tokenResult.accessToken);
}

/**
 * Create a calendar event. Returns event id or null.
 */
export async function createCalendarEvent(
  userId: Types.ObjectId,
  calendarId: string,
  accessToken: string,
  event: CalendarEventInput
): Promise<{ id: string } | null> {
  try {
    const created = await insertEvent(accessToken, calendarId, event);
    return { id: created.id };
  } catch (e) {
    console.error("[googleCalendar] createCalendarEvent failed", (e as Error).message);
    return null;
  }
}

/**
 * Update an existing calendar event.
 */
export async function updateCalendarEvent(
  userId: Types.ObjectId,
  calendarId: string,
  accessToken: string,
  eventId: string,
  event: Partial<CalendarEventInput>
): Promise<boolean> {
  try {
    await updateEvent(accessToken, calendarId, eventId, event);
    return true;
  } catch (e) {
    console.error("[googleCalendar] updateCalendarEvent failed", (e as Error).message);
    return false;
  }
}

const DEFAULT_WORK_START_HOUR = 8;
const DEFAULT_WORK_END_HOUR = 18;
const SLOT_STEP_MINUTES = 30;

function eventToRange(item: CalendarEventItem): { start: number; end: number } | null {
  const startStr = item.start?.dateTime ?? item.start?.date;
  const endStr = item.end?.dateTime ?? item.end?.date;
  if (!startStr || !endStr) return null;
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { start, end };
}

/**
 * Suggest delivery windows for a date based on the user's calendar free slots.
 * Returns slots in local time (HH:mm) in the given timezone, sorted by start.
 */
export async function suggestDeliveryWindows(params: {
  userId: Types.ObjectId;
  date: string; // YYYY-MM-DD
  durationMinutes?: number;
  timeZone?: string;
  workStartHour?: number;
  workEndHour?: number;
}): Promise<{ start: string; end: string }[]> {
  const tokenResult = await getValidAccessToken(params.userId);
  if (!tokenResult) return [];

  const timeZone = params.timeZone ?? CFG.DEFAULT_DELIVERY_TIMEZONE;
  const durationMinutes = params.durationMinutes ?? 120;
  const workStart = params.workStartHour ?? DEFAULT_WORK_START_HOUR;
  const workEnd = params.workEndHour ?? DEFAULT_WORK_END_HOUR;

  const [y, m, d] = params.date.split("-").map(Number);
  const timeMin = fromZonedTime(new Date(y, m - 1, d, workStart, 0, 0, 0), timeZone);
  const timeMax = fromZonedTime(new Date(y, m - 1, d, workEnd, 0, 0, 0), timeZone);

  let events: CalendarEventItem[];
  try {
    events = await listEvents(
      tokenResult.accessToken,
      tokenResult.calendarId,
      timeMin.toISOString(),
      timeMax.toISOString()
    );
  } catch (e) {
    console.error("[googleCalendar] suggestDeliveryWindows listEvents failed", (e as Error).message);
    return [];
  }

  const busy = events.map(eventToRange).filter((r): r is { start: number; end: number } => r != null);
  const durationMs = durationMinutes * 60 * 1000;
  const stepMs = SLOT_STEP_MINUTES * 60 * 1000;
  const slots: { start: string; end: string }[] = [];

  for (let t = timeMin.getTime(); t + durationMs <= timeMax.getTime(); t += stepMs) {
    const slotEnd = t + durationMs;
    const overlaps = busy.some((b) => t < b.end && slotEnd > b.start);
    if (overlaps) continue;

    const startDate = new Date(t);
    const endDate = new Date(slotEnd);
    const startLocal = startDate.toLocaleTimeString("en-CA", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    });
    const endLocal = endDate.toLocaleTimeString("en-CA", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    });
    slots.push({ start: startLocal, end: endLocal });
  }

  return slots;
}

export { encrypt, decrypt };
