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

// --- 初期人格シード (ここから進化する) ---
const INITIAL_PERSONA = "あなたはADHDの脳特性をハックするパートナーです。基本方針: 1. 提案は極限まで小さく。 2. ユーザーを責めない。 3. ゲームのように楽しく。";

// --- メッセージ定義 ---
const MESSAGES = {
  ja: {
    limit_reached: "無料版の制限に達しました。シェアして回復するか、Proプランで制限解除してください！"
  },
  en: {
    limit_reached: "Free limit reached. Share to reset or Upgrade!"
  }
};

const getStripe = (env: Bindings) => new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' as any });

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return "{}";
  return text.substring(start, end + 1);
}

// 認証周り (変更なし)
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

// --- 進化型AIチャット ---
app.post('/api/chat', async (c) => {
  try {
    const { message, email, action, prev_context, current_goal, lang = 'ja' } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    const t = (MESSAGES as any)[lang] || MESSAGES.ja;
    
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user) return c.json({ error: "User not found" }, 401);

    // 回数制限チェック
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

    // --- ★ここから自己進化ロジック ---
    
    // 現在の「最強の指示書」を取得 (なければ初期値)
    let currentStyleInstruction = user.current_best_style || INITIAL_PERSONA;
    const userMemory = user.memory || "特になし";

    // アクションに応じた戦略指示
    let dynamicContext = "";
    if (action === 'retry') {
      dynamicContext = `
        [CRITICAL UPDATE]: The user REJECTED your previous proposal ("${prev_context}"). 
        Your current style might be annoying or the task was too big.
        STRATEGY CHANGE: Apologize briefly. Drastically LOWER the hurdle. Suggest a physical action taking less than 2 seconds.
        MUTATION: You MUST change your tone. If you were energetic, be calm. If you were strict, be kind.
      `;
    } else if (action === 'next') {
      dynamicContext = `
        [STATUS]: Success! The user completed the task.
        STRATEGY: Keep the momentum. Give a short, high-dopamine praise. Immediately suggest the next micro-step.
        MUTATION: Reinforce the current successful tone but make it slightly more confident.
      `;
    } else {
      dynamicContext = `
        [STATUS]: New conversation or continuation.
        STRATEGY: Identify the user's goal. Break it down into the first step.
        MUTATION: Based on past memory, try to optimize the tone for this specific user.
      `;
    }

    // Geminiへのメタプロンプト (指示書自体を進化させる)
    const systemPrompt = `
      You are an "AI Persona Optimizer". Your job is twofold:
      1. Reply to the user to help them execute tasks (ADHD support).
      2. ANALYZE the interaction and EVOLVE your own "Persona Instruction" for the next turn.

      [Current Persona Instruction]: "${currentStyleInstruction}"
      [User Memory]: "${userMemory}"
      [Current Context]: ${dynamicContext}
      [User Input]: "${message}"
      [Goal]: "${current_goal || 'Unknown'}"
      [Language]: ${lang === 'en' ? 'English' : 'Japanese'}

      REQUIRED OUTPUT FORMAT (JSON only):
      {
        "reply": "Your message to the user (Keep it short, max 2-3 sentences).",
        "new_style_instruction": "A REVISED, detailed instruction for YOURSELF to use next time. Based on this interaction, refine the tone, sentence length, and attitude. If the user rejected ('retry'), change this instruction drastically.",
        "detected_goal": "The inferred user goal",
        "timer_seconds": 180 (integer, suggested timer duration)
      }
    `;

    // モデル呼び出し (Liteモデル推奨)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite-preview-02-05:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const data: any = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const result = JSON.parse(extractJson(rawText));

    // --- ★進化の保存 ---
    // AIが自分で考え出した「新しい指示書 (new_style_instruction)」をDBに上書き保存する
    if (result.new_style_instruction && result.new_style_instruction.length > 10) {
      c.executionCtx.waitUntil(
        c.env.DB.prepare("UPDATE users SET current_best_style = ? WHERE email = ?")
          .bind(result.new_style_instruction, email).run()
      );
    }

    // 記憶の更新 (非同期)
    if (result.reply) {
      c.executionCtx.waitUntil((async () => {
        try {
          const memPrompt = `Update user memory concisely. Old: ${userMemory}. User: ${message}. AI: ${result.reply}.`;
          const memRes = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: memPrompt }] }] })
          });
          const memData: any = await memRes.json();
          const newMem = memData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (newMem) await c.env.DB.prepare("UPDATE users SET memory = ? WHERE email = ?").bind(newMem, email).run();
        } catch(e) {}
      })());
    }

    return c.json({
      reply: result.reply,
      timer_seconds: result.timer_seconds || 180,
      detected_goal: result.detected_goal,
      // デバッグ用に現在のスタイルを返すことも可能
      used_style: currentStyleInstruction 
    });

  } catch (e: any) {
    return c.json({ reply: `Error: ${e.message}`, timer_seconds: 0 });
  }
})

// フィードバックなどの他APIは変更なし (stripe系含む)
app.post('/api/feedback', async (c) => {
  const { email, is_success } = await c.req.json();
  // 成功時のみStreak更新 (スタイル更新はchat内ですでに完了しているため不要だが、強化学習的に「確定」させるならここでも良い)
  if (is_success) {
    await c.env.DB.prepare("UPDATE users SET streak = streak + 1 WHERE email = ?").bind(email).run();
  }
  const user: any = await c.env.DB.prepare("SELECT streak FROM users WHERE email = ?").bind(email).first();
  return c.json({ streak: user.streak });
});

app.post('/api/share-recovery', async (c) => {
  const { email } = await c.req.json();
  await c.env.DB.prepare("UPDATE users SET usage_count = 0 WHERE email = ?").bind(email).run();
  return c.json({ success: true });
});

app.post('/api/checkout', async (c) => {
  try {
    const { email, plan } = await c.req.json(); 
    const stripe = getStripe(c.env);
    const user: any = await c.env.DB.prepare("SELECT stripe_customer_id FROM users WHERE email = ?").bind(email).first();
    const priceId = plan === 'monthly' ? c.env.STRIPE_PRICE_ID_MONTHLY : c.env.STRIPE_PRICE_ID_YEARLY;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${c.env.FRONTEND_URL}/?payment=success`,
      cancel_url: `${c.env.FRONTEND_URL}/?payment=canceled`,
      customer: user?.stripe_customer_id || undefined,
      customer_email: user?.stripe_customer_id ? undefined : email,
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
    if (!user?.stripe_customer_id) return c.json({ error: "No billing info" }, 404);
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: c.env.FRONTEND_URL,
    });
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
    if (email && session.customer) {
      await c.env.DB.prepare("UPDATE users SET is_pro = 1, stripe_customer_id = ? WHERE email = ?").bind(session.customer, email).run();
    }
  }
  if (event.type === 'customer.subscription.deleted') {
    await c.env.DB.prepare("UPDATE users SET is_pro = 0 WHERE stripe_customer_id = ?").bind(event.data.object.customer).run();
  }
  return c.text('Received', 200);
});

export default app
