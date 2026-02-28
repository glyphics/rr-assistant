exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const LOGGER_URL        = process.env.LOGGER_URL;

  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'API key not configured' })
    };
  }

  try {
    const body = JSON.parse(event.body);

    // Build system prompt from sheet data passed by frontend
    const d      = body.sheetData || {};
    const cfg    = body.cfg       || {};
    const today  = new Date().toISOString().split('T')[0];

    let system = `You are ${cfg.chatbot_name || 'RR Assistant'}, a civic information assistant for ${cfg.org_name || 'Ridgefield Resistance'}.

CORE RULES:
1. FAQ ANSWERS ARE SCRIPTS — when a user question matches a FAQ, reproduce the FAQ answer content faithfully. Do not paraphrase, do not omit facts, do not substitute your own knowledge.
2. Geographic scope: ${cfg.geographic_focus || 'Ridgefield CT, Fairfield County, Connecticut statewide, Federal CT delegation'}
3. Today is ${today}. Never mention events with expires_date before today.
4. Always provide phone numbers, emails, and links when available.
5. If curated data doesn't have the answer, say so clearly and suggest checking the official website or contacting the org directly.
6. Out of scope: "${cfg.out_of_scope_response || "That's outside my focus area. For broader political questions, check ProPublica, Ballotpedia, or Congress.gov."}"

=== OFFICIALS ===`;

    (d.officials || []).filter(o => o.active !== 'FALSE').forEach(o => {
      if (!o.title) return;
      system += `\n${o.title} ${o.first_name} ${o.last_name} | ${o.level} | District: ${o.district || 'N/A'}`;
      if (o.phone)                         system += ` | Phone: ${o.phone}`;
      if (o.email && o.email !== 'via website') system += ` | Email: ${o.email}`;
      if (o.website)                       system += ` | Website: ${o.website}`;
      if (o.office_address)                system += ` | Office: ${o.office_address}`;
      if (o.notes)                         system += ` | Notes: ${o.notes}`;
    });

    system += '\n\n=== UPCOMING EVENTS ===';
    const events = (d.events || []).filter(e => e.active !== 'FALSE' && (e.expires_date || '9999') >= today);
    if (!events.length) {
      system += '\nNo upcoming events currently scheduled.';
    } else {
      events.forEach(e => {
        system += `\n${e.event_name} (${e.event_type}) — ${e.date} at ${e.time} — ${e.location_name}, ${e.location_address}`;
        if (e.description)       system += ` — ${e.description}`;
        if (e.registration_link) system += ` — Register: ${e.registration_link}`;
      });
    }

    system += '\n\n=== FAQs — CRITICAL: REPRODUCE THESE ANSWERS FAITHFULLY ===';
    system += '\nWhen a user asks something matching a FAQ below, your answer MUST include all the facts in the FAQ answer. Do not omit geographic policy, mission statements, historical context, or any other detail present in the FAQ answer.\n';
    (d.faqs || []).forEach(f => {
      if (!f.question) return;
      system += `\nUSER MAY ASK: "${f.question}"\nREQUIRED ANSWER CONTENT: ${f.answer}\n`;
    });

    system += '\n\n=== RESOURCES ===';
    (d.resources || []).filter(r => r.active !== 'FALSE').forEach(r => {
      if (r.name) system += `\n${r.name} (${r.category}) — ${r.description} — ${r.url}`;
    });

    system += `\n\n=== ORG CONTACT ===\nEmail: ${cfg.org_email || 'N/A'}\nWebsite: ${cfg.org_website || 'N/A'}\nSubstack: ${cfg.org_substack || 'N/A'}`;

    // Call Anthropic API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: system,
        messages: body.messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: data.error || 'API error' })
      };
    }

    // Log to Google Sheets (non-blocking)
    if (LOGGER_URL && body.messages && body.messages.length > 0) {
      const lastUser = [...body.messages].reverse().find(m => m.role === 'user');
      const reply    = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      try {
        await fetch(LOGGER_URL, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            session_id: body.session_id || 'unknown',
            question:   lastUser ? lastUser.content : '',
            response:   reply
          })
        });
      } catch(logErr) {
        console.log('Logging failed:', logErr.message);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(data)
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
