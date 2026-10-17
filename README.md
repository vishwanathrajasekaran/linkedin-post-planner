# Post Planner

A small, self-hosted tool for planning, scheduling and publishing LinkedIn posts to **your own personal profile**. It is built for people who run a long content series (a 30-day or 100-day run, a weekly technical post) and want one place that answers: what is published, what is scheduled, what is still a draft, and what did I miss.

- **Planner:** write posts, group them into series, see today's posts and anything late or failed.
- **Editor:** bold, italic, underline, strikethrough, monospace, bullets, numbering and indent, with a LinkedIn-style preview (desktop and mobile).
- **Calendar:** a month view of everything scheduled and published.
- **Scheduling:** pick a date and time (IST) and the post goes out automatically, within about 15 minutes.
- **Images:** attach a picture by pasting a Google Drive link.
- **Look:** Liquid Glass design with day and night modes.

It runs on free tiers: Google Sheets and Apps Script for the data and the scheduler, Vercel for the website.

---

## How it works

```
Browser  ──►  Vercel site (static page + 3 small functions)  ──►  Google Apps Script web app  ──►  LinkedIn API
                 │  password login, holds the API key                │  Google Sheet = your posts
                 │                                                   │  time trigger every 15 minutes publishes due posts
                 └─ API key and Apps Script URL live only here       └─ LinkedIn token and secret live only here
```

- The **Google Sheet** stores your posts.
- **Apps Script** is the backend: it talks to LinkedIn, keeps your LinkedIn sign-in token, and runs a timer that publishes posts that are due.
- The **Vercel site** is the interface. It asks for a password, and it adds the secret API key when it talks to Apps Script, so the key never reaches the browser.

### Things to know up front

- LinkedIn has **no scheduling API**. This tool holds your post and sends it at the right time itself, so a post goes out within about 15 minutes after its scheduled time, not at the exact minute.
- LinkedIn sign-in tokens for personal apps last **60 days** and cannot be renewed in the background. You click **Connect LinkedIn** again roughly every two months. The app warns you a week before. If the sign-in expires, scheduled posts wait instead of failing, and go out once you reconnect.
- It posts to a **personal profile only**. Company Pages need a different, reviewed LinkedIn product that this project does not use.
- Text styling uses special Unicode characters, because LinkedIn has no rich text. It looks right in the feed, but it is not searchable and screen readers may read it oddly. Use it sparingly.

---

## What you need

- A Google account (Sheets, Apps Script, Drive)
- A LinkedIn account, and a **LinkedIn Page** you own (see step 1; it can be an empty Page)
- A free Vercel account
- A GitHub account (to deploy from a repository)
- Node.js 18 or newer, only if you want to run it locally

---

## Setup, step by step

### Step 1: Create a LinkedIn Page

LinkedIn requires every developer app to be linked to a Page. You still post as yourself, to your own feed. The Page stays empty and never posts anything.

1. On LinkedIn open **For Business > Create a Company Page** and choose **Company**.
2. Use any sensible name (for example your own name or brand), add a website, an industry and a size of 0-1 employees. You do not need to fill in or publish anything else.
3. A new Page can take from a few hours to a few days to appear in the app creation form.

### Step 2: Create the LinkedIn developer app

1. Go to <https://www.linkedin.com/developers/apps> and click **Create app**.
2. Enter an app name, choose your Page, upload a logo, accept the terms and click **Create app**.
3. Open the **Settings** tab and click **Verify**. Open the verification link while signed in as the Page admin.
4. Open the **Products** tab and request both of these:
   - **Share on LinkedIn** (gives the `w_member_social` scope, which allows posting)
   - **Sign In with LinkedIn using OpenID Connect** (gives `openid` and `profile`, used to find your member ID and name)
5. Open the **Auth** tab. Keep this page open: you will copy the **Client ID** and **Primary Client Secret** in step 4, and add the redirect URL in step 5.

> If you later see `invalid_scope_error`, one of the two products is not added yet.

### Step 3: Create the Google Sheet and the backend

1. Create a new Google Sheet (any name).
2. Open **Extensions > Apps Script**.
3. Delete the starter code, paste the contents of [`Code.gs`](./Code.gs) and save.
4. In the function dropdown choose **`setup`** and click **Run**. Approve the permission prompts (Sheets, Drive, external requests, triggers). This creates the **Posts** tab, saves the Sheet ID and creates the 15-minute timer.

### Step 4: Add the script properties (secrets)

In Apps Script open **Project Settings** (gear icon) > **Script properties** and add:

| Property | Value |
|---|---|
| `CLIENT_ID` | Client ID from the LinkedIn Auth tab |
| `CLIENT_SECRET` | Primary Client Secret from the LinkedIn Auth tab |
| `API_KEY` | A long random string you make up (generate one: `openssl rand -hex 32`) |

`SHEET_ID` is added by `setup()`. You do not need to add anything else.

### Step 5: Deploy the backend and register the redirect URL

1. In Apps Script click **Deploy > New deployment**, choose type **Web app**, set:
   - **Execute as:** Me
   - **Who has access:** Anyone
2. Click **Deploy** and copy the **Web app URL**. It looks like `https://script.google.com/macros/s/.../exec`.
3. Back on the LinkedIn app's **Auth** tab, under **Authorized redirect URLs for your app**, add that exact `/exec` URL and save. It must match character for character, with no trailing space or slash.

"Anyone" is safe here because every request without the correct `API_KEY` is rejected with `unauthorized`.

To test the backend, open the `/exec` URL in a browser. You should see a plain "Post Planner backend" page, not a Google sign-in page. If you see a Google sign-in, the access setting is not "Anyone".

### Step 6: Put the project on GitHub

1. Put the contents of this folder at the root of a new repository (the folder with `index.html` and `api/` must be the project root).
2. The included `.gitignore` keeps `.env` files out of the repository. Never commit real secrets.

### Step 7: Deploy the site on Vercel

1. In Vercel choose **Add New > Project** and import the repository.
2. Set **Framework Preset** to **Other**. Leave the build command empty. If the project is in a subfolder, set **Root Directory** to the folder that contains `index.html` and `api/`.
3. Under **Environment Variables** add the four values below (for Production, and for Preview if you want preview deployments to work):

   | Name | Value |
   |---|---|
   | `APPS_SCRIPT_URL` | The Apps Script `/exec` URL from step 5 |
   | `API_KEY` | The same value as the `API_KEY` script property |
   | `APP_PASSWORD` | The password you will type to open the site |
   | `SESSION_SECRET` | A long random string for signing the login cookie (`openssl rand -hex 32`) |

4. Click **Deploy**.
5. Environment variables only apply to **new** deployments. If you add or change one later, redeploy from the Deployments page.

### Step 8: Connect LinkedIn and test

1. Open your Vercel URL and sign in with `APP_PASSWORD`.
2. If the top right says **Connect LinkedIn**, click it. LinkedIn opens in a **new tab**. Approve the request. The tab shows "LinkedIn connected", and the main page updates itself. The top right then shows how many days are left on the sign-in.
3. Click **New post**, write one harmless line, and choose **Publish now**. Confirm it appears on your profile, then delete it from LinkedIn.
4. Create another post, set **Publish at** about 20 minutes ahead and click **Schedule**. Check that it goes out, and that its chip changes to **published** after a refresh.

---

## Daily use

- **Today** (Planner tab) shows posts due today, anything late or failed, and the next post that still needs a date.
- **New post** starts a blank post. The series and day number carry on from your last post.
- **Series** on the left lists each series with a progress bar.
- **Save draft**, **Mark ready**, **Schedule** and **Publish now** each show a confirmation when they finish.
- A published post becomes read-only. You can **Duplicate as draft** or open it on LinkedIn.
- **Delete** removes a post from the planner only. A post already on LinkedIn stays there.
- The **Calendar** tab shows the month. Click a day to see its posts or to start one on that day.

### Text formatting

Select text, then use the toolbar or the shortcuts: **Cmd/Ctrl+B** bold, **Cmd/Ctrl+I** italic, **Cmd/Ctrl+U** underline. Bullets, numbering, indent and outdent apply to the lines you selected. **Clear** removes the styles.

Indentation uses wide space characters. LinkedIn may trim or keep them, so check with a test post.

### Images

Paste the **Share link** of an image in your Google Drive (JPG, PNG or GIF, keep it under about 5 MB). The backend reads the file as you, so it does not need to be public. The preview in the page may not show the picture unless the file is shared by link, but the published post still includes it.

### Times

Everything is in **IST** (Asia/Kolkata), whatever your browser's time zone. In the Sheet, times are stored as text in the form `2026-10-09 09:45`.

---

## Keeping it running

| Task | How often | What to do |
|---|---|---|
| Reconnect LinkedIn | About every 60 days (the app warns at 7 days) | Click **Connect LinkedIn** and approve |
| Update the backend code | When `Code.gs` changes | Paste it into Apps Script, then **Deploy > Manage deployments > pencil icon > Version: New version > Deploy**. The URL stays the same |
| Change a Vercel variable | Rarely | Edit it, then **Redeploy** |
| Rotate secrets | If one is ever exposed | New LinkedIn secret (Auth tab) into `CLIENT_SECRET`; new API key into **both** the script property and the Vercel variable |

---

## Insights (impressions, reactions, comments, reposts)

The **Insights** tab shows impressions, reactions, comments, reposts and an engagement rate for your published posts, with a chart and a sortable table. Numbers are stored in a **Stats** tab of the same Google Sheet, one row per snapshot, so you also keep the history.

**Setup (2 minutes)**

1. In Apps Script, add a second file (File +, Script) named `Insights` and paste `Insights.gs` into it.
2. Paste the updated `Code.gs` over the old one. Only two lines changed: the `statsRoute_` hook inside `route_` and the optional `EXTRA_SCOPES` property in `authUrl_`.
3. Deploy > Manage deployments > pencil icon > Version: New version > Deploy.
4. Push the updated site files (`index.html`, `insights.js`, `insights.css`, `api/proxy.js`) to GitHub. Vercel redeploys on its own.

**Two ways to fill it**

- **By hand (works today).** Open a post on LinkedIn, copy the numbers, and click **Update** on its row in Insights.
- **Automatically.** LinkedIn's Member Post Analytics API can return these numbers, but it needs the `r_member_postAnalytics` permission, which LinkedIn approves per app and does not grant by default. If it is approved for your app: set the script property `EXTRA_SCOPES` to `r_member_postAnalytics`, click the LinkedIn pill to reconnect, then click **Sync from LinkedIn**. To sync every night, run `enableStatsSync()` once from the Apps Script editor (re-run it if you ever re-run `setup()`, which clears all triggers). If LinkedIn requires a separate app for analytics, put that app's token in the script property `STATS_ACCESS_TOKEN` and the sync will use it.

Sync re-reads a post at most every 6 hours and only for posts published in the last 60 days. If LinkedIn refuses, the page shows the reason and manual entry keeps working.

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| LinkedIn page: **redirect_uri does not match the registered value** | The `/exec` URL is missing from the LinkedIn app's Authorized redirect URLs, or differs by even one character. Add it exactly, save, and try again. Also check you are using the Client ID of the same app |
| After approving: **invalid_scope_error** | A product is missing. Add both **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect** on the Products tab |
| Page says **Load failed**, **Unexpected reply** or **Apps Script did not return data** | The web app is not deployed with access **Anyone**, the URL in `APPS_SCRIPT_URL` is wrong (it must end in `/exec`), or the deployment is out of date. Open the `/exec` URL in a browser to check |
| **The server is missing APPS_SCRIPT_URL or API_KEY** | A Vercel variable is missing or you have not redeployed since adding it |
| **unauthorized** | `API_KEY` in Vercel and in Apps Script script properties do not match exactly |
| **Wrong password** | `APP_PASSWORD` in Vercel is different from what you typed. Redeploy after changing it |
| **SESSION_SECRET is not set** | Add it (16 or more characters) and redeploy |
| Scheduled post did not go out | In Apps Script open **Triggers** and check that `publishDue` exists (run `setup()` again if not). Open **Executions** to see errors. Check the top right still shows days left, because an expired sign-in holds posts. Allow up to 15 minutes |
| A post shows **failed** | The reason is shown in the editor. Common ones: the image link is not a Drive file or is not a JPG/PNG/GIF, the file is too large, or the post is over 3,000 characters |
| Scheduling button does nothing | You are on a published (read-only) post. Click **New post** |

---

## Running locally

1. Copy `.env.example` to `.env.local` and fill in the four values.
2. Run `npx vercel dev` in this folder and open the address it prints.

The Apps Script and LinkedIn parts still run in Google's cloud, so you need steps 1 to 5 done first.

---

## Project structure

```
index.html        the page
styles.css        Liquid Glass styling, day and night
app.js            the app: planner, editor, calendar, picker, preview
insights.js       the Insights tab (stats, chart, manual entry, sync)
insights.css      styling for the Insights tab
lib.js            IST time helpers, text styling, Drive link parsing (no dependencies)
api/login.js      checks APP_PASSWORD and sets the login cookie
api/logout.js     clears the cookie
api/proxy.js      forwards requests to Apps Script and adds the API key
api/_auth.js      cookie signing helpers
Insights.gs       Apps Script file for stats (add it next to Code.gs)
Code.gs           the Apps Script backend (paste it into Apps Script; it is not deployed to Vercel)
vercel.json       function settings
.env.example      the variables to set
```

### The Stats sheet

Columns: `postId`, `capturedAt`, `impressions`, `reach`, `reactions`, `comments`, `reshares`, `source` (`api` or `manual`). Created automatically on first use. Newest row per post wins.

### The Posts sheet

Columns: `id`, `series`, `day`, `title`, `body`, `imageDriveId`, `status`, `scheduledAt`, `publishedAt`, `linkedinUrn`, `error`. Status is one of `draft`, `ready`, `scheduled`, `published` or `failed`. You can edit the Sheet by hand, but keep the header row and the date format.

---

## Security notes

- The site is protected by a password and a signed, HttpOnly cookie (30 days). Nothing is shown until you sign in.
- The API key and the Apps Script URL exist only in Vercel's environment variables. The browser never receives them.
- The LinkedIn Client Secret and your LinkedIn token exist only in Apps Script's script properties.
- Anyone with the Apps Script URL can reach it, but without the `API_KEY` every request is rejected.
- Do not commit `.env` files, and do not paste secrets into issues or screenshots.

---

## Limits

- Personal profile only, no Company Pages.
- No exact-minute scheduling: the timer runs every 15 minutes.
- No automatic token renewal: reconnect about every 60 days.
- Text, a single image and hashtags only. No multi-image posts, polls, documents, articles or video.
- You cannot read your published posts' stats back from LinkedIn with this setup.
- Apps Script has daily quotas on URL fetches and trigger runtime. A personal posting schedule is far below them.

## License

Released under the [MIT License](./LICENSE).

## Author

**Vishwanath Rajasekaran** | SDET | Automation Engineer

[GitHub](https://github.com/vishwanathrajasekaran) | [LinkedIn](https://www.linkedin.com/in/vishwanathrajasekaran/)

Not affiliated with or endorsed by LinkedIn. LinkedIn is a trademark of LinkedIn Corporation.
