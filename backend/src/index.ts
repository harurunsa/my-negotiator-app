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

type PersonaAnalysisResult = {
  label: string;
  prompt: string;
};

const app = new Hono<{ Bindings: Bindings }>()

// CORS制限
app.use('/*', async (c, next) => {
  const corsMiddleware = cors({
    origin: c.env.FRONTEND_URL || '*',
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

// 人格（アーキタイプ）定義
const ARCHETYPES: any = {
  empathy: {
    label: "The Empathic Counselor",
    prompt: "Tone: Warm, soft, soothing. Focus on emotional support. 'It's okay, let's take a small step.'"
  },
  logic: {
    label: "The Logical Analyst",
    prompt: "Tone: Precise, efficient, robotic. Focus on efficiency and logic. 'Executing step 1. No emotions required.'"
  },
  game: {
    label: "The Game Master",
    prompt: "Tone: Playful, RPG-style. Treat tasks as 'Quests' and the user as a 'Hero'. 'Quest Accepted! Your loot awaits!'"
  },
  passion: {
    label: "The Passionate Coach",
    prompt: "Tone: Hot, energetic, Shuzo Matsuoka style! Push for action! 'You can do it!! Just one step!!'"
  },
  minimal: {
    label: "The Minimalist",
    prompt: "Tone: Extremely short. Max 5 words per sentence. Direct commands. 'Do it. Now.'"
  }
};

type ArchetypeKey = keyof typeof ARCHETYPES;

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
function extractJson(text: string): string {
  let cleaned = text.replace(/```json\s*|\s*```/g, '');
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

// --- API Endpoints ---

app.post('/api/language', async (c) => {
  const { email, language } = await c.req.json();
  await c.env.DB.prepare("UPDATE users SET language = ? WHERE email = ?").bind(language, email).run();
  return c.json({ success: true });
});

app.post('/api/inquiry', async (c) => {
  try {
    const { email, message } = await c.req.json();
    if (!message || message.trim() === "") return c.json({ error: "Empty message" }, 400);
    await c.env.DB.prepare("INSERT INTO inquiries (id, email, message, created_at) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), email, message, Date.now()).run();
    return c.json({ success: true });
  } catch(e: any) { return c.json({ error: e.message }, 500); }
});

// ★ 画像解析API (推しの口調を生成)
app.post('/api/analyze-persona', async (c) => {
  try {
    const { email, imageBase64, lang = 'ja' } = await c.req.json();
    const apiKey = c.env.GEMINI_API_KEY;

    const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

    const systemInstruction = `
      Analyze the image of the character provided.
      1. Infer the character's name (or give a descriptive nickname).
      2. Analyze their visual appearance to determine their likely personality and speech style (tone).
      3. Create a detailed system instruction to roleplay as this character.
      
      [Language]: Output in ${lang === 'ja' ? 'Japanese' : 'English'}.
      
      [OUTPUT JSON format]:
      {
        "label": "Character Name",
        "prompt": "Tone: [Description]. Speech style: [Examples]. Acting instruction..."
      }
    `;

    // チャットと同じモデルを使用
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: systemInstruction },
            { inline_data: { mime_type: "image/jpeg", data: cleanBase64 } }
          ]
        }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const data: any = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const analysis: PersonaAnalysisResult = JSON.parse(extractJson(rawText));

    // DB保存
    const user: any = await c.env.DB.prepare("SELECT custom_personas FROM users WHERE email = ?").bind(email).first();
    let currentPersonas = user?.custom_personas ? JSON.parse(user.custom_personas) : [];
    
    const newPersona = {
      id: `custom_${Date.now()}`,
      label: analysis.label,
      prompt: analysis.prompt,
      image: imageBase64
    };
    
    currentPersonas.push(newPersona);
    if (currentPersonas.length > 3) currentPersonas.shift();

    await c.env.DB.prepare("UPDATE users SET custom_personas = ? WHERE email = ?").bind(JSON.stringify(currentPersonas), email).run();

    return c.json({ success: true, persona: newPersona });

  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ★ AI Chat (口調指定 & カスタム対応版)
app.post('/api/chat', async (c) => {
  try {
    const { message, email, action, prev_context, current_goal, lang = 'en', style = 'auto' } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    const t = MESSAGES[lang] || MESSAGES.en;
    const langMap: {[key:string]: string} = { ja: 'Japanese', en: 'English', pt: 'Portuguese', es: 'Spanish', id: 'Indonesian' };
    const targetLangName = langMap[lang] || 'English';
    
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user) return c.json({ error: "User not found" }, 401);

    if (!user.is_pro && user.usage_count >= DAILY_LIMIT) {
      return c.json({ limit_reached: true, reply: t.limit_reached });
    }

    if (action === 'normal' || action === 'retry') {
      await c.env.DB.prepare("UPDATE users SET usage_count = usage_count + 1 WHERE email = ?").bind(email).run();
    }

    // タスクリスト処理
    let currentTaskList: string[] = [];
    try { currentTaskList = JSON.parse(user.task_list || '[]'); } catch(e) {}
    let taskIndex = user.current_task_index || 0;

    if (action === 'next') {
      let nextIndex = taskIndex + 1;
      if (nextIndex < currentTaskList.length) {
        const nextTask = currentTaskList[nextIndex];
        const completedTask = currentTaskList[taskIndex];
        const progressText = t.progress ? ` ${t.progress(nextIndex + 1, currentTaskList.length)}` : "";
        const updatedMemory = truncateContext((user.memory || "") + ` [System Log]: User completed task "${completedTask}".`);
        await c.env.DB.prepare("UPDATE users SET current_task_index = ?, memory = ? WHERE email = ?").bind(nextIndex, updatedMemory, email).run();
        
        return c.json({ reply: `${t.next_prefix}${nextTask}${progressText}`, timer_seconds: 180, detected_goal: current_goal, used_archetype: "system_optimized" });
      } else {
        await c.env.DB.prepare("UPDATE users SET task_list = '[]', current_task_index = 0 WHERE email = ?").bind(email).run();
        return c.json({ reply: t.complete, timer_seconds: 0, detected_goal: null, used_archetype: "system_complete" });
      }
    }

    // 人格決定ロジック
    let archetypeLabel = "Empathic Counselor";
    let archetypePrompt = ARCHETYPES['empathy'].prompt;
    let selectedKey = style;

    if (style && style !== 'auto') {
        if (ARCHETYPES[style]) {
            // プリセットから
            archetypeLabel = ARCHETYPES[style].label;
            archetypePrompt = ARCHETYPES[style].prompt;
        } else if (style.startsWith('custom_')) {
            // カスタムから検索
            const customs = user.custom_personas ? JSON.parse(user.custom_personas) : [];
            const target = customs.find((p: any) => p.id === style);
            if (target) {
                archetypeLabel = target.label;
                archetypePrompt = target.prompt;
            }
        }
    } else {
        // 自動 (Bandit)
        const styleStats = user.style_stats ? JSON.parse(user.style_stats) : {};
        const epsilon = 0.2; 
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
        
        archetypeLabel = ARCHETYPES[selectedKey].label;
        archetypePrompt = ARCHETYPES[selectedKey].prompt;
    }

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
      
      [CURRENT PERSONA]: **${archetypeLabel}**
      [PERSONA INSTRUCTION]: ${archetypePrompt}
      
      [CRITICAL RULE]: 
      1. Reply MUST reflect the [PERSONA INSTRUCTION] (Tone/Style/Roleplay).
      2. Task items in "new_task_list" must be **SHORT ACTION PHRASES ONLY**. No conversational filler in the list.
      
      [INSTRUCTIONS]:
      1. **IF 'RETRY' (Impossible)**:
         - Break "${currentTaskText}" down into 2-3 tiny micro-steps.
         - **IMPORTANT**: The last micro-step MUST be a "Check" step to verify completion.
         - Output in "new_task_list".
         
      2. **IF 'NORMAL' (New Goal)**:
         - Create a **COMPLETE** step-by-step checklist in "new_task_list".
      
      3. **IF 'NORMAL' (Chat/Motivation)**:
         - If just chatting, **DO NOT** return "new_task_list". Return "reply" only.

      [OUTPUT FORMAT]: JSON ONLY.
      {
        "reply": "Conversational response in Persona Tone",
        "new_task_list": ["Action 1", "Action 2"...] (Optional),
        "timer_seconds": 180,
        "detected_goal": "Goal String",
        "used_archetype": "${selectedKey}"
      }
    `;

    const requestText = `User: ${message} (Action: ${action})`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: systemInstruction + "\n\n" + requestText }] }], generationConfig: { response_mime_type: "application/json" } })
    });

    const data: any = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    
    let result;
    try { result = JSON.parse(extractJson(rawText)); } catch (e) {
      console.error("JSON Parse Error:", rawText);
      result = { reply: lang === 'ja' ? "通信エラーが発生しました。" : "Connection error.", timer_seconds: 60, used_archetype: selectedKey };
    }
    
    if (!result.used_archetype) result.used_archetype = selectedKey;

    if (result.new_task_list && Array.isArray(result.new_task_list) && result.new_task_list.length > 0) {
      let finalTaskList: string[] = [];
      if (action === 'retry') finalTaskList = [...result.new_task_list, ...remainingTasks];
      else finalTaskList = result.new_task_list;
      await c.env.DB.prepare("UPDATE users SET task_list = ?, current_task_index = 0 WHERE email = ?").bind(JSON.stringify(finalTaskList), email).run();
    }

    if (result.reply) {
      c.executionCtx.waitUntil((async () => {
        const newMem = truncateContext(userMemory + ` U:${message} A:${result.reply}`);
        await c.env.DB.prepare("UPDATE users SET memory = ? WHERE email = ?").bind(newMem, email).run();
      })());
    }
    return c.json(result);
  } catch (e: any) { return c.json({ reply: `System Error: ${e.message}`, timer_seconds: 0 }); }
})

// --- Feedback & Others ---
app.post('/api/feedback', async (c) => {
  const { email, used_archetype, is_success } = await c.req.json();
  try {
    const user: any = await c.env.DB.prepare("SELECT style_stats, streak FROM users WHERE email = ?").bind(email).first();
    let stats = user.style_stats ? JSON.parse(user.style_stats) : {};
    
    if (used_archetype && !used_archetype.startsWith('system_')) {
        if (!stats[used_archetype]) stats[used_archetype] = { wins: 0, total: 0 };
        stats[used_archetype].total += 1;
        if (is_success) stats[used_archetype].wins += 1;
        await c.env.DB.prepare("UPDATE users SET style_stats = ?, streak = streak + ? WHERE email = ?").bind(JSON.stringify(stats), is_success ? 1 : 0, email).run();
    } else {
        if(is_success) await c.env.DB.prepare("UPDATE users SET streak = streak + 1 WHERE email = ?").bind(email).run();
    }
    return c.json({ streak: user.streak + (is_success ? 1 : 0) });
  } catch (e) { return c.json({ error: "DB Error" }, 500); }
});

app.post('/api/share-recovery', async (c) => {
  try {
    const { email } = await c.req.json();
    const result = await c.env.DB.prepare("UPDATE users SET usage_count = 0 WHERE email = ?").bind(email).run();
    if (result.meta.changes > 0) return c.json({ success: true, message: "Usage limit reset!" });
    else return c.json({ success: false, error: "User not found" }, 404);
  } catch(e: any) { return c.json({ error: "DB Error", details: e.message }, 500); }
});

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
