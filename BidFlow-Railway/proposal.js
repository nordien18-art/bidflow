// proposal.js — Generate personalised proposals using Claude AI
const Anthropic = require('@anthropic-ai/sdk')

let anthropic
function getClient() {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return anthropic
}

// ─── GENERATE A PROPOSAL ──────────────────────────────────────
async function generateProposal({ project, rule, tone = 'friendly', askQuestion = true, scriptTemplate = null }) {
  const toneGuide = {
    professional: 'formal, professional, authoritative',
    friendly: 'warm, friendly, confident, conversational',
    concise: 'very short and direct — 3 paragraphs max',
    consultative: 'consultative, asking clarifying questions, showing strategic thinking'
  }

  const systemPrompt = `You are an expert freelancer writing a winning bid proposal on Freelancer.com.
Your proposals are ${toneGuide[tone] || toneGuide.friendly}.
You write in first person. You never use clichés like "I am the perfect candidate" or "Look no further".
You never use bullet points. You write 2-4 short paragraphs.
${askQuestion ? 'Always end with ONE relevant question about the project.' : ''}
Never write a subject line or greeting like "Dear Sir/Madam". Start with "Hi there," or "Hi [Name]," or just dive in.
Keep it under 200 words.`

  const userPrompt = `Write a bid proposal for this Freelancer.com project:

Title: ${project.title}
Description: ${project.description?.slice(0, 500) || '(no description provided)'}
Budget: ${project.budget.currency}${project.budget.min}–${project.budget.max}
Skills needed: ${project.skills.join(', ') || 'not specified'}
My expertise area: ${rule.name}
Keywords I target: ${rule.keywords.join(', ')}

${scriptTemplate ? `Base the proposal loosely on this template but make it feel natural and specific to the project:\n${scriptTemplate}` : ''}

Write the proposal now:`

  try {
    const client = getClient()
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })

    const text = msg.content[0]?.text || ''
    return { success: true, text }
  } catch (err) {
    console.error('[Proposal] Claude API error:', err.message)

    // Fallback: use template if Claude fails
    const fallback = scriptTemplate
      ? scriptTemplate
          .replace('[PROJECT_TITLE]', project.title)
          .replace('[SKILLS]', rule.keywords.slice(0, 3).join(', '))
          .replace('[AI_CUSTOM_PARAGRAPH]', `I noticed your project requires ${project.skills[0] || rule.keywords[0]} — this is my core speciality.`)
          .replace('[CLIENT_NAME]', 'there')
      : `Hi there,\n\nI saw your project "${project.title}" and I'm confident I can help. My background in ${rule.keywords.slice(0,2).join(' and ')} makes me a strong fit.\n\nI can start immediately. What timeline are you working with?`

    return { success: true, text: fallback, fallback: true }
  }
}

// ─── CALCULATE BID AMOUNT ─────────────────────────────────────
function calculateBidAmount(project, rule) {
  const max = project.budget.max
  const min = project.budget.min
  const pct = rule.bid_pct / 100

  // Bid at X% of the max budget, but not below min
  let amount = Math.round(max * pct)
  if (amount < min) amount = min

  // Round to nearest 5
  amount = Math.ceil(amount / 5) * 5

  return amount
}

module.exports = { generateProposal, calculateBidAmount }
