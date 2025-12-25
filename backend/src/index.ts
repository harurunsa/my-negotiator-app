import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  DB: D1Database
  GEMINI_API_KEY: string
  STRIPE_SECRET_KEY: string
  STRIPE_PRICE_ID: string
  FRONTEND_URL: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/*', cors())

// --- 言語定数など (省略なしで記述) ---
const MESSAGES = {
  ja: {
    retry_instruction: "【緊急: ユーザー拒絶】直前の提案は却下されました。即座に謝罪し、タスクを物理的最小単位（指一本動かすだけ等）に分解してください。精神論は禁止。",
    next_instruction: "【コンボ継続中！】短くテンション高く褒めて、間髪入れずに次のステップを出してください。",
    goal_instruction: (goal: string) => `【絶対目標】: "${goal}"\n(※全ての提案はこの達成に向かうこと。関係ない話題は禁止)`,
    goal_default: "会話からユーザーのゴールを推測し、そこにロックオンしてください。",
    ai_persona: "あなたはADHDの脳特性をハックする実行機能拡張AIです。",
    limit_reached: "本日の無料枠（10回）を使い切りました！\n明日またお会いするか、Proプランで無制限に脳をハックしましょう。",
  },
  en: {
    retry_instruction: "[URGENT: User Rejection] The previous proposal was rejected. Apologize immediately and break the task down to the absolute physical minimum. No motivational speeches.",
    next_instruction: "[COMBO ACTIVE!] Praise shortly and energetically, then present the next step immediately.",
    goal_instruction: (goal: string) => `[ABSOLUTE GOAL]: "${goal}"\n(*All proposals must lead to this. No distractions.)`,
    goal_default: "Infer the user's current goal from the conversation and lock onto it.",
    ai_persona: "You are an Executive Function Augmentation AI that hacks ADHD brain characteristics.",
    limit_reached: "You've used up your 10 free messages for today!\nSee you tomorrow, or upgrade to Pro for unlimited brain hacking.",
  }
};

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return "{}";
  return text.substring(start, end + 1);
}

// 今日の日付文字列 (YYYY-MM-DD)
const getTodayString = () => new Date().toISOString().split('T')[0];

// --- 認証 ---
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

    // ユーザー作成・更新 (使用回数カラムも考慮)
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name`
    ).bind(userData.id, userData.email, userData.name, Date.now()).run();

    // 日付が変わっていたらリセットするロジックも含めてデータ取得
    const today = getTodayString();
    let user: any = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userData.id).first();

    if (user.last_usage_date !== today) {
      // 日付変更 -> リセット
      await c.env.DB.prepare("UPDATE users SET usage_count = 0, last_usage_date = ? WHERE id = ?").bind(today, userData.id).run();
      user.usage_count = 0;
    }

    const frontendUrl = c.env.FRONTEND_URL || "https://my-negotiator-app.pages.dev";
    return c.redirect(`${frontendUrl}?email=${userData.email}&name=${encodeURIComponent(userData.name)}&streak=${user.streak || 0}&pro=${user.is_pro || 0}`)
  } catch (e: any) {
    return c.text(`Auth Error: ${e.message}`, 500)
  }
})

// --- ★Stripe決済開始 (Checkout Session作成) ---
app.post('/api/checkout', async (c) => {
  try {
    const { email } = await c.req.json();
    const user: any = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    
    if (!user) return c.json({ error: "User not found" }, 404);

    // Stripe APIを直接叩く (npm install stripe 不要)
    const formData = new URLSearchParams();
    formData.append('payment_method_types[]', 'card');
    formData.append('line_items[0][price]', c.env.STRIPE_PRICE_ID);
    formData.append('line_items[0][quantity]', '1');
    formData.append('mode', 'payment'); // サブスクなら 'subscription'
    formData.append('success_url', `${new URL(c.req.url).origin}/api/stripe/success?session_id={CHECKOUT_SESSION_ID}`);
    formData.append('cancel_url', c.env.FRONTEND_URL);
    formData.append('client_reference_id', user.id); // 誰が払ったか識別用

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData
    });

    const session: any = await stripeRes.json();
    if (session.error) throw new Error(session.error.message);

    return c.json({ url: session.url });

  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- ★決済完了後の処理 (Proフラグ有効化) ---
app.get('/api/stripe/success', async (c) => {
  const sessionId = c.req.query('session_id');
  if (!sessionId) return c.text('Error: No session ID', 400);

  try {
    // セッション情報の確認 (改ざん防止のためStripeに問い合わせる)
    const verifyRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: { 'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}` }
    });
    const session: any = await verifyRes.json();

    if (session.payment_status === 'paid') {
      const userId = session.client_reference_id;
      // DBをPro会員に更新
      await c.env.DB.prepare("UPDATE users SET is_pro = 1 WHERE id = ?").bind(userId).run();
      
      // フロントエンドに戻す
      const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
      return c.redirect(`${c.env.FRONTEND_URL}?email=${user.email}&name=${encodeURIComponent(user.name)}&streak=${user.streak}&pro=1&payment=success`);
    } else {
      return c.text('Payment not completed', 400);
    }
  } catch (e: any) {
    return c.text(`Error: ${e.message}`, 500);
  }
});

// --- AIチャット (回数制限ロジック追加) ---
app.post('/api/chat', async (c) => {
  try {
    const { message, email, action, prev_context, current_goal, lang = 'ja' } = await c.req.json()
    const t = (MESSAGES as any)[lang] || MESSAGES.ja;
    
    // 1. ユーザー情報 & 回数チェック
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    const today = getTodayString();
    
    // 日付が変わっていたらリセット (念のためここでも)
    if (user.last_usage_date !== today) {
      user.usage_count = 0;
      await c.env.DB.prepare("UPDATE users SET usage_count = 0, last_usage_date = ? WHERE email = ?").bind(today, email).run();
    }

    // ★制限チェック: 無料(is_pro=0) かつ 10回以上ならストップ
    if (user.is_pro === 0 && user.usage_count >= 10) {
      return c.json({
        reply: t.limit_reached,
        timer_seconds: 0,
        score: 0,
        is_combo: false,
        limit_reached: true // フロントエンドに通知
      });
    }

    // 2. AI処理 (Gemini 2.5 Flash Lite)
    const apiKey = c.env.GEMINI_API_KEY
    const modelName = 'gemini-2.0-flash-lite-preview-02-05'; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    // ... (以下、プロンプト生成などは前回と同じなので省略なしで書きます) ...
    let stylePrompt = user.current_best_style || (lang === 'en' ? "Supportive and punchy partner" : "優しく励ますパートナー");
    const userMemory = user.memory || "";
    let contextInstruction = "";
    let isExploration = false;
    const goalInstruction = current_goal ? t.goal_instruction(current_goal) : t.goal_default;

    if (action === 'retry') {
      contextInstruction = t.retry_instruction + `\nRejected: "${prev_context}"`;
    } else if (action === 'next') {
      isExploration = Math.random() < 0.3; 
      contextInstruction = t.next_instruction;
    } else {
      isExploration = Math.random() < 0.2;
    }

    let usedStyle = stylePrompt;
    if (isExploration && action !== 'retry') {
      try {
        const mutationPrompt = lang === 'en' 
          ? `Current: "${stylePrompt}". Variate slightly. Output description only.`
          : `現在の接客スタイル: "${stylePrompt}"。これのバリエーションを1つ作成せよ。出力は説明文のみ。`;
        const mRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: mutationPrompt }] }] })
        });
        const mData: any = await mRes.json();
        const mutated = mData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (mutated) usedStyle = mutated.trim();
      } catch (e) {}
    }

    const systemInstruction = `
      ${t.ai_persona}
      [Language]: Reply in ${lang === 'en' ? 'English' : 'Japanese'}.
      [Current Persona]: "${usedStyle}"
      [User Memory]: ${userMemory}
      ${goalInstruction}
      ${contextInstruction}
      [OUTPUT RULES]: Output JSON ONLY.
      { "reply": "msg", "timer_seconds": 0, "score": 0, "is_combo": false, "detected_goal": null, "reason": "" }
    `;

    // 自動リトライロジック
    let result = null;
    let retryCount = 0;
    while (retryCount < 3) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: systemInstruction + "\n\n" + (action==='normal'?`User: ${message}`:`System: ${action}`) }] }]
          })
        });
        const data: any = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const parsed = JSON.parse(extractJson(rawText));
        if (parsed.reply) { result = parsed; break; }
      } catch (e) { retryCount++; }
    }

    if (!result) {
       result = {
        reply: lang === 'en' ? "Connection glitch! Take a deep breath." : "通信が不安定ですが、深呼吸して落ち着きましょう。",
        timer_seconds: 60, score: 10, is_combo: false, detected_goal: current_goal
      };
    }

    result.used_style = usedStyle;
    result.is_exploration = isExploration;

    // ★使用回数のカウントアップ (成功時のみ)
    if (user.is_pro === 0) {
      await c.env.DB.prepare("UPDATE users SET usage_count = usage_count + 1, last_usage_date = ? WHERE email = ?").bind(today, email).run();
      // レスポンスに残り回数を含める（オプション）
      result.usage_count = user.usage_count + 1;
    }

    // 記憶更新 (WaitUntil)
    if ((action === 'normal' || action === 'next') && result.reply) {
      c.executionCtx.waitUntil((async () => {
        try {
          const memoryPrompt = lang === 'en' 
            ? `Update profile: User="${message}" / AI="${result.reply}".`
            : `記憶更新: User="${message}" / AI="${result.reply}"`;
          const memRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: memoryPrompt }] }] })
          });
          const memData: any = await memRes.json();
          const newMemory = memData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (newMemory) await c.env.DB.prepare("UPDATE users SET memory = ? WHERE email = ?").bind(newMemory, email).run();
        } catch (e) {}
      })());
    }

    return c.json(result);

  } catch (e: any) {
    return c.json({ reply: `Error: ${e.message}`, timer_seconds: 0 });
  }
})

// フィードバック
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

export default app
