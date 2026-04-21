require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*', methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '20kb' }));

// ── Rate Limiting ─────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please wait a few minutes.' } });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 12, message: { error: 'Slow down — max 12 messages per minute.' } });

// ── Serve Frontend ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Doctigo Insight API',
    version: '3.0.0',
    ai: process.env.ANTHROPIC_API_KEY ? 'configured' : 'missing — add ANTHROPIC_API_KEY',
    timestamp: new Date().toISOString()
  });
});

// ── Module System Prompts ─────────────────────────────────────────────────────
const MODULE_PROMPTS = {
  medical: `You are Doctigo Insight's Medical AI — a highly knowledgeable clinical decision support system. 
Provide structured, evidence-based medical analysis using clear headers and bullet points.
Always recommend consulting a licensed physician for actual clinical decisions.
Format responses with sections: Assessment, Differential Diagnosis, Recommended Tests, Treatment Considerations, Urgency Level.`,

  marketing: `You are Doctigo Insight's Marketing AI — an expert in healthcare marketing, digital campaigns, 
HIPAA-compliant brand communication, and content strategy. Create compelling, professional, 
platform-optimised marketing content with clear sections and actionable copy.`,

  automation: `You are Doctigo Insight's Workflow AI — an expert in process automation, RPA, n8n, Zapier, 
Make.com, and Python scripting. Design practical, implementable automation blueprints that eliminate 
manual computer tasks. Be specific about tools, triggers, error handling, and estimated time savings.`,

  graphics: `You are Doctigo Insight's Creative AI — expert in visual content direction, social media copy, 
video production scripts, and brand design for healthcare organisations. Create professional, 
platform-optimised creative content with strong hooks and clear CTAs.`,

  general: `You are Doctigo Insight — an advanced AI intelligence platform for healthcare and business. 
You are knowledgeable across medical, marketing, business strategy, technology, and creative domains. 
Be professional, accurate, comprehensive, and always prioritise patient safety in medical contexts.`
};

// ── General Chat (with conversation history) ──────────────────────────────────
app.post('/api/chat', apiLimiter, chatLimiter, async (req, res) => {
  const { messages, system, max_tokens = 1000 } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: 'messages array is required.' });
  if (messages.length > 60)
    return res.status(400).json({ error: 'Conversation too long. Max 60 messages.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AI not configured — add ANTHROPIC_API_KEY to environment variables.' });

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens, messages, ...(system && { system }) })
    });
    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: data.error?.message || 'AI API error' });
    res.json({ content: data.content[0]?.text || '' });
  } catch (e) {
    console.error('[Chat Error]', e.message);
    res.status(500).json({ error: 'Internal server error — please try again.' });
  }
});

// ── Module Endpoints (pre-configured system prompts) ──────────────────────────
app.post('/api/module/:module', apiLimiter, async (req, res) => {
  const { module } = req.params;
  const { prompt, messages, max_tokens = 1400 } = req.body;

  const systemPrompt = MODULE_PROMPTS[module] || MODULE_PROMPTS.general;
  if (!prompt && (!messages || !messages.length))
    return res.status(400).json({ error: 'prompt or messages required.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AI not configured.' });

  try {
    const msgArray = messages || [{ role: 'user', content: prompt }];
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens, system: systemPrompt, messages: msgArray })
    });
    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: data.error?.message || 'AI error' });
    res.json({ content: data.content[0]?.text || '' });
  } catch (e) {
    console.error(`[Module ${module}]`, e.message);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// ── Catch-all → serve SPA ────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🟢 Doctigo Insight  →  http://localhost:${PORT}`);
  console.log(`   AI Key : ${process.env.ANTHROPIC_API_KEY ? '✓ Configured' : '✗ MISSING — set ANTHROPIC_API_KEY'}`);
  console.log(`   Env    : ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
