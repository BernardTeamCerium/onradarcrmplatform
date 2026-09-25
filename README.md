# OnRadar CRM: client performance dashboard

A branded, login-protected dashboard that pulls each client's numbers from **GoHighLevel** and shows them the metrics that matter:

| Metric | Where it comes from |
|---|---|
| **Marketing spend** | Entered monthly by an OnRadar admin (Client settings → Marketing spend) and spread evenly across the month's days |
| **Leads** | GoHighLevel contacts created in the period (`POST /contacts/search`) |
| **Conversations** | GoHighLevel conversations started in the period (`GET /conversations/search`) |
| **Connected appointments** | Events on every calendar in the sub-account, excluding cancelled, no-show and invalid (`GET /calendars/events`) |
| **Cost per lead** | Spend ÷ Leads |
| **Cost per appointment** | Spend ÷ Appointments |
| **Applications submitted** | Opportunities that reached the "application" pipeline stage or later, or were won. The stage is matched by keyword and can be set per client |
| **Sales conversion** | Won opportunities ÷ Leads |
| **Submitted premium** | Sum of opportunity values for applications submitted in the period. When an application has no value, the client's *average premium per application* is used instead. Credited to the client's agent (e.g. "Submitted by Troy Sibley") |
| **Estimated return** | (Premium − Spend) ÷ Spend |

**Monthly figures:** an admin can enter a month's connected appointments and submitted premium by hand (Client settings → Monthly figures). While a client shows sample data, the dashboard matches those numbers exactly for that month. Sibley Financial Group comes with September 2026 entered: 36 connected appointments and $5.6M submitted premium.

Every metric is compared with the previous period of the same length. Date ranges: last 7 / 30 / 90 days, month to date, last month and year to date.

## Two dashboards

- **Admin** (`/admin`): every client in one table with rolled-up totals. From there an admin can open any client's dashboard (exactly what the client sees), manage their logo and brand color, connect GoHighLevel, enter marketing spend, and create client logins.
- **Client** (`/dashboard`): a client only ever sees their own company, branded with their logo.

**Sibley Financial Group** is already set up with its crest logo (from sfg.onradarcrm.com) and a client login.

## Marketing

The **Marketing** tab breaks each date range down by source (TV, Radio, Facebook, TikTok, YouTube and Lead Seller #1 by default). For each source it shows marketing spend, leads, cost per lead, conversations, contact rate (conversations ÷ leads), appointments set, connected appointments, connected rate, cost per connected appointment, applications and sales conversion. It also highlights the best source on each measure and has a chart that ranks the sources by whichever measure you pick. The rows add up to the Dashboard totals.

- **Sources:** Admin → client → **Settings → Marketing sources**. Keywords match the lead source recorded in the CRM.
- **Spend by source:** choose the source when adding marketing spend. Spend without a source shows as "Unassigned spend".
- **With live CRM data:** leads are attributed by the contact's source. Appointments, applications and sales follow their lead, and anything unmatched shows as "Other / unknown".
- **With sample data:** each source has a realistic profile.

## Trends

The **Trends** tab shows the last three years (or however many are entered) of **submitted, paid and chargebacks**. Each year shows its growth rate, its target and how far off target it is. For the current year it uses year-to-date numbers, compares growth on the full-year pace, and spells out **what it takes to hit the targets**: dollars needed per month versus the current pace, and the same gap in connected appointments and appointments set. It also covers appointments per year: appointments set, connected appointments, connected rate and paid production per connect.

Enter and edit the numbers under Admin → client → **Settings → Yearly results & targets**. Sibley's submitted, paid and chargebacks are their reported figures. Their yearly appointment counts and all targets are placeholders to confirm.

The main dashboard also shows **Appointments set**, **Connected rate** (connected ÷ appointments set), **Connected appt %** (connected ÷ leads) and **Avg. cycle time to application** (days from a lead coming in to their application). The last two also appear per source on the Marketing tab.

## Leads and the Typeform quiz

Each client has a **Leads** tab listing every quiz lead: name, phone, email, when they came in, their status (New, Contacted, Appointment set, Appointment held, No show, Application submitted, Sold, Not interested, Bad contact info) and **every quiz answer**. The page checks for new leads every 4 seconds. A new lead slides in with a pop-up, with no page refresh needed. Clients and admins can both update a lead's status.

To connect a Typeform quiz (the site must be live, e.g. on Netlify):

1. Admin → client → **Settings → Typeform quiz** shows the client's webhook URL and secret.
2. In Typeform: open the quiz → **Connect → Webhooks → Add a webhook**, paste the URL, then **Edit** the webhook and paste the secret. Turn it on.
3. Click **View deliveries → Send test request** in Typeform. The lead appears on the Leads page.

Submissions without a valid Typeform signature are rejected, and repeat deliveries of the same response are ignored. Name, email and phone are taken from the quiz's name, email and phone questions automatically.

Admins also have a **Send test lead** button on the Leads page that runs a realistic sample submission through the same parser. Use it to show a live lead arriving during a demo, and delete test leads afterwards. Sibley Financial Group starts with 14 fictional sample leads.

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
