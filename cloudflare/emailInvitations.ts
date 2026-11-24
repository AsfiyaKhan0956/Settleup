import type { CloudflareEnv } from "./db.ts";
import { dbAll, dbFirst, dbRun } from "./db.ts";
import { generateOpaqueToken, isValidEmail } from "./security.ts";

export interface EmailInvitationEnv extends CloudflareEnv {
  SESSION_SECRET: string;
  CANONICAL_APP_URL?: string;
  APPS_SCRIPT_URL?: string;
  EMAIL_INTEGRATION_SECRET?: string;
}

interface User { id: number; fullName: string; email: string; }
const MAX_RECIPIENTS_PER_REQUEST = 5;
const DAILY_RECIPIENT_LIMIT = 50;
const MAX_BODY_BYTES = 12_000;

const response = (data: unknown, status = 200) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store" }
});

function canonicalOrigin(configured?: string): string | null {
  if (!configured?.trim()) return null;
  try {
    const url = new URL(configured.trim());
    const host = url.hostname.toLowerCase();
    const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || host === "localhost" || host.endsWith(".localhost") || isIpLiteral) return null;
    return url.origin;
  } catch { return null; }
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function sendInvitationEmails(
  request: Request,
  env: EmailInvitationEnv,
  groupId: number,
  user: User
): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return response({ error: "Request origin could not be verified." }, 403);
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return response({ error: "The invitation request is too large." }, 413);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return response({ error: "The invitation request is too large." }, 413);
  let body: any;
  try { body = JSON.parse(rawBody); } catch { return response({ error: "Enter valid recipient email addresses." }, 400); }
  const rawEmails = body?.recipients;
  if (!Array.isArray(rawEmails) || rawEmails.length < 1 || rawEmails.length > MAX_RECIPIENTS_PER_REQUEST) {
    return response({ error: `Enter between 1 and ${MAX_RECIPIENTS_PER_REQUEST} recipient addresses.` }, 400);
  }
  const recipients = rawEmails.map((value: unknown) => String(value ?? "").trim().toLowerCase());
  if (recipients.some(email => email.length > 254 || !isValidEmail(email))) return response({ error: "One or more recipient email addresses are invalid." }, 400);
  const uniqueRecipients = [...new Set(recipients)];
  if (uniqueRecipients.length !== recipients.length) return response({ error: "Remove duplicate recipient addresses before sending." }, 400);
  const requestId = String(body?.requestId ?? "");
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) return response({ error: "Refresh the invitation form and try again." }, 400);

  const canonical = canonicalOrigin(env.CANONICAL_APP_URL);
  if (!canonical) return response({ error: "Invitation sending is not configured: set CANONICAL_APP_URL to the verified public HTTPS origin." }, 503);
  const scriptUrl = env.APPS_SCRIPT_URL?.trim() ?? "";
  try {
    const parsed = new URL(scriptUrl);
    if (parsed.protocol !== "https:" || parsed.hostname !== "script.google.com" || !/^\/macros\/s\/[^/]+\/exec\/?$/.test(parsed.pathname)) throw new Error();
  } catch { return response({ error: "Email delivery is not configured. Set the Apps Script web app endpoint in Worker configuration." }, 503); }
  if (!env.EMAIL_INTEGRATION_SECRET || env.EMAIL_INTEGRATION_SECRET.length < 32) return response({ error: "Email delivery is not configured. Set the Worker email integration secret." }, 503);

  const member = await dbFirst<any>(env.DB, "SELECT role FROM group_members WHERE group_id = ? AND user_id = ?", [groupId, user.id]);
  if (!member) return response({ error: "You must be a registered member of this group to send invitations." }, 403);
  const group = await dbFirst<any>(env.DB, "SELECT id, name FROM groups WHERE id = ?", [groupId]);
  if (!group) return response({ error: "Group not found." }, 404);

  const previous = await dbFirst<any>(env.DB,
    "SELECT group_id, requested_by_user_id, status, response_json FROM email_invite_batches WHERE request_id = ?", [requestId]);
  if (previous) {
    if (Number(previous.group_id) !== groupId || Number(previous.requested_by_user_id) !== user.id) return response({ error: "This request identifier is already in use." }, 409);
    if (previous.response_json) return response(JSON.parse(previous.response_json));
    return response({ error: "This invitation request is still being processed. Check its status before retrying." }, 409);
  }

  const reserve = await dbRun(env.DB,
    `INSERT INTO email_invite_usage (request_id, user_id, recipient_count)
     SELECT ?, ?, ? WHERE COALESCE((
       SELECT SUM(recipient_count) FROM email_invite_usage
       WHERE user_id = ? AND date(created_at) = date('now')
     ), 0) + ? <= ?`,
    [requestId, user.id, uniqueRecipients.length, user.id, uniqueRecipients.length, DAILY_RECIPIENT_LIMIT]);
  if (!reserve.meta.changes) return response({ error: `Daily invitation limit reached (maximum ${DAILY_RECIPIENT_LIMIT} recipients per account).` }, 429);

  await dbRun(env.DB,
    "INSERT INTO email_invite_batches (request_id, group_id, requested_by_user_id, status) VALUES (?, ?, ?, 'pending')",
    [requestId, groupId, user.id]);

  const expiry = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 19).replace("T", " ");
  const invitations: Array<{ email: string; token: string; url: string; invitationId: number }> = [];
  for (const email of uniqueRecipients) {
    const existing = await dbFirst<any>(env.DB,
      `SELECT id, token FROM invitations WHERE group_id = ? AND lower(COALESCE(invitee_email, '')) = ?
       AND status = 'pending' AND use_count < max_uses AND datetime(expires_at) > datetime('now')
       ORDER BY created_at DESC, id DESC LIMIT 1`, [groupId, email]);
    if (existing) {
      await dbRun(env.DB,
        "UPDATE invitations SET channel = 'email', expires_at = ?, delivery_status = 'pending', delivery_error = NULL WHERE id = ?",
        [expiry, existing.id]);
      invitations.push({ email, token: existing.token, url: `${canonical}/guest-group?invite=${encodeURIComponent(existing.token)}`, invitationId: Number(existing.id) });
    } else {
      const token = generateOpaqueToken(32);
      const created = await dbRun(env.DB,
        `INSERT INTO invitations
          (group_id, invited_by, invitee_email, channel, token, status, delivery_status, max_uses, expires_at, last_sent_at)
         VALUES (?, ?, ?, 'email', ?, 'pending', 'pending', 1, ?, datetime('now'))`,
        [groupId, user.id, email, token, expiry]);
      invitations.push({ email, token, url: `${canonical}/guest-group?invite=${encodeURIComponent(token)}`, invitationId: Number(created.meta.last_row_id) });
    }
  }

  const payload = {
    senderName: user.fullName.slice(0, 120), groupName: String(group.name).slice(0, 120),
    invitations: invitations.map(({ email, url }) => ({ email, url }))
  };
  const payloadJson = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const nonce = generateOpaqueToken(24);
  const signed = `${timestamp}\n${nonce}\n${requestId}\n${payloadJson}`;
  const signature = await hmacHex(env.EMAIL_INTEGRATION_SECRET, signed);
  let delivery: any;
  try {
    const timeout = AbortSignal.timeout(20_000);
    let mailResponse = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestamp, nonce, requestId, payload: payloadJson, signature }),
      redirect: "manual",
      signal: timeout
    });

    // Apps Script ContentService redirects its response to a one-time
    // script.googleusercontent.com URL. Fetch that response as a clean GET:
    // the signed POST body is only sent to the Apps Script /exec endpoint.
    if (mailResponse.status >= 300 && mailResponse.status < 400) {
      const location = mailResponse.headers.get("Location");
      if (!location) throw new Error("Email service redirect did not include a location.");
      const contentUrl = new URL(location, scriptUrl);
      if (
        contentUrl.protocol !== "https:" ||
        contentUrl.hostname !== "script.googleusercontent.com" ||
        contentUrl.username ||
        contentUrl.password ||
        contentUrl.port
      ) throw new Error("Email service returned an unexpected redirect.");
      mailResponse = await fetch(contentUrl.toString(), {
        method: "GET",
        redirect: "manual",
        signal: timeout
      });
    }

    const text = await mailResponse.text();
    if (text.length > 16_000) throw new Error("Email service returned an oversized response.");
    try { delivery = JSON.parse(text); } catch { throw new Error("Email service returned an unreadable response."); }
    if (!mailResponse.ok || !delivery || !Array.isArray(delivery.results)) throw new Error("Email service could not confirm delivery.");
  } catch {
    const safeResponse = { ok: false, sentCount: 0, failedIndexes: invitations.map((_, index) => index), error: "Email delivery could not be confirmed. The request was not automatically retried to avoid duplicate messages." };
    for (const invite of invitations) await dbRun(env.DB,
      "UPDATE invitations SET delivery_status = 'failed', delivery_error = 'Email delivery could not be confirmed.' WHERE id = ?", [invite.invitationId]);
    await dbRun(env.DB,
      "UPDATE email_invite_batches SET status = 'failed', response_json = ?, updated_at = datetime('now') WHERE request_id = ?",
      [JSON.stringify(safeResponse), requestId]);
    return response(safeResponse, 502);
  }

  const results = invitations.map((invite, index) => {
    const item = delivery.results.find((result: any) => Number(result.index) === index);
    return { index, ok: Boolean(item?.ok), error: item?.ok ? undefined : String(item?.error ?? "Email was not sent.").slice(0, 180) };
  });
  for (const [index, invite] of invitations.entries()) {
    const result = results[index];
    await dbRun(env.DB,
      `UPDATE invitations SET delivery_status = ?, delivery_error = ? WHERE id = ?`,
      [result.ok ? "sent" : "failed", result.ok ? null : result.error, invite.invitationId]);
  }
  const sentCount = results.filter(result => result.ok).length;
  const failedIndexes = results.filter(result => !result.ok).map(result => result.index);
  const safeResponse = { ok: failedIndexes.length === 0, sentCount, failedIndexes, results, requestId };
  await dbRun(env.DB,
    `UPDATE email_invite_batches SET status = ?, response_json = ?, updated_at = datetime('now') WHERE request_id = ?`,
    [failedIndexes.length === 0 ? "sent" : sentCount > 0 ? "partial" : "failed", JSON.stringify(safeResponse), requestId]);
  return response(safeResponse, 200);
}

export const emailInvitationLimits = { maxRecipientsPerRequest: MAX_RECIPIENTS_PER_REQUEST, dailyRecipientLimit: DAILY_RECIPIENT_LIMIT };
export const escapeEmailHtml = htmlEscape;
