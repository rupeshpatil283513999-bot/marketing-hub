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

## Canva design (describe a design in Studio, Claude makes it in Canva)

In Studio, open the Canva tab, then Design with a prompt. The browser sends the description to `/.netlify/functions/canva-design-background`. That function asks Claude to design it with the Canva connector, exports a PNG, and keeps it in Netlify Blobs. The Studio checks `/api/canva-design-status` every few seconds and shows the picture when it is ready.

Files: `netlify/functions/canva-design-background.mjs`, `canva-design-status.mjs`, `canva-auth-start.mjs`, `canva-auth-callback.mjs`, `canva-auth-status.mjs` and `netlify/lib/canva-auth.mjs`. No new packages are needed (`@netlify/blobs` is already used).

### Settings (Netlify, Site configuration, Environment variables, mark as secret)

| Setting | What it is |
| --- | --- |
| `ANTHROPIC_API_KEY` | Your Anthropic API key. Already listed above for the nudge job. |
| `DESIGN_ACCESS_CODE` | Any long random string. People type it once per browser session in Studio. Without it the service refuses every request, so nobody outside the team can spend your credits. |
| `DESIGN_DAILY_LIMIT` | Optional. Designs allowed per day. Default 30. |
| `DESIGN_FOLDER_ID` | Optional. Canva folder id that new designs are filed into. The Valura Templates folder is `FAHXCuuZDbg`. |
| `CANVA_MCP_URL` | Optional. Defaults to `https://mcp.canva.com/mcp`. |
| `DESIGN_MODEL` | Optional. Defaults to `claude-sonnet-4-5`. |
| `CANVA_MCP_TOKEN` | Optional fallback only. Normally leave it out; the one-time sign-in below stores and renews the token for you. |

### One-time Canva sign-in (an admin does this once)

1. Set `ANTHROPIC_API_KEY` and `DESIGN_ACCESS_CODE` in Netlify, then deploy.
2. Open `https://<your-site>/api/canva-auth-start`, type the design access code, and press Continue to Canva.
3. Sign in on Canva's own page and approve. Canva sends you back to a page that says "Canva is connected".

The token and its renewal token are kept in Netlify Blobs and renewed automatically. Studio's Canva tab shows "Ready" when the key, the code and the Canva sign-in are all in place, and lists what is missing otherwise. Repeat step 2 only if the sign-in is revoked or expires.

### What is safe, and what is not finished

- Claude can only use seven Canva tools here: create a design, check the job, list export formats, export, read, file into a folder, and find folders. It cannot edit or delete existing designs.
- The access code, API key and Canva token never reach the browser. Studio only learns yes or no for each setting.
- **The Canva sign-in is untested against real Canva.** The sign-in pages were tested with a mock. Canva's server may behave differently (registration, scopes, or whether it accepts the token through Anthropic's connector). If the first sign-in fails, the page says what Canva replied.
- **Not tested against the real services.** The functions were tested with mocked Anthropic and Canva responses. The first live run needs your keys and should be watched.
- Each design uses Anthropic API credits (billed to your Anthropic account) and one Canva AI generation.

### Until this is set up

Studio shows "Backend not set up". Everything else in the Canva tab works: Copy request for Claude gives a ready brief to paste into a Claude chat that has Canva connected, the Template library opens Canva's ready-made templates beside Studio, and Brand brief and import brings finished files back.

## Reach on Netlify: delivery tracking, WhatsApp and Instagram leads

Reach adds these addresses. They run on Netlify with no extra service (waiting items are kept in Netlify Blobs).

| Address | Who calls it | Protection |
| --- | --- | --- |
| `/api/resend-webhook` | Resend, when an email is delivered, opened, clicked, bounced or marked as spam | Signature checked with `RESEND_WEBHOOK_SECRET` |
| `/api/interakt-webhook` | Interakt, for WhatsApp sent, delivered, read, failed and replies | Signature checked with `INTERAKT_WEBHOOK_SECRET` |
| `/api/hub-events` | The hub, to read and clear waiting delivery updates | Hub access code |
| `/api/instagram-leads` | Interakt, ManyChat or Zapier send leads in. The hub reads and clears them. | Sending in needs `INBOUND_KEY`. Reading needs the hub access code. |
| `/api/send-whatsapp` | The hub, to send an approved Interakt template | Hub access code |

`/api/send-mail`, `/api/claude-action` and `/api/follow-up-cron` now need the hub access code too. The confirm link partners tap (`/api/confirm-hop`) stays open on purpose.

### Settings to add in Netlify (Site configuration, Environment variables, mark as secret)

`HUB_ACCESS_CODE`, `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`, `INTERAKT_API_KEY`, `INTERAKT_WEBHOOK_SECRET`, `INBOUND_KEY`, `ANTHROPIC_API_KEY`.

If `HUB_ACCESS_CODE` is missing, the protected routes answer "not set" and do nothing. The first time someone uses a protected route the hub asks for the code and keeps it for that browser tab.

### After the first deploy

1. Resend, Webhooks, Add endpoint: `https://YOUR-SITE.netlify.app/api/resend-webhook`. Tick sent, delivered, opened, clicked, bounced, complained and failed. Copy the signing secret into `RESEND_WEBHOOK_SECRET`.
2. Interakt, Developer settings, Webhooks: `https://YOUR-SITE.netlify.app/api/interakt-webhook` with your secret key. Choose message sent, delivered, read, failed and message received.
3. Redeploy after changing any setting.
4. In Reach, open the dashboard. The Delivery updates panel shows when it last checked.
