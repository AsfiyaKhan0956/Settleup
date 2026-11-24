# Cloudflare invitations, guests, and Gmail sending setup

This project has separate Express/SQLite and Cloudflare Worker/D1 backends. The Cloudflare Worker in `worker.ts` is the production implementation described here. The Express backend remains for local development.

## Values to verify before Cloudflare setup

The supplied `wrangler.jsonc` already defines the `worker.ts` entry point, `DB` D1 binding, `ASSETS` binding to `./dist`, and `migrations` directory. Preserve its current production values.

Before invitation links can be generated, set the public Worker variable `CANONICAL_APP_URL` to the verified stable HTTPS origin for this deployment. Use the URL shown for the production Worker in Cloudflare, without a path, query, or trailing application route. Do not use localhost, a preview hostname, or a guessed account subdomain. The current configuration does not establish that public URL.

The D1 database name and ID in `wrangler.jsonc` must be checked in the intended Cloudflare account. No production database ID is supplied in this guide. `SESSION_SECRET` must exist as a Worker secret; it is not a public `vars` value. Do not rotate it casually because it signs session hashes.

## Apply schema changes manually

These migrations are additive and must be applied to the intended D1 database only after you verify the binding. From the project root, the production command is:

```powershell
npx wrangler d1 migrations apply settleup-db --remote
```

This command is documentation only; Codex did not execute it. Verify the account and database selection in Wrangler before running it. For a disposable local D1 test database, omit `--remote`.

## Set Worker configuration

In the Cloudflare dashboard, open the Worker’s settings and set these values for the appropriate environment:

- `CANONICAL_APP_URL`: the verified stable public HTTPS origin, not a preview deployment URL.
- `APPS_SCRIPT_URL`: the deployed Apps Script web app endpoint ending in `/exec`. This is configuration, not an authentication secret.

Set these using Cloudflare’s secret store, not `vars`:

- `SESSION_SECRET`: existing session-signing secret. If it is missing, generate a strong value and set it yourself after reviewing session compatibility. Do not send it to Codex.
- `EMAIL_INTEGRATION_SECRET`: a newly generated random secret of at least 32 characters. Store the same value in Apps Script Script Properties as `SETTLEUP_HMAC_SECRET`.

Do not place secrets in this repository, frontend code, `.env.example`, public Worker variables, or URLs. To rotate the email secret, update the Apps Script property and Worker secret together; brief delivery failures may occur during the changeover.

## Create and deploy the Apps Script mailer

1. While signed into the Google account that should send invitations, create a new standalone Apps Script project.
2. Add `SettleUpMailer.gs` from this folder and replace the project manifest with `appsscript.json`. The manifest declares only `https://www.googleapis.com/auth/script.send_mail`.
3. In **Project Settings → Script Properties**, create `SETTLEUP_HMAC_SECRET`. Generate the value yourself and keep it private; do not share it with Codex or recipients.
4. Deploy as a **Web app**, executing as your account. The web app needs to be reachable by the Worker, which may require access setting **Anyone**. That makes the endpoint publicly reachable, but the script rejects unsigned requests and does not expose Gmail login, inbox, contacts, or settings.
5. Google may show an authorization prompt for send-only permission. Authorize it while signed into the owner account. If Google Workspace policy blocks the web app access level or Google refuses the declared scope, stop and review the account restriction; do not grant inbox scopes or use another provider as a workaround.
6. Copy the deployed `/exec` endpoint into the Worker’s `APPS_SCRIPT_URL` setting. Do not paste the HMAC secret into the URL.
7. Configure `EMAIL_INTEGRATION_SECRET` in Cloudflare’s Worker secret store with the same secret you set in Script Properties.
8. Test with an address you control, using the in-app group invitation field. Confirm the response reports success before treating the test as sent. Apps Script checks `MailApp.getRemainingDailyQuota()` and reports quota failures. Consumer Gmail sending limits still apply and can change.

The Apps Script verifies a signed request body with a five-minute timestamp window, a unique nonce recorded under a script lock, and a request ID for idempotency. The Worker also requires an authenticated registered group member, same-origin request, D1 daily recipient guard, and a request ID. Apps Script keeps only bounded request status and nonce records; it does not log message bodies or recipient addresses.

## Guest identity and conversion

The new guest migration adds a separate guest membership table and a nullable reference from guest sessions. Existing registered `group_members` rows and expense data are not rebuilt. Apply the migration before deploying code that queries these new columns/tables. Guest-to-account conversion happens only from an active guest session and creates a normal registered membership only if one does not already exist.

## Deployment

Build and validate the project locally before deployment. Deployment is a separate manual action. No production Worker deployment, secret update, D1 migration, or live email delivery is performed by the source changes themselves.
