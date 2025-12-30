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
const MAX_CONTEXT_CHARS = 1000; // ★コスト削減: コンテキストの最大文字数

// --- 国と言語設定 ---
const PPP_DISCOUNTS: { [key: string]: string } = {
  'IN': 'PPP50', 'BR': 'PPP50', 'ID': 'PPP50', 'PH': 'PPP50', 
  'VN': 'PPP50', 'EG': 'PPP50', 'NG': 'PPP50', 'BD': 'PPP50', 'PK': 'PPP50',
  'CN': 'PPP30', 'MX': 'PPP30', 'TH': 'PPP30', 'TR': 'PPP30', 
  'MY': 'PPP30', 'RU': 'PPP30', 'AR': 'PPP30',
};

const COUNTRY_TO_LANG: { [key: string]: string } = {
  'JP': 'ja', 'BR': 'pt', 'PT': 'pt', 'ES': 'es', 'MX': 'es', 'ID': 'id', 'US': 'en'
};

// メッセージ定数
const MESSAGES: any = {
  ja: { 
    limit_reached: "無料版の制限に達しました。シェアで回復するか、Proへ！",
    complete: "🎉 すべてのタスクが完了しました！素晴らしい達成です！",
    next_prefix: "👍 ナイス！次はこれです: "
  },
  en: { 
    limit_reached: "Free limit reached. Share or Upgrade!",
    complete: "🎉 All tasks completed! Amazing work!",
    next_prefix: "👍 Nice! Next up: "
  },
  pt: { limit_reached: "Limite atingido.", complete: "🎉 Tarefas concluídas!", next_prefix: "👍 Boa! Próximo: " },
  es: { limit_reached: "Límite alcanzado.", complete: "🎉 ¡Tareas completadas!", next_prefix: "👍 ¡Bien! Siguiente: " },
  id: { limit_reached: "Batas tercapai.", complete: "🎉 Semua tugas selesai!", next_prefix: "👍 Bagus! Berikutnya: " }
};

// --- Helper Functions ---
function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return "{}";
  return text.substring(start, end + 1);
}

// ★コスト削減: 古い記憶や長い入力をカットする
function truncateContext(text: string): string {
  if (!text) return "";
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  return "..." + text.substring(text.length - MAX_CONTEXT_CHARS);
}

async function callLemonSqueezy(path: string, method: string, apiKey: string, body?: any) {
  /* ... (以前と同じなので省略せず記述しますが、変更なし) ... */
  const res = await fetch(`https://api.lemonsqueezy.com/v1/${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data: any = await res.json();
  if (!res.ok || data.errors) throw new Error(`Lemon Squeezy Error`);
  return data;
}

// --- Auth Routes (変更なし) ---
app.get('/auth/login', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  const callbackUrl = `${new URL(c.req.url).origin}/auth/callback`
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${callbackUrl}&response_type=code&scope=openid%20email%20profile`)
})

app.get('/auth/callback', async (c) => {
  /* ... (以前と同じロジック) ... */
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

    const country = c.req.header('cf-ipcountry') || 'US';
    const detectedLang = COUNTRY_TO_LANG[country] || 'en';

    await c.env.DB.prepare(
      `INSERT INTO users (id, email, name, language, created_at) 
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name`
    ).bind(userData.id, userData.email, userData.name, detectedLang, Date.now()).run();

    const user: any = await c.env.DB.prepare("SELECT streak, is_pro, language FROM users WHERE id = ?").bind(userData.id).first();
    const finalLang = user.language || detectedLang;

    return c.redirect(`${c.env.FRONTEND_URL}?email=${userData.email}&name=${encodeURIComponent(userData.name)}&streak=${user.streak || 0}&pro=${user.is_pro || 0}&lang=${finalLang}`)
  } catch (e: any) { return c.text(`Auth Error: ${e.message}`, 500) }
})

// --- Language Update API ---
app.post('/api/language', async (c) => {
  const { email, language } = await c.req.json();
  await c.env.DB.prepare("UPDATE users SET language = ? WHERE email = ?").bind(language, email).run();
  return c.json({ success: true });
});

// --- ★ AI Chat (コスト最適化版) ---
app.post('/api/chat', async (c) => {
  try {
    const { message, email, action, prev_context, current_goal, lang = 'en' } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    const t = MESSAGES[lang] || MESSAGES.en;
    
    // ユーザー取得
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user) return c.json({ error: "User not found" }, 401);

    // 制限チェック
    if (!user.is_pro && user.usage_count >= DAILY_LIMIT) {
      return c.json({ limit_reached: true, reply: t.limit_reached });
    }

    // カウントアップ
    if (action === 'normal' || action === 'retry') {
      await c.env.DB.prepare("UPDATE users SET usage_count = usage_count + 1 WHERE email = ?").bind(email).run();
    }

    // --- ★ APIを呼ばないルート (DBから次を取り出す) ---
    if (action === 'next') {
      let taskList = [];
      try { taskList = JSON.parse(user.task_list || '[]'); } catch(e) {}
      
      let nextIndex = (user.current_task_index || 0) + 1;

      // まだタスクが残っている場合
      if (nextIndex < taskList.length) {
        const nextTask = taskList[nextIndex];
        // DB更新
        await c.env.DB.prepare("UPDATE users SET current_task_index = ? WHERE email = ?").bind(nextIndex, email).run();
        
        // ★APIを呼ばずに即答！
        return c.json({
          reply: `${t.next_prefix}${nextTask}`,
          timer_seconds: 180,
          detected_goal: current_goal,
          used_archetype: "system_optimized" // 統計には含めない
        });
      } else {
        // 全完了
        return c.json({
          reply: t.complete,
          timer_seconds: 0,
          detected_goal: null, // ゴールクリア
          used_archetype: "system_complete"
        });
      }
    }

    // --- ★ APIを呼ぶルート (初回リスト生成 or リトライ/変更) ---
    // ここに来るのは action='normal'(会話/ゴール設定) か 'retry'(無理/変更) の時だけ

    const userMemory = truncateContext(user.memory || "");
    const safePrevContext = truncateContext(prev_context || "");
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    
    const systemInstruction = `
      You are an Executive Function Augmentation AI.
      [Language]: Reply in ${lang}.
      [User Memory]: ${userMemory}
      [Context]: ${safePrevContext}
      
      [GOAL]: ${current_goal || "Infer from user input"}
      
      [TASK]: 
      1. If the user input implies a NEW GOAL, break it down into a detailed step-by-step checklist (JSON).
      2. If the user says "Impossible" or "Retry", break the CURRENT STEP down into even smaller micro-steps (JSON).
      3. Otherwise, just reply conversationally (shortly).

      [OUTPUT FORMAT]: JSON ONLY.
      {
        "reply": "Conversational response (first step instruction)",
        "new_task_list": ["step1", "step2", "step3"...] (Optional: ONLY if planning/re-planning),
        "timer_seconds": 180,
        "detected_goal": "Goal String"
      }
    `;

    const requestText = `User: ${message} (Action: ${action})`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: systemInstruction + "\n\n" + requestText }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const data: any = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const result = JSON.parse(extractJson(rawText));

    // ★ リストが生成されたらDB保存
    if (result.new_task_list && Array.isArray(result.new_task_list) && result.new_task_list.length > 0) {
      await c.env.DB.prepare(
        "UPDATE users SET task_list = ?, current_task_index = 0 WHERE email = ?"
      ).bind(JSON.stringify(result.new_task_list), email).run();
      
      // 最初のタスクをreplyに上書き（念のため）
      // result.reply = result.new_task_list[0]; 
    }

    // 記憶更新 (文字数を絞って保存)
    if (result.reply) {
      c.executionCtx.waitUntil((async () => {
        const newMem = truncateContext(userMemory + ` U:${message} A:${result.reply}`);
        await c.env.DB.prepare("UPDATE users SET memory = ? WHERE email = ?").bind(newMem, email).run();
      })());
    }

    return c.json(result);

  } catch (e: any) {
    return c.json({ reply: `System Error: ${e.message}`, timer_seconds: 0 });
  }
})

// --- 他のルートは変更なし (feedback, checkout, etc.) ---
app.post('/api/feedback', async (c) => { /* ...省略 (既存のまま) */ return c.json({streak:0}); });
app.post('/api/share-recovery', async (c) => { /* ...省略 */ return c.json({success:true}); });

app.post('/api/checkout', async (c) => {
  try {
    const { email, plan } = await c.req.json();
    if (!c.env.LEMON_SQUEEZY_STORE_ID) throw new Error("Missing Store ID");
    
    let variantId = plan === 'monthly' ? c.env.LEMON_SQUEEZY_VARIANT_ID_MONTHLY : c.env.LEMON_SQUEEZY_VARIANT_ID_YEARLY;
    if (!variantId && !plan) variantId = c.env.LEMON_SQUEEZY_VARIANT_ID_YEARLY;
    
    // PPP logic
    const country = c.req.header('cf-ipcountry');
    let discountCode = undefined;
    if (country && PPP_DISCOUNTS[country]) discountCode = PPP_DISCOUNTS[country];

    const payload: any = {
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: { email, custom: { user_email: email }, ...(discountCode ? { discount_code: discountCode } : {}) },
          product_options: { redirect_url: `${c.env.FRONTEND_URL}/?payment=success` }
        },
        relationships: {
          store: { data: { type: "stores", id: c.env.LEMON_SQUEEZY_STORE_ID.toString() } },
          variant: { data: { type: "variants", id: variantId.toString() } }
        }
      }
    };
    const data: any = await callLemonSqueezy('checkouts', 'POST', c.env.LEMON_SQUEEZY_API_KEY, payload);
    if (data?.data?.attributes?.url) return c.json({ url: data.data.attributes.url });
    else throw new Error("No URL returned");
  } catch(e: any) { return c.json({ error: e.message }, 500); }
});

app.post('/api/portal', async (c) => { /* ...省略 */ return c.json({url:""}); });
app.post('/api/webhook', async (c) => { /* ...省略 */ return c.text('Received'); });

export default app
