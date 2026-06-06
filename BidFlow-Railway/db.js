// db.js — local SQLite database (no setup needed, just a file)
const Database = require('better-sqlite3')
const path = require('path')

const db = new Database(path.join(__dirname, 'bidflow.db'))

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL')

// ─── CREATE TABLES ────────────────────────────────────────────

db.exec(`
  -- Bidding rules
  CREATE TABLE IF NOT EXISTS rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    keywords    TEXT NOT NULL,      -- JSON array
    min_budget  REAL DEFAULT 0,
    max_budget  REAL DEFAULT 9999,
    bid_pct     INTEGER DEFAULT 65, -- bid at X% of max budget
    active      INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  -- Every bid we've sent
  CREATE TABLE IF NOT EXISTS bids (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    TEXT NOT NULL UNIQUE,
    project_title TEXT NOT NULL,
    project_url   TEXT,
    amount        REAL,
    proposal_text TEXT,
    status        TEXT DEFAULT 'sent',  -- sent | replied | won | lost | declined
    rule_id       INTEGER,
    sent_at       TEXT DEFAULT (datetime('now'))
  );

  -- Projects we've already seen (to avoid re-bidding)
  CREATE TABLE IF NOT EXISTS seen_projects (
    project_id  TEXT PRIMARY KEY,
    seen_at     TEXT DEFAULT (datetime('now'))
  );

  -- App settings (key-value)
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- Bid scripts / proposal templates
  CREATE TABLE IF NOT EXISTS scripts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    template   TEXT NOT NULL,
    active     INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Cached inbox threads (synced from Freelancer API)
  CREATE TABLE IF NOT EXISTS inbox_threads (
    thread_id   TEXT PRIMARY KEY,
    subject     TEXT,
    project_id  TEXT,
    client_name TEXT,
    unread      INTEGER DEFAULT 1,
    last_message TEXT,
    last_time   TEXT,
    synced_at   TEXT DEFAULT (datetime('now'))
  );

  -- Cached messages per thread
  CREATE TABLE IF NOT EXISTS inbox_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id   TEXT NOT NULL,
    message_id  TEXT UNIQUE,
    from_name   TEXT,
    from_id     TEXT,
    text        TEXT,
    is_me       INTEGER DEFAULT 0,
    time        TEXT,
    FOREIGN KEY(thread_id) REFERENCES inbox_threads(thread_id)
  );
`)

// ─── SEED DEFAULT DATA ─────────────────────────────────────────

const existingRules = db.prepare('SELECT count(*) as c FROM rules').get()
if (existingRules.c === 0) {
  db.prepare(`INSERT INTO rules (name, keywords, min_budget, max_budget, bid_pct) VALUES (?, ?, ?, ?, ?)`).run(
    'Web Development',
    JSON.stringify(['React', 'Node.js', 'JavaScript', 'PHP', 'WordPress']),
    50, 500, 65
  )
  db.prepare(`INSERT INTO rules (name, keywords, min_budget, max_budget, bid_pct) VALUES (?, ?, ?, ?, ?)`).run(
    'API / Backend',
    JSON.stringify(['REST API', 'Node.js', 'Python', 'Django', 'Express']),
    80, 800, 70
  )
  console.log('[DB] Seeded default rules')
}

const existingScripts = db.prepare('SELECT count(*) as c FROM scripts').get()
if (existingScripts.c === 0) {
  db.prepare(`INSERT INTO scripts (name, template) VALUES (?, ?)`).run(
    'General Web Developer',
    `Hi [CLIENT_NAME],

I came across your project "[PROJECT_TITLE]" and I'm confident I can deliver exactly what you need.

I've been building web applications for 4+ years, specialising in [SKILLS]. I've completed 30+ similar projects and always deliver clean, well-documented code on time.

[AI_CUSTOM_PARAGRAPH]

I can start immediately. Quick question: do you have any existing designs or wireframes ready to go?

Looking forward to working with you!`
  )
  console.log('[DB] Seeded default script')
}

const existingSettings = db.prepare('SELECT count(*) as c FROM settings').get()
if (existingSettings.c === 0) {
  const defaults = [
    ['bidder_active', 'true'],
    ['max_bids_per_day', '8'],
    ['bid_delay_ms', '120000'],
    ['proposal_tone', 'friendly'],
    ['verified_clients_only', 'true'],
    ['ask_question', 'true'],
  ]
  const ins = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  defaults.forEach(([k, v]) => ins.run(k, v))
  console.log('[DB] Seeded default settings')
}

// ─── HELPER FUNCTIONS ──────────────────────────────────────────

const dbHelpers = {
  // Rules
  getRules: () => {
    return db.prepare('SELECT * FROM rules ORDER BY id').all().map(r => ({
      ...r,
      keywords: JSON.parse(r.keywords),
      active: r.active === 1
    }))
  },
  getActiveRules: () => {
    return db.prepare('SELECT * FROM rules WHERE active = 1').all().map(r => ({
      ...r,
      keywords: JSON.parse(r.keywords)
    }))
  },
  addRule: (rule) => {
    return db.prepare(`INSERT INTO rules (name, keywords, min_budget, max_budget, bid_pct) VALUES (?, ?, ?, ?, ?)`)
      .run(rule.name, JSON.stringify(rule.keywords), rule.minBudget, rule.maxBudget, rule.bidPct)
  },
  updateRule: (id, fields) => {
    if (fields.keywords) fields.keywords = JSON.stringify(fields.keywords)
    const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ')
    return db.prepare(`UPDATE rules SET ${sets} WHERE id = ?`).run(...Object.values(fields), id)
  },
  deleteRule: (id) => db.prepare('DELETE FROM rules WHERE id = ?').run(id),
  toggleRule: (id, active) => db.prepare('UPDATE rules SET active = ? WHERE id = ?').run(active ? 1 : 0, id),

  // Bids
  getBids: (limit = 50) => db.prepare('SELECT * FROM bids ORDER BY sent_at DESC LIMIT ?').all(limit),
  getBidsSentToday: () => {
    return db.prepare(`SELECT count(*) as c FROM bids WHERE date(sent_at) = date('now')`).get().c
  },
  addBid: (bid) => {
    return db.prepare(`INSERT OR IGNORE INTO bids (project_id, project_title, project_url, amount, proposal_text, rule_id) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(bid.projectId, bid.title, bid.url, bid.amount, bid.proposalText, bid.ruleId)
  },
  updateBidStatus: (projectId, status) => db.prepare('UPDATE bids SET status = ? WHERE project_id = ?').run(status, projectId),

  // Seen projects
  hasSeen: (projectId) => !!db.prepare('SELECT 1 FROM seen_projects WHERE project_id = ?').get(projectId),
  markSeen: (projectId) => db.prepare('INSERT OR IGNORE INTO seen_projects (project_id) VALUES (?)').run(projectId),

  // Settings
  getSetting: (key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
    return row ? row.value : null
  },
  setSetting: (key, value) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value)),
  getAllSettings: () => {
    const rows = db.prepare('SELECT * FROM settings').all()
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  },

  // Scripts
  getScripts: () => db.prepare('SELECT * FROM scripts ORDER BY id').all(),
  addScript: (name, template) => db.prepare('INSERT INTO scripts (name, template) VALUES (?, ?)').run(name, template),
  updateScript: (id, name, template) => db.prepare('UPDATE scripts SET name = ?, template = ? WHERE id = ?').run(name, template, id),
  deleteScript: (id) => db.prepare('DELETE FROM scripts WHERE id = ?').run(id),

  // Stats
  getStats: () => {
    const bidsToday = db.prepare(`SELECT count(*) as c FROM bids WHERE date(sent_at) = date('now')`).get().c
    const bidsTotal = db.prepare('SELECT count(*) as c FROM bids').get().c
    const replied = db.prepare(`SELECT count(*) as c FROM bids WHERE status = 'replied'`).get().c
    const won = db.prepare(`SELECT count(*) as c FROM bids WHERE status = 'won'`).get().c
    const responseRate = bidsTotal > 0 ? Math.round((replied / bidsTotal) * 100) : 0
    return { bidsToday, bidsTotal, replied, won, responseRate }
  },

  // Inbox threads
  upsertThread: (t) => {
    db.prepare(`INSERT OR REPLACE INTO inbox_threads (thread_id, subject, project_id, client_name, unread, last_message, last_time)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(t.thread_id, t.subject, t.project_id, t.client_name, t.unread ? 1 : 0, t.last_message, t.last_time)
  },
  getThreads: () => db.prepare('SELECT * FROM inbox_threads ORDER BY last_time DESC').all().map(t => ({ ...t, unread: t.unread === 1 })),
  markThreadRead: (threadId) => db.prepare('UPDATE inbox_threads SET unread = 0 WHERE thread_id = ?').run(threadId),
  getUnreadCount: () => db.prepare('SELECT count(*) as c FROM inbox_threads WHERE unread = 1').get().c,

  // Inbox messages
  upsertMessage: (m) => {
    db.prepare(`INSERT OR IGNORE INTO inbox_messages (thread_id, message_id, from_name, from_id, text, is_me, time)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(m.thread_id, m.message_id, m.from_name, m.from_id, m.text, m.is_me ? 1 : 0, m.time)
  },
  getMessages: (threadId) => db.prepare('SELECT * FROM inbox_messages WHERE thread_id = ? ORDER BY time ASC').all(threadId).map(m => ({ ...m, is_me: m.is_me === 1 })),
  addSentMessage: (threadId, text) => {
    db.prepare(`INSERT INTO inbox_messages (thread_id, message_id, from_name, from_id, text, is_me, time) VALUES (?, ?, 'You', 'me', ?, 1, datetime('now'))`)
      .run(threadId, 'local-' + Date.now(), text)
    db.prepare('UPDATE inbox_threads SET last_message = ?, last_time = datetime(\'now\'), unread = 0 WHERE thread_id = ?').run(text, threadId)
  }
}

module.exports = { db, ...dbHelpers }
