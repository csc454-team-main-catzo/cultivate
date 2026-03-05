import { API_URL } from "../config.js";

export interface GoogleCalendarStatus {
  connected: boolean;
  needsReconnect?: boolean;
  calendarId?: string;
}

export interface GoogleCalendarListResponse {
  calendars: Array<{ id: string; summary: string; primary?: boolean }>;
}

export async function getGoogleCalendarStatus(
  accessToken: string
): Promise<GoogleCalendarStatus> {
  const res = await fetch(`${API_URL}/api/integrations/google/status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to get Google Calendar status");
  return res.json();
}

export async function getGoogleCalendars(
  accessToken: string
): Promise<GoogleCalendarListResponse> {
  const res = await fetch(`${API_URL}/api/integrations/google/calendars`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "Failed to list calendars");
  }
  return res.json();
}

export async function setGoogleCalendar(
  accessToken: string,
  calendarId: string
): Promise<void> {
  const res = await fetch(`${API_URL}/api/integrations/google/calendar`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ calendarId }),
  });
  if (!res.ok) throw new Error("Failed to set calendar");
}

export async function disconnectGoogleCalendar(
  accessToken: string
): Promise<void> {
  const res = await fetch(`${API_URL}/api/integrations/google/disconnect`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error("Failed to disconnect");
}

/**
 * Returns the URL to start Google OAuth. Frontend should fetch with Bearer token and redirect to the returned URL.
 */
export function getGoogleCalendarStartUrl(): string {
  return `${API_URL}/api/integrations/google/start`;
}

// ---- Suggest delivery window (Calendar) ----
export interface SuggestWindowParams {
  date: string; // YYYY-MM-DD
  durationMinutes?: number;
  timeZone?: string;
}

export interface SuggestWindowResponse {
  suggestedWindows: Array<{ start: string; end: string }>;
}

export async function suggestDeliveryWindows(
  accessToken: string,
  params: SuggestWindowParams
): Promise<SuggestWindowResponse> {
  const url = new URL(`${API_URL}/api/integrations/google/calendar/suggest-window`);
  url.searchParams.set("date", params.date);
  if (params.durationMinutes != null) url.searchParams.set("durationMinutes", String(params.durationMinutes));
  if (params.timeZone) url.searchParams.set("timeZone", params.timeZone);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "Failed to suggest windows");
  }
  return res.json();
}

// ---- Gmail ----
export interface SendGmailParams {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

export interface SendGmailResponse {
  messageId: string;
  threadId: string;
}

export async function sendGmail(
  accessToken: string,
  params: SendGmailParams
): Promise<SendGmailResponse> {
  const res = await fetch(`${API_URL}/api/integrations/google/gmail/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "Failed to send email");
  }
  return res.json();
}

export interface GmailMessagePayload {
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string };
  parts?: Array<{ mimeType?: string; body?: { data?: string }; headers?: Array<{ name: string; value: string }> }>;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: GmailMessagePayload;
}

export interface GmailThreadResponse {
  id: string;
  messages?: GmailMessage[];
  historyId?: string;
}

export async function getGmailThread(
  accessToken: string,
  threadId: string
): Promise<GmailThreadResponse> {
  const res = await fetch(
    `${API_URL}/api/integrations/google/gmail/thread/${encodeURIComponent(threadId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "Failed to load thread");
  }
  return res.json();
}
