const UPAYMENTS_KEY = process.env.UPAYMENTS_API_KEY || 'e66a94d579cf75fba327ff716ad68c53aae11528';
const UPAYMENTS_URL = process.env.UPAYMENTS_URL || 'https://sandboxapi.upayments.com/api/v1/charge';
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || 'https://keen-ant-82868.upstash.io';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || 'gQAAAAAAAUO0AAIncDFjMGE3Y2MzODU3NzM0YTI0ODI0OTg3M2ZhZDA5ZTUwOHAxODI4Njg';

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
  const seg = () => Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `HZ-${seg()}-${seg()}`;
}

const PLANS = {
  month:  { months: 1,  amount: 3,  label: 'شهر واحد'    },
  half:   { months: 6,  amount: 8,  label: '٦ أشهر'      },
  year:   { months: 12, amount: 12, label: 'سنة كاملة'   },
};

exports.handler = async (event) => {
  const H = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: H, body: '' };

  try {
    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    // ── إنشاء طلب دفع ──
    if (action === 'createCharge') {
      const { plan, customerEmail, customerName, customerPhone } = body;
      const p = PLANS[plan];
      if (!p) return R(400, { error: 'باقة غير صحيحة' }, H);

      const orderId = `HZ-${Date.now()}-${Math.random().toString(36).substring(2,6).toUpperCase()}`;
      const siteUrl = process.env.URL || 'https://hazalgame.netlify.app';

      const chargeBody = {
        order: {
          id: orderId,
          description: `هزل - ${p.label}`,
          currency: 'KWD',
          amount: parseFloat(p.amount.toFixed(3)),
        },
        reference: {
          id: orderId,
        },
        language: 'ar',
        customer: {
          uniqueId: orderId,
          name: customerName || 'هزل مستخدم',
          email: customerEmail || 'user@hazal.com',
          mobile: customerPhone || '96500000000',
        },
        returnUrl: `${siteUrl}/payment-success.html?orderId=${orderId}`,
        cancelUrl: `${siteUrl}/payment-cancel.html`,
        notificationUrl: `${siteUrl}/.netlify/functions/hazal-payment`,
        products: [{
          name: `هزل - ${p.label}`,
          description: `اشتراك هزل ${p.label}`,
          price: parseFloat(p.amount.toFixed(3)),
          quantity: 1,
        }],
        paymentGateway: {
          src: 'knet',
        },
      };

      const res = await fetch(UPAYMENTS_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${UPAYMENTS_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(chargeBody),
      });

      const data = await res.json();

      if (!data.status && !data.data?.link && !data.link) {
        // log full response for debugging
        console.error('uPayments error:', JSON.stringify(data));
        return R(400, { error: data.message || data.error || 'فشل إنشاء طلب الدفع', raw: data }, H);
      }

      const paymentUrl = data.data?.link || data.link || data.url || data.data?.url;
      if (!paymentUrl) {
        return R(400, { error: 'ما رجع رابط الدفع', raw: data }, H);
      }

      // احفظ بيانات الطلب في Redis مؤقتاً
      await redis('SET', `hazal:order:${orderId}`, JSON.stringify({ plan, months: p.months, orderId, status: 'pending' }));
      await redis('EXPIRE', `hazal:order:${orderId}`, 3600);

      return R(200, { paymentUrl, orderId }, H);
    }

    // ── Webhook من uPayments بعد الدفع ──
    if (event.httpMethod === 'POST' && !action) {
      const webhook = JSON.parse(event.body || '{}');
      const orderId = webhook.order?.id || webhook.id;
      const status  = webhook.status || webhook.result;

      if ((status === 'success' || status === 'CAPTURED') && orderId) {
        const raw = await redis('GET', `hazal:order:${orderId}`);
        if (raw) {
          const order = JSON.parse(raw);
          const code = genCode();
          const expiresAt = Date.now() + order.months * 30 * 24 * 60 * 60 * 1000;
          await redis('SET', `hazal:code:${code}`, JSON.stringify({ code, plan: order.plan, months: order.months, expiresAt, createdAt: Date.now(), orderId }));
          await redis('EXPIRE', `hazal:code:${code}`, order.months * 30 * 24 * 60 * 60);
          await redis('LPUSH', 'hazal:codes:list', code);
          await redis('SET', `hazal:order:${orderId}`, JSON.stringify({ ...order, status: 'paid', code }));
        }
      }
      return { statusCode: 200, headers: H, body: 'ok' };
    }

    // ── تأكيد الدفع يدوياً (fallback لو الـ Webhook ما وصل) ──
    if (action === 'confirmPayment') {
      const { orderId } = body;
      const raw = await redis('GET', `hazal:order:${orderId}`);
      if (!raw) return R(404, { error: 'الطلب غير موجود' }, H);
      const order = JSON.parse(raw);
      // لو الكود موجود أصلاً ارجعيه
      if (order.code) return R(200, { status:'paid', code: order.code }, H);
      // ولّد كود جديد
      const code = genCode();
      const expiresAt = Date.now() + order.months * 30 * 24 * 60 * 60 * 1000;
      await redis('SET', `hazal:code:${code}`, JSON.stringify({ code, plan: order.plan, months: order.months, expiresAt, createdAt: Date.now(), orderId }));
      await redis('EXPIRE', `hazal:code:${code}`, order.months * 30 * 24 * 60 * 60);
      await redis('LPUSH', 'hazal:codes:list', code);
      await redis('SET', `hazal:order:${orderId}`, JSON.stringify({ ...order, status:'paid', code }));
      return R(200, { status:'paid', code }, H);
    }

    // ── تحقق من حالة الطلب ──
    if (action === 'checkOrder') {
      const { orderId } = body;
      const raw = await redis('GET', `hazal:order:${orderId}`);
      if (!raw) return R(404, { error: 'الطلب غير موجود' }, H);
      const order = JSON.parse(raw);
      return R(200, { status: order.status, code: order.code || null }, H);
    }

    return R(400, { error: 'إجراء غير معروف' }, H);
  } catch (e) {
    return R(500, { error: 'خطأ: ' + e.message }, H);
  }
};

function R(s, b, h) { return { statusCode: s, headers: h, body: JSON.stringify(b) }; }
