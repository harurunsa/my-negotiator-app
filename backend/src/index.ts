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
  STRIPE_PRICE_ID: string
  FRONTEND_URL: string
  STRIPE_PRICE_ID_YEARLY: string
  STRIPE_PRICE_ID_MONTHLY: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/*', cors())

// --- 定数 ---
const DAILY_LIMIT = 5; // 無料版の1日あたりの会話回数

const MESSAGES = {
  ja: {
    retry_instruction: "【緊急: ユーザー拒絶】直前の提案は却下されました。即座に謝罪し、タスクを物理的最小単位（指一本動かすだけ等）に分解してください。精神論は禁止。",
    next_instruction: "【コンボ継続中！】短くテンション高く褒めて、間髪入れずに次のステップを出してください。",
    goal_instruction: (goal: string) => `【絶対目標】: "${goal}"\n(※全ての提案はこの達成に向かうこと。関係ない話題は禁止)`,
    goal_default: "会話からユーザーのゴールを推測し、そこにロックオンしてください。",
    ai_persona: "あなたはADHDの脳特性をハックする実行機能拡張AIです。",
    limit_reached: "無料版の制限に達しました。SNSシェアで回復するか、Proプランにアップグレードしてください！"
  },
  en: {
    retry_instruction: "[URGENT: User Rejection] The previous proposal was rejected. Apologize immediately and break the task down to the absolute physical minimum (e.g., just moving a finger). No motivational speeches, just easy physics.",
    next_instruction: "[COMBO ACTIVE!] Praise shortly and energetically, then present the next step immediately.",
    goal_instruction: (goal: string) => `[ABSOLUTE GOAL]: "${goal}"\n(*All proposals must lead to this. No distractions.)`,
    goal_default: "Infer the user's current goal from the conversation and lock onto it.",
    ai_persona: "You are an Executive Function Augmentation AI that hacks ADHD brain characteristics. Be punchy, empathetic, and gamified.",
    limit_reached: "Free limit reached. Share to reset or Upgrade!"
  }
};

// --- ヘルパー関数 ---
function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return "{}";
  return text.substring(start, end + 1);
}

const getStripe = (env: Bindings) => new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' as any });

// --- 認証周り ---
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

// --- AIチャット (回数制限 & Stripe対応) ---
app.post('/api/chat', async (c) => {
  try {
    const { message, email, action, prev_context, current_goal, lang = 'ja' } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    const t = (MESSAGES as any)[lang] || MESSAGES.ja;
    
    // ユーザー取得
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user) return c.json({ error: "User not found" }, 401);

    // ★ 日付変更チェックと回数リセット
    const today = new Date().toISOString().split('T')[0];
    if (user.last_usage_date !== today) {
      await c.env.DB.prepare("UPDATE users SET usage_count = 0, last_usage_date = ? WHERE email = ?").bind(today, email).run();
      user.usage_count = 0;
    }

    // ★ 制限チェック (Proでなく、かつ制限を超えている場合)
    if (!user.is_pro && user.usage_count >= DAILY_LIMIT) {
      return c.json({ 
        limit_reached: true, 
        reply: t.limit_reached
      });
    }

    // ★ 回数インクリメント (システムメッセージ以外の場合)
    if (action === 'normal') {
      await c.env.DB.prepare("UPDATE users SET usage_count = usage_count + 1 WHERE email = ?").bind(email).run();
    }

    // --- Gemini呼び出しロジック ---
    let stylePrompt = user.current_best_style || (lang === 'en' ? "Supportive and punchy partner" : "優しく励ますパートナー");
    const userMemory = user.memory || "";
    let contextInstruction = "";
    let isExploration = false;
    const goalInstruction = current_goal ? t.goal_instruction(current_goal) : t.goal_default;

    if (action === 'retry') {
      contextInstruction = t.retry_instruction + `\nRejected proposal: "${prev_context || 'None'}"`;
    } else if (action === 'next') {
      isExploration = Math.random() < 0.3; 
      contextInstruction = t.next_instruction;
    } else {
      isExploration = Math.random() < 0.2;
    }

    // 変異ロジック
    let usedStyle = stylePrompt;
    if (isExploration && action !== 'retry') {
      const mutationUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
      try {
        const mutationPrompt = lang === 'en' 
          ? `Current style: "${stylePrompt}". Create a slight variation. Output description only.`
          : `現在の接客スタイル: "${stylePrompt}"。これのバリエーションを1つ作成せよ。出力は説明文のみ。`;
        const mRes = await fetch(mutationUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: mutationPrompt }] }] })
        });
        const mData: any = await mRes.json();
        const mutated = mData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (mutated) usedStyle = mutated.trim();
      } catch (e) {}
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    
    const systemInstruction = `
      ${t.ai_persona}
      [Language]: Reply in ${lang === 'en' ? 'English' : 'Japanese'}.
      [Current Persona]: "${usedStyle}"
      [User Memory]: ${userMemory}
      
      ${goalInstruction}
      ${contextInstruction}
      
      [OUTPUT RULES]: Output JSON ONLY.
      {
        "reply": "Response to user",
        "timer_seconds": Integer,
        "score": 0-100,
        "is_combo": boolean,
        "detected_goal": "Inferred goal string or null",
        "reason": "Reasoning"
      }
    `;

    const requestText = action === 'normal' ? `User: ${message}` : `(System Trigger: ${action})`;

    // 自動リトライロジック
    let result = null;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
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
        const cleanedText = extractJson(rawText);
        const parsed = JSON.parse(cleanedText);

        if (parsed.reply && parsed.reply.trim() !== "") {
          result = parsed;
          break;
        } else {
          throw new Error("Empty reply");
        }
      } catch (e) {
        console.log(`Retry ${retryCount + 1}/${maxRetries} failed:`, e);
        retryCount++;
      }
    }

    if (!result) {
      result = {
        reply: lang === 'en' 
          ? "Sorry, connection glitch! Let's just focus on the task: Take one deep breath." 
          : "通信が少し不安定です！でも大丈夫、まずは深呼吸を一つしましょう。",
        timer_seconds: 60,
        score: 10,
        is_combo: false,
        detected_goal: current_goal
      };
    }

    result.used_style = usedStyle; 
    result.is_exploration = isExploration;

    // 記憶更新
    if ((action === 'normal' || action === 'next') && result.reply) {
      c.executionCtx.waitUntil((async () => {
        try {
          const memoryPrompt = lang === 'en'
            ? `Update user profile based on: User="${message}" / AI="${result.reply}". Keep it concise.`
            : `ユーザーの記憶を更新してください。直前の会話: User="${message}" / AI="${result.reply}"`;

          const memRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: memoryPrompt }] }] })
          });
          const memData: any = await memRes.json();
          const newMemory = memData.candidates?.[0]?.content?.parts?.[0]?.text;
          
          if (newMemory) {
            await c.env.DB.prepare("UPDATE users SET memory = ? WHERE email = ?").bind(newMemory, email).run();
          }
        } catch (err) { console.error(err); }
      })());
    }

    return c.json(result);

  } catch (e: any) {
    return c.json({ 
      reply: `System Error: ${e.message}`, 
      timer_seconds: 0 
    });
  }
})

// --- フィードバック ---
app.post('/api/feedback', async (c) => {
  const { email, used_style, is_success } = await c.req.json();
  try {
    if (is_success) {
      await c.env.DB.prepare("UPDATE users SET current_best_style = ?, streak = streak + 1 WHERE email = ?").bind(used_style, email).run();
    }
    const user: any = await c.env.DB.prepare("SELECT streak FROM users WHERE email = ?").bind(email).first();
    return c.json({ streak: user.streak });
  } catch (e) { return c.json({ error: "DB Error" }, 500); }
});

// --- ★ SNSシェアでの回復 ---
app.post('/api/share-recovery', async (c) => {
  try {
    const { email } = await c.req.json();
    await c.env.DB.prepare("UPDATE users SET usage_count = 0 WHERE email = ?").bind(email).run();
    return c.json({ success: true, message: "Usage limit reset!" });
  } catch(e) { return c.json({ error: "DB Error"}, 500); }
});

// --- ★ Stripe 決済セッション作成 ---
app.post('/api/checkout', async (c) => {
  try {
    // plan ('yearly' | 'monthly') を受け取る
    const { email, plan } = await c.req.json(); 
    const stripe = getStripe(c.env);
    
    const user: any = await c.env.DB.prepare("SELECT stripe_customer_id FROM users WHERE email = ?").bind(email).first();
    let customerId = user?.stripe_customer_id;

    // プランに応じてPrice IDを選択 (デフォルトは年額)
    const priceId = plan === 'monthly' 
      ? c.env.STRIPE_PRICE_ID_MONTHLY 
      : c.env.STRIPE_PRICE_ID_YEARLY;

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
  } catch(e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- ★ サブスク管理ポータル (Billing Portal) ---
app.post('/api/portal', async (c) => {
  try {
    const { email } = await c.req.json();
    const stripe = getStripe(c.env);

    // DBからCustomer IDを取得
    const user: any = await c.env.DB.prepare("SELECT stripe_customer_id FROM users WHERE email = ?").bind(email).first();

    if (!user || !user.stripe_customer_id) {
      return c.json({ error: "No billing information found" }, 404);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: c.env.FRONTEND_URL,
    });

    return c.json({ url: session.url });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- ★ Stripe Webhook ---
app.post('/api/webhook', async (c) => {
  const stripe = getStripe(c.env);
  const signature = c.req.header('stripe-signature');
  const body = await c.req.text();

  let event;
  try {
    if (!signature) throw new Error("No signature");
    event = await stripe.webhooks.constructEventAsync(body, signature, c.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    return c.text(`Webhook Error: ${err.message}`, 400);
  }

  // 決済完了時 (Customer IDを保存)
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const email = session.metadata?.email || session.customer_details?.email;
    const customerId = session.customer as string;
    
    if (email && customerId) {
      await c.env.DB.prepare(
        "UPDATE users SET is_pro = 1, stripe_customer_id = ? WHERE email = ?"
      ).bind(customerId, email).run();
    }
  }

  // サブスクリプション削除時 (Pro権限剥奪)
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;
    
    await c.env.DB.prepare(
      "UPDATE users SET is_pro = 0 WHERE stripe_customer_id = ?"
    ).bind(customerId).run();
  }

  return c.text('Received', 200);
});

export default app
