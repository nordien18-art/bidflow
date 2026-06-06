// db.js — SQLite database using sqlite3 (works on Render free tier)
const sqlite3 = require('sqlite3').verbose()
const path = require('path')

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'bidflow.db')
const db = new sqlite3.Database(DB_PATH)

// Helper: run a query (INSERT, UPDATE, DELETE)
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err)
      else resolve({ lastID: this.lastID, changes: this.changes })
    })
  })
}

// Helper: get one row
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err)
      else resolve(row)
    })
  })
}

// Helper: get all rows
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err)
      else resolve(rows || [])
    })
  })
}

// ─── CREATE TABLES ────────────────────────────────────────────
async function init() {
  await run(`CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    keywords TEXT NOT NULL,
    min_budget REAL DEFAULT 0,
    max_budget REAL DEFAULT 9999,
    bid_pct INTEGER DEFAULT 65,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`)

  await run(`CREATE TABLE IF NOT EXISTS bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL UNIQUE,
    project_title TEXT NOT NULL,
    project_url TEXT,
    amount REAL,
    proposal_text TEXT,
    status TEXT DEFAULT 'sent',
    rule_id INTEGER,
    sent_at TEXT DEFAULT (datetime('now'))
  )`)

  await run(`CREATE TABLE IF NOT EXISTS seen_projects (
    project_id TEXT PRIMARY KEY,
    seen_at TEXT DEFAULT (datetime('now'))
  )`)

  await run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`)

  await run(`CREATE TABLE IF NOT EXISTS scripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    template TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`)

  await run(`CREATE TABLE IF NOT EXISTS inbox_threads (
    thread_id TEXT PRIMARY KEY,
    subject TEXT,
    project_id TEXT,
    client_name TEXT,
    unread INTEGER DEFAULT 1,
    last_message TEXT,
    last_time TEXT,
    synced_at TEXT DEFAULT (datetime('now'))
  )`)

  await run(`CREATE TABLE IF NOT EXISTS inbox_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL,
    message_id TEXT UNIQUE,
    from_name TEXT,
    from_id TEXT,
    text TEXT,
    is_me INTEGER DEFAULT 0,
    time TEXT
  )`)

  // Seed defaults
  const ruleCount = await get('SELECT count(*) as c FROM rules')
  if (ruleCount.c === 0) {
    await run(`INSERT INTO rules (name, keywords, min_budget, max_budget, bid_pct) VALUES (?, ?, ?, ?, ?)`,
      ['Web Development', JSON.stringify(['React','Node.js','JavaScript','PHP','WordPress']), 50, 500, 65])
    await run(`INSERT INTO rules (name, keywords, min_budget, max_budget, bid_pct) VALUES (?, ?, ?, ?, ?)`,
      ['API / Backend', JSON.stringify(['REST API','Node.js','Python','Django','Express']), 80, 800, 70])
    console.log('[DB] Seeded default rules')
  }

  const scriptCount = await get('SELECT count(*) as c FROM scripts')
  if (scriptCount.c === 0) {
    await run(`INSERT INTO scripts (name, template) VALUES (?, ?)`, [
      'General Web Developer',
      `Hi [CLIENT_NAME],\n\nI came across your project "[PROJECT_TITLE]" and I'm confident I can deliver exactly what you need.\n\nI've been building web applications for 4+ years, specialising in [SKILLS]. I always deliver clean, well-documented code on time.\n\nI can start immediately. Quick question: do you have any existing designs or wireframes?\n\nLooking forward to working together!`
    ])
    console.log('[DB] Seeded default script')
  }

  const settingCount = await get('SELECT count(*) as c FROM settings')
  if (settingCount.c === 0) {
    const defaults = [
      ['bidder_active','true'],['max_bids_per_day','8'],
      ['bid_delay_ms','120000'],['proposal_tone','friendly'],
      ['verified_clients_only','true'],['ask_question','true'],
    ]
    for (const [k,v] of defaults) await run('INSERT INTO settings (key,value) VALUES (?,?)', [k,v])
    console.log('[DB] Seeded default settings')
  }

  console.log('[DB] Ready')
}

// ─── HELPERS ──────────────────────────────────────────────────
const dbHelpers = {
  getRules: async () => {
    const rows = await all('SELECT * FROM rules ORDER BY id')
    return rows.map(r => ({ ...r, keywords: JSON.parse(r.keywords), active: r.active === 1 }))
  },
  getActiveRules: async () => {
    const rows = await all('SELECT * FROM rules WHERE active = 1')
    return rows.map(r => ({ ...r, keywords: JSON.parse(r.keywords) }))
  },
  addRule: (rule) => run(
    `INSERT INTO rules (name,keywords,min_budget,max_budget,bid_pct) VALUES (?,?,?,?,?)`,
    [rule.name, JSON.stringify(rule.keywords), rule.minBudget, rule.maxBudget, rule.bidPct]
  ),
  updateRule: async (id, fields) => {
    if (fields.keywords) fields.keywords = JSON.stringify(fields.keywords)
    const sets = Object.keys(fields).map(k => `${k}=?`).join(',')
    return run(`UPDATE rules SET ${sets} WHERE id=?`, [...Object.values(fields), id])
  },
  deleteRule: (id) => run('DELETE FROM rules WHERE id=?', [id]),
  toggleRule: (id, active) => run('UPDATE rules SET active=? WHERE id=?', [active?1:0, id]),

  getBids: (limit=50) => all('SELECT * FROM bids ORDER BY sent_at DESC LIMIT ?', [limit]),
  getBidsSentToday: async () => {
    const r = await get(`SELECT count(*) as c FROM bids WHERE date(sent_at)=date('now')`)
    return r.c
  },
  addBid: (bid) => run(
    `INSERT OR IGNORE INTO bids (project_id,project_title,project_url,amount,proposal_text,rule_id) VALUES (?,?,?,?,?,?)`,
    [bid.projectId, bid.title, bid.url, bid.amount, bid.proposalText, bid.ruleId]
  ),
  updateBidStatus: (projectId, status) => run('UPDATE bids SET status=? WHERE project_id=?', [status, projectId]),

  hasSeen: async (projectId) => !!(await get('SELECT 1 FROM seen_projects WHERE project_id=?', [projectId])),
  markSeen: (projectId) => run('INSERT OR IGNORE INTO seen_projects (project_id) VALUES (?)', [projectId]),

  getSetting: async (key) => {
    const r = await get('SELECT value FROM settings WHERE key=?', [key])
    return r ? r.value : null
  },
  setSetting: (key, value) => run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', [key, String(value)]),
  getAllSettings: async () => {
    const rows = await all('SELECT * FROM settings')
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  },

  getScripts: () => all('SELECT * FROM scripts ORDER BY id'),
  addScript: (name, template) => run('INSERT INTO scripts (name,template) VALUES (?,?)', [name, template]),
  updateScript: (id, name, template) => run('UPDATE scripts SET name=?,template=? WHERE id=?', [name, template, id]),
  deleteScript: (id) => run('DELETE FROM scripts WHERE id=?', [id]),

  getStats: async () => {
    const bidsToday = (await get(`SELECT count(*) as c FROM bids WHERE date(sent_at)=date('now')`)).c
    const bidsTotal = (await get('SELECT count(*) as c FROM bids')).c
    const replied = (await get(`SELECT count(*) as c FROM bids WHERE status='replied'`)).c
    const won = (await get(`SELECT count(*) as c FROM bids WHERE status='won'`)).c
    const responseRate = bidsTotal > 0 ? Math.round((replied/bidsTotal)*100) : 0
    return { bidsToday, bidsTotal, replied, won, responseRate }
  },

  upsertThread: (t) => run(
    `INSERT OR REPLACE INTO inbox_threads (thread_id,subject,project_id,client_name,unread,last_message,last_time) VALUES (?,?,?,?,?,?,?)`,
    [t.thread_id, t.subject, t.project_id, t.client_name, t.unread?1:0, t.last_message, t.last_time]
  ),
  getThreads: async () => {
    const rows = await all('SELECT * FROM inbox_threads ORDER BY last_time DESC')
    return rows.map(r => ({ ...r, unread: r.unread===1 }))
  },
  markThreadRead: (threadId) => run('UPDATE inbox_threads SET unread=0 WHERE thread_id=?', [threadId]),
  getUnreadCount: async () => (await get('SELECT count(*) as c FROM inbox_threads WHERE unread=1')).c,

  upsertMessage: (m) => run(
    `INSERT OR IGNORE INTO inbox_messages (thread_id,message_id,from_name,from_id,text,is_me,time) VALUES (?,?,?,?,?,?,?)`,
    [m.thread_id, m.message_id, m.from_name, m.from_id, m.text, m.is_me?1:0, m.time]
  ),
  getMessages: async (threadId) => {
    const rows = await all('SELECT * FROM inbox_messages WHERE thread_id=? ORDER BY time ASC', [threadId])
    return rows.map(r => ({ ...r, is_me: r.is_me===1 }))
  },
  addSentMessage: (threadId, text) => {
    run(`INSERT INTO inbox_messages (thread_id,message_id,from_name,from_id,text,is_me,time) VALUES (?,?,?,?,?,1,datetime('now'))`,
      [threadId, 'local-'+Date.now(), 'You', 'me', text])
    return run(`UPDATE inbox_threads SET last_message=?,last_time=datetime('now'),unread=0 WHERE thread_id=?`, [text, threadId])
  }
}

// Init DB then export
init().catch(console.error)

module.exports = { db, run, get, all, ...dbHelpers }
