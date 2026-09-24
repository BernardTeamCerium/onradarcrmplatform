# OnRadar CRM: client performance dashboard

A branded, login-protected dashboard that pulls each client's numbers from **GoHighLevel** and shows them the metrics that matter:

| Metric | Where it comes from |
|---|---|
| **Ad spend** | Entered monthly by an OnRadar admin (Client settings → Ad spend) and spread evenly across the month's days |
| **Leads** | GoHighLevel contacts created in the period (`POST /contacts/search`) |
| **Conversations** | GoHighLevel conversations started in the period (`GET /conversations/search`) |
| **Appointments** | Events on every calendar in the sub-account, excluding cancelled, no-show and invalid (`GET /calendars/events`) |
| **Cost per lead** | Spend ÷ Leads |
| **Cost per appointment** | Spend ÷ Appointments |
| **Applications submitted** | Opportunities that reached the "application" pipeline stage or later, or were won. The stage is matched by keyword and can be set per client |
| **Sales conversion** | Won opportunities ÷ Leads |
| **Estimated revenue** | Sum of won opportunity values. When a won deal has no value, the client's *average revenue per sale* is used instead |
| **Estimated return** | (Revenue − Spend) ÷ Spend |

Every metric is compared with the previous period of the same length. Date ranges: last 7 / 30 / 90 days, month to date, last month and year to date.

## Two dashboards

- **Admin** (`/admin`): every client in one table with rolled-up totals. From there an admin can open any client's dashboard (exactly what the client sees), manage their logo and brand color, connect GoHighLevel, enter ad spend, and create client logins.
- **Client** (`/dashboard`): a client only ever sees their own company, branded with their logo.

**Sibley Financial Group** is already set up with its crest logo (from sfg.onradarcrm.com) and a client login.

## Run it locally

Requires Node 20+.

```bash
npm install
cp .env.example .env      # optional: change the seed passwords
npm run dev               # http://localhost:3000
```

Default logins, created the first time the app starts (change them in `.env` **before** first run, or reset the passwords later from the admin screens):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@onradarcrm.com` | `OnRadarAdmin!2026` |
| Sibley client | `demo@sibleyfinancialgroup.com` | `SibleyDemo!2026` |

The login page lists the demo emails. Set `SHOW_DEMO_LOGINS=false` to hide them.

## Connect a client to GoHighLevel

1. In the client's GoHighLevel **sub-account**, go to **Settings → Private Integrations → Create new integration**.
2. Grant these read scopes: `contacts.readonly`, `conversations.readonly`, `opportunities.readonly`, `calendars.readonly`, `calendars/events.readonly`, `locations.readonly`.
3. Copy the token (it starts with `pit-`) and the **Location ID** (Settings → Business Profile).
4. In OnRadar, go to **Admin → client → Settings → GoHighLevel connection**, paste both, untick **Show sample data**, save, then click **Test connection**.
5. Check **Application stage keywords** against the client's pipeline stage names. The default keywords are `application, submitted`.

Until a client is connected, the dashboard shows realistic **sample data**, clearly badged as such, so you can demo the product before the integration is live. If GoHighLevel can't be reached, the dashboard shows a warning and falls back to sample data instead of breaking.

Results are cached for 5 minutes per client and date range. Saving a client's settings clears the cache.

## Deploying to Netlify (recommended)

The repo includes `netlify.toml`. On Netlify, logins, settings and logos are stored in **Netlify Blobs** automatically, and the session secret is generated on first run. There's nothing to configure.

1. In Netlify, choose **Add new project → Import an existing project → GitHub**, then pick this repo and the branch to deploy.
2. Keep the detected settings (build command `npm run build`) and click **Deploy**.
3. To use your own domain, go to **Domain management → Add a domain** and enter something like `dashboard.onradarcrm.com`. If onradarcrm.com's DNS is managed by Netlify, it connects automatically. Otherwise, add the CNAME record Netlify shows at your DNS provider. HTTPS is issued automatically.
4. Sign in with the admin login and change both passwords (Admin → Users, and the Sibley settings page).

Optional environment variables (Site configuration → Environment variables): `AUTH_SECRET` to pin the session secret, and `SHOW_DEMO_LOGINS=false` to hide the demo emails on the login page.

### Other hosts

Anywhere else, data is saved on disk under `DATA_DIR` (default `./data`), so use a host with a persistent disk. Then run `npm run build && npm start`.

## Project layout

```
src/lib/ghl.ts          GoHighLevel API v2 client (Private Integration token auth)
src/lib/metrics.ts      Metric calculations, live + sample data, caching
src/lib/store.ts        Data store (Netlify Blobs or local disk) + first-run seed (admin, Sibley client, Sibley login)
src/lib/session.ts      Signed session cookie (JWT, 12h)
src/app/dashboard       Client dashboard
src/app/admin           Admin: client list, client dashboard, client settings, users
src/components          KPI tiles, trend chart, funnel, branding
```

## Roadmap ideas

- Pull ad spend automatically from GoHighLevel's Ad Manager reporting (`/ad-publishing/facebook/reporting`) or straight from Meta and Google Ads, so nobody has to type it in.
- Use GoHighLevel webhooks (ContactCreate, AppointmentCreate, OpportunityStatusUpdate) for real-time numbers.
- Move storage to Postgres, and encrypt API tokens at rest.
