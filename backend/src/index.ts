import { Hono } from 'hono'
import { cors } from 'hono/cors'
import Stripe from 'stripe'

type Bindings = {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  DB: D1Database
  GEMINI_API_KEY: string
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  STRIPE_PRICE_ID_YEARLY: string
  STRIPE_PRICE_ID_MONTHLY: string
  FRONTEND_URL: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/*', cors())

const DAILY_LIMIT = 5;

// ★変更: プロンプトに「短さ」を徹底させる指示を追加
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

const getStripe = (env: Bindings) => new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' as any });

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return "{}";
  return text.substring(start, end + 1);
}

// --- 認証周り (変更なし) ---
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

    await c.env.DB.prepare(
      `INSERT INTO users (id, email, name, created_at) 
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name`
    ).bind(userData.id, userData.email, userData.name, Date.now()).run();

    const user: any = await c.env.DB.prepare("SELECT streak, is_pro FROM users WHERE id = ?").bind(userData.id).first();
    const frontendUrl = c.env.FRONTEND_URL || "https://my-negotiator-app.pages.dev";
    
    return c.redirect(`${frontendUrl}?email=${userData.email}&name=${encodeURIComponent(userData.name)}&streak=${user.streak || 0}&pro=${user.is_pro || 0}`)
  } catch (e: any) {
    return c.text(`Auth Error: ${e.message}`, 500)
  }
})

// --- AIチャット ---
app.post('/api/chat', async (c) => {
  try {
    const { message, email, action, prev_context, current_goal, lang = 'ja' } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user) return c.json({ error: "User not found" }, 401);

    const today = new Date().toISOString().split('T')[0];
    if (user.last_usage_date !== today) {
      await c.env.DB.prepare("UPDATE users SET usage_count = 0, last_usage_date = ? WHERE email = ?").bind(today, email).run();
      user.usage_count = 0;
    }

    if (!user.is_pro && user.usage_count >= DAILY_LIMIT) {
      return c.json({ 
        limit_reached: true, 
        reply: lang === 'ja' 
          ? "無料版の制限に達しました。SNSシェアで回復するか、Proプランにアップグレードしてください！"
          : "Free limit reached. Share to reset or Upgrade!"
      });
    }

    if (action === 'normal') {
      await c.env.DB.prepare("UPDATE users SET usage_count = usage_count + 1 WHERE email = ?").bind(email).run();
    }

    // バンディットアルゴリズム (変更なし)
    const styleStats = user.style_stats ? JSON.parse(user.style_stats) : {};
    const epsilon = 0.2;
    let selectedKey: ArchetypeKey = 'empathy';
    let bestKey: ArchetypeKey = 'empathy';
    let bestRate = -1;

    Object.keys(ARCHETYPES).forEach((key) => {
      const k = key as ArchetypeKey;
      const stat = styleStats[k] || { wins: 0, total: 0 };
      const rate = stat.total === 0 ? 0.5 : stat.wins / stat.total;
      if (rate > bestRate) {
        bestRate = rate;
        bestKey = k;
      }
    });

    if (Math.random() < epsilon || Object.keys(styleStats).length === 0) {
      const keys = Object.keys(ARCHETYPES) as ArchetypeKey[];
      selectedKey = keys[Math.floor(Math.random() * keys.length)];
    } else {
      selectedKey = bestKey;
    }

    const archetype = ARCHETYPES[selectedKey];
    const userMemory = user.memory || "";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    
    // ★変更: システムプロンプトで「短さ」と「会話」を強制
    const systemInstruction = `
      You are an Executive Function Augmentation AI for ADHD.
      
      [CURRENT STRATEGY]: "${archetype.label}"
      [STRATEGY INSTRUCTION]: ${archetype.prompt}
      
      [User Memory]: ${userMemory}
      [Language]: Reply in ${lang === 'en' ? 'English' : 'Japanese'}.
      
      [CRITICAL RULES]:
      1. **KEEP IT SHORT**. Maximum 2-3 sentences.
      2. **ONE STEP ONLY**. Do not give a list. Do not plan the whole project. Give only the *very first, smallest* physical step.
      3. **CONVERSATIONAL**. Talk *to* the user, not *at* them. Ask a simple question or give a simple command.
      
      ${current_goal ? `[GOAL]: ${current_goal}` : "Infer goal."}
      
      ${action === 'retry' ? "PREVIOUS WAS TOO HARD. Make it tinier. Apologize." : ""}
      ${action === 'next' ? "User did it! Praise and give the NEXT small step." : ""}
      
      [OUTPUT JSON ONLY]:
      {
        "reply": "Short response text",
        "timer_seconds": Integer,
        "detected_goal": "Goal string",
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
      result = {
        reply: "通信エラーです。もう一度深呼吸して、リラックスしましょう。",
        timer_seconds: 60,
        detected_goal: current_goal,
        used_archetype: selectedKey
      };
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

// --- その他API (変更なし) ---
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
    const stripe = getStripe(c.env);
    const user: any = await c.env.DB.prepare("SELECT stripe_customer_id FROM users WHERE email = ?").bind(email).first();
    let customerId = user?.stripe_customer_id;
    const priceId = plan === 'monthly' ? c.env.STRIPE_PRICE_ID_MONTHLY : c.env.STRIPE_PRICE_ID_YEARLY;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${c.env.FRONTEND_URL}/?payment=success`,
      cancel_url: `${c.env.FRONTEND_URL}/?payment=canceled`,
      customer: customerId || undefined,
      customer_email: customerId ? undefined : email,
      metadata: { email }
    });
    return c.json({ url: session.url });
  } catch(e: any) { return c.json({ error: e.message }, 500); }
});

app.post('/api/portal', async (c) => {
  try {
    const { email } = await c.req.json();
    const stripe = getStripe(c.env);
    const user: any = await c.env.DB.prepare("SELECT stripe_customer_id FROM users WHERE email = ?").bind(email).first();
    if (!user || !user.stripe_customer_id) return c.json({ error: "No billing information found" }, 404);
    const session = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: c.env.FRONTEND_URL });
    return c.json({ url: session.url });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post('/api/webhook', async (c) => {
  const stripe = getStripe(c.env);
  const signature = c.req.header('stripe-signature');
  const body = await c.req.text();
  let event;
  try {
    if (!signature) throw new Error("No signature");
    event = await stripe.webhooks.constructEventAsync(body, signature, c.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) { return c.text(`Webhook Error: ${err.message}`, 400); }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const email = session.metadata?.email || session.customer_details?.email;
    const customerId = session.customer as string;
    if (email && customerId) await c.env.DB.prepare("UPDATE users SET is_pro = 1, stripe_customer_id = ? WHERE email = ?").bind(customerId, email).run();
  }
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;
    await c.env.DB.prepare("UPDATE users SET is_pro = 0 WHERE stripe_customer_id = ?").bind(customerId).run();
  }
  return c.text('Received', 200);
});

export default app
