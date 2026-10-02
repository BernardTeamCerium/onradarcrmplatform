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

## Engine

The **Engine** tab shows outreach running: a live "today so far" strip (texts, emails and calls sent today, and conversations active in the last 24 hours) that refreshes every 30 seconds. It also has totals for the chosen dates (texts, emails and calls sent, replies, call answer rate, total conversations, appointments set from conversations), a daily outreach chart, and a per-source table of outreach, conversations, appointments set and booked rate (appointments ÷ conversations). With the CRM connected it reads the CRM message log, which needs the `conversations/message.readonly` scope.

## Calendar

The **Calendar** tab shows appointments by agent. At the top is today's preview: appointments today, projected assets today, what's still to come and who's next, split by agent. Below it is a week view with each day's count and projected assets, and an agent filter. Clicking a day lists each appointment's time, prospect, age, assets, city and state, source and status, with a **View bio** link. The bio is a printable prospect brief (print or save as PDF) with every quiz answer, and each appointment also has a **Word** download: a full prospect brief (.docx) covering the meeting type (new money, policy review, annuity review, 401(k) rollover, retirement income plan, or beneficiary and estate review), household and finances, new money in motion, existing policies to review, goals, notes for the agent, quiz responses and a prep checklist.

- **Assets** are estimated from the quiz's savings answer. In sample mode the household, policy and new-money details are fictional. With the CRM connected, the meeting type is read from the appointment title (e.g. "Policy review - Jane Doe").
- **Where appointments come from:** sample data (switch it off in settings), the CRM when connected, appointments **booked from the Leads tab** (Book appointment on any lead: date, time, agent, meeting type), and each agent's **Google Calendar**. For Google, paste the calendar's "Secret address in iCal format" into the agent's row in settings. It's read-only and refreshes every 5 minutes. Google events are matched to a lead by the lead's email, phone or full name in the event, which brings in the quiz bio. Booked appointments have Showed / No-show / Cancelled buttons on their bio page, and these update the lead's status.
- **Agents and the calendar time zone** are set in Admin → client → **Settings → Agents & calendar**. Sibley's two extra agents are fictional placeholders.
- **With the CRM connected**, appointments come from the CRM calendars grouped by assigned user (needs `users.readonly`). Quiz details are linked when the prospect's email or phone matches a Typeform lead.

## Marketing

*(Marketing and Geo are admin-only; client logins don't see them.)* The **Marketing** tab breaks each date range down by source (TV, Radio, Facebook, TikTok, YouTube and Lead Seller #1 by default). For each source it shows marketing spend, leads, cost per lead, conversations, contact rate (conversations ÷ leads), appointments set, connected appointments, connected rate, cost per connected appointment, applications and sales conversion. It also highlights the best source on each measure and has a chart that ranks the sources by whichever measure you pick. The rows add up to the Dashboard totals.

- **Sources:** Admin → client → **Settings → Marketing sources**. Keywords match the lead source recorded in the CRM.
- **Spend by source:** choose the source when adding marketing spend. Spend without a source shows as "Unassigned spend".
- **With live CRM data:** leads are attributed by the contact's source. Appointments, applications and sales follow their lead, and anything unmatched shows as "Other / unknown".
- **With sample data:** each source has a realistic profile.

## Geo

The **Geo** tab shows the same measures as Marketing by **state** or **city**. Each row shows the **best source** in that place. You choose what "best" means (lowest cost per connected appointment, lowest cost per lead, best sales conversion, fastest to application, or most leads). A source needs enough volume there to qualify. Click a place to see every source's numbers in it. The tab opens on Year to date because places need volume to compare fairly.

- **With live CRM data:** places come from each lead's city and state. Appointments, applications and sales follow their lead, and leads without a place are grouped as "Unknown".
- **Spend:** it isn't recorded by place, so each source's spend is shared across places in proportion to the leads it produced there.
- **With sample data:** it uses fictional distributions around Sibley's Louisiana and Mississippi Gulf Coast market.

## Production

The **Production** tab is where Sibley's team (any client login) and admins record production:

- **Log a case:** date submitted, client, agent, product, carrier, premium, status and lead source. Change the status from Submitted to Paid, Chargeback or Declined in the list; it saves immediately and stamps the paid or chargeback date.
- **Case status emails:** IMO or carrier status emails (e.g. Allied Elite Financial's "Status Update- Transfer *Funds En Route* TB00071984: …") are read for the case number, carrier, product, advisor, client, premium, the status in the subject, and the message itself.
  - The first email for a case number adds the case. Later emails update it, and each case keeps a history of its email updates.
  - "Issued", "Paid" or "Placed" marks a case paid. "Declined", "Withdrawn" or "Not taken" marks it declined. A cancellation after payment is a chargeback.
  - An older email never moves a case backwards, and the same email is never applied twice.
  - The advisor is matched to an agent by name, so "Christopher Troy Sibley" counts for Troy Sibley.
  - Emails arrive automatically through a Gmail label (**Settings → Production emails**, label `OnRadar Production`, script and filter provided), or anyone can paste one on the Production tab. Services like Zapier or Postmark can POST to `/api/production/<clientId>/email?key=…`.
- **Historical numbers:** enter totals per agent for a month or a whole year (submitted, paid, chargebacks, number of cases), or import a CSV of past cases or totals. Download the templates from the tab; Excel and Google Sheets both save CSV. Importing the same totals again updates them, and identical cases aren't added twice. Rows that can't be read are listed by row number.
- **Totals:** by year, all time and by agent. There's also a CSV export of everything.

Everything logged here feeds the rest of the platform. **Trends** uses it for submitted, paid and chargebacks in any year that has production (targets and appointment counts still come from settings), and shows the last three years. The **Dashboard**'s submitted premium comes from it too, with month and year totals spread evenly across their days. Sibley starts with their reported 2024, 2025 and 2026 year-to-date totals, split across agents for illustration. Use **Remove sample entries** before importing real history.

## Pipeline: pending business

The top of the **Pipeline** tab is a board of every submitted case that isn't paid yet, by stage:

> Submitted → In Review → Suit Req → Final Review → AOF → Needs Attention → Transfer Out → Transfer Out NIGO → Awaiting Transfer → Funds En Route

Admins can edit the stage list in **Settings → Pipeline stages**.

- **Totals:** pending premium, money in transfer, stuck cases (14+ days in one stage, flagged on the card), average days pending, and premium issued or paid in the last 30 days.
- **Moving cases:** IMO status emails place and move cases automatically, by stage name or common wording (e.g. "check mailed" → Funds En Route). The team can also drag a card to another column or use its menu. Moves are recorded in the case's update history.
- **Leaving the board:** an "Issued" or "Paid" email (or setting the status on the Production tab) takes the case off the board and counts it as paid.

The cases are the same ones as on the Production tab, so nothing is entered twice.

## Pipeline: previous prospects (Monday.com)

The **Pipeline** tab brings in the client's Monday.com deals board, the board behind Monday's Sales Pipeline dashboards. It covers every past and current prospect:

- Open pipeline, won (paid) value and count, average won deal, win rate, and average days to close.
- Deals by stage, by value or count, in the board's own stage order. Bars are coloured open / won / lost.
- Won value by month, and results by rep. A deal with two reps counts for both, with its value split between them.
- A rep filter.
- A searchable prospect list that links back to each item in Monday.com.

**To connect:** go to Admin → client → **Settings → Monday.com pipeline** and enter:

- an API token (Monday avatar → Developers → My access tokens)
- the board link

Columns are matched from their names (Stage, Deal Value, Actual Deal Value, Owner, Close Date) and can be changed. "Paid" counts as won, and "Cancelled" and "No Show" count as lost; tick other stages as needed. Every other stage is open pipeline.

The connection is read-only. The board refreshes every 30 minutes when the tab is opened, and anyone can click **Refresh from Monday**. Boards of up to 20,000 items are read 500 at a time.

Set `MONDAY_API_URL` only to point at a test server.

## Trends

The **Trends** tab shows the last three years (or however many are entered) of **submitted, paid and chargebacks**. Each year shows its growth rate, its target and how far off target it is. For the current year it uses year-to-date numbers, compares growth on the full-year pace, and spells out **what it takes to hit the targets**: dollars needed per month versus the current pace, and the same gap in connected appointments and appointments set. It also covers appointments per year: appointments set, connected appointments, connected rate and paid production per connect.

Enter and edit the numbers under Admin → client → **Settings → Yearly results & targets**. Sibley's submitted, paid and chargebacks are their reported figures. Their yearly appointment counts and all targets are placeholders to confirm.

The main dashboard also shows **Appointments set**, **Connected rate** (connected ÷ appointments set) and **Avg. cycle time to application** (days from a lead coming in to their application). Both also appear per source on the Marketing tab.

## Leads and the Typeform quiz

Each client has a **Leads** tab listing every quiz lead: name, phone, email, when they came in, their status (New, Contacted, Appointment set, Appointment held, No show, Application submitted, Sold, Not interested, Bad contact info) and **every quiz answer**. The page checks for new leads every 4 seconds. A new lead slides in with a pop-up, with no page refresh needed. Clients and admins can both update a lead's status.

To connect a Typeform quiz (the site must be live, e.g. on Netlify):

1. Admin → client → **Settings → Typeform quiz** shows the client's webhook URL and secret.
2. In Typeform: open the quiz → **Connect → Webhooks → Add a webhook**, paste the URL, then **Edit** the webhook and paste the secret. Turn it on.
3. Click **View deliveries → Send test request** in Typeform. The lead appears on the Leads page.

Everything Typeform sends is kept: every answer, including questions inside groups and contact or address blocks, with personalized titles filled in. Hidden fields (UTM tags, ad IDs), the quiz score, variables and time to complete are kept too. City and state are read from address answers. A `?utm_source=facebook` (or tv, radio, tiktok, youtube…) on the quiz link credits the lead to that marketing source.

**Past responses:** under Settings → Typeform quiz → **Import past responses**, enter a Typeform personal access token (Forms: read, Responses: read) and the form ID or quiz link. Every completed response is imported through the same reader; responses already on the Leads tab are skipped, so it can be re-run any time.

Submissions without a valid Typeform signature are rejected, and repeat deliveries of the same response are ignored. Name, email and phone are taken from the quiz's name, email and phone questions automatically.

Admins also have a **Send test lead** button on the Leads page that runs a realistic sample submission through the same parser. Use it to show a live lead arriving during a demo, and delete test leads afterwards. Sibley Financial Group starts with 14 fictional sample leads.

## Email leads (Gmail) and other lead feeds

Lead notification emails can flow into the Leads tab automatically. Admin → client → **Settings → Email leads (Gmail)** has:

- **A ready-made Google Apps Script** with the client's address and key filled in. Paste it into script.google.com in the Gmail account that receives lead emails and run `setup` once. Then label lead emails **OnRadar Leads**, by hand or with a Gmail filter. Every 5 minutes the script sends labelled emails to the dashboard and moves them to **OnRadar Leads/Imported**.
- **The email reader** picks out name, email, phone, city, state, ZIP and source from "Label: value" lines and HTML tables, ignores forwarded-message headers, keeps every other field as an answer, and skips emails it has already received. The source comes from a "Source"/"Lead source" line, otherwise from the sender or subject matched against the client's marketing sources.
- **A general lead webhook** (`/api/leads/<clientId>/inbound?key=…`) for Zapier, Make or lead vendors. It takes fields like first_name, last_name, email, phone, city, state and source, and `&source=Facebook` sets the source.
- **A "paste a lead email" box** for one-off imports.

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

While a client is in demo, the dashboard shows realistic **sample data**, clearly badged as such. Once a client is live (see **Going live** below) sample data is never shown: if the CRM can't be reached, the dashboard shows a warning and counts from the Leads tab instead.

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

## Going live

Open the client's **Settings → Go live**, type `GO LIVE` and confirm. In one step this:

- turns off sample dashboard numbers and sample calendar appointments
- deletes the sample and test leads (and any bookings made for them)
- deletes the sample production entries, the monthly figure overrides and the sample agents

The yearly results, marketing spend, logged production, real leads and all settings are kept. The section lists exactly what's still in place before you confirm.

A live client with the CRM connected gets its numbers from the CRM. Without the CRM, the dashboard counts leads from the Leads tab (Typeform, Gmail and webhook leads) and moves them through the funnel by status. Spend comes from what you enter and premium from the Production tab. Texts, emails and calls start counting once the CRM is connected.

Before sharing the site, also set `SHOW_DEMO_LOGINS=false` and change the starting passwords in **Admin → Users**.

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
