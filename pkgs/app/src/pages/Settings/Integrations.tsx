import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import {
  getGoogleCalendarStatus,
  getGoogleCalendars,
  setGoogleCalendar,
  disconnectGoogleCalendar,
  getGoogleCalendarStartUrl,
  suggestDeliveryWindows,
  sendGmail,
  getGmailThread,
  type GoogleCalendarStatus,
  type GoogleCalendarListResponse,
  type GmailThreadResponse,
} from "../../api/integrations.js";

export default function Integrations() {
  const { getAccessTokenSilently } = useAuth0();
  const [searchParams, setSearchParams] = useSearchParams();

  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarListResponse["calendars"]>([]);
  const [loading, setLoading] = useState<"status" | "connect" | "disconnect" | "calendars" | "set-calendar" | null>("status");
  const [error, setError] = useState<string | null>(null);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>("");

  // Suggest delivery window (test)
  const [suggestDate, setSuggestDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [suggestDuration, setSuggestDuration] = useState<number>(60);
  const [suggestTimezone, setSuggestTimezone] = useState<string>("");
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestResult, setSuggestResult] = useState<Array<{ start: string; end: string }> | null>(null);

  // Gmail send (test)
  const [gmailTo, setGmailTo] = useState("");
  const [gmailSubject, setGmailSubject] = useState("");
  const [gmailBody, setGmailBody] = useState("");
  const [gmailThreadId, setGmailThreadId] = useState("");
  const [gmailSendLoading, setGmailSendLoading] = useState(false);
  const [gmailSendResult, setGmailSendResult] = useState<{ messageId: string; threadId: string } | null>(null);

  // Gmail thread (test)
  const [threadIdInput, setThreadIdInput] = useState("");
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadResult, setThreadResult] = useState<GmailThreadResponse | null>(null);

  const connected = status?.connected === true;
  const needsReconnect = status?.needsReconnect === true;

  useEffect(() => {
    const q = searchParams.get("googleCalendar");
    const message = searchParams.get("message");
    if (q === "connected") {
      setError(null);
      setSearchParams({}, { replace: true });
      loadStatus();
    } else if (q === "error" && message) {
      setError(decodeURIComponent(message));
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  async function loadStatus() {
    setLoading("status");
    setError(null);
    try {
      const token = await getAccessTokenSilently();
      const data = await getGoogleCalendarStatus(token);
      setStatus(data);
      if (data.connected && data.calendarId) {
        setSelectedCalendarId(data.calendarId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load status");
      setStatus({ connected: false });
    } finally {
      setLoading(null);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    (async () => {
      setLoading("calendars");
      try {
        const token = await getAccessTokenSilently();
        const data = await getGoogleCalendars(token);
        if (!cancelled) setCalendars(data.calendars);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to list calendars");
      } finally {
        if (!cancelled) setLoading(null);
      }
    })();
    return () => { cancelled = true; };
  }, [connected, getAccessTokenSilently]);

  async function handleConnect() {
    setLoading("connect");
    setError(null);
    try {
      const token = await getAccessTokenSilently();
      const res = await fetch(getGoogleCalendarStartUrl(), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? `Server error ${res.status}`);
        return;
      }
      const data = (await res.json()) as { url?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError("Could not start Google sign-in");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start connection");
    } finally {
      setLoading(null);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Google Calendar? Delivery events will no longer be added.")) return;
    setLoading("disconnect");
    setError(null);
    try {
      const token = await getAccessTokenSilently();
      await disconnectGoogleCalendar(token);
      setStatus({ connected: false });
      setCalendars([]);
      setSelectedCalendarId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setLoading(null);
    }
  }

  async function handleSetCalendar(calendarId: string) {
    setLoading("set-calendar");
    setError(null);
    try {
      const token = await getAccessTokenSilently();
      await setGoogleCalendar(token, calendarId);
      setSelectedCalendarId(calendarId);
      setStatus((prev) => (prev ? { ...prev, calendarId } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set calendar");
    } finally {
      setLoading(null);
    }
  }

  async function handleSuggestWindows() {
    setSuggestLoading(true);
    setError(null);
    setSuggestResult(null);
    try {
      const token = await getAccessTokenSilently();
      const data = await suggestDeliveryWindows(token, {
        date: suggestDate,
        durationMinutes: suggestDuration,
        timeZone: suggestTimezone || undefined,
      });
      setSuggestResult(data.suggestedWindows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to suggest windows");
    } finally {
      setSuggestLoading(false);
    }
  }

  async function handleSendGmail() {
    setGmailSendLoading(true);
    setError(null);
    setGmailSendResult(null);
    try {
      const token = await getAccessTokenSilently();
      const data = await sendGmail(token, {
        to: gmailTo,
        subject: gmailSubject,
        body: gmailBody,
        threadId: gmailThreadId.trim() || undefined,
      });
      setGmailSendResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send email");
    } finally {
      setGmailSendLoading(false);
    }
  }

  async function handleLoadThread() {
    const tid = threadIdInput.trim();
    if (!tid) return;
    setThreadLoading(true);
    setError(null);
    setThreadResult(null);
    try {
      const token = await getAccessTokenSilently();
      const data = await getGmailThread(token, tid);
      setThreadResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load thread");
    } finally {
      setThreadLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="font-display text-2xl text-earth-900 mb-2">Settings</h1>
      <p className="text-earth-600 text-sm mb-6">Manage integrations and preferences.</p>

      <section className="card p-4 sm:p-6 mb-6">
        <h2 className="font-display text-lg text-earth-900 mb-1">Google Calendar</h2>
        <p className="text-sm text-earth-600 mb-4">
          Connect your Google Calendar to automatically add a calendar event for each delivery window when you place an order.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
            {error}
          </div>
        )}

        {loading === "status" && status === null ? (
          <div className="flex items-center gap-2 text-earth-600">
            <span className="inline-block w-5 h-5 border-2 border-earth-300 border-t-leaf-500 rounded-full animate-spin" />
            Loading…
          </div>
        ) : needsReconnect ? (
          <div className="space-y-3">
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Your connection has expired. Please connect again.
            </p>
            <button
              type="button"
              onClick={handleConnect}
              disabled={loading === "connect"}
              className="btn-primary"
            >
              {loading === "connect" ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Connecting…
                </>
              ) : (
                "Connect Google Calendar"
              )}
            </button>
          </div>
        ) : connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-leaf-700">
              <span className="inline-block w-3 h-3 rounded-full bg-leaf-500" />
              Connected to Google Calendar
            </div>

            <div>
              <label className="block text-sm font-medium text-earth-700 mb-1">
                Choose calendar
              </label>
              {loading === "calendars" && calendars.length === 0 ? (
                <p className="text-sm text-earth-500">Loading calendars…</p>
              ) : (
                <select
                  value={selectedCalendarId}
                  onChange={(e) => handleSetCalendar(e.target.value)}
                  disabled={loading === "set-calendar" || loading === "calendars"}
                  className="w-full max-w-sm px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 focus:outline-none focus:ring-2 focus:ring-leaf-400 text-sm"
                >
                  {calendars.map((cal) => (
                    <option key={cal.id} value={cal.id}>
                      {cal.summary} {cal.primary ? "(primary)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <button
              type="button"
              onClick={handleDisconnect}
              disabled={loading === "disconnect"}
              className="btn-secondary text-sm"
            >
              {loading === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            disabled={loading === "connect"}
            className="btn-primary"
          >
            {loading === "connect" ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Connecting…
              </>
            ) : (
              "Connect Google Calendar"
            )}
          </button>
        )}
      </section>

      {connected && (
        <>
          <section className="card p-4 sm:p-6 mb-6">
            <h2 className="font-display text-lg text-earth-900 mb-1">Suggest delivery window</h2>
            <p className="text-sm text-earth-600 mb-4">
              Test: find free slots on your calendar for a given date (used to suggest delivery times).
            </p>
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-earth-600 mb-1">Date</label>
                <input
                  type="date"
                  value={suggestDate}
                  onChange={(e) => setSuggestDate(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-earth-600 mb-1">Duration (min)</label>
                <select
                  value={suggestDuration}
                  onChange={(e) => setSuggestDuration(Number(e.target.value))}
                  className="px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 text-sm"
                >
                  {[30, 60, 90, 120].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-earth-600 mb-1">Timezone (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. America/New_York"
                  value={suggestTimezone}
                  onChange={(e) => setSuggestTimezone(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 text-sm w-48"
                />
              </div>
              <button
                type="button"
                onClick={handleSuggestWindows}
                disabled={suggestLoading}
                className="btn-primary text-sm"
              >
                {suggestLoading ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Suggesting…
                  </>
                ) : (
                  "Suggest windows"
                )}
              </button>
            </div>
            {suggestResult !== null && (
              <div className="text-sm">
                {suggestResult.length === 0 ? (
                  <p className="text-earth-500">No free windows found for this date.</p>
                ) : (
                  <p className="text-earth-700">
                    <span className="font-medium">{suggestResult.length} window(s):</span>{" "}
                    {suggestResult.map((w) => `${w.start}–${w.end}`).join(", ")}
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="card p-4 sm:p-6 mb-6">
            <h2 className="font-display text-lg text-earth-900 mb-1">Gmail (test)</h2>
            <p className="text-sm text-earth-600 mb-4">
              Send an email from your connected Gmail, or load a thread for context (e.g. supplier thread).
            </p>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-earth-600 mb-1">To</label>
                <input
                  type="email"
                  value={gmailTo}
                  onChange={(e) => setGmailTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="w-full px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-earth-600 mb-1">Subject</label>
                <input
                  type="text"
                  value={gmailSubject}
                  onChange={(e) => setGmailSubject(e.target.value)}
                  placeholder="Subject"
                  className="w-full px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-earth-600 mb-1">Body</label>
                <textarea
                  value={gmailBody}
                  onChange={(e) => setGmailBody(e.target.value)}
                  placeholder="Email body"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-earth-600 mb-1">Thread ID (optional, to reply in thread)</label>
                <input
                  type="text"
                  value={gmailThreadId}
                  onChange={(e) => setGmailThreadId(e.target.value)}
                  placeholder="Gmail thread ID"
                  className="w-full px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 text-sm font-mono"
                />
              </div>
              <button
                type="button"
                onClick={handleSendGmail}
                disabled={gmailSendLoading || !gmailTo.trim() || !gmailSubject.trim()}
                className="btn-primary text-sm"
              >
                {gmailSendLoading ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Sending…
                  </>
                ) : (
                  "Send email"
                )}
              </button>
            </div>
            {gmailSendResult && (
              <p className="text-sm text-leaf-700 mb-4">
                Sent. Message ID: <code className="text-xs bg-earth-100 px-1 rounded">{gmailSendResult.messageId}</code>, Thread ID: <code className="text-xs bg-earth-100 px-1 rounded">{gmailSendResult.threadId}</code>
              </p>
            )}
            <hr className="border-earth-200 my-4" />
            <div>
              <label className="block text-xs font-medium text-earth-600 mb-1">Load thread by ID</label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={threadIdInput}
                  onChange={(e) => setThreadIdInput(e.target.value)}
                  placeholder="Thread ID"
                  className="flex-1 px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={handleLoadThread}
                  disabled={threadLoading || !threadIdInput.trim()}
                  className="btn-secondary text-sm"
                >
                  {threadLoading ? "Loading…" : "Load thread"}
                </button>
              </div>
              {threadResult && (
                <div className="text-sm border border-earth-200 rounded-lg p-3 bg-earth-50 max-h-64 overflow-y-auto">
                  <p className="font-medium text-earth-800 mb-2">
                    {threadResult.messages?.length ?? 0} message(s)
                  </p>
                  <ul className="space-y-2">
                    {threadResult.messages?.map((msg) => (
                      <li key={msg.id} className="border-l-2 border-earth-300 pl-2">
                        <span className="text-earth-600 text-xs">{msg.id}</span>
                        {msg.snippet && (
                          <p className="text-earth-800 truncate" title={msg.snippet}>{msg.snippet}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
