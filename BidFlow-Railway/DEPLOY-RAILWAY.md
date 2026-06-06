# Deploy BidFlow to Railway — Step by Step

## What you need
- A GitHub account (free) → github.com
- A Railway account (free) → railway.app

---

## Step 1 — Put the files on GitHub

1. Go to **github.com** → click the **+** button → **"New repository"**
2. Name it `bidflow` → click **"Create repository"**
3. On the next page, click **"uploading an existing file"**
4. Drag ALL the BidFlow files into the upload box:
   - `index.html`
   - `server.js`
   - `bidder.js`
   - `freelancer.js`
   - `db.js`
   - `proposal.js`
   - `package.json`
   - `Dockerfile`
   - `railway.toml`
   - `.gitignore`
   - `README.md`
   ⚠️ Do NOT upload `.env` — keep your tokens private
5. Click **"Commit changes"**

---

## Step 2 — Deploy on Railway

1. Go to **railway.app** → click **"Start a New Project"**
2. Click **"Deploy from GitHub repo"**
3. Connect your GitHub account if asked
4. Select your `bidflow` repository
5. Railway detects the Dockerfile automatically and starts building
6. Wait ~2 minutes for it to build and deploy
7. Click **"Settings"** → **"Domains"** → **"Generate Domain"**
8. You get a URL like: `bidflow-production.up.railway.app` ✅

---

## Step 3 — Add your environment variables

This is where you put your API keys (instead of the .env file):

1. In Railway, click your project → **"Variables"** tab
2. Add these one by one:

| Variable | Value |
|---|---|
| `FREELANCER_ACCESS_TOKEN` | Your Freelancer personal access token |
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `JWT_SECRET` | Any random string (e.g. `abc123xyz789random`) |
| `MAX_BIDS_PER_DAY` | `8` (or higher if you have a paid Freelancer plan) |

3. Railway automatically restarts your app after you add variables

---

## Step 4 — Open your live app

Go to your Railway domain URL (e.g. `bidflow-production.up.railway.app`)

You'll see the BidFlow login screen. Paste your Freelancer token → Sign in. Done!

---

## Free tier limits
- Railway free tier: 500 hours/month (enough for ~16hrs/day)
- If you need it running 24/7, upgrade to Railway Starter ($5/month)

## To update the app later
1. Edit your files
2. Go to your GitHub repo → upload the changed files
3. Railway auto-redeploys within 1-2 minutes

