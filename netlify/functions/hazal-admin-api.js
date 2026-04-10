const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || 'https://keen-ant-82868.upstash.io';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || 'gQAAAAAAAUO0AAIncDFjMGE3Y2MzODU3NzM0YTI0ODI0OTg3M2ZhZDA5ZTUwOHAxODI4Njg';
const ADMIN_PASS = process.env.HAZAL_ADMIN_PASS || 'Jwaijo249@jwaijo';

async function redis(cmd, ...args) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([cmd, ...args])
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.result;
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
  return `HZ-${seg()}-${seg()}`;
}

exports.handler = async (event) => {
  const H = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'Content-Type', 'Content-Type':'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode:200, headers:H, body:'' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { action, password } = body;

    if (password !== ADMIN_PASS) return R(401, { error:'كلمة المرور خاطئة' }, H);

    // ── GENERATE CODES ──
    if (action === 'generateCodes') {
      const { count=1, months=1, plan='basic', notes='' } = body;
      const codes = [];
      const expiresAt = Date.now() + months * 30 * 24 * 60 * 60 * 1000;

      for (let i = 0; i < Math.min(count, 50); i++) {
        const code = genCode();
        const data = { code, plan, months, notes, expiresAt, createdAt: Date.now(), used: false };
        await redis('SET', `hazal:code:${code}`, JSON.stringify(data));
        await redis('EXPIRE', `hazal:code:${code}`, months * 30 * 24 * 60 * 60);
        codes.push({ code, expiresAt });
        // Track in list
        await redis('LPUSH', 'hazal:codes:list', code);
      }
      await redis('LTRIM', 'hazal:codes:list', 0, 999);
      return R(200, { codes }, H);
    }

    // ── LIST CODES ──
    if (action === 'listCodes') {
      const list = await redis('LRANGE', 'hazal:codes:list', 0, 99) || [];
      const results = [];
      for (const code of list) {
        try {
          const raw = await redis('GET', `hazal:code:${code}`);
          if (raw) results.push(JSON.parse(raw));
        } catch(e) {}
      }
      return R(200, { codes: results }, H);
    }

    // ── DELETE CODE ──
    if (action === 'deleteCode') {
      const { code } = body;
      await redis('DEL', `hazal:code:${code}`);
      return R(200, { ok: true }, H);
    }

    // ── STATS ──
    if (action === 'stats') {
      const codeCount = await redis('LLEN', 'hazal:codes:list') || 0;
      return R(200, { codeCount }, H);
    }

    // ── TEST REDIS ──
    if (action === 'testRedis') {
      await redis('SET', 'hazal:test', 'ok');
      const val = await redis('GET', 'hazal:test');
      return R(200, { ok: val === 'ok', message: val === 'ok' ? '✅ Redis يشتغل بشكل مثالي!' : '❌ Redis فيه مشكلة' }, H);
    }

    return R(400, { error: 'إجراء غير معروف' }, H);
  } catch(e) {
    return R(500, { error: 'خطأ: ' + e.message }, H);
  }
};

function R(s,b,h){ return { statusCode:s, headers:h, body:JSON.stringify(b) }; }
