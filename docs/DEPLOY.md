# Going live: GitHub + Render, step by step

Time needed: about 15 minutes. You need a GitHub account and a Render account (free, sign in with GitHub).

## Part 1 - Put the code on GitHub

The repository is already initialised and committed locally (see the project root). Only the push needs your account.

1. Open a terminal in `D:\Claude Code\couchverse`.
2. Sign the GitHub CLI into your account (opens the browser once):
   ```bash
   gh auth login --web --git-protocol https
   ```
   Choose **GitHub.com**, **HTTPS**, **Login with a web browser**, and paste the one-time code shown.
3. Create the repository from the local folder and push in one go:
   ```bash
   gh repo create couchverse --public --source . --remote origin --push
   ```
   Use `--private` instead of `--public` if you prefer. The command prints the repo URL, e.g. `https://github.com/<you>/couchverse`.

   *Already have an empty repo on GitHub?* Skip step 3 and run:
   ```bash
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
4. Later changes: `git add -A && git commit -m "message" && git push`.

## Part 2 - Deploy on Render (free)

1. Go to https://dashboard.render.com and sign in with GitHub.
2. Click **New +** → **Blueprint**.
3. Connect the `couchverse` repository. Render reads `render.yaml` and shows one web service named **couchverse**.
4. Click **Apply**. The first build takes 3-5 minutes (installs, builds the client and extension, downloads the sample clip).
5. When it says **Live**, open the URL shown, e.g. `https://couchverse.onrender.com`. Sign in with a dev account (any email) and create a room.
6. Set the site origin so the packaged extension works on your domain:
   - Open the service → **Environment** → edit `SITE_ORIGIN` to your exact URL (`https://couchverse.onrender.com`) → **Save changes**. Render redeploys automatically.
7. Test with a friend: send them the room link. Each person needs their own account; the free plan handles a room of 10 comfortably.

Notes on the free plan:
- The service sleeps after 15 minutes without traffic and takes ~30 s to wake.
- The free plan has no persistent disk, so without a hosted database accounts, friends, preferences and rooms are cleared on every **deploy**. Do Part 2b once to fix that for free.

## Part 2b - Keep accounts and friends across deploys (Turso, free)

CouchVerse stores everything in a libSQL database. Pointing it at a free hosted Turso database makes logins, usernames, friends and preferences permanent.

1. Go to https://turso.tech, sign up with GitHub (free plan, no card).
2. In the dashboard click **Create Database**, name it `couchverse`, pick the region closest to your Render region (Singapore or Frankfurt for the free Render regions), and create it.
3. Open the database page. Copy the **URL** (starts with `libsql://couchverse-...turso.io`).
4. Click **Create Token** (or **Generate token**), choose no expiry, copy the token.
5. In Render → **couchverse** service → **Environment**, add two variables and click **Save Changes**:
   - `TURSO_DATABASE_URL` = the URL from step 3
   - `TURSO_AUTH_TOKEN` = the token from step 4
6. Render redeploys. Open `https://couchverse.onrender.com/api/health`: it should show `"db":"turso"`. Tables are created automatically on first start.

From now on, deploying new versions keeps every account, username, friendship and setting. Sessions last 90 days, so people stay signed in on their devices too.

Alternative without a hosted database: a paid Render instance with a **Disk** mounted at `/var/data` and `DB_PATH=/var/data/couchverse.sqlite`.

## Part 3 - Google Sign-In (optional, recommended for a public site)

1. https://console.cloud.google.com → create a project → **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.
2. Under **Authorized JavaScript origins** add your Render URL (and `http://localhost:5173` for local work).
3. Copy the **Client ID** into Render → Environment → `GOOGLE_CLIENT_ID`, and set `ALLOW_DEV_LOGIN` to `false`. Save; Render redeploys.

## Part 4 - The companion extension on the live site

- Visitors click **Get the extension** on the profile page or in an OTT room lobby. The site serves a zip built for your domain and walks them through the four-step install.
- To make it one click: publish `extension/dist` to the Chrome Web Store (https://chrome.google.com/webstore/devconsole, one-time $5 fee, a few days' review), then set `EXTENSION_STORE_URL` on Render to the store page. The button becomes **Add to Chrome**.

## Alternatives

- **Fly.io** (persistent volume on the free tier): install flyctl, then `fly launch --copy-config --no-deploy`, `fly volumes create couchverse_data --size 1`, `fly secrets set JWT_SECRET=$(openssl rand -hex 32)`, `fly deploy`. Config is in `fly.toml` and `Dockerfile`.
- **Any Docker host**: `docker build --build-arg SITE_ORIGIN=https://your.domain -t couchverse .` then run it with `-p 4000:4000 -v couchverse-data:/app/data -e JWT_SECRET=...`.

## Checklist before sharing the link

- [ ] `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are set (data survives deploys); `/api/health` shows `"db":"turso"`.
- [ ] `SITE_ORIGIN` equals the live URL (extension bridge).
- [ ] `JWT_SECRET` is set (Render generates one from the blueprint).
- [ ] Google Sign-In configured, or you are fine with dev login for testers.
- [ ] Open `/api/health` on the live URL: it should return `{"ok":true,...}`.
