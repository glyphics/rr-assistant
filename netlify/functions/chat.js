// ═══════════════════════════════════════════════════════════════
// ResistChat — Netlify Serverless Function
// File: netlify/functions/chat.js
// Ridgefield Resistance
//
// Proxies requests to Anthropic Claude Haiku.
// Logs each exchange to Google Apps Script (LOGGER_URL),
// now including the `action_served` field (comma-separated
// Action IDs that were displayed to the user during this turn).
// ═══════════════════════════════════════════════════════════════

exports.handler = async function(event) {

  // ── CORS preflight ──────────────────────────────────────────
  if(event.httpMethod === 'OPTIONS'){
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin' : '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  if(event.httpMethod !== 'POST'){
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ── ENV vars ────────────────────────────────────────────────
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const LOGGER_URL        = process.env.LOGGER_URL;

  if(!ANTHROPIC_API_KEY){
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'API key not configured' })
    };
  }

  // ── Parse request body ──────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Invalid JSON body' })
    };
  }

  const {
    session_id     = 'unknown',
    messages       = [],
    system_context = '',
    action_served  = ''   // ← NEW: comma-separated action IDs from index.html
  } = body;

  if(!messages.length){
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'No messages provided' })
    };
  }

  // ── Call Anthropic API ──────────────────────────────────────
  let data;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type'      : 'application/json',
        'x-api-key'         : ANTHROPIC_API_KEY,
        'anthropic-version' : '2023-06-01'
      },
      body: JSON.stringify({
        model      : 'claude-haiku-4-5-20251001',
        max_tokens : 1024,
        system     : system_context,
        messages   : messages
      })
    });
    data = await response.json();
  } catch(err){
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Upstream API error: ' + err.message })
    };
  }

  // ── Log to Google Apps Script ───────────────────────────────
  // Non-blocking — never lets a logger failure affect the user response.
  if(LOGGER_URL){
    try {
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const reply    = data.content?.[0]?.text || '';

      await fetch(LOGGER_URL, {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify({
          session_id    : session_id,
          question      : lastUser ? lastUser.content : '',
          response      : reply,
          action_served : action_served   // ← NEW: forwarded to Apps Script
        })
      });
    } catch(logErr){
      // Silent fail — logging never blocks the user
      console.log('Logger error:', logErr.message);
    }
  }

  // ── Return Claude response ──────────────────────────────────
  return {
    statusCode: 200,
    headers: {
      'Content-Type'              : 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(data)
  };
};
