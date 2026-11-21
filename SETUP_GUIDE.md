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

## Email delivery (SMTP)
The project already contains the HTML invitation email and password-reset email templates. No HTML file or email design is required from you.

To send real email, create an SMTP account with an email provider and enter these values in the local `.env` file:

```env
SMTP_HOST="smtp.provider.example"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="your-smtp-username"
SMTP_PASS="your-smtp-password-or-api-key"
SMTP_FROM="SettleUp <verified-sender@your-domain.example>"
```

For a straightforward SMTP option, Resend's settings are:

```env
SMTP_HOST="smtp.resend.com"
SMTP_PORT="465"
SMTP_SECURE="true"
SMTP_USER="resend"
SMTP_PASS="re_your_resend_api_key"
SMTP_FROM="SettleUp <no-reply@your-verified-domain.com>"
```

In Resend, add and verify a domain under **Domains**, add the DNS records it provides at your domain registrar, then create a sending API key under **API Keys**. Resend documents `smtp.resend.com`, port `465`, username `resend`, and the API key as the SMTP password. The From address must use your verified domain. See https://resend.com/docs/send-with-smtp.

For another provider, use the exact SMTP host, port, username and password/API key it supplies. For port 465, set `SMTP_SECURE="true"`; for port 587, normally use `SMTP_SECURE="false"`.

For production, use a transactional email provider and verify a domain you control. Do not use your ordinary email account password. If using Gmail for a personal test, use a Google App Password (requires 2-Step Verification), not your Google login password. Provider-specific restrictions may apply.

## Automated SMS delivery (Twilio)
The current backend has a Twilio integration. To enable it, create a Twilio account, obtain an Account SID and Auth Token, and obtain/activate a Twilio sender number that is permitted to send to your recipients' countries. Then add these values to `.env`:

```env
TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
TWILIO_AUTH_TOKEN="your-twilio-auth-token"
TWILIO_FROM_NUMBER="+12345678900"
```

Use the exact sender number assigned/approved by Twilio, in international E.164 format. Find the Account SID and Auth Token in the Twilio Console dashboard under Account Info; treat the Auth Token like a password. Buy or activate a number with SMS capability, and ensure messaging permissions and any required sender, business, or regulatory registration are completed for the countries you plan to message. Delivery to Indian mobile numbers may require additional provider/regulatory setup and is not guaranteed merely by entering credentials. If Twilio cannot provision an eligible sender for your destinations, tell us the SMS provider you choose (for example, an India-focused provider) so the backend can be adapted to its API.

## Public deployment
For a hosted production app, set `APP_URL` to the public HTTPS origin, set a long random `SESSION_SECRET` (32+ characters), and set `DB_PATH` to persistent disk storage supplied by the host. Do not use a temporary deployment filesystem for SQLite data.

## Keep secrets private
Never send SMTP passwords, API keys, Twilio Auth Tokens, session secrets, or `.env` files in chat, email, screenshots, or the project ZIP. Enter them only into your own local `.env` file or your hosting provider's secret/environment-variable settings. You can share screenshots with the secret values covered/blurred if you need help checking the field names.
