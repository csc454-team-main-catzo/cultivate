import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { authMiddleware } from "../middleware/auth.js";
import GoogleCalendarIntegration from "../models/GoogleCalendarIntegration.js";
import OAuthState from "../models/OAuthState.js";
import CFG from "../config.js";
import { buildAuthUrl, exchangeCodeForTokens, listCalendars } from "../integrations/googleCalendar/googleApi.js";
import { encrypt } from "../integrations/googleCalendar/crypto.js";

const routes = new Hono();

// ---- GET /integrations/google/start (auth required) ----
routes.get("/integrations/google/start", authMiddleware(), async (c) => {
  const userId = c.get("userId") as string;
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (!CFG.GOOGLE_CLIENT_ID || !CFG.GOOGLE_REDIRECT_URI) {
    return c.json(
      { error: "Google Calendar integration is not configured" },
      503
    );
  }
  const state = randomBytes(24).toString("base64url");
  await OAuthState.create({
    state,
    userId,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  const url = buildAuthUrl({
    clientId: CFG.GOOGLE_CLIENT_ID,
    redirectUri: CFG.GOOGLE_REDIRECT_URI,
    state,
  });
  // Return URL in body so the SPA can redirect; cross-origin fetch cannot read Location header
  return c.json({ url });
});

// ---- GET /integrations/google/callback (no auth; validated via state) ----
routes.get("/integrations/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const errorParam = c.req.query("error");
  const appBase = (CFG.APP_BASE_URL || "").replace(/\/$/, "");
  const redirectBase = `${appBase}/settings/integrations`;

  if (errorParam) {
    const fragment = `?googleCalendar=error&message=${encodeURIComponent(errorParam)}`;
    return c.redirect(`${redirectBase}${fragment}`);
  }
  if (!code || !state) {
    return c.redirect(`${redirectBase}?googleCalendar=error&message=missing_code_or_state`);
  }

  const stateDoc = await OAuthState.findOneAndDelete({ state });
  if (!stateDoc) {
    return c.redirect(`${redirectBase}?googleCalendar=error&message=invalid_state`);
  }
  if (new Date() > stateDoc.expiresAt) {
    return c.redirect(`${redirectBase}?googleCalendar=error&message=state_expired`);
  }

  const userId = stateDoc.userId;
  if (!CFG.GOOGLE_CLIENT_ID || !CFG.GOOGLE_CLIENT_SECRET || !CFG.GOOGLE_REDIRECT_URI) {
    return c.redirect(`${redirectBase}?googleCalendar=error&message=server_config`);
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      clientId: CFG.GOOGLE_CLIENT_ID,
      clientSecret: CFG.GOOGLE_CLIENT_SECRET,
      redirectUri: CFG.GOOGLE_REDIRECT_URI,
    });
    const expiry = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);
    const accessEnc = encrypt(tokens.access_token);
    const refreshEnc = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;

    await GoogleCalendarIntegration.findOneAndUpdate(
      { userId },
      {
        $set: {
          provider: "google",
          accessTokenEncrypted: accessEnc,
          refreshTokenEncrypted: refreshEnc,
          tokenExpiryISO: expiry.toISOString(),
          calendarId: "primary",
          needsReconnect: false,
        },
      },
      { upsert: true, new: true }
    );
  } catch (e) {
    console.error("[integrationsGoogle] callback token exchange failed", (e as Error).message);
    return c.redirect(`${redirectBase}?googleCalendar=error&message=exchange_failed`);
  }

  return c.redirect(`${redirectBase}?googleCalendar=connected`);
});

const disconnectSchema = z.object({});
const setCalendarSchema = z.object({
  calendarId: z.string().min(1),
});

// ---- POST /integrations/google/disconnect (auth required) ----
routes.post(
  "/integrations/google/disconnect",
  authMiddleware(),
  zValidator("json", disconnectSchema, (result, c) => {
    if (!result.success) return c.json({ error: "Invalid body", details: result.error.flatten() }, 400);
  }),
  async (c) => {
    const userId = c.get("userId") as string;
    await GoogleCalendarIntegration.deleteOne({ userId });
    return c.json({ ok: true });
  }
);

// ---- GET /integrations/google/status (auth required) ----
routes.get("/integrations/google/status", authMiddleware(), async (c) => {
  const userId = c.get("userId") as string;
  const integration = await GoogleCalendarIntegration.findOne(
    { userId },
    { calendarId: 1, needsReconnect: 1 }
  ).lean();
  if (!integration) {
    return c.json({ connected: false });
  }
  return c.json({
    connected: !integration.needsReconnect,
    needsReconnect: integration.needsReconnect ?? false,
    calendarId: integration.calendarId,
  });
});

// ---- GET /integrations/google/calendars (auth required) ----
routes.get("/integrations/google/calendars", authMiddleware(), async (c) => {
  const userId = c.get("userId") as string;
  const { getValidAccessToken } = await import("../integrations/googleCalendar/service.js");
  const tokenResult = await getValidAccessToken(userId as any);
  if (!tokenResult) {
    return c.json({ error: "Not connected or token invalid" }, 400);
  }
  try {
    const calendars = await listCalendars(tokenResult.accessToken);
    return c.json({
      calendars: calendars.map((cal) => ({ id: cal.id, summary: cal.summary, primary: cal.primary })),
    });
  } catch (e) {
    console.error("[integrationsGoogle] list calendars failed", (e as Error).message);
    return c.json({ error: "Failed to list calendars" }, 500);
  }
});

// ---- POST /integrations/google/calendar (auth required, set selected calendar) ----
routes.post(
  "/integrations/google/calendar",
  authMiddleware(),
  zValidator("json", setCalendarSchema, (result, c) => {
    if (!result.success) return c.json({ error: "Invalid body", details: result.error.flatten() }, 400);
  }),
  async (c) => {
    const userId = c.get("userId") as string;
    const { calendarId } = c.req.valid("json");
    const updated = await GoogleCalendarIntegration.findOneAndUpdate(
      { userId },
      { $set: { calendarId } },
      { new: true }
    );
    if (!updated) {
      return c.json({ error: "Integration not found" }, 404);
    }
    return c.json({ ok: true, calendarId: updated.calendarId });
  }
);

// ---- GET /integrations/google/calendar/suggest-window (auth required) ----
const suggestWindowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMinutes: z.coerce.number().min(30).max(480).optional(),
  timeZone: z.string().optional(),
});
routes.get("/integrations/google/calendar/suggest-window", authMiddleware(), async (c) => {
  const userId = c.get("userId") as string;
  const query = suggestWindowSchema.safeParse({
    date: c.req.query("date"),
    durationMinutes: c.req.query("durationMinutes"),
    timeZone: c.req.query("timeZone"),
  });
  if (!query.success) {
    return c.json({ error: "Invalid query", details: query.error.flatten() }, 400);
  }
  const { suggestDeliveryWindows } = await import("../integrations/googleCalendar/service.js");
  const slots = await suggestDeliveryWindows({
    userId: new mongoose.Types.ObjectId(userId),
    date: query.data.date,
    durationMinutes: query.data.durationMinutes,
    timeZone: query.data.timeZone,
  });
  return c.json({ suggestedWindows: slots });
});

// ---- POST /integrations/google/gmail/send (auth required) ----
const sendSupplierEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string(),
  threadId: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
});
routes.post(
  "/integrations/google/gmail/send",
  authMiddleware(),
  zValidator("json", sendSupplierEmailSchema, (result, c) => {
    if (!result.success) return c.json({ error: "Invalid body", details: result.error.flatten() }, 400);
  }),
  async (c) => {
    const userId = c.get("userId") as string;
    const body = c.req.valid("json");
    const { sendSupplierEmail } = await import("../integrations/gmail/service.js");
    const result = await sendSupplierEmail({
      userId: new mongoose.Types.ObjectId(userId),
      to: body.to,
      subject: body.subject,
      body: body.body,
      threadId: body.threadId,
      inReplyTo: body.inReplyTo,
      references: body.references,
    });
    if (!result) {
      return c.json({ error: "Not connected or token invalid" }, 400);
    }
    return c.json({ messageId: result.messageId, threadId: result.threadId });
  }
);

// ---- GET /integrations/google/gmail/thread/:threadId (auth required) ----
routes.get("/integrations/google/gmail/thread/:threadId", authMiddleware(), async (c) => {
  const userId = c.get("userId") as string;
  const threadId = c.req.param("threadId");
  if (!threadId) {
    return c.json({ error: "Missing threadId" }, 400);
  }
  const { getThreadContext } = await import("../integrations/gmail/service.js");
  const thread = await getThreadContext(new mongoose.Types.ObjectId(userId), threadId);
  if (!thread) {
    return c.json({ error: "Not connected or thread not found" }, 400);
  }
  return c.json(thread);
});

export default routes;
