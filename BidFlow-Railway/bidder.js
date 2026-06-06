// bidder.js — The auto-bidder engine
const { searchProjects, submitBid } = require('./freelancer')
const { generateProposal, calculateBidAmount } = require('./proposal')
const db = require('./db')

let isRunning = false
let scanInterval = null
let bidQueue = []  // projects waiting to be bid on
let isBidding = false

// ─── MAIN SCAN LOOP ───────────────────────────────────────────
// Runs every SCAN_INTERVAL_MS, finds new matching jobs, queues them
async function scan() {
  const bidderActive = db.getSetting('bidder_active') === 'true'
  if (!bidderActive) {
    console.log('[Bidder] Paused — skipping scan')
    return
  }

  const bidsToday = db.getBidsSentToday()
  const maxBids = parseInt(db.getSetting('max_bids_per_day') || process.env.MAX_BIDS_PER_DAY || '8')

  if (bidsToday >= maxBids) {
    console.log(`[Bidder] Daily limit reached (${bidsToday}/${maxBids}) — skipping scan`)
    return
  }

  console.log(`[Bidder] 🔍 Scanning for jobs... (${bidsToday}/${maxBids} bids today)`)

  const rules = db.getActiveRules()
  if (rules.length === 0) {
    console.log('[Bidder] No active rules — add a rule first')
    return
  }

  const verifiedOnly = db.getSetting('verified_clients_only') === 'true'
  let newFound = 0

  for (const rule of rules) {
    // Search once per keyword group (use first 3 keywords as query)
    const query = rule.keywords.slice(0, 3).join(' ')

    const projects = await searchProjects({
      query,
      minBudget: rule.min_budget,
      maxBudget: rule.max_budget,
      limit: 20
    })

    for (const project of projects) {
      // Skip if already seen or already in queue
      if (db.hasSeen(project.id)) continue
      if (bidQueue.some(q => q.project.id === project.id)) continue

      // Skip unverified clients if setting is on
      if (verifiedOnly && !project.clientVerified) {
        console.log(`[Bidder] Skipping unverified: ${project.title}`)
        db.markSeen(project.id) // don't check again
        continue
      }

      // Check if title/description contains at least one keyword
      const text = `${project.title} ${project.description}`.toLowerCase()
      const hasKeyword = rule.keywords.some(k => text.includes(k.toLowerCase()))
      if (!hasKeyword) {
        db.markSeen(project.id)
        continue
      }

      db.markSeen(project.id)
      bidQueue.push({ project, rule })
      newFound++
      console.log(`[Bidder] ✓ Queued: "${project.title}" (rule: ${rule.name})`)
    }
  }

  console.log(`[Bidder] Scan done — ${newFound} new jobs queued (total queue: ${bidQueue.length})`)

  // Start processing queue
  if (!isBidding && bidQueue.length > 0) {
    processBidQueue()
  }
}

// ─── PROCESS QUEUE ─────────────────────────────────────────────
// Sends bids one at a time with delay between each
async function processBidQueue() {
  if (isBidding || bidQueue.length === 0) return
  isBidding = true

  const delay = parseInt(db.getSetting('bid_delay_ms') || process.env.BID_DELAY_MS || '120000')

  while (bidQueue.length > 0) {
    const bidsToday = db.getBidsSentToday()
    const maxBids = parseInt(db.getSetting('max_bids_per_day') || '8')

    if (bidsToday >= maxBids) {
      console.log(`[Bidder] Daily limit hit (${bidsToday}) — pausing queue`)
      break
    }

    const active = db.getSetting('bidder_active') === 'true'
    if (!active) {
      console.log('[Bidder] Paused — stopping queue')
      break
    }

    const item = bidQueue.shift()
    await placeBid(item.project, item.rule)

    if (bidQueue.length > 0) {
      const jitter = Math.floor(Math.random() * 30000) // ±30s random jitter
      const wait = delay + jitter
      console.log(`[Bidder] ⏳ Waiting ${Math.round(wait/1000)}s before next bid...`)
      await sleep(wait)
    }
  }

  isBidding = false
}

// ─── PLACE A SINGLE BID ───────────────────────────────────────
async function placeBid(project, rule) {
  console.log(`[Bidder] 📝 Generating proposal for: "${project.title}"`)

  const tone = db.getSetting('proposal_tone') || 'friendly'
  const askQuestion = db.getSetting('ask_question') === 'true'

  // Get a script template if any exist
  const scripts = db.getScripts()
  const script = scripts.length > 0 ? scripts[0].template : null

  // Generate proposal with Claude
  const { text: proposalText, fallback } = await generateProposal({
    project,
    rule,
    tone,
    askQuestion,
    scriptTemplate: script
  })

  if (fallback) {
    console.log('[Bidder] ⚠️  Used fallback template (Claude API may be unavailable)')
  }

  const amount = calculateBidAmount(project, rule)

  console.log(`[Bidder] 💸 Bidding $${amount} on "${project.title}"`)

  // Submit to Freelancer
  const result = await submitBid({
    projectId: project.id,
    amount,
    period: 7,
    description: proposalText
  })

  if (result.success) {
    // Save to database
    db.addBid({
      projectId: project.id,
      title: project.title,
      url: project.url,
      amount,
      proposalText,
      ruleId: rule.id
    })

    console.log(`[Bidder] ✅ Bid sent! $${amount} on "${project.title}"`)
    return true
  } else {
    console.log(`[Bidder] ❌ Bid failed: ${result.error}`)
    return false
  }
}

// ─── START / STOP ─────────────────────────────────────────────
function start() {
  if (isRunning) return
  isRunning = true

  const interval = parseInt(process.env.SCAN_INTERVAL_MS || '300000')
  console.log(`[Bidder] 🚀 Started — scanning every ${interval/60000} minutes`)

  // Run immediately, then on interval
  scan()
  scanInterval = setInterval(scan, interval)
}

function stop() {
  if (scanInterval) clearInterval(scanInterval)
  isRunning = false
  bidQueue = []
  console.log('[Bidder] ⏹ Stopped')
}

function getStatus() {
  return {
    running: isRunning,
    active: db.getSetting('bidder_active') === 'true',
    queueLength: bidQueue.length,
    bidsToday: db.getBidsSentToday(),
    maxBids: parseInt(db.getSetting('max_bids_per_day') || '8'),
    isBidding
  }
}

function getQueue() {
  return bidQueue.map(item => ({
    projectId: item.project.id,
    title: item.project.title,
    budget: item.project.budget,
    rule: item.rule.name
  }))
}

function skipFromQueue(projectId) {
  const before = bidQueue.length
  bidQueue = bidQueue.filter(item => item.project.id !== projectId)
  return bidQueue.length < before
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = { start, stop, scan, getStatus, getQueue, skipFromQueue }
