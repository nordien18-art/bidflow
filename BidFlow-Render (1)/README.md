# BidFlow — Freelancer.com Auto-Bidder

Your personal auto-bidding platform for Freelancer.com.
Scans for jobs, generates AI proposals with Claude, and submits bids automatically.

---

## What you need first

1. **Node.js** installed on your PC
   → Download from https://nodejs.org (click "LTS" version)
   → After installing, open a terminal and check it works: `node --version`

2. **A Freelancer.com account**
   → You already have one

3. **A Freelancer API token**
   → Go to: https://www.freelancer.com/users/settings/developer
   → Click "Create App" → give it any name
   → Scroll down to "Personal Access Tokens" → Generate one
   → Copy the token (you only see it once!)

4. **A Claude/Anthropic API key** (for AI proposal writing)
   → Go to: https://console.anthropic.com/settings/keys
   → Click "Create Key" → copy it

---

## Setup (do this once)

### Step 1 — Open terminal in this folder
- **Windows**: Right-click the `bidflow` folder → "Open in Terminal"
  (or press Win+R, type `cmd`, press Enter, then `cd` to this folder)
- **Mac**: Right-click the folder → "New Terminal at Folder"

### Step 2 — Install dependencies
```bash
npm install
```
Wait for it to finish (downloads ~30MB of packages).

### Step 3 — Add your credentials
Copy the example file:
```bash
# Windows:
copy .env.example .env

# Mac/Linux:
cp .env.example .env
```

Then open `.env` in any text editor (Notepad, VS Code, etc.) and fill in:
```
FREELANCER_ACCESS_TOKEN=paste_your_token_here
ANTHROPIC_API_KEY=paste_your_claude_key_here
```

Leave the other settings as-is for now.

### Step 4 — Start the server
```bash
npm start
```

You should see:
```
╔══════════════════════════════════════╗
║      BidFlow Server Running          ║
╠══════════════════════════════════════╣
║  Frontend: http://localhost:3001     ║
║  API:      http://localhost:3001/api ║
╚══════════════════════════════════════╝
```

### Step 5 — Open the app
Open your browser and go to: **http://localhost:3001**

That's it. The app is running!

---

## How to use it

### Setting up your first bidding rule
1. Click **"Auto Bidder"** in the sidebar
2. Click **"+ New Rule"**
3. Enter a name (e.g. "React Developer")
4. Add keywords (e.g. React, Node.js, JavaScript) — press Enter after each
5. Set your budget range (e.g. $50 min, $500 max)
6. Save — the bidder will now find and bid on matching jobs automatically

### Watching it work
- Dashboard shows live stats and recent bids
- Auto Bidder page shows the queue of upcoming bids
- Each bid fires with a random delay so it looks natural

### Testing without real API keys
If you haven't added your Freelancer token yet, the app runs in **Mock Mode** —
you'll see fake projects and bids so you can explore everything. No real bids are sent.

---

## Important notes

**Daily bid limits**
- Freelancer free accounts: ~8 bids/day
- Freelancer Plus: 50/day
- Higher plans: more
Set `MAX_BIDS_PER_DAY` in `.env` to match your plan.

**Bid delay**
The default 1–3 minute delay between bids is intentional.
Instant bidding looks like a bot and can get your account flagged.

**Keep the terminal open**
The server only runs while the terminal is open.
Close the terminal = bidder stops.
(Later I can help you run it 24/7 in the background)

---

## File structure

```
bidflow/
├── index.html      ← The frontend (your dashboard UI)
├── server.js       ← Express web server + API routes
├── bidder.js       ← Auto-bidding engine (scan → queue → bid)
├── freelancer.js   ← Freelancer.com API client
├── proposal.js     ← Claude AI proposal generator
├── db.js           ← Local database (SQLite)
├── bidflow.db      ← Your data (created on first run)
├── package.json    ← Node.js dependencies
├── .env            ← Your credentials (never share this file!)
└── .env.example    ← Template for credentials
```

---

## Troubleshooting

**"npm: command not found"**
→ Node.js isn't installed. Download from https://nodejs.org

**"Cannot find module"**
→ Run `npm install` again

**"Invalid token" error in terminal**
→ Your Freelancer access token is wrong. Re-generate it from the developer portal.

**Bids not sending**
→ Check the terminal for error messages
→ Make sure your Freelancer account has bids available (check your plan)
→ Make sure `bidder_active` is ON in the dashboard

**Want to run it 24/7?**
→ Ask me to set up PM2 (a background process manager) or deploy to a cheap VPS

---

## Upgrading to multi-user (sell subscriptions)
When you're ready to let others use your platform:
1. Add user authentication (login/signup)
2. Add Stripe for payments
3. Deploy to a server (Railway, Render, or a VPS)
Ask me and I'll build all of this for you.
