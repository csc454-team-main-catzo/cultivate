/**
 * Minimal Google OAuth2 + Calendar API using fetch.
 * Scopes: https://www.googleapis.com/auth/calendar.events
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const CALENDAR_EVENTS_URL = (calendarId: string) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

export interface CalendarEventItem {
  id: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

export interface CalendarEventsListResponse {
  items?: CalendarEventItem[];
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: string;
}

export interface CalendarListResponse {
  items: CalendarListEntry[];
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  reminders?: { useDefault?: boolean; overrides?: Array<{ method: string; minutes: number }> };
}

export interface CalendarEventResponse {
  id: string;
  htmlLink?: string;
}

/**
 * Build the Google OAuth authorization URL.
 */
/** Default OAuth scopes: Calendar (events + read) and Gmail (send + read for supplier thread context). */
export const DEFAULT_GOOGLE_SCOPES =
  "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly " +
  "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly";

export function buildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const scope = params.scope ?? DEFAULT_GOOGLE_SCOPES;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", params.state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent"); // force refresh_token on first consent
  return url.toString();
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeCodeForTokens(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

/**
 * Refresh access token using refresh token.
 */
export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ access_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { access_token: data.access_token, expires_in: data.expires_in };
}

/**
 * List user's calendars (needs calendar.readonly scope).
 */
export async function listCalendars(accessToken: string): Promise<CalendarListEntry[]> {
  const url = new URL(CALENDAR_LIST_URL);
  url.searchParams.set("minAccessRole", "writer");
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google calendar list failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as CalendarListResponse;
  return data.items ?? [];
}

/**
 * Insert an event. Returns the created event id.
 */
export async function insertEvent(
  accessToken: string,
  calendarId: string,
  event: CalendarEventInput
): Promise<CalendarEventResponse> {
  const res = await fetch(CALENDAR_EVENTS_URL(calendarId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google calendar insert event failed: ${res.status} ${text}`);
  }
  return (await res.json()) as CalendarEventResponse;
}

/**
 * Update an existing event.
 */
export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: Partial<CalendarEventInput>
): Promise<CalendarEventResponse> {
  const url = `${CALENDAR_EVENTS_URL(calendarId)}/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google calendar update event failed: ${res.status} ${text}`);
  }
  return (await res.json()) as CalendarEventResponse;
}

/**
 * List events in a time range (RFC3339 timeMin/timeMax).
 */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<CalendarEventItem[]> {
  const url = new URL(CALENDAR_EVENTS_URL(calendarId));
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google calendar list events failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as CalendarEventsListResponse;
  return data.items ?? [];
}
