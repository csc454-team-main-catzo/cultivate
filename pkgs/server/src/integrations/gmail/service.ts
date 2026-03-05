/**
 * Gmail integration service: send supplier email, get thread context.
 * Reuses the same Google OAuth token as Calendar (scopes: gmail.send, gmail.readonly).
 */

import type { Types } from "mongoose";
import { getValidAccessToken } from "../googleCalendar/service.js";
import { sendMessage as apiSendMessage, getThread as apiGetThread, type GmailThread } from "./gmailApi.js";

export interface SendSupplierEmailParams {
  userId: Types.ObjectId;
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

export interface SendSupplierEmailResult {
  messageId: string;
  threadId: string;
}

/**
 * Send an email (optionally in a thread) using the user's connected Google account.
 */
export async function sendSupplierEmail(
  params: SendSupplierEmailParams
): Promise<SendSupplierEmailResult | null> {
  const tokenResult = await getValidAccessToken(params.userId);
  if (!tokenResult) return null;
  const result = await apiSendMessage({
    accessToken: tokenResult.accessToken,
    to: params.to,
    subject: params.subject,
    body: params.body,
    threadId: params.threadId,
    inReplyTo: params.inReplyTo,
    references: params.references,
  });
  return { messageId: result.id, threadId: result.threadId };
}

/**
 * Get thread with messages for email thread context (e.g. when replying to supplier).
 */
export async function getThreadContext(
  userId: Types.ObjectId,
  threadId: string
): Promise<GmailThread | null> {
  const tokenResult = await getValidAccessToken(userId);
  if (!tokenResult) return null;
  return apiGetThread(tokenResult.accessToken, threadId);
}
