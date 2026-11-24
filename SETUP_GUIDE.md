# SettleUp setup guide (Windows)

## First run
1. Install **Node.js 22 LTS or newer** from https://nodejs.org/.
2. Extract the complete ZIP into a normal writable folder (not inside the ZIP preview).
3. Double-click `setup-windows.bat`.
4. The script copies `.env.example` to `.env`, runs `npm install`, creates `settleup.db` if it is missing, and starts SettleUp.
5. Open the local address printed by the app (normally `http://localhost:3000`).

`npm install` downloads the dependencies and creates `package-lock.json` on the computer where the project is installed. Do not copy a `node_modules` folder from another computer; native SQLite packages need to match that computer's Node.js and operating system.

## Main database
- The main database is `settleup.db` in the project folder unless `DB_PATH` is changed in `.env`.
- `npm run db:init` creates the current schema only when the file is missing. It never overwrites an existing database.
- Normal production startup refuses to silently create a new empty database if the configured database is missing.
- Keep the database path stable. Back up the database using `npm run backup:db` while the app is running; do not copy only the `-wal` or `-shm` sidecar files.
- A newly initialized database is empty. It does not restore data from an earlier missing database.
- To load demo/sample content intentionally, set `SEED_DEMO_DATA=true` before initializing a new database. Leave it false for a clean database.

## Group invitation email (Cloudflare)
Cloudflare group invitation email uses the send-only Google Apps Script integration. Follow [`docs/CLOUDFLARE_GUEST_EMAIL_SETUP.md`](docs/CLOUDFLARE_GUEST_EMAIL_SETUP.md) to set the canonical public URL, deploy the script as the account owner, configure signed Worker-to-script authentication, and apply the D1 migrations manually. No Gmail password, OTP, inbox scope, or paid email provider is required for this invitation flow.

The existing Express/SQLite local backend retains its SMTP mailer for the existing local mail flows. Invitation URLs require `APP_URL` to be set to the verified public HTTPS origin; the backend will not generate localhost or preview invitation links.

## Automated SMS delivery (Twilio)
The current backend has a Twilio integration. To enable it, create a Twilio account, obtain an Account SID and Auth Token, and obtain/activate a Twilio sender number that is permitted to send to your recipients' countries. Then add these values to `.env`:

```env
TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
TWILIO_AUTH_TOKEN="your-twilio-auth-token"
TWILIO_FROM_NUMBER="+12345678900"
```

Use the exact sender number assigned/approved by Twilio, in international E.164 format. Find the Account SID and Auth Token in the Twilio Console dashboard under Account Info; treat the Auth Token like a password. Buy or activate a number with SMS capability, and ensure messaging permissions and any required sender, business, or regulatory registration are completed for the countries you plan to message. Delivery to Indian mobile numbers may require additional provider/regulatory setup and is not guaranteed merely by entering credentials. If Twilio cannot provision an eligible sender for your destinations, tell us the SMS provider you choose (for example, an India-focused provider) so the backend can be adapted to its API.

## Public deployment
For Cloudflare production setup, use the existing `wrangler.jsonc` values and follow [`docs/CLOUDFLARE_GUEST_EMAIL_SETUP.md`](docs/CLOUDFLARE_GUEST_EMAIL_SETUP.md). Set the actual canonical origin and Worker secrets manually after verifying the Cloudflare account configuration. For an Express host, set `APP_URL` to the verified public HTTPS origin, set a long random `SESSION_SECRET` (32+ characters), and set `DB_PATH` to persistent disk storage supplied by the host. Do not use a temporary deployment filesystem for SQLite data.

## Keep secrets private
Never send SMTP passwords, API keys, Twilio Auth Tokens, session secrets, or `.env` files in chat, email, screenshots, or the project ZIP. Enter them only into your own local `.env` file or your hosting provider's secret/environment-variable settings. You can share screenshots with the secret values covered/blurred if you need help checking the field names.
