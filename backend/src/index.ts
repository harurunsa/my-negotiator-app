import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  DB: D1Database
  GEMINI_API_KEY: string
  LEMON_SQUEEZY_API_KEY: string
  LEMON_SQUEEZY_STORE_ID: string
  LEMON_SQUEEZY_VARIANT_ID_YEARLY: string
  LEMON_SQUEEZY_VARIANT_ID_MONTHLY: string
  LEMON_SQUEEZY_WEBHOOK_SECRET: string
  FRONTEND_URL: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/*', cors())

const DAILY_LIMIT = 5;

// --- PPP設定 ---
const PPP_DISCOUNTS: { [key: string]: string } = {
  'IN': 'PPP50', 'BR': 'PPP50', 'ID': 'PPP50', 'PH': 'PPP50', 
  'VN': 'PPP50', 'EG': 'PPP50', 'NG': 'PPP50', 'BD': 'PPP50', 'PK': 'PPP50',
  'CN': 'PPP30', 'MX': 'PPP30', 'TH': 'PPP30', 'TR': 'PPP30', 
  'MY': 'PPP30', 'RU': 'PPP30', 'AR': 'PPP30',
};

// --- 国と言語のマッピング ---
const COUNTRY_TO_LANG: { [key: string]: string } = {
  'JP': 'ja', 
  'BR': 'pt', 'PT': 'pt', 'AO': 'pt', 'MZ': 'pt',
  'ES': 'es', 'MX': 'es', 'AR': 'es', 'CO': 'es', 'PE': 'es', 'CL': 'es',
  'ID': 'id',
  'US': 'en', 'GB': 'en', 'AU': 'en', 'CA': 'en'
};

const ARCHETYPES = {
  empathy: {
    label: "The Empathic Counselor",
    prompt: "Tone: Warm, soft, soothing. [CONSTRAINT]: Max 3 sentences. Focus ONLY on the very first tiny step. Do not give a full plan."
  },
  logic: {
    label: "The Logical Analyst",
    prompt: "Tone: Precise, efficient. [CONSTRAINT]: Max 3 sentences. Output only the immediate next physical action. No bullet points of future steps."
  },
  game: {
    label: "The Game Master",
    prompt: "Tone: Playful, RPG-style. [CONSTRAINT]: Max 3 sentences. Treat the next step as a 'Mini Quest'. Keep it short and punchy."
  },
  passion: {
    label: "The Passionate Coach",
    prompt: "Tone: Hot, energetic! [CONSTRAINT]: Max 3 sentences. Push for immediate action! 'Just do this one thing!'"
  },
  minimal: {
    label: "The Minimalist",
    prompt: "Tone: Robot. [CONSTRAINT]: Max 15 words. State the action only."
  }
};

type ArchetypeKey = keyof typeof ARCHETYPES;

const MESSAGES: any = {
  ja: { limit_reached: "無料版の制限に達しました。SNSシェアで回復するか、Proプランにアップグレードしてください！" },
  en: { limit_reached: "Free limit reached. Share to reset or Upgrade!" },
  pt: { limit_reached: "Limite gratuito atingido. Compartilhe para resetar ou faça Upgrade!" },
  es: { limit_reached: "Límite gratuito alcanzado. ¡Comparte para reiniciar o actualiza a Pro!" },
  id: { limit_reached: "Batas gratis tercapai. Bagikan untuk reset atau Upgrade!" }
};

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return "{}";
  return text.substring(start, end + 1);
}

async function callLemonSqueezy(path: string, method: string, apiKey: string, body?: any) {
  console.log(`[LemonSqueezy] Request: ${method} /${path}`);
  const res = await fetch(`https://api.lemonsqueezy.com/v1/${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`Lemon Squeezy Non-JSON: ${text.substring(0, 100)}`); }
  if (!res.ok || data.errors) {
    const errorDetail = data.errors ? data.errors.map((e: any) => `${e.title}: ${e.detail}`).join(', ') : "Unknown API Error";
    throw new Error(`Lemon Squeezy Failed: ${errorDetail}`);
  }
  return data;
}

// --- Auth Routes ---
app.get('/auth/login', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  const callbackUrl = `${new URL(c.req.url).origin}/auth/callback`
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${callbackUrl}&response_type=code&scope=openid%20email%20profile`
  return c.redirect(url)
})

app.get('/auth/callback', async (c) => {
  const code = c.req.query('code')
  const clientId = c.env.GOOGLE_CLIENT_ID
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET
  const callbackUrl = `${new URL(c.req.url).origin}/auth/callback`

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: callbackUrl, grant_type: 'authorization_code' }),
    })
    const tokenData: any = await tokenResponse.json()
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const userData: any = await userResponse.json()

    // ★国コードから言語を決定
    const country = c.req.header('cf-ipcountry') || 'US';
    const detectedLang = COUNTRY_TO_LANG[country] || 'en';

    // ユーザー作成または更新 (言語設定がなければ初期値をセット)
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, name, language, created_at) 
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name`
    ).bind(userData.id, userData.email, userData.name, detectedLang, Date.now()).run();

    // ユーザー情報を取得してフロントエンドへ
    const user: any = await c.env.DB.prepare("SELECT streak, is_pro, language FROM users WHERE id = ?").bind(userData.id).first();
    const finalLang = user.language || detectedLang; // DBの値があればそちらを優先

    const frontendUrl = c.env.FRONTEND_URL || "https://my-negotiator-app.pages.dev";
    return c.redirect(`${frontendUrl}?email=${userData.email}&name=${encodeURIComponent(userData.name)}&streak=${user.streak || 0}&pro=${user.is_pro || 0}&lang=${finalLang}`)
  } catch (e: any) {
    return c.text(`Auth Error: ${e.message}`, 500)
  }
})

// --- ★ 言語設定更新API ---
app.post('/api/language', async (c) => {
  try {
    const { email, language } = await c.req.json();
    await c.env.DB.prepare("UPDATE users SET language = ? WHERE email = ?").bind(language, email).run();
    return c.json({ success: true, language });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- AI Chat ---
app.post('/api/chat', async (c) => {
  try {
    const { message, email, action, prev_context, current_goal, lang = 'ja' } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    const t = MESSAGES[lang] || MESSAGES.en;
    const langMap: {[key:string]: string} = { ja: 'Japanese', en: 'English', pt: 'Portuguese', es: 'Spanish', id: 'Indonesian' };
    const targetLangName = langMap[lang] || 'English';

    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user) return c.json({ error: "User not found" }, 401);

    const today = new Date().toISOString().split('T')[0];
    if (user.last_usage_date !== today) {
      await c.env.DB.prepare("UPDATE users SET usage_count = 0, last_usage_date = ? WHERE email = ?").bind(today, email).run();
      user.usage_count = 0;
    }

    if (!user.is_pro && user.usage_count >= DAILY_LIMIT) {
      return c.json({ limit_reached: true, reply: t.limit_reached });
    }

    if (action === 'normal') {
      await c.env.DB.prepare("UPDATE users SET usage_count = usage_count + 1 WHERE email = ?").bind(email).run();
    }

    const styleStats = user.style_stats ? JSON.parse(user.style_stats) : {};
    const epsilon = 0.2;
    let selectedKey: ArchetypeKey = 'empathy';
    let bestKey: ArchetypeKey = 'empathy';
    let bestRate = -1;

    Object.keys(ARCHETYPES).forEach((key) => {
      const k = key as ArchetypeKey;
      const stat = styleStats[k] || { wins: 0, total: 0 };
      const rate = stat.total === 0 ? 0.5 : stat.wins / stat.total;
      if (rate > bestRate) { bestRate = rate; bestKey = k; }
    });

    if (Math.random() < epsilon || Object.keys(styleStats).length === 0) {
      const keys = Object.keys(ARCHETYPES) as ArchetypeKey[];
      selectedKey = keys[Math.floor(Math.random() * keys.length)];
    } else { selectedKey = bestKey; }

    const archetype = ARCHETYPES[selectedKey];
    const userMemory = user.memory || "";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    
    const systemInstruction = `
      You are an Executive Function Augmentation AI for ADHD.
      [CURRENT STRATEGY]: "${archetype.label}"
      [STRATEGY INSTRUCTION]: ${archetype.prompt}
      [User Memory]: ${userMemory}
      [Language]: Reply in **${targetLangName}**.
      [CRITICAL RULES]:
      1. **KEEP IT SHORT**. Maximum 2-3 sentences.
      2. **ONE STEP ONLY**. Give only the *very first, smallest* physical step.
      3. **CONVERSATIONAL**. Talk *to* the user.
      ${current_goal ? `[GOAL]: ${current_goal}` : "Infer goal."}
      ${action === 'retry' ? "PREVIOUS WAS TOO HARD. Make it tinier. Apologize." : ""}
      ${action === 'next' ? "User did it! Praise and give the NEXT small step." : ""}
      [OUTPUT JSON ONLY]:
      {
        "reply": "Short response text in ${targetLangName}",
        "timer_seconds": Integer,
        "detected_goal": "Goal string (translate to ${targetLangName})",
        "used_archetype": "${selectedKey}" 
      }
    `;

    const requestText = action === 'normal' ? `User: ${message}` : `(System Trigger: ${action})`;

    let result = null;
    let retryCount = 0;
    while (retryCount < 2) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: systemInstruction + "\n\n" + requestText }] }],
            generationConfig: { response_mime_type: "application/json" }
          })
        });
        const data: any = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        result = JSON.parse(extractJson(rawText));
        if (result.reply) break;
      } catch (e) { retryCount++; }
    }

    if (!result) {
      const errorMsgs: any = {
        ja: "通信エラーです。深呼吸してリラックスしましょう。",
        en: "Connection error. Take a deep breath.",
        pt: "Erro de conexão. Respire fundo.",
        es: "Error de conexión. Respira hondo.",
        id: "Kesalahan koneksi. Tarik napas dalam-dalam."
      };
      result = { reply: errorMsgs[lang] || errorMsgs.en, timer_seconds: 60, detected_goal: current_goal, used_archetype: selectedKey };
    }
    result.used_archetype = selectedKey;

    if ((action === 'normal' || action === 'next') && result.reply) {
      c.executionCtx.waitUntil((async () => {
        try {
          const memoryPrompt = `Update user profile based on: User="${message}" / AI="${result.reply}". Keep it concise.`;
          const memRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: memoryPrompt }] }] })
          });
          const memData: any = await memRes.json();
          const newMemory = memData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (newMemory) await c.env.DB.prepare("UPDATE users SET memory = ? WHERE email = ?").bind(newMemory, email).run();
        } catch (err) {}
      })());
    }
    return c.json(result);
  } catch (e: any) {
    return c.json({ reply: `System Error: ${e.message}`, timer_seconds: 0 });
  }
})

app.post('/api/feedback', async (c) => {
  const { email, used_archetype, is_success } = await c.req.json();
  try {
    const user: any = await c.env.DB.prepare("SELECT style_stats, streak FROM users WHERE email = ?").bind(email).first();
    let stats = user.style_stats ? JSON.parse(user.style_stats) : {};
    if (!stats[used_archetype]) stats[used_archetype] = { wins: 0, total: 0 };
    stats[used_archetype].total += 1;
    if (is_success) stats[used_archetype].wins += 1;
    await c.env.DB.prepare("UPDATE users SET style_stats = ?, streak = streak + ? WHERE email = ?").bind(JSON.stringify(stats), is_success ? 1 : 0, email).run();
    return c.json({ streak: user.streak + (is_success ? 1 : 0) });
  } catch (e) { return c.json({ error: "DB Error" }, 500); }
});

app.post('/api/share-recovery', async (c) => {
  try {
    const { email } = await c.req.json();
    await c.env.DB.prepare("UPDATE users SET usage_count = 0 WHERE email = ?").bind(email).run();
    return c.json({ success: true, message: "Usage limit reset!" });
  } catch(e) { return c.json({ error: "DB Error"}, 500); }
});

app.post('/api/checkout', async (c) => {
  try {
    const { email, plan } = await c.req.json();
    if (!c.env.LEMON_SQUEEZY_STORE_ID) throw new Error("Server Error: Missing Store ID");
    if (!c.env.LEMON_SQUEEZY_API_KEY) throw new Error("Server Error: Missing API Key");

    let variantId = plan === 'monthly' ? c.env.LEMON_SQUEEZY_VARIANT_ID_MONTHLY : c.env.LEMON_SQUEEZY_VARIANT_ID_YEARLY;
    if (!variantId && !plan) variantId = c.env.LEMON_SQUEEZY_VARIANT_ID_YEARLY;
    if (!variantId) throw new Error(`Server Error: Missing Variant ID for plan '${plan}'`);

    const country = c.req.header('cf-ipcountry');
    let discountCode = undefined;
    if (country && PPP_DISCOUNTS[country]) {
      discountCode = PPP_DISCOUNTS[country];
      console.log(`[PPP] Applying discount ${discountCode} for country ${country}`);
    }

    const payload: any = {
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email,
            custom: { user_email: email },
            ...(discountCode ? { discount_code: discountCode } : {})
          },
          product_options: { redirect_url: `${c.env.FRONTEND_URL}/?payment=success` }
        },
        relationships: {
          store: { data: { type: "stores", id: c.env.LEMON_SQUEEZY_STORE_ID.toString() } },
          variant: { data: { type: "variants", id: variantId.toString() } }
        }
      }
    };

    const data: any = await callLemonSqueezy('checkouts', 'POST', c.env.LEMON_SQUEEZY_API_KEY, payload);
    if (data?.data?.attributes?.url) { return c.json({ url: data.data.attributes.url }); }
    else { throw new Error("API succeeded but returned no checkout URL."); }
  } catch(e: any) {
    console.error("Checkout Fatal Error:", e.message);
    return c.json({ error: e.message, details: "Check backend logs for more info." }, 500);
  }
});

app.post('/api/portal', async (c) => {
  try {
    const { email } = await c.req.json();
    const user: any = await c.env.DB.prepare("SELECT stripe_customer_id FROM users WHERE email = ?").bind(email).first();
    if (!user || !user.stripe_customer_id) return c.json({ error: "No billing information found" }, 404);
    const data: any = await callLemonSqueezy(`customers/${user.stripe_customer_id}`, 'GET', c.env.LEMON_SQUEEZY_API_KEY);
    const portalUrl = data?.data?.attributes?.urls?.customer_portal;
    if (portalUrl) return c.json({ url: portalUrl });
    else throw new Error("Portal URL not found");
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post('/api/webhook', async (c) => {
  const secret = c.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  const signature = c.req.header('x-signature');
  const bodyText = await c.req.text();
  if (!signature) return c.text('No signature', 400);
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyText));
  const hashArray = Array.from(new Uint8Array(sigBuffer));
  const hexSignature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  if (hexSignature !== signature) return c.text('Invalid signature', 400);

  const body = JSON.parse(bodyText);
  const eventName = body.meta.event_name;
  const customData = body.meta.custom_data || {};
  const attributes = body.data.attributes;

  try {
    if (eventName === 'subscription_created' || eventName === 'subscription_updated') {
      const email = attributes.user_email || customData.user_email;
      const customerId = attributes.customer_id; 
      const status = attributes.status;
      const isPro = (status === 'active' || status === 'on_trial') ? 1 : 0;
      if (email) await c.env.DB.prepare("UPDATE users SET is_pro = ?, stripe_customer_id = ? WHERE email = ?").bind(isPro, customerId, email).run();
    }
    if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
       const email = attributes.user_email || customData.user_email;
       if (email) await c.env.DB.prepare("UPDATE users SET is_pro = 0 WHERE email = ?").bind(email).run();
    }
  } catch (e) { return c.text('DB Update Failed', 500); }
  return c.text('Received', 200);
});

export default app
