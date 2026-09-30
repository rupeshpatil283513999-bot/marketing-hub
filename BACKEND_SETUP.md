# Marketing Hub backend on Netlify with Outlook

Every morning a server job runs the same readiness rules as the dashboard card and emails the team what is overdue, due soon and coming up, sent from your company Outlook mailbox.

## How the pieces fit

1. The app (`index.html`) sends a small snapshot of its data to `/api/snapshot` a few seconds after any change. It only does this when served from a real web address, never when opened as a local file.
2. `netlify/functions/snapshot.mjs` stores only the latest snapshot in Netlify Blobs (built in).
3. `netlify/functions/digest-daily.mjs` runs every day at 04:00 UTC (09:30 India, 08:00 Dubai).
4. It loads the snapshot, runs the rules in `netlify/lib/readiness.js`, builds the email in `netlify/lib/digest.js`, and sends it through Microsoft Graph in `netlify/lib/mail.js`.
5. `netlify/functions/digest.mjs` is a protected address for testing, so you do not have to wait for the schedule.

## Step 1: Register the app in Microsoft Entra (needs your admin)

1. Sign in to https://entra.microsoft.com and open Identity, Applications, App registrations, New registration.
2. Name it "Marketing Hub digest", keep "Accounts in this organizational directory only", and register.
3. On the Overview page copy the **Application (client) ID** and **Directory (tenant) ID**.
4. Open Certificates & secrets, New client secret, pick an expiry, and copy the secret **Value** straight away (it is shown once). Put a reminder in your calendar to renew it before it expires.
5. Open API permissions, Add a permission, Microsoft Graph, **Application permissions**, search for `Mail.Send`, add it.
6. Click **Grant admin consent** (an admin has to do this).
7. Ask the admin to limit the app to the one sender mailbox (an Exchange Online application access policy, or RBAC for Applications). Without this the app could send as anyone in the company.

### If your admin sent a developer config document

The four values map straight across, and the server accepts either set of names:

| In the document | Netlify setting |
| --- | --- |
| Directory (Tenant) ID | `MS_TENANT_ID` or `AZURE_TENANT_ID` |
| Application (Client) ID | `MS_CLIENT_ID` or `AZURE_CLIENT_ID` |
| Client secret value | `MS_CLIENT_SECRET` or `AZURE_CLIENT_SECRET`, marked as a secret value |
| Sender mailbox | `MS_SENDER` or `MAIL_FROM` |

Only send-only access (`Mail.Send`) is needed. Do not add `Mail.Read` or `Mail.ReadWrite`. Never put the secret in the repository, in chat or in email. If it has been pasted anywhere else, create a new secret in Entra, update the Netlify setting, then delete the old one.

### The other endpoints the app uses

Four more addresses are kept from the earlier Vercel version and now run on Netlify through `netlify/lib/adapter.mjs`, with their original code in `netlify/lib/legacy/`:

| Address | What it does |
| --- | --- |
| `/api/send-mail` | Send to SPOC, sent through Resend |
| `/api/claude-action` | Claude decides whether to send or skip a send or follow-up |
| `/api/confirm-hop` | The one-tap "I've forwarded this" confirmation link |
| `/api/follow-up-cron` | The nudge job, called from the app with the partner list |

They need these Netlify settings: `RESEND_API_KEY`, `EMAIL_FROM`, `ANTHROPIC_API_KEY`, and optionally `NUDGE_AUTOMATION_ENABLED` and `NUDGE_DRY_RUN`. Mark the keys as secret values.

## Step 2: Choose the mailbox and recipients

- Sender: a shared or service mailbox such as marketing@yourcompany.com. This becomes `MS_SENDER`.
- Recipients: the people who get the digest. This becomes `DIGEST_TO`, comma separated.

## Step 3: Put the project on GitHub

Create a new private GitHub repository and upload this whole folder (the `.gitignore` keeps secrets out).

## Step 4: Create the Netlify site

1. Sign in at https://app.netlify.com, Add new site, Import an existing project, choose GitHub and your repository.
2. Leave the build settings as they are. Netlify reads `netlify.toml` and picks them up.
3. Before deploying, open Site configuration, Environment variables, and add every value from `.env.example`: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_SENDER`, `DIGEST_TO`, `CRON_SECRET`, `APP_URL`, `DIGEST_TZ`. Mark the secret ones as secret values. For `CRON_SECRET` use any long random string.
4. Deploy the site.

## Step 5: Sync the first snapshot

Open your Netlify address in the browser, click around the app for a few seconds (open a phase, tick something), and give it a moment. That sends the first snapshot.

## Step 6: Test

Preview without sending (replace the address and secret):

```
curl -H "Authorization: Bearer YOUR_CRON_SECRET" "https://YOUR-SITE.netlify.app/api/digest?dry=1"
```

You should see JSON with a subject line and the digest text. Then send a real one, the same call without `?dry=1`, and check the inbox of everyone in `DIGEST_TO`.

## Step 7: Confirm the schedule

In Netlify open Functions, and check that `digest-daily` shows a schedule. Scheduled functions only run on the published production deploy. The result of each daily run appears in that function's logs.

## Known limits

- `/api/snapshot` has no login, so anyone who finds the address could overwrite the snapshot. Recipients are fixed in server settings, so they cannot redirect the emails, but they could skew what the digest says. A real database with logins removes this.
- The digest says what is missing but not who owns it, because the app does not store an owner per check yet.
- The rules exist twice (in the app and in `netlify/lib/readiness.js`). If you change one, change the other.
- The Microsoft client secret expires. When it does, sending fails until you create a new secret and update `MS_CLIENT_SECRET`.
- To test with Resend instead of Outlook, set `MAIL_PROVIDER=resend` plus the Resend values in `.env.example`.
