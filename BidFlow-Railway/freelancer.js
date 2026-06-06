// freelancer.js — Freelancer.com API client
const axios = require('axios')

const BASE = 'https://www.freelancer.com/api'
const TOKEN = process.env.FREELANCER_ACCESS_TOKEN

const client = axios.create({
  baseURL: BASE,
  headers: {
    'freelancer-oauth-v1': TOKEN,
    'Content-Type': 'application/json'
  }
})

// ─── SEARCH PROJECTS ──────────────────────────────────────────
// Returns projects matching a query string, within budget range
async function searchProjects({ query, minBudget, maxBudget, limit = 20 }) {
  try {
    const params = {
      query,
      limit,
      offset: 0,
      job_details: true,
      full_description: false,
      // Filter: fixed price + hourly
      'project_types[]': ['fixed', 'hourly'],
    }

    if (minBudget) params['min_avg_price'] = minBudget
    if (maxBudget) params['max_avg_price'] = maxBudget

    const res = await client.get('/projects/0.1/projects/active/', { params })
    const data = res.data

    if (data.status !== 'success') {
      console.error('[Freelancer] Search failed:', data.message)
      return []
    }

    const projects = data.result?.projects || []

    return projects.map(p => ({
      id: String(p.id),
      title: p.title,
      description: p.description || '',
      budget: {
        min: p.budget?.minimum || 0,
        max: p.budget?.maximum || 0,
        currency: p.currency?.sign || '$'
      },
      skills: (p.jobs || []).map(j => j.name),
      bidCount: p.bid_stats?.bid_count || 0,
      clientVerified: p.nonpublic_details?.payment_verified || false,
      url: `https://www.freelancer.com/projects/${p.seo_url}`,
      postedAt: new Date(p.time_submitted * 1000).toISOString()
    }))
  } catch (err) {
    if (err.response?.status === 401) {
      console.error('[Freelancer] ❌ Invalid access token — check your FREELANCER_ACCESS_TOKEN in .env')
    } else {
      console.error('[Freelancer] Search error:', err.message)
    }
    return []
  }
}

// ─── SUBMIT A BID ─────────────────────────────────────────────
async function submitBid({ projectId, amount, period, description, milestones }) {
  try {
    const payload = {
      project_id: parseInt(projectId),
      amount: parseFloat(amount),
      period: period || 7, // days to deliver
      description,
      // optional milestone
      ...(milestones ? { milestones } : {})
    }

    const res = await client.post('/projects/0.1/bids/', payload)
    const data = res.data

    if (data.status !== 'success') {
      console.error('[Freelancer] Bid failed:', data.message)
      return { success: false, error: data.message }
    }

    return { success: true, bidId: data.result?.id }
  } catch (err) {
    const msg = err.response?.data?.message || err.message
    console.error('[Freelancer] Bid error:', msg)
    return { success: false, error: msg }
  }
}

// ─── GET PROJECT DETAILS ──────────────────────────────────────
async function getProject(projectId) {
  try {
    const res = await client.get(`/projects/0.1/projects/${projectId}/`, {
      params: { full_description: true, job_details: true }
    })
    return res.data.result?.project || null
  } catch (err) {
    console.error('[Freelancer] getProject error:', err.message)
    return null
  }
}

// ─── GET MY ACCOUNT INFO ──────────────────────────────────────
async function getMyProfile() {
  try {
    const res = await client.get('/users/0.1/self/', {
      params: { display_info: true, profile_description: true }
    })
    return res.data.result || null
  } catch (err) {
    if (err.response?.status === 401) {
      return { error: 'Invalid token — check FREELANCER_ACCESS_TOKEN in .env' }
    }
    return { error: err.message }
  }
}

// ─── GET MY BID COUNT (for quota tracking) ────────────────────
async function getBidQuota() {
  try {
    // Freelancer tracks bids via the profile endpoint
    const profile = await getMyProfile()
    if (!profile || profile.error) return { used: 0, limit: 8 }

    // The bid quota is in the employer_reputation or similar
    // Exact field varies by account type — we track locally
    return { used: 0, limit: parseInt(process.env.MAX_BIDS_PER_DAY || '8') }
  } catch (err) {
    return { used: 0, limit: 8 }
  }
}

// ─── MOCK MODE (for testing without real API) ─────────────────
// If no token is set, return fake data so you can test the UI
function isMockMode() {
  return !TOKEN || TOKEN === 'your_personal_access_token_here'
}

function mockProjects(query) {
  const samples = [
    { id: 'mock-1', title: `Build a React dashboard for ${query} analytics`, description: 'We need a modern React dashboard with charts, user management, and REST API integration.', budget: { min: 150, max: 400, currency: '$' }, skills: ['React', 'Node.js', 'REST API'], bidCount: 3, clientVerified: true, url: 'https://www.freelancer.com', postedAt: new Date().toISOString() },
    { id: 'mock-2', title: `${query} API integration for e-commerce`, description: 'Looking for an expert to integrate payment gateway and shipping APIs into our store.', budget: { min: 80, max: 250, currency: '$' }, skills: ['API', 'PHP', 'JavaScript'], bidCount: 7, clientVerified: true, url: 'https://www.freelancer.com', postedAt: new Date().toISOString() },
    { id: 'mock-3', title: `Fix ${query} performance issues on our website`, description: 'Site is slow. Need someone to audit and fix the bottlenecks.', budget: { min: 50, max: 150, currency: '$' }, skills: ['JavaScript', 'Performance'], bidCount: 2, clientVerified: false, url: 'https://www.freelancer.com', postedAt: new Date().toISOString() },
  ]
  return samples
}

async function searchProjectsSafe(opts) {
  if (isMockMode()) {
    console.log('[Freelancer] ⚠️  MOCK MODE — using fake projects (add real token to .env to go live)')
    return mockProjects(opts.query)
  }
  return searchProjects(opts)
}

async function submitBidSafe(opts) {
  if (isMockMode()) {
    console.log('[Freelancer] ⚠️  MOCK MODE — bid not actually sent')
    return { success: true, bidId: 'mock-bid-' + Date.now() }
  }
  return submitBid(opts)
}

// ─── GET MY MESSAGES / INBOX ──────────────────────────────────
async function getMessages({ limit = 30, unreadOnly = false } = {}) {
  try {
    const params = {
      limit,
      offset: 0,
      // context: messages related to projects I've bid on
      context: 'project',
      new_messages_only: unreadOnly,
    }
    const res = await client.get('/messages/0.1/threads/', { params })
    const data = res.data
    if (data.status !== 'success') return []

    const threads = data.result?.threads || []
    return threads.map(t => ({
      id: String(t.id),
      subject: t.context?.project?.title || t.subject || 'Message',
      projectId: String(t.context?.project?.id || ''),
      unread: t.message_count?.new > 0,
      lastMessage: t.last_message?.message || '',
      lastTime: t.last_message ? new Date(t.last_message.time_created * 1000).toISOString() : null,
      participants: (t.members || []).map(m => ({
        id: String(m.id),
        name: m.display_name || m.username,
        username: m.username,
        avatar: m.avatar_cdn || null,
        isMe: m.id === t.context?.self_id
      }))
    }))
  } catch (err) {
    console.error('[Freelancer] getMessages error:', err.message)
    return []
  }
}

// ─── GET THREAD MESSAGES ──────────────────────────────────────
async function getThreadMessages(threadId, limit = 50) {
  try {
    const res = await client.get(`/messages/0.1/threads/${threadId}/messages/`, {
      params: { limit, offset: 0 }
    })
    const data = res.data
    if (data.status !== 'success') return []

    return (data.result?.messages || []).map(m => ({
      id: String(m.id),
      from: m.from_user?.display_name || m.from_user?.username || 'Unknown',
      fromId: String(m.from_user?.id || ''),
      text: m.message,
      time: new Date(m.time_created * 1000).toISOString(),
      isMe: !!m.from_self
    }))
  } catch (err) {
    console.error('[Freelancer] getThreadMessages error:', err.message)
    return []
  }
}

// ─── SEND A MESSAGE ───────────────────────────────────────────
async function sendMessage(threadId, message) {
  try {
    const res = await client.post(`/messages/0.1/threads/${threadId}/messages/`, { message })
    const data = res.data
    if (data.status !== 'success') return { success: false, error: data.message }
    return { success: true, messageId: data.result?.id }
  } catch (err) {
    console.error('[Freelancer] sendMessage error:', err.message)
    return { success: false, error: err.message }
  }
}

// ─── MARK THREAD AS READ ──────────────────────────────────────
async function markThreadRead(threadId) {
  try {
    await client.put(`/messages/0.1/threads/${threadId}/`, { read: true })
    return { success: true }
  } catch (err) {
    return { success: false }
  }
}

// ─── SEARCH FREELANCERS (Find Devs) ───────────────────────────
async function searchFreelancers({ query = '', minEarnings = 0, limit = 12, offset = 0 } = {}) {
  try {
    const params = {
      query,
      limit,
      offset,
      // Request extra detail
      profile_description: true,
      display_info: true,
      jobs: true,
      // Filter by earnings if set
      ...(minEarnings > 0 ? { min_earnings: minEarnings } : {})
    }
    const res = await client.get('/users/0.1/users/', { params })
    const data = res.data
    if (data.status !== 'success') return []

    return (data.result?.users || []).map(u => ({
      id: String(u.id),
      name: u.display_name || u.username,
      username: u.username,
      initials: (u.display_name || u.username || 'U').slice(0, 2).toUpperCase(),
      title: u.tagline || '',
      country: u.location?.country?.name || '',
      countryFlag: '', // not provided by API directly
      hourlyRate: u.hourly_rate || 0,
      successRate: u.employer_reputation?.entire_history?.completion_rate
        ? Math.round(u.employer_reputation.entire_history.completion_rate * 100)
        : u.status?.payment_verified ? 100 : null,
      earnings: u.employer_reputation?.entire_history?.earnings || 0,
      hoursWorked: Math.round((u.employer_reputation?.entire_history?.complete || 0) * 10),
      skills: (u.jobs || []).map(j => j.name).slice(0, 8),
      bio: u.profile_description || '',
      avatar: u.avatar_cdn || null,
      profileUrl: `https://www.freelancer.com/u/${u.username}`
    }))
  } catch (err) {
    console.error('[Freelancer] searchFreelancers error:', err.message)
    return []
  }
}

// ─── MOCK DATA FOR MESSAGES ───────────────────────────────────
function mockMessages() {
  return [
    { id:'t1', subject:'React Dashboard for SaaS Analytics', projectId:'p1', unread:true, lastMessage:'Hi! I love your approach — can you tell me more about your experience with Recharts?', lastTime: new Date(Date.now()-5*60000).toISOString(), participants:[{id:'c1',name:'Sarah M.',username:'sarahm',isMe:false},{id:'me',name:'You',username:'you',isMe:true}] },
    { id:'t2', subject:'REST API for E-commerce Platform', projectId:'p2', unread:true, lastMessage:"Thanks for your bid. What's your timeline? We need it done in 2 weeks.", lastTime: new Date(Date.now()-60*60000).toISOString(), participants:[{id:'c2',name:'James T.',username:'jamest',isMe:false},{id:'me',name:'You',username:'you',isMe:true}] },
    { id:'t3', subject:'Fix Node.js Performance Issues', projectId:'p3', unread:true, lastMessage:"We've had 3 devs look at this. Can you share examples of similar work?", lastTime: new Date(Date.now()-3*60*60000).toISOString(), participants:[{id:'c3',name:'Priya K.',username:'priyak',isMe:false},{id:'me',name:'You',username:'you',isMe:true}] },
    { id:'t4', subject:'Python Automation Script', projectId:'p4', unread:false, lastMessage:'Perfect. Hired! Check your milestones.', lastTime: new Date(Date.now()-24*60*60000).toISOString(), participants:[{id:'c4',name:'Marcus L.',username:'marcusl',isMe:false},{id:'me',name:'You',username:'you',isMe:true}] },
  ]
}

function mockThreadMessages(threadId) {
  const map = {
    t1:[
      {id:'m1',from:'Sarah M.',fromId:'c1',text:'Hi! I saw your proposal for my React dashboard project. I love your approach. Can you tell me more about your experience with Recharts or Chart.js?',time:new Date(Date.now()-6*60000).toISOString(),isMe:false}
    ],
    t2:[
      {id:'m1',from:'James T.',fromId:'c2',text:"Thanks for your bid. What's your timeline for this? We need it done within 2 weeks.",time:new Date(Date.now()-61*60000).toISOString(),isMe:false}
    ],
    t3:[
      {id:'m1',from:'Priya K.',fromId:'c3',text:"We've had 3 developers look at this and nobody could fix it. Can you share examples of similar performance work you've done?",time:new Date(Date.now()-3*60*60000).toISOString(),isMe:false}
    ],
    t4:[
      {id:'m1',from:'Marcus L.',fromId:'c4',text:"Looks good! Can you start tomorrow?",time:new Date(Date.now()-25*60*60000).toISOString(),isMe:false},
      {id:'m2',from:'You',fromId:'me',text:"Absolutely — I'll be ready to kick off first thing tomorrow. I'll send a brief outline of my approach beforehand.",time:new Date(Date.now()-24.5*60*60000).toISOString(),isMe:true},
      {id:'m3',from:'Marcus L.',fromId:'c4',text:'Perfect. Hired! Check your milestones.',time:new Date(Date.now()-24*60*60000).toISOString(),isMe:false}
    ]
  }
  return map[threadId] || []
}

function mockFreelancers(query) {
  const all = [
    {id:'d1',name:'Rashed B.',username:'rashedb',initials:'RB',title:'WordPress Designer & Elementor Pro Expert',country:'Bangladesh',countryFlag:'🇧🇩',hourlyRate:28,successRate:100,earnings:30000,hoursWorked:718,skills:['Elementor','WordPress','Landing Page','WooCommerce','Web Design'],bio:'Top WordPress & Elementor expert with 700+ hours on Freelancer. I specialise in high-converting landing pages, full WooCommerce builds, and custom WordPress development.',profileUrl:'https://www.freelancer.com'},
    {id:'d2',name:'Asma K.',username:'asmak',initials:'AK',title:'Webflow & Figma Design Expert',country:'Pakistan',countryFlag:'🇵🇰',hourlyRate:15,successRate:100,earnings:10000,hoursWorked:782,skills:['Webflow','Web Development','Landing Page','Figma','Adaptive Design'],bio:'Website Design Expert specialising in Webflow, Figma, and landing pages. I create visually stunning, SEO-optimised websites that convert visitors into customers.',profileUrl:'https://www.freelancer.com'},
    {id:'d3',name:'Taras K.',username:'tarask',initials:'TK',title:'Webflow Expert | Figma → Website | SEO',country:'Ukraine',countryFlag:'🇺🇦',hourlyRate:29,successRate:100,earnings:100000,hoursWorked:7202,skills:['Webflow','WordPress','Landing Page','UI/UX','Page Speed'],bio:'Webflow Expert with 7200+ hours and $100K earned. I transform creative ideas into high-performing, conversion-focused websites.',profileUrl:'https://www.freelancer.com'},
    {id:'d4',name:'David C.',username:'davidc',initials:'DC',title:'Full-Stack JS Developer (React + Node)',country:'Philippines',countryFlag:'🇵🇭',hourlyRate:22,successRate:98,earnings:50000,hoursWorked:3100,skills:['React','Node.js','REST API','MongoDB','Express'],bio:'Full-stack JavaScript developer with 3000+ hours. I build scalable web apps, REST APIs, and SaaS platforms.',profileUrl:'https://www.freelancer.com'},
    {id:'d5',name:'Maria S.',username:'marias',initials:'MS',title:'Python & Django Backend Developer',country:'Romania',countryFlag:'🇷🇴',hourlyRate:35,successRate:99,earnings:75000,hoursWorked:4800,skills:['Python','Django','PostgreSQL','AWS','Docker'],bio:'Senior Python/Django developer. I build backend systems, REST APIs, and data pipelines. AWS certified.',profileUrl:'https://www.freelancer.com'},
    {id:'d6',name:'Ahmed F.',username:'ahmedf',initials:'AF',title:'React Native Mobile App Developer',country:'Egypt',countryFlag:'🇪🇬',hourlyRate:18,successRate:97,earnings:20000,hoursWorked:1540,skills:['React Native','iOS','Android','Firebase','Expo'],bio:"Mobile developer specialising in React Native. I've shipped 15+ apps to both App Store and Play Store.",profileUrl:'https://www.freelancer.com'},
    {id:'d7',name:'Lena V.',username:'lenav',initials:'LV',title:'Senior UI/UX Designer & Brand Strategist',country:'Russia',countryFlag:'🇷🇺',hourlyRate:40,successRate:100,earnings:120000,hoursWorked:9200,skills:['Figma','UI/UX','Branding','Prototyping','User Research'],bio:'UI/UX designer with $120K+ earned and 9000+ hours. I design SaaS dashboards, mobile apps, and complete brand identities.',profileUrl:'https://www.freelancer.com'},
    {id:'d8',name:'Ken O.',username:'keno',initials:'KO',title:'SEO Specialist & Content Strategist',country:'Nigeria',countryFlag:'🇳🇬',hourlyRate:20,successRate:96,earnings:15000,hoursWorked:890,skills:['SEO','Content Writing','WordPress','Google Analytics','Ahrefs'],bio:"SEO specialist and content strategist. I've ranked 50+ websites on page 1 of Google.",profileUrl:'https://www.freelancer.com'},
    {id:'d9',name:'Sofia R.',username:'sofiar',initials:'SR',title:'Shopify Expert & E-commerce Developer',country:'Argentina',countryFlag:'🇦🇷',hourlyRate:25,successRate:99,earnings:40000,hoursWorked:2600,skills:['Shopify','E-commerce','Liquid','HTML/CSS','Klaviyo'],bio:'Shopify expert with 2600+ hours. I build and customise stores — theme development, app integrations, CRO.',profileUrl:'https://www.freelancer.com'},
  ]
  if (!query) return all
  const q = query.toLowerCase()
  return all.filter(d => d.skills.some(s => s.toLowerCase().includes(q)) || d.title.toLowerCase().includes(q) || d.name.toLowerCase().includes(q))
}

async function getMessagesSafe(opts) {
  if (isMockMode()) return mockMessages()
  return getMessages(opts)
}
async function getThreadMessagesSafe(threadId) {
  if (isMockMode()) return mockThreadMessages(threadId)
  return getThreadMessages(threadId)
}
async function sendMessageSafe(threadId, message) {
  if (isMockMode()) {
    console.log('[Freelancer] MOCK — message not actually sent')
    return { success: true, messageId: 'mock-msg-' + Date.now() }
  }
  return sendMessage(threadId, message)
}
async function searchFreelancersSafe(opts) {
  if (isMockMode()) return mockFreelancers(opts?.query)
  return searchFreelancers(opts)
}

module.exports = {
  searchProjects: searchProjectsSafe,
  submitBid: submitBidSafe,
  getProject,
  getMyProfile,
  getBidQuota,
  getMessages: getMessagesSafe,
  getThreadMessages: getThreadMessagesSafe,
  sendMessage: sendMessageSafe,
  markThreadRead,
  searchFreelancers: searchFreelancersSafe,
  isMockMode
}
