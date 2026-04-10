const Anthropic = require('@anthropic-ai/sdk');

exports.handler = async (event) => {
  const H = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: H, body: '' };

  try {
    const { message } = JSON.parse(event.body || '{}');
    if (!message) return { statusCode: 400, headers: H, body: JSON.stringify({ reply: 'هزّول يقول: قل شي! 😂' }) };

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      system: `أنت هزّول، بوت خليجي مضحك خفيف الدم في لعبة "هزل".
شخصيتك:
- خفيف الدم، ذكاء خبيث، دمه خفيف
- تضحك مع اللاعبين وتعلق على كلامهم بطريقة طريفة
- عندك ردود فعل مبالغ فيها بطريقة مضحكة

قواعد صارمة:
- ردك جملة واحدة أو جملتين فقط - لا أكثر
- دائماً ابدأ بـ "هزّول يقول:" أو "هزّول:"
- استخدم إيموجي مضحك ١-٢ فقط
- رد بالعربي الخليجي الكويتي البسيط
- لا تكون رسمي أبداً
- إذا كلام المستخدم مضحك، اضحك معه بمبالغة
- إذا سألك سؤال، رد بطريقة مضحكة مو جدية`,
      messages: [{ role: 'user', content: message.slice(0, 200) }]
    });

    const reply = response.content[0]?.text?.trim() || 'هزّول يقول: واو! 😂';
    return { statusCode: 200, headers: H, body: JSON.stringify({ reply }) };

  } catch (e) {
    console.error('hazal-bot error:', e.message);
    // fallback مضمون لو API فشل
    const fallbacks = [
      'هزّول يقول: ههههه! 😂',
      'هزّول يقول: والله ما عنده رد على هذا! 💀',
      'هزّول يقول: يضحك ويسكت 🤖😂',
    ];
    const reply = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    return { statusCode: 200, headers: H, body: JSON.stringify({ reply }) };
  }
};
