import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildInvitationUrl, handleGroups, normalizeGuestName } from '../cloudflare/group.ts';
import { emailInvitationLimits, escapeEmailHtml, sendInvitationEmails } from '../cloudflare/emailInvitations.ts';

const token = 'a'.repeat(64);
const validInvitation = {
  id: 4, group_id: 27, invited_by: 3, token,
  group_name: 'Weekend group', group_description: '', group_category: 'Friends', inviter_name: 'Taylor',
  status: 'pending', expires_at: new Date(Date.now() + 86400000).toISOString().slice(0, 19).replace('T', ' '),
  max_uses: 10, use_count: 0, invitee_email: null
};

class Statement {
  params: unknown[] = [];
  constructor(private db: FakeD1, private sql: string) {}
  bind(...params: unknown[]) { this.params = params; return this; }
  async first() { return this.db.first(this.sql, this.params); }
  async all() { return { results: this.db.all(this.sql, this.params) }; }
  async run() { return this.db.run(this.sql, this.params); }
}

class FakeD1 {
  batches: Array<{ sql: string; params: unknown[] }> = [];
  runs: Array<{ sql: string; params: unknown[] }> = [];
  batchesById = new Map<string, any>();
  invitation?: any;
  session?: any;
  joinedGuest: any = { id: 8, display_name: 'Alex Morgan', group_id: 27 };
  prepare(sql: string) { return new Statement(this, sql); }
  async first(sql: string, params: unknown[]) {
    if (sql.includes('FROM invitations i') && sql.includes('WHERE i.token = ?')) return this.invitation ?? null;
    if (sql.includes('FROM guest_sessions WHERE token_hash')) return null;
    if (sql.includes('FROM guest_sessions gs')) return this.session ?? null;
    if (sql.includes('FROM guest_members WHERE source_session_id')) return this.joinedGuest;
    if (sql.includes('FROM group_members WHERE group_id = ? AND user_id = ?')) return { role: 'member' };
    if (sql.includes('SELECT id, name FROM groups')) return { id: 27, name: 'Weekend group' };
    if (sql.includes('FROM email_invite_batches WHERE request_id = ?')) return this.batchesById.get(String(params[0])) ?? null;
    if (sql.includes('SELECT id, token FROM invitations WHERE group_id')) return null;
    return null;
  }
  all(_sql: string, _params: unknown[]) { return []; }
  async run(sql: string, params: unknown[]) {
    this.runs.push({ sql, params });
    if (sql.includes('INSERT INTO email_invite_batches')) {
      const row = { group_id: params[1], requested_by_user_id: params[2], status: 'pending', response_json: null };
      this.batchesById.set(String(params[0]), row);
    }
    if (sql.includes('UPDATE email_invite_batches')) {
      const row = this.batchesById.get(String(params[1]));
      if (row) { row.status = params[0]; row.response_json = params[1] === 'unused' ? null : params[0] === 'sent' || params[0] === 'partial' || params[0] === 'failed' ? params[1] : row.response_json; }
      // The SQL bind order for status updates is [status, JSON, requestId].
      if (row) { row.status = String(params[0]); row.response_json = String(params[1]); }
    }
    return { success: true, meta: { changes: 1, last_row_id: 91 } };
  }
  async batch(statements: Statement[]) {
    this.batches = statements.map(statement => ({ sql: (statement as any).sql, params: (statement as any).params }));
    return statements.map(() => ({ success: true, meta: { changes: 1 } }));
  }
}

function request(url: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

test('canonical invitation URL uses the configured HTTPS origin and preserves the token', () => {
  assert.equal(buildInvitationUrl('https://settleup.test', token), `https://settleup.test/guest-group?invite=${token}`);
  assert.throws(() => buildInvitationUrl(undefined, token), /CANONICAL_APP_URL/);
  assert.throws(() => buildInvitationUrl('http://settleup.test', token), /HTTPS/);
  assert.throws(() => buildInvitationUrl('https://localhost:3000', token), /HTTPS/);
});

test('guest names are trimmed, bounded, and reject markup/control characters', () => {
  assert.equal(normalizeGuestName('  Alex   Morgan '), 'Alex Morgan');
  assert.equal(normalizeGuestName('A'), null);
  assert.equal(normalizeGuestName('<script>'), null);
  assert.equal(normalizeGuestName('A\nB'), null);
  assert.equal(normalizeGuestName('x'.repeat(81)), null);
});

test('invitation preview returns the token-bound group only while the token is valid', async () => {
  const db = new FakeD1();
  db.invitation = validInvitation;
  const res = await handleGroups(request(`https://app.test/api/groups/invite/${token}`), { DB: db, SESSION_SECRET: 'test-session-secret' } as any);
  assert.equal(res?.status, 200);
  assert.equal((await res!.json() as any).groupId, validInvitation.group_id);
  assert.equal((await handleGroups(request(`https://app.test/api/groups/invite/${'b'.repeat(64)}`), { DB: new FakeD1(), SESSION_SECRET: 'test' } as any))?.status, 200);
});

test('expired and revoked invitation previews do not disclose group details', async () => {
  for (const invitation of [
    { ...validInvitation, status: 'revoked' },
    { ...validInvitation, expires_at: '2000-01-01 00:00:00' }
  ]) {
    const db = new FakeD1(); db.invitation = invitation;
    const res = await handleGroups(request(`https://app.test/api/groups/invite/${token}`), { DB: db, SESSION_SECRET: 'test' } as any);
    const preview = await res!.json() as any;
    assert.equal(preview.valid, false);
    assert.equal(preview.groupName, '');
    assert.equal(preview.groupId, null);
  }
});

test('guest session creation rejects an invalid token and scopes secure cookies to group APIs', async () => {
  const db = new FakeD1();
  const invalid = await handleGroups(request(`https://app.test/api/groups/invite/${token}/guest-session`, 'POST', {}), { DB: db, SESSION_SECRET: 'test' } as any);
  assert.equal(invalid?.status, 410);

  db.invitation = validInvitation;
  const created = await handleGroups(request(`https://app.test/api/groups/invite/${token}/guest-session`, 'POST', {}), { DB: db, SESSION_SECRET: 'test' } as any);
  assert.equal(created?.status, 200);
  const cookie = created!.headers.get('Set-Cookie') ?? '';
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/api\/groups/);
});

test('guest join requires a valid scoped session and validates the supplied name', async () => {
  const db = new FakeD1();
  const joinUrl = 'https://app.test/api/groups/guest-session/join';
  db.session = { id: 7, group_id: 27, invitation_id: 4, guest_member_id: null };
  const missing = await handleGroups(request(joinUrl, 'POST', { name: ' ' }, { Cookie: 'settleup_guest=raw' }), { DB: db, SESSION_SECRET: 'test' } as any);
  assert.equal(missing?.status, 400);
  const expiredDb = new FakeD1();
  const expired = await handleGroups(request(joinUrl, 'POST', { name: 'Alex' }, { Cookie: 'settleup_guest=raw' }), { DB: expiredDb, SESSION_SECRET: 'test' } as any);
  assert.equal(expired?.status, 410);
});

test('guest cookies cannot authorize registered group write routes', async () => {
  const db = new FakeD1();
  const res = await handleGroups(request('https://app.test/api/groups/27/invitations', 'POST', { channel: 'link' }, { Cookie: 'settleup_guest=raw' }), { DB: db, SESSION_SECRET: 'test' } as any);
  assert.equal(res?.status, 401);
});

test('email limits and HTML escaping are explicit', () => {
  assert.equal(emailInvitationLimits.maxRecipientsPerRequest, 5);
  assert.ok(emailInvitationLimits.dailyRecipientLimit > emailInvitationLimits.maxRecipientsPerRequest);
  assert.equal(escapeEmailHtml(`<script a="&">'`), '&lt;script a=&quot;&amp;&quot;&gt;&#39;');
});

test('email endpoint enforces same-origin and does not report a failed send as success', async (t) => {
  const db = new FakeD1();
  const user = { id: 3, fullName: 'Taylor', email: 'taylor@example.test' };
  const env = {
    DB: db, SESSION_SECRET: 'test-session-secret', CANONICAL_APP_URL: 'https://app.test',
    APPS_SCRIPT_URL: 'https://script.google.com/macros/s/test-deployment/exec',
    EMAIL_INTEGRATION_SECRET: 'x'.repeat(40)
  } as any;
  const denied = await sendInvitationEmails(request('https://app.test/api/groups/27/invitations/email', 'POST', { recipients: ['a@example.test'], requestId: '1234567890abcdef' }, { Origin: 'https://attacker.test' }), env, 27, user);
  assert.equal(denied.status, 403);

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, results: [{ index: 0, ok: false, error: 'gmail_daily_quota_exceeded' }] }), { status: 200 });
  const failed = await sendInvitationEmails(request('https://app.test/api/groups/27/invitations/email', 'POST', { recipients: ['a@example.test'], requestId: '1234567890abcdef' }, { Origin: 'https://app.test' }), env, 27, user);
  const result = await failed.json() as any;
  assert.equal(failed.status, 200);
  assert.equal(result.ok, false);
  assert.equal(result.sentCount, 0);
  assert.deepEqual(result.failedIndexes, [0]);
  assert.ok(db.runs.some(row => row.sql.includes("delivery_status = ?")));
});

test('Apps Script source is send-only and declares only the mail-send scope', async () => {
  const [script, manifest] = await Promise.all([
    readFile(new URL('../apps-script/SettleUpMailer.gs', import.meta.url), 'utf8'),
    readFile(new URL('../apps-script/appsscript.json', import.meta.url), 'utf8')
  ]);
  assert.match(script, /MailApp\.sendEmail/);
  assert.doesNotMatch(script, /GmailApp|Gmail API|users\.messages/);
  assert.match(script, /LockService\.getScriptLock/);
  assert.match(script, /const\s+nonceKey\s*=\s*["']N_["']\s*\+\s*nonce\s*;/);
  assert.match(script, /if\s*\(props\.getProperty\(nonceKey\)\)\s*return\s*\{\s*ok:\s*false,\s*error:\s*["']replayed_request["']\s*\}/);
  assert.match(script, /props\.setProperty\(nonceKey,\s*String\(timestamp\)\)/);
  const settings = JSON.parse(manifest);
  assert.deepEqual(settings.oauthScopes, ['https://www.googleapis.com/auth/script.send_mail']);
});
