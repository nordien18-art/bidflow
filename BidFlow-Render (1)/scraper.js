// scraper.js — Fetch real Freelancer.com jobs without an API token
// Uses Freelancer's public project search endpoint (same one their website uses)
const axios = require('axios')

const BASE = 'https://www.freelancer.com/api'

// Category IDs on Freelancer.com
const CATEGORIES = {
  'web':     [3, 13, 17],   // Web Dev, HTML, JavaScript
  'design':  [15, 56],      // Design, UI/UX
  'mobile':  [7],           // Mobile
  'api':     [3, 13],       // Backend/API
  'python':  [13],          // Software Dev
  'writing': [45],          // Writing
  'seo':     [8],           // SEO
}

// ─── FETCH LIVE JOBS ──────────────────────────────────────────
async function fetchJobs({ query = '', category = '', limit = 20, minBudget = 0, maxBudget = 0 } = {}) {
  try {
    const params = {
      job_details: true,
      full_description: false,
      limit,
      offset: 0,
      sort_field: 'time_updated',
      // Only show active projects
      project_statuses: ['active'],
      // Only fixed price + hourly
      'project_types[]': ['fixed', 'hourly'],
    }

    if (query) params.query = query
    if (minBudget > 0) params.min_avg_price = minBudget
    if (maxBudget > 0) params.max_avg_price = maxBudget

    // Add job/category IDs if category filter set
    if (category && CATEGORIES[category]) {
      CATEGORIES[category].forEach((id, i) => {
        params[`jobs[${i}]`] = id
      })
    }

    const res = await axios.get(`${BASE}/projects/0.1/projects/active/`, {
      params,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        // Use a browser-like user agent to avoid being blocked
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    })

    const data = res.data
    if (data.status !== 'success') {
      console.error('[Scraper] API error:', data.message)
      return []
    }

    const projects = data.result?.projects || []
    return projects.map(formatProject)

  } catch (err) {
    console.error('[Scraper] Fetch error:', err.message)
    return []
  }
}

// ─── FORMAT A PROJECT ─────────────────────────────────────────
function formatProject(p) {
  const minB = p.budget?.minimum || 0
  const maxB = p.budget?.maximum || 0
  const currency = p.currency?.sign || '$'

  // Build budget string
  let budgetStr = ''
  if (maxB > 0) budgetStr = `${currency}${minB}–${maxB}`
  else if (minB > 0) budgetStr = `${currency}${minB}+`
  else budgetStr = 'Open budget'

  // Skills/tags
  const tags = (p.jobs || []).map(j => j.name).slice(0, 5)

  // Time ago
  const postedAt = p.time_submitted ? new Date(p.time_submitted * 1000) : new Date()
  const timeAgo = getTimeAgo(postedAt)

  // Build direct URL to project
  const url = p.seo_url
    ? `https://www.freelancer.com/projects/${p.seo_url}`
    : `https://www.freelancer.com/projects/${p.id}`

  // Determine category
  const jobIds = (p.jobs || []).map(j => j.id)
  let cat = 'other'
  if (jobIds.some(id => [3,13,17].includes(id))) cat = 'web'
  else if (jobIds.some(id => [15,56].includes(id))) cat = 'design'
  else if (jobIds.some(id => [7].includes(id))) cat = 'mobile'
  else if (jobIds.some(id => [8].includes(id))) cat = 'seo'
  else if (jobIds.some(id => [45].includes(id))) cat = 'writing'

  return {
    id: String(p.id),
    title: p.title || 'Untitled Project',
    description: p.description || '',
    budget: budgetStr,
    budgetMin: minB,
    budgetMax: maxB,
    currency,
    tags,
    cat,
    time: timeAgo,
    postedAt: postedAt.toISOString(),
    bidCount: p.bid_stats?.bid_count || 0,
    url,
    clientVerified: p.nonpublic_details?.payment_verified || false,
    type: p.type || 'fixed'
  }
}

function getTimeAgo(date) {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return Math.floor(secs / 60) + ' min ago'
  if (secs < 86400) return Math.floor(secs / 3600) + ' hr ago'
  return Math.floor(secs / 86400) + 'd ago'
}

// ─── CACHE ────────────────────────────────────────────────────
// Cache results for 3 minutes so rapid refreshes don't hammer Freelancer
let cache = {}
const CACHE_TTL = 3 * 60 * 1000 // 3 minutes

async function fetchJobsCached(opts = {}) {
  const key = JSON.stringify(opts)
  const now = Date.now()

  if (cache[key] && (now - cache[key].time) < CACHE_TTL) {
    console.log('[Scraper] Serving from cache')
    return cache[key].data
  }

  const jobs = await fetchJobs(opts)

  if (jobs.length > 0) {
    cache[key] = { data: jobs, time: now }
  }

  return jobs
}

// ─── FALLBACK JOBS (shown if scraping fails) ──────────────────
function getFallbackJobs() {
  return [
    { id:'f1', title:'Build a React dashboard for SaaS analytics', description:'', budget:'$200–500', budgetMin:200, budgetMax:500, currency:'$', tags:['React','Node.js'], cat:'web', time:'3 min ago', bidCount:4, url:'https://www.freelancer.com/jobs/react/', clientVerified:true, type:'fixed' },
    { id:'f2', title:'WordPress custom plugin — WooCommerce', description:'', budget:'$80–200', budgetMin:80, budgetMax:200, currency:'$', tags:['WordPress','PHP'], cat:'web', time:'5 min ago', bidCount:7, url:'https://www.freelancer.com/jobs/wordpress/', clientVerified:true, type:'fixed' },
    { id:'f3', title:'Python scraper for product listings', description:'', budget:'$100–300', budgetMin:100, budgetMax:300, currency:'$', tags:['Python','Scraping'], cat:'python', time:'12 min ago', bidCount:3, url:'https://www.freelancer.com/jobs/python/', clientVerified:false, type:'fixed' },
    { id:'f4', title:'REST API for mobile app backend', description:'', budget:'$150–400', budgetMin:150, budgetMax:400, currency:'$', tags:['REST','Node.js'], cat:'api', time:'18 min ago', bidCount:5, url:'https://www.freelancer.com/jobs/api/', clientVerified:true, type:'fixed' },
    { id:'f5', title:'React Native delivery app', description:'', budget:'$300–800', budgetMin:300, budgetMax:800, currency:'$', tags:['React Native','Mobile'], cat:'mobile', time:'24 min ago', bidCount:9, url:'https://www.freelancer.com/jobs/react-native/', clientVerified:true, type:'fixed' },
    { id:'f6', title:'Figma to HTML landing page', description:'', budget:'$50–150', budgetMin:50, budgetMax:150, currency:'$', tags:['HTML','CSS','Figma'], cat:'design', time:'31 min ago', bidCount:12, url:'https://www.freelancer.com/jobs/html/', clientVerified:false, type:'fixed' },
    { id:'f7', title:'Full-stack SaaS MVP build', description:'', budget:'$500–2000', budgetMin:500, budgetMax:2000, currency:'$', tags:['React','Node.js','AWS'], cat:'web', time:'40 min ago', bidCount:6, url:'https://www.freelancer.com/jobs/software-development/', clientVerified:true, type:'fixed' },
    { id:'f8', title:'Django REST API with PostgreSQL', description:'', budget:'$200–600', budgetMin:200, budgetMax:600, currency:'$', tags:['Django','Python'], cat:'api', time:'55 min ago', bidCount:4, url:'https://www.freelancer.com/jobs/django/', clientVerified:true, type:'fixed' },
    { id:'f9', title:'Shopify store setup + customisation', description:'', budget:'$150–400', budgetMin:150, budgetMax:400, currency:'$', tags:['Shopify','E-commerce'], cat:'web', time:'1 hr ago', bidCount:8, url:'https://www.freelancer.com/jobs/shopify/', clientVerified:true, type:'fixed' },
    { id:'f10', title:'UI/UX design for fintech dashboard', description:'', budget:'$150–500', budgetMin:150, budgetMax:500, currency:'$', tags:['Figma','UI/UX'], cat:'design', time:'1 hr ago', bidCount:3, url:'https://www.freelancer.com/jobs/ui-ux/', clientVerified:true, type:'fixed' },
    { id:'f11', title:'SEO audit and optimisation', description:'', budget:'$50–200', budgetMin:50, budgetMax:200, currency:'$', tags:['SEO','WordPress'], cat:'seo', time:'2 hr ago', bidCount:6, url:'https://www.freelancer.com/jobs/seo/', clientVerified:false, type:'fixed' },
    { id:'f12', title:'Chrome extension development', description:'', budget:'$100–350', budgetMin:100, budgetMax:350, currency:'$', tags:['JavaScript','Chrome'], cat:'web', time:'2 hr ago', bidCount:5, url:'https://www.freelancer.com/jobs/javascript/', clientVerified:true, type:'fixed' },
  ]
}

module.exports = { fetchJobs: fetchJobsCached, getFallbackJobs }
