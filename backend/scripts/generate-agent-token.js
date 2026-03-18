#!/usr/bin/env node
'use strict';
/**
 * Vanguard OS — Agent Token Generator
 * Usage:
 *   node scripts/generate-agent-token.js \
 *     --email superadmin@vanguardos.io \
 *     --password changeme \
 *     --description "Austin DC - srv01"
 */
require('dotenv').config();
const https  = require('https');
const http   = require('http');
const crypto = require('crypto');

const args   = process.argv.slice(2);
const get    = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i+1] : null; };

const API_BASE    = get('--api')    || `http://localhost:${process.env.PORT || 3001}`;
const EMAIL       = get('--email')  || 'superadmin@vanguardos.io';
const PASSWORD    = get('--password') || 'changeme';
const DESCRIPTION = get('--description') || 'CLI-generated token';

async function post(url, body) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);
    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('\n🔑  Vanguard OS — Agent Token Generator\n');

  // Login
  console.log(`Authenticating as ${EMAIL} …`);
  const loginRes = await post(`${API_BASE}/api/auth/login`, { email: EMAIL, password: PASSWORD });
  if (loginRes.status !== 200) {
    console.error('Login failed:', loginRes.body);
    process.exit(1);
  }
  const { token } = loginRes.body;
  console.log('✓  Authenticated\n');

  // Generate raw token
  const rawToken  = crypto.randomBytes(48).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // Call agent-token endpoint (POST /api/agent/tokens)
  const createRes = await post(`${API_BASE}/api/agent/tokens`, {
    description: DESCRIPTION,
    rawToken,
    tokenHash,
  });

  if (createRes.status === 201) {
    console.log('✅  Agent token created!\n');
    console.log('┌────────────────────────────────────────────────────────────────────┐');
    console.log('│  STORE THIS TOKEN — it will NOT be shown again.                    │');
    console.log('├────────────────────────────────────────────────────────────────────┤');
    console.log(`│  Token: ${rawToken}`);
    console.log('└────────────────────────────────────────────────────────────────────┘\n');
    console.log('Set on the agent machine:');
    console.log(`  Linux/macOS : export VANGUARD_AGENT_TOKEN="${rawToken}"`);
    console.log(`  Windows     : $env:VANGUARD_AGENT_TOKEN="${rawToken}"\n`);
  } else {
    console.error('Failed:', createRes.body);
    process.exit(1);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
