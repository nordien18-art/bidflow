// server.js — BidFlow backend server
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const db = require('./db')
const bidder = require('./bidder')
const { generateProposal, calculateBidAmount } = require('./proposal')
const { getMyProfile, isMockMode, getMessages, getThreadMessages, sendMessage, markThreadRead, searchFreelancers } = require('./freelancer')
const { fetchJobs, getFallbackJobs } = require('./scraper')
const Anthropic = require('@anthropic-ai/sdk')

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

// Serve the frontend HTML
app.use(express.static(path.join(__dirname)))
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')))

// ─── LIVE JOBS (scraped from Freelancer — no token needed) ────
app.get('/api/jobs', async (req, res) => {
  const { query = '', category = '', limit = 20, minBudget = 0, maxBudget = 0 } = req.query
  try {
    let jobs = await fetchJobs({
      query,
      category,
      limit: parseInt(limit),
      minBudget: parseInt(minBudget),
      maxBudget: parseInt(maxBudget)
    })

    // Fall back to sample jobs if scraping fails
    if (!jobs || jobs.length === 0) {
      console.log('[Jobs] Scraping returned nothing — using fallback jobs')
      jobs = getFallbackJobs()
      if (category) jobs = jobs.filter(j => j.cat === category)
      if (query) {
        const q = query.toLowerCase()
        jobs = jobs.filter(j =>
          j.title.toLowerCase().includes(q) ||
          j.tags.some(t => t.toLowerCase().includes(q))
        )
      }
      return res.json({ jobs, source: 'fallback' })
    }

    res.json({ jobs, source: 'live' })
  } catch (err) {
    console.error('[Jobs] Error:', err.message)
    res.json({ jobs: getFallbackJobs(), source: 'fallback' })
  }
})

// ─── STATUS ───────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    ...bidder.getStatus(),
    mockMode: isMockMode(),
    stats: db.getStats()
  })
})

// ─── RULES ────────────────────────────────────────────────────
app.get('/api/rules', (req, res) => {
  res.json(db.getRules())
})

app.post('/api/rules', (req, res) => {
  const { name, keywords, minBudget, maxBudget, bidPct } = req.body
  if (!name || !keywords?.length) return res.status(400).json({ error: 'name and keywords required' })
  const result = db.addRule({ name, keywords, minBudget: minBudget||50, maxBudget: maxBudget||500, bidPct: bidPct||65 })
  res.json({ id: result.lastInsertRowid, name, keywords, minBudget, maxBudget, bidPct, active: true })
})

app.patch('/api/rules/:id', (req, res) => {
  const { id } = req.params
  const { active, ...rest } = req.body
  if (typeof active === 'boolean') db.toggleRule(id, active)
  if (Object.keys(rest).length) db.updateRule(id, rest)
  res.json({ ok: true })
})

app.delete('/api/rules/:id', (req, res) => {
  db.deleteRule(req.params.id)
  res.json({ ok: true })
})

// ─── BIDS ─────────────────────────────────────────────────────
app.get('/api/bids', (req, res) => {
  const limit = parseInt(req.query.limit) || 50
  res.json(db.getBids(limit))
})

app.get('/api/bids/stats', (req, res) => {
  res.json(db.getStats())
})

// ─── BIDDER CONTROL ───────────────────────────────────────────
app.post('/api/bidder/start', (req, res) => {
  db.setSetting('bidder_active', 'true')
  bidder.start()
  res.json({ ok: true, status: 'running' })
})

app.post('/api/bidder/pause', (req, res) => {
  db.setSetting('bidder_active', 'false')
  res.json({ ok: true, status: 'paused' })
})

app.post('/api/bidder/scan', async (req, res) => {
  res.json({ ok: true, message: 'Scan triggered' })
  bidder.scan() // run async
})

app.get('/api/bidder/queue', (req, res) => {
  res.json(bidder.getQueue())
})

app.delete('/api/bidder/queue/:projectId', (req, res) => {
  const skipped = bidder.skipFromQueue(req.params.projectId)
  res.json({ ok: skipped })
})

// ─── PROPOSALS ────────────────────────────────────────────────
app.post('/api/proposals/generate', async (req, res) => {
  const { project, ruleId, tone } = req.body
  if (!project) return res.status(400).json({ error: 'project required' })

  const rules = db.getRules()
  const rule = rules.find(r => r.id === ruleId) || rules[0] || { name: 'General', keywords: [] }

  const result = await generateProposal({ project, rule, tone: tone || 'friendly' })
  res.json(result)
})

// ─── SETTINGS ─────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  res.json(db.getAllSettings())
})

app.patch('/api/settings', (req, res) => {
  const updates = req.body
  Object.entries(updates).forEach(([k, v]) => db.setSetting(k, v))
  res.json({ ok: true })
})

// ─── SCRIPTS ──────────────────────────────────────────────────
app.get('/api/scripts', (req, res) => {
  res.json(db.getScripts())
})

app.post('/api/scripts', (req, res) => {
  const { name, template } = req.body
  if (!name || !template) return res.status(400).json({ error: 'name and template required' })
  const result = db.addScript(name, template)
  res.json({ id: result.lastInsertRowid, name, template })
})

app.put('/api/scripts/:id', (req, res) => {
  const { name, template } = req.body
  db.updateScript(req.params.id, name, template)
  res.json({ ok: true })
})

app.delete('/api/scripts/:id', (req, res) => {
  db.deleteScript(req.params.id)
  res.json({ ok: true })
})

// ─── FREELANCER ACCOUNT ───────────────────────────────────────
app.get('/api/account', async (req, res) => {
  const profile = await getMyProfile()
  res.json(profile || { error: 'Could not load profile' })
})

// ─── INBOX ────────────────────────────────────────────────────
// GET all threads — syncs from Freelancer API then returns cached
app.get('/api/inbox', async (req, res) => {
  try {
    const threads = await getMessages()
    // Sync into local DB
    for (const t of threads) {
      const client = t.participants.find(p => !p.isMe)
      db.upsertThread({
        thread_id: t.id,
        subject: t.subject,
        project_id: t.projectId,
        client_name: client?.name || 'Client',
        unread: t.unread,
        last_message: t.lastMessage,
        last_time: t.lastTime
      })
    }
    const cached = db.getThreads()
    res.json({ threads: cached, unreadCount: db.getUnreadCount() })
  } catch (err) {
    console.error('[Inbox] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET messages in a thread
app.get('/api/inbox/:threadId/messages', async (req, res) => {
  const { threadId } = req.params
  try {
    const messages = await getThreadMessages(threadId)
    // Sync into local DB
    for (const m of messages) {
      db.upsertMessage({
        thread_id: threadId,
        message_id: m.id,
        from_name: m.from,
        from_id: m.fromId,
        text: m.text,
        is_me: m.isMe,
        time: m.time
      })
    }
    db.markThreadRead(threadId)
    try { await markThreadRead(threadId) } catch(e) {}
    res.json(db.getMessages(threadId))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST send a reply
app.post('/api/inbox/:threadId/reply', async (req, res) => {
  const { threadId } = req.params
  const { message } = req.body
  if (!message?.trim()) return res.status(400).json({ error: 'message required' })
  try {
    const result = await sendMessage(threadId, message)
    if (result.success) {
      db.addSentMessage(threadId, message)
    }
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST generate AI reply for a thread
app.post('/api/inbox/:threadId/generate-reply', async (req, res) => {
  const { threadId } = req.params
  const { lastClientMessage, projectTitle, tone } = req.body

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const toneMap = { professional:'professional and formal', friendly:'warm, friendly, and confident', concise:'brief and direct — 2-3 sentences max' }
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: `You are a freelancer replying to a client message on Freelancer.com. Be ${toneMap[tone||'friendly']}. No greetings like "Dear Sir". Keep it under 100 words. End with a relevant question if appropriate.`,
      messages: [{
        role: 'user',
        content: `Project: "${projectTitle || 'freelance project'}"\n\nClient said: "${lastClientMessage}"\n\nWrite a reply:`
      }]
    })
    res.json({ text: msg.content[0]?.text || '' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── FIND DEVS ────────────────────────────────────────────────
app.get('/api/devs', async (req, res) => {
  const { query = '', minEarnings = 0, limit = 12, offset = 0 } = req.query
  try {
    const devs = await searchFreelancers({
      query,
      minEarnings: parseInt(minEarnings),
      limit: parseInt(limit),
      offset: parseInt(offset)
    })
    res.json({ devs, total: devs.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST send a message to a freelancer (creates a new thread)
app.post('/api/devs/:username/message', async (req, res) => {
  const { username } = req.params
  const { message } = req.body
  if (!message?.trim()) return res.status(400).json({ error: 'message required' })
  // Freelancer API requires a project context to message; in mock mode we just confirm
  if (isMockMode()) {
    return res.json({ success: true, mock: true, message: 'Message queued (mock mode — add real token to send)' })
  }
  // Real: use the messages API with a new thread
  try {
    const res2 = await require('./freelancer').client?.post('/messages/0.1/threads/', {
      members: [username],
      message
    })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST generate AI outreach message for a dev
app.post('/api/devs/generate-message', async (req, res) => {
  const { devName, devTitle, devSkills } = req.body
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: 'You write short, genuine outreach messages to freelancers on Freelancer.com. Warm, direct, under 80 words. No clichés.',
      messages: [{
        role: 'user',
        content: `Write a message to ${devName} who is a "${devTitle}" with skills in ${(devSkills||[]).slice(0,3).join(', ')}. I want to discuss a potential project collaboration.`
      }]
    })
    res.json({ text: msg.content[0]?.text || '' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── AUTH — verify a Freelancer token (fixes CORS for hosted frontend) ────
app.post('/api/auth/verify', async (req, res) => {
  const { token } = req.body
  if (!token) return res.status(400).json({ error: 'token required' })

  try {
    const axios = require('axios')
    const r = await axios.get('https://www.freelancer.com/api/users/0.1/self/?display_info=true', {
      headers: { 'freelancer-oauth-v1': token }
    })
    const data = r.data
    if (data.status === 'success' && data.result) {
      const u = data.result
      res.json({
        success: true,
        user: {
          id: u.id,
          username: u.username,
          displayName: u.display_name || u.username,
          avatar: u.avatar_cdn || null,
          profileUrl: `https://www.freelancer.com/u/${u.username}`,
          token
        }
      })
    } else {
      res.json({ success: false, error: 'Invalid token' })
    }
  } catch (err) {
    res.json({ success: false, error: 'Could not reach Freelancer API: ' + err.message })
  }
})

// ─── START SERVER ─────────────────────────────────────────────
const HOST = '0.0.0.0' // Required for Railway — listen on all interfaces
app.listen(PORT, HOST, () => {
  const isRailway = !!process.env.RAILWAY_ENVIRONMENT
  const url = isRailway
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN || 'your-app.up.railway.app'}`
    : `http://localhost:${PORT}`

  console.log(`\n╔══════════════════════════════════════╗`)
  console.log(`║      BidFlow Server Running          ║`)
  console.log(`╠══════════════════════════════════════╣`)
  console.log(`║  URL: ${url.padEnd(31)}║`)
  console.log(`╚══════════════════════════════════════╝`)

  if (isMockMode()) {
    console.log(`\n⚠️  No Freelancer token set — running in mock mode`)
    console.log(`   Add FREELANCER_ACCESS_TOKEN in Railway environment variables\n`)
  } else {
    console.log(`\n✅ Freelancer API connected\n`)
  }
})
