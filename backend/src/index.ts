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

// ★改善1: CORSをフロントエンドのURLのみに制限
app.use('/*', async (c, next) => {
  const corsMiddleware = cors({
    origin: c.env.FRONTEND_URL || '*', // 環境変数がなければ全許可(開発用)
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: true,
  });
  return corsMiddleware(c, next);
});

const DAILY_LIMIT = 5;
const MAX_CONTEXT_CHARS = 1500;

// --- PPP設定 ---
const PPP_DISCOUNTS: { [key: string]: string } = {
  'IN': 'PPP50', 'BR': 'PPP50', 'ID': 'PPP50', 'PH': 'PPP50', 
  'VN': 'PPP50', 'EG': 'PPP50', 'NG': 'PPP50', 'BD': 'PPP50', 'PK': 'PPP50',
  'CN': 'PPP30', 'MX': 'PPP30', 'TH': 'PPP30', 'TR': 'PPP30', 
  'MY': 'PPP30', 'RU': 'PPP30', 'AR': 'PPP30',
};

const COUNTRY_TO_LANG: { [key: string]: string } = {
  'JP': 'ja', 'BR': 'pt', 'PT': 'pt', 'ES': 'es', 'MX': 'es', 'ID': 'id', 'US': 'en'
};

const MESSAGES: any = {
  ja: { 
    limit_reached: "無料版の制限に達しました。シェアで回復するか、Proへ！",
    complete: "🎉 すべてのタスクが完了しました！素晴らしい達成です！次はどうしますか？",
    next_prefix: "👍 ナイス！次はこれです: ",
    progress: (cur: number, tot: number) => `(進捗: ${cur}/${tot})`
  },
  en: { 
    limit_reached: "Free limit reached. Share or Upgrade!",
    complete: "🎉 All tasks completed! Amazing work! What's next?",
    next_prefix: "👍 Nice! Next up: ",
    progress: (cur: number, tot: number) => `(Step: ${cur}/${tot})`
  },
  pt: { limit_reached: "Limite atingido.", complete: "🎉 Tarefas concluídas!", next_prefix: "👍 Boa! Próximo: ", progress: (c:number, t:number) => `(${c}/${t})` },
  es: { limit_reached: "Límite alcanzado.", complete: "🎉 ¡Tareas completadas!", next_prefix: "👍 ¡Bien! Siguiente: ", progress: (c:number, t:number) => `(${c}/${t})` },
  id: { limit_reached: "Batas tercapai.", complete: "🎉 Semua tugas selesai!", next_prefix: "👍 Bagus! Berikutnya: ", progress: (c:number, t:number) => `(${c}/${t})` }
};

// --- Helper Functions ---

// ★改善2: JSONパースの強化 (Markdown記法やコメントを除去)
function extractJson(text: string): string {
  // Markdownのコードブロックを除去
  let cleaned = text.replace(/```json\s*|\s*```/g, '');
  // 最初の { から 最後の } までを抽出
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return "{}";
  return cleaned.substring(start, end + 1);
}

function truncateContext(text: string): string {
  if (!text) return "";
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  return "..." + text.substring(text.length - MAX_CONTEXT_CHARS);
}

async function callLemonSqueezy(path: string, method: string, apiKey: string, body?: any) {
  const res = await fetch(`https://api.lemonsqueezy.com/v1/${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json' },
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
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${callbackUrl}&response_type=code&scope=openid%20email%20profile`)
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

// --- AI Chat ---
app.post('/api/chat', async (c) => {
  try {
    const { message, email, action, prev_context, current_goal, lang = 'en' } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    const t = MESSAGES[lang] || MESSAGES.en;
    const langMap: {[key:string]: string} = { ja: 'Japanese', en: 'English', pt: 'Portuguese', es: 'Spanish', id: 'Indonesian' };
    const targetLangName = langMap[lang] || 'English';
    
    // User Check
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user) return c.json({ error: "User not found" }, 401);

    // Limit Check
    if (!user.is_pro && user.usage_count >= DAILY_LIMIT) {
      return c.json({ limit_reached: true, reply: t.limit_reached });
    }

    if (action === 'normal' || action === 'retry') {
      await c.env.DB.prepare("UPDATE users SET usage_count = usage_count + 1 WHERE email = ?").bind(email).run();
    }

    // タスク状態取得
    let currentTaskList: string[] = [];
    try { currentTaskList = JSON.parse(user.task_list || '[]'); } catch(e) {}
    let taskIndex = user.current_task_index || 0;

    // --- Action: NEXT (No API Call) ---
    if (action === 'next') {
      let nextIndex = taskIndex + 1;

      if (nextIndex < currentTaskList.length) {
        const nextTask = currentTaskList[nextIndex];
        const completedTask = currentTaskList[taskIndex];
        
        // ★改善3: 進捗表示を追加
        const progressText = t.progress ? ` ${t.progress(nextIndex + 1, currentTaskList.length)}` : "";
        
        const updatedMemory = truncateContext((user.memory || "") + ` [System Log]: User completed task "${completedTask}".`);
        
        await c.env.DB.prepare(
          "UPDATE users SET current_task_index = ?, memory = ? WHERE email = ?"
        ).bind(nextIndex, updatedMemory, email).run();
        
        return c.json({
          reply: `${t.next_prefix}${nextTask}${progressText}`, // 進捗を表示
          timer_seconds: 180,
          detected_goal: current_goal,
          used_archetype: "system_optimized"
        });
      } else {
        await c.env.DB.prepare("UPDATE users SET task_list = '[]', current_task_index = 0 WHERE email = ?").bind(email).run();
        return c.json({
          reply: t.complete,
          timer_seconds: 0,
          detected_goal: null,
          used_archetype: "system_complete"
        });
      }
    }

    // --- Action: RETRY or NORMAL (Call API) ---
    const userMemory = truncateContext(user.memory || "");
    const safePrevContext = truncateContext(prev_context || "");
    const currentTaskText = currentTaskList[taskIndex] || "None";
    const remainingTasks = currentTaskList.slice(taskIndex + 1); 
    
    const planContext = currentTaskList.length > 0 
      ? `[Current Plan Status]: Working on step ${taskIndex + 1}/${currentTaskList.length} "${currentTaskText}". Future steps: ${JSON.stringify(remainingTasks)}.` 
      : "[Current Plan Status]: No active plan.";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    
    const systemInstruction = `
      You are an Executive Function Augmentation AI.
      [Language]: Reply in **${targetLangName}**.
      [User Memory]: ${userMemory}
      [Context]: ${safePrevContext}
      ${planContext}
      
      [GOAL]: ${current_goal || "Infer from user input"}
      
      [INSTRUCTIONS]:
      1. **IF 'RETRY' (Impossible)**:
         - The user cannot do "${currentTaskText}".
         - Break "${currentTaskText}" down into 2-3 tiny micro-steps.
         - Output these micro-steps in "new_task_list".
         - Be empathetic.
         
      2. **IF 'NORMAL' (New Goal)**:
         - If user input is a NEW goal, create a step-by-step checklist in "new_task_list".
      
      3. **IF 'NORMAL' (Chat/Motivation)**:
         - If user is just chatting or asking for advice *without* changing the goal, **DO NOT** return "new_task_list". 
         - Just return "reply". Keep the current plan active.

      [OUTPUT FORMAT]: JSON ONLY.
      {
        "reply": "Conversational response",
        "new_task_list": ["step1", "step2"...] (Optional: Only if planning/re-planning),
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
    
    // ★JSONパースエラー時のフォールバック処理
    let result;
    try {
      result = JSON.parse(extractJson(rawText));
    } catch (e) {
      console.error("JSON Parse Error:", rawText);
      result = { 
        reply: lang === 'ja' ? "申し訳ありません、通信エラーが発生しました。もう一度教えてください。" : "Sorry, a connection error occurred. Please try again.",
        timer_seconds: 60
      };
    }

    if (result.new_task_list && Array.isArray(result.new_task_list) && result.new_task_list.length > 0) {
      let finalTaskList: string[] = [];
      if (action === 'retry') {
        finalTaskList = [...result.new_task_list, ...remainingTasks];
      } else {
        finalTaskList = result.new_task_list;
      }
      await c.env.DB.prepare("UPDATE users SET task_list = ?, current_task_index = 0 WHERE email = ?").bind(JSON.stringify(finalTaskList), email).run();
    }

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

// 他のルートは変更なし
app.post('/api/feedback', async (c) => { /*...*/ return c.json({streak:0}); });
app.post('/api/share-recovery', async (c) => { /*...*/ return c.json({success:true}); });

app.post('/api/checkout', async (c) => {
  try {
    const { email, plan } = await c.req.json();
    if (!c.env.LEMON_SQUEEZY_STORE_ID) throw new Error("Missing Store ID");
    
    let variantId = plan === 'monthly' ? c.env.LEMON_SQUEEZY_VARIANT_ID_MONTHLY : c.env.LEMON_SQUEEZY_VARIANT_ID_YEARLY;
    if (!variantId && !plan) variantId = c.env.LEMON_SQUEEZY_VARIANT_ID_YEARLY;
    
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

app.post('/api/portal', async (c) => { /*...*/ return c.json({url:""}); });
app.post('/api/webhook', async (c) => { /*...*/ return c.text('Received'); });

export default app
