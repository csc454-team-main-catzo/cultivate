/**
 * Gmail API helpers: send message, get thread with messages (for supplier email with thread context).
 * Uses same OAuth token as Google Calendar integration (scopes must include gmail.send, gmail.readonly).
 */

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

function base64UrlEncode(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Build a simple MIME message (plain text).
 */
function buildMimeMessage(params: {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines: string[] = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
  ];
  if (params.inReplyTo) lines.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) lines.push(`References: ${params.references}`);
  lines.push("", params.body);
  return lines.join("\r\n");
}

export interface SendMessageParams {
  accessToken: string;
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

export interface SendMessageResponse {
  id: string;
  threadId: string;
}

/**
 * Send an email. If threadId is provided, the message is added to that thread.
 */
export async function sendMessage(params: SendMessageParams): Promise<SendMessageResponse> {
  const mime = buildMimeMessage({
    to: params.to,
    subject: params.subject,
    body: params.body,
    inReplyTo: params.inReplyTo,
    references: params.references,
  });
  const raw = base64UrlEncode(mime);

  const body: { raw: string; threadId?: string } = { raw };
  if (params.threadId) body.threadId = params.threadId;

  const res = await fetch(`${GMAIL_BASE}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail send failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { id: string; threadId: string };
  return { id: data.id, threadId: data.threadId };
}

export interface GmailMessageHeader {
  name: string;
  value: string;
}

export interface GmailMessagePart {
  partId: string;
  mimeType?: string;
  body?: { data?: string; size?: number };
  headers?: GmailMessageHeader[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    headers?: GmailMessageHeader[];
    body?: { data?: string };
    parts?: GmailMessagePart[];
  };
}

export interface GmailThread {
  id: string;
  messages?: GmailMessage[];
  historyId?: string;
}

/**
 * Get a thread with its messages (for email thread context with supplier).
 */
export async function getThread(
  accessToken: string,
  threadId: string,
  format: "minimal" | "full" | "raw" = "full"
): Promise<GmailThread> {
  const url = new URL(`${GMAIL_BASE}/threads/${encodeURIComponent(threadId)}`);
  url.searchParams.set("format", format);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail get thread failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GmailThread;
}
