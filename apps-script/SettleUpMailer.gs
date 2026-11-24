const MAX_RECIPIENTS = 5;
const MAX_BODY_BYTES = 12000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const NONCE_RETENTION_MS = 10 * 60 * 1000;
const RESULT_RETENTION_MS = 24 * 60 * 60 * 1000;

function doPost(e) {
  const raw = String(e && e.postData && e.postData.contents || "");
  if (!raw || raw.length > MAX_BODY_BYTES) return output({ ok: false, error: "invalid_request" });

  let request;
  try { request = JSON.parse(raw); } catch (_) { return output({ ok: false, error: "invalid_json" }); }
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty("SETTLEUP_HMAC_SECRET") || "";
  if (secret.length < 32) return output({ ok: false, error: "service_not_configured" });

  const timestamp = String(request.timestamp || "");
  const nonce = String(request.nonce || "");
  const requestId = String(request.requestId || "");
  const payloadJson = String(request.payload || "");
  const signature = String(request.signature || "").toLowerCase();
  const timestampNumber = Number(timestamp);
  if (!/^\d{13}$/.test(timestamp) || !Number.isFinite(timestampNumber) || Math.abs(Date.now() - timestampNumber) > MAX_CLOCK_SKEW_MS) {
    return output({ ok: false, error: "expired_request" });
  }
  if (!/^[a-f0-9]{48}$/.test(nonce) || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId) || !/^[a-f0-9]{64}$/.test(signature)) {
    return output({ ok: false, error: "invalid_authentication" });
  }
  const signed = [timestamp, nonce, requestId, payloadJson].join("\n");
  const expected = bytesToHex(Utilities.computeHmacSha256Signature(signed, secret, Utilities.Charset.UTF_8));
  if (!constantTimeEqual(signature, expected)) return output({ ok: false, error: "invalid_authentication" });

  let payload;
  try { payload = JSON.parse(payloadJson); } catch (_) { return output({ ok: false, error: "invalid_payload" }); }
  const invites = payload && payload.invitations;
  if (!Array.isArray(invites) || invites.length < 1 || invites.length > MAX_RECIPIENTS) return output({ ok: false, error: "recipient_limit" });
  const normalized = [];
  for (const item of invites) {
    const email = String(item && item.email || "").trim().toLowerCase();
    const invitationUrl = String(item && item.url || "");
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return output({ ok: false, error: "invalid_recipient" });
    if (!isValidInvitationUrl(invitationUrl)) return output({ ok: false, error: "invalid_invitation_url" });
    normalized.push({ email, url: invitationUrl });
  }
  if (new Set(normalized.map(item => item.email)).size !== normalized.length) return output({ ok: false, error: "duplicate_recipient" });

  const payloadHash = bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, payloadJson, Utilities.Charset.UTF_8));
  const reservation = reserveRequest(props, requestId, nonce, timestampNumber, payloadHash);
  if (reservation.cached) return output(reservation.cached);
  if (!reservation.ok) return output({ ok: false, error: reservation.error });

  let quota;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (_) {
    const quotaFailure = { ok: false, error: "gmail_quota_unavailable", sentCount: 0, results: normalized.map((_, index) => ({ index, ok: false, error: "quota_unavailable" })) };
    completeRequest(props, requestId, payloadHash, quotaFailure);
    return output(quotaFailure);
  }
  if (quota < normalized.length) {
    const quotaFailure = { ok: false, error: "gmail_daily_quota_exceeded", sentCount: 0, results: normalized.map((_, index) => ({ index, ok: false, error: "quota_exceeded" })) };
    completeRequest(props, requestId, payloadHash, quotaFailure);
    return output(quotaFailure);
  }

  const sender = safeText(payload.senderName, 120) || "A SettleUp member";
  const group = safeText(payload.groupName, 120) || "a SettleUp group";
  const results = [];
  normalized.forEach((item, index) => {
    try {
      const subject = sender + " invited you to join " + group + " on SettleUp";
      const plain = "Hello,\n\n" + sender + " invited you to join the group \"" + group + "\" on SettleUp.\n\nOpen the secure invitation link to view and join the group:\n" + item.url + "\n\nThe invitation expires in 14 days.";
      const html = "<p>Hello,</p><p>" + escapeHtml(sender) + " invited you to join the group <strong>" + escapeHtml(group) + "</strong> on SettleUp.</p><p><a href=\"" + escapeHtml(item.url) + "\">Open the secure invitation</a></p><p>The invitation expires in 14 days.</p>";
      MailApp.sendEmail({ to: item.email, subject: subject, body: plain, htmlBody: html, name: "SettleUp" });
      results.push({ index: index, ok: true });
    } catch (_) {
      results.push({ index: index, ok: false, error: "send_failed" });
    }
  });
  const result = { ok: results.every(item => item.ok), sentCount: results.filter(item => item.ok).length, results: results };
  completeRequest(props, requestId, payloadHash, result);
  return output(result);
}

function reserveRequest(props, requestId, nonce, timestamp, payloadHash) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (_) { return { ok: false, error: "service_busy" }; }
  try {
    const all = props.getProperties();
    const now = Date.now();
    Object.keys(all).forEach(key => {
      if (key.indexOf("N_") === 0 && now - Number(all[key]) > NONCE_RETENTION_MS) props.deleteProperty(key);
      if (key.indexOf("R_") === 0) {
        try { if (now - Number(JSON.parse(all[key]).at) > RESULT_RETENTION_MS) props.deleteProperty(key); } catch (_) { props.deleteProperty(key); }
      }
      if (key.indexOf("P_") === 0) {
        try { if (now - Number(JSON.parse(all[key]).at) > NONCE_RETENTION_MS) props.deleteProperty(key); } catch (_) { props.deleteProperty(key); }
      }
    });
    const nonceKey = "N_" + nonce;
    if (props.getProperty(nonceKey)) return { ok: false, error: "replayed_request" };
    props.setProperty(nonceKey, String(timestamp));

    const resultKey = "R_" + requestId;
    const prior = props.getProperty(resultKey);
    if (prior) {
      const saved = JSON.parse(prior);
      return saved.payloadHash === payloadHash ? { ok: true, cached: saved.result } : { ok: false, error: "request_id_conflict" };
    }
    const pendingKey = "P_" + requestId;
    const pending = props.getProperty(pendingKey);
    if (pending) {
      const saved = JSON.parse(pending);
      return saved.payloadHash === payloadHash ? { ok: false, error: "request_in_progress" } : { ok: false, error: "request_id_conflict" };
    }
    props.setProperty(pendingKey, JSON.stringify({ at: now, payloadHash: payloadHash }));
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function completeRequest(props, requestId, payloadHash, result) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    props.setProperty("R_" + requestId, JSON.stringify({ at: Date.now(), payloadHash: payloadHash, result: result }));
    props.deleteProperty("P_" + requestId);
  } finally { lock.releaseLock(); }
}

function isValidInvitationUrl(value) {
  const prefix = "https://settleup.arzooshanagi.workers.dev/guest-group?";
  if (typeof value !== "string" || value.indexOf(prefix) !== 0 || /[\u0000-\u0020\u007f\\#]/.test(value)) return false;

  const query = value.slice(prefix.length);
  if (!query || /%(?![a-f0-9]{2})/i.test(query)) return false;

  let inviteFound = false;
  const parameters = query.split("&");
  for (let index = 0; index < parameters.length; index++) {
    if (!parameters[index]) return false;
    const equals = parameters[index].indexOf("=");
    const rawName = equals === -1 ? parameters[index] : parameters[index].slice(0, equals);
    const rawValue = equals === -1 ? "" : parameters[index].slice(equals + 1);
    let name;
    let decodedValue;
    try {
      name = decodeURIComponent(rawName.replace(/\+/g, " "));
      decodedValue = decodeURIComponent(rawValue.replace(/\+/g, " "));
    } catch (_) {
      return false;
    }
    if (name === "invite") {
      if (inviteFound || !decodedValue) return false;
      inviteFound = true;
    }
  }
  return inviteFound;
}

function bytesToHex(bytes) {
  return bytes.map(value => (value + 256).toString(16).slice(-2)).join("");
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function safeText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function output(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
