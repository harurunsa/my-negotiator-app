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

type PersonaAnalysisResult = {
  label: string;
  prompt: string;
};

const app = new Hono<{ Bindings: Bindings }>()

const MAX_CUSTOM_PERSONAS = 3; 

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
const MAX_CONTEXT_CHARS = 2500;

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
  ja: { limit_reached: "無料版の制限に達しました。シェアで回復するか、Proへ！" },
  en: { limit_reached: "Free limit reached. Share or Upgrade!" },
  pt: { limit_reached: "Limite atingido." },
  es: { limit_reached: "Límite alcanzado." },
  id: { limit_reached: "Batas tercapai." }
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

// ユーザー情報の取得 (画像復元 & スタイル復元用)
app.get('/api/user', async (c) => {
  const email = c.req.query('email');
  if (!email) return c.json({ error: "Email required" }, 400);
  
  const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user) return c.json({ error: "User not found" }, 404);
  
  try {
    user.custom_personas = JSON.parse(user.custom_personas || '[]');
  } catch(e) {
    user.custom_personas = [];
  }
  
  return c.json(user);
});

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

// 手動確認用API (Webhookの代わり)
app.post('/api/verify-subscription', async (c) => {
  try {
    const { email } = await c.req.json();
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

    // 1. Stripe上で顧客を検索
    const customers = await stripe.customers.list({ email: email, limit: 1 });
    if (customers.data.length === 0) {
      return c.json({ is_pro: 0, message: "No customer found" });
    }
    const customerId = customers.data[0].id;

    // 2. その顧客のサブスクリプション状況を確認
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1
    });

    // 3. 有効なサブスクがあればDBを更新
    const isPro = subscriptions.data.length > 0 ? 1 : 0;
    
    let isTrialing = false;
    if (!isPro) {
        const trials = await stripe.subscriptions.list({ customer: customerId, status: 'trialing', limit: 1 });
        if (trials.data.length > 0) isTrialing = true;
    }

    const finalStatus = (isPro || isTrialing) ? 1 : 0;

    await c.env.DB.prepare("UPDATE users SET is_pro = ?, stripe_customer_id = ? WHERE email = ?")
      .bind(finalStatus, customerId, email).run();

    return c.json({ success: true, is_pro: finalStatus });

  } catch(e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/persona/manage', async (c) => {
  try {
    const { email, action, personaId, newName } = await c.req.json();
    const user: any = await c.env.DB.prepare("SELECT custom_personas FROM users WHERE email = ?").bind(email).first();
    let personas = user?.custom_personas ? JSON.parse(user.custom_personas) : [];

    if (action === 'delete') {
      personas = personas.filter((p: any) => p.id !== personaId);
    } else if (action === 'rename') {
      personas = personas.map((p: any) => {
        if (p.id === personaId) return { ...p, label: newName };
        return p;
      });
    }

    await c.env.DB.prepare("UPDATE users SET custom_personas = ? WHERE email = ?").bind(JSON.stringify(personas), email).run();
    return c.json({ success: true, personas }); 
  } catch(e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 画像解析API
app.post('/api/analyze-persona', async (c) => {
  try {
    const { email, imageBase64, lang = 'ja' } = await c.req.json();
    const apiKey = c.env.GEMINI_API_KEY;

    const user: any = await c.env.DB.prepare("SELECT custom_personas FROM users WHERE email = ?").bind(email).first();
    let currentPersonas = user?.custom_personas ? JSON.parse(user.custom_personas) : [];
    
    if (currentPersonas.length >= MAX_CUSTOM_PERSONAS) {
      return c.json({ error: "LIMIT_REACHED" }, 400);
    }

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

    const newPersona = {
      id: `custom_${Date.now()}`,
      label: analysis.label,
      prompt: analysis.prompt,
      image: imageBase64
    };
    
    currentPersonas.push(newPersona);
    if (currentPersonas.length > MAX_CUSTOM_PERSONAS) currentPersonas = currentPersonas.slice(0, MAX_CUSTOM_PERSONAS);

    await c.env.DB.prepare("UPDATE users SET custom_personas = ? WHERE email = ?").bind(JSON.stringify(currentPersonas), email).run();

    return c.json({ success: true, persona: newPersona });

  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// AI Chat (物理アクション強制 & 口調維持 & スタイル保存)
app.post('/api/chat', async (c) => {
  try {
    const { message, email, action, prev_context, current_goal, lang = 'en', style = 'auto' } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    const t = MESSAGES[lang] || MESSAGES.en;
    const langMap: {[key:string]: string} = { ja: 'Japanese', en: 'English', pt: 'Portuguese', es: 'Spanish', id: 'Indonesian' };
    const targetLangName = langMap[lang] || 'English';
    
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user) return c.json({ error: "User not found" }, 401);

    if (style) {
      await c.env.DB.prepare("UPDATE users SET current_style = ? WHERE email = ?").bind(style, email).run();
    }

    if (!user.is_pro && user.usage_count >= DAILY_LIMIT) {
      return c.json({ limit_reached: true, reply: t.limit_reached });
    }

    if (action === 'normal' || action === 'retry') {
      await c.env.DB.prepare("UPDATE users SET usage_count = usage_count + 1 WHERE email = ?").bind(email).run();
    }

    // --- 人格決定ロジック ---
    let archetypeLabel = "Empathic Counselor";
    let archetypePrompt = ARCHETYPES['empathy'].prompt;
    let selectedKey = style;

    if (style && style !== 'auto') {
        if (ARCHETYPES[style]) {
            archetypeLabel = ARCHETYPES[style].label;
            archetypePrompt = ARCHETYPES[style].prompt;
        } else if (style.startsWith('custom_')) {
            const customs = user.custom_personas ? JSON.parse(user.custom_personas) : [];
            const target = customs.find((p: any) => p.id === style);
            if (target) {
                archetypeLabel = target.label;
                archetypePrompt = target.prompt;
            }
        }
    } else {
        selectedKey = 'empathy'; 
        archetypeLabel = ARCHETYPES[selectedKey].label;
        archetypePrompt = ARCHETYPES[selectedKey].prompt;
    }

    // --- タスク処理とプロンプト構築 ---
    let currentTaskList: string[] = [];
    try { currentTaskList = JSON.parse(user.task_list || '[]'); } catch(e) {}
    let taskIndex = user.current_task_index || 0;
    
    const userMemory = truncateContext(user.memory || "");
    const safePrevContext = truncateContext(prev_context || "");
    
    let instructionBlock = "";
    
    // --- アクションごとの指示生成 ---
    if (action === 'next') {
        let nextIndex = taskIndex + 1;
        if (nextIndex < currentTaskList.length) {
            const nextTask = currentTaskList[nextIndex];
            const completedTask = currentTaskList[taskIndex];
            
            // ログ更新
            const updatedMemory = truncateContext((user.memory || "") + ` [Log]: User finished "${completedTask}".`);
            await c.env.DB.prepare("UPDATE users SET current_task_index = ?, memory = ? WHERE email = ?").bind(nextIndex, updatedMemory, email).run();
            
            instructionBlock = `
              [STATUS]: User clicked "Next".
              [COMPLETED]: "${completedTask}"
              [NEXT TASK]: "${nextTask}" (Step ${nextIndex + 1} of ${currentTaskList.length})
              [INSTRUCTION]: 
              1. **ROLEPLAY**: Speak as [Current Persona]. Praise the user.
              2. **DIRECTIVE**: Tell them the next task is "${nextTask}".
              3. **PROGRESS**: Mention "You are at step ${nextIndex + 1}/${currentTaskList.length}!".
              [OUTPUT]: JSON "reply" only. No "new_task_list".
            `;
        } else {
            // 全完了
            await c.env.DB.prepare("UPDATE users SET task_list = '[]', current_task_index = 0 WHERE email = ?").bind(email).run();
            instructionBlock = `
              [STATUS]: User clicked "Next". All tasks done.
              [INSTRUCTION]: 
              1. **ROLEPLAY**: Speak as [Current Persona]. Celebrate enthusiastically!
              2. Ask what they want to do next.
              [OUTPUT]: JSON "reply" only.
            `;
        }
    } 
    
    else if (action === 'retry') {
        const currentTask = currentTaskList[taskIndex] || "Current Task";
        
        instructionBlock = `
          [STATUS]: User clicked "Impossible/Retry".
          [CURRENT TASK]: "${currentTask}"
          [INSTRUCTION]: Break this task down into 2-3 **PHYSICAL ACTIONS**.
          [FORBIDDEN VERBS]: Think, Decide, Check, Look, Prepare, Assess.
          [REQUIRED VERBS]: Stand up, Touch, Hold, Open, Throw, Walk.
          [EXAMPLE]: "Clean desk" -> 1. "Stand up from chair." 2. "Pick up one piece of trash." 3. "Throw it in bin."
          [OUTPUT]: JSON with "new_task_list" and "reply".
        `;
    } 
    
    else { // normal
        const currentTaskText = currentTaskList[taskIndex] || "None";
        const progressInfo = currentTaskList.length > 0 ? `(Step ${taskIndex + 1} of ${currentTaskList.length}: "${currentTaskText}")` : "(No active plan)";

        instructionBlock = `
          [STATUS]: User input: "${message}".
          [CURRENT PLAN]: ${progressInfo}.
          [INSTRUCTION]:
          1. **IF NEW GOAL** (e.g. "clean room", "study"):
             - Create a "new_task_list" with 3-5 steps.
             - **CRITICAL RULE**: Steps MUST be **PHYSICAL ACTIONS** (e.g. "Get trash bag", "Pick up bottles").
             - **DO NOT** use mental steps (e.g. "Check mess", "Decide where to start").
             - **FORGET**: Ignore previous finished tasks in memory if this is a new goal.
          2. **IF CHAT**:
             - Reply in [Current Persona] tone.
          3. **IF PROGRESS REPORT**:
             - Praise and guide to next step.
          [OUTPUT]: JSON. If new plan, include "new_task_list". Always include "reply".
        `;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    
    const systemInstructionContent = `
      You are an Executive Function Support AI.
      [Language]: Reply in **${targetLangName}**.
      [Current Persona]: **${archetypeLabel}**
      [Persona Instructions]: ${archetypePrompt}
      
      [User Context]: ${safePrevContext}
      [Memory]: ${userMemory}
      
      ${instructionBlock}
      
      [ABSOLUTE RULES]:
      1. **ALWAYS** speak in the [Current Persona] tone. Do not revert to a robotic assistant.
      2. **ACTION BIAS**: Use PHYSICAL VERBS (Stand, Pick up). Avoid cognitive verbs (Think).
      3. Keep responses concise.

      [OUTPUT FORMAT]: JSON ONLY
      {
        "reply": "Conversational response in Persona Tone",
        "new_task_list": ["Action 1", "Action 2"] (Optional),
        "timer_seconds": 180,
        "detected_goal": "Goal String",
        "used_archetype": "${selectedKey}"
      }
    `;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: systemInstructionContent }] }], generationConfig: { response_mime_type: "application/json" } })
    });

    const data: any = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    
    let result;
    try { result = JSON.parse(extractJson(rawText)); } catch (e) {
      console.error("JSON Parse Error:", rawText);
      result = { reply: lang === 'ja' ? "通信エラーが発生しました。" : "Error.", timer_seconds: 60, used_archetype: selectedKey };
    }
    
    if (!result.reply || result.reply.trim() === "") {
        result.reply = lang === 'ja' ? "準備はいい？次へ行こう！" : "Ready? Let's go!";
    }
    if (!result.used_archetype) result.used_archetype = selectedKey;

    if (result.new_task_list && Array.isArray(result.new_task_list) && result.new_task_list.length > 0) {
      let finalTaskList: string[] = [];
      if (action === 'retry') {
          const remaining = currentTaskList.slice(taskIndex + 1);
          finalTaskList = [...result.new_task_list, ...remaining];
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

// Stripe Checkout
app.post('/api/checkout', async (c) => {
  try {
    const { email, plan } = await c.req.json();
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
    
    const user: any = await c.env.DB.prepare("SELECT stripe_customer_id FROM users WHERE email = ?").bind(email).first();
    let customerId = user?.stripe_customer_id;

    const createNewCustomer = async () => {
      const customer = await stripe.customers.create({ email });
      await c.env.DB.prepare("UPDATE users SET stripe_customer_id = ? WHERE email = ?").bind(customer.id, email).run();
      return customer.id;
    };

    if (!customerId) customerId = await createNewCustomer();

    const priceId = plan === 'monthly' ? c.env.STRIPE_PRICE_ID_MONTHLY : c.env.STRIPE_PRICE_ID_YEARLY;

    try {
        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          payment_method_types: ['card'],
          line_items: [{ price: priceId, quantity: 1 }],
          mode: 'subscription',
          success_url: `${c.env.FRONTEND_URL}/?payment=success`,
          cancel_url: `${c.env.FRONTEND_URL}/?payment=cancelled`,
        });
        if (session.url) return c.json({ url: session.url });
    } catch (err: any) {
        if (err.code === 'resource_missing') {
            customerId = await createNewCustomer();
            const session = await stripe.checkout.sessions.create({
                customer: customerId,
                payment_method_types: ['card'],
                line_items: [{ price: priceId, quantity: 1 }],
                mode: 'subscription',
                success_url: `${c.env.FRONTEND_URL}/?payment=success`,
                cancel_url: `${c.env.FRONTEND_URL}/?payment=cancelled`,
            });
            if (session.url) return c.json({ url: session.url });
        } else { throw err; }
    }
    throw new Error("No URL");
  } catch(e: any) { return c.json({ error: e.message }, 500); }
});

app.post('/api/portal', async (c) => {
  try {
    const { email } = await c.req.json();
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

    const user: any = await c.env.DB.prepare("SELECT stripe_customer_id FROM users WHERE email = ?").bind(email).first();
    if (!user || !user.stripe_customer_id) return c.json({ error: "No billing information found" }, 404);

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${c.env.FRONTEND_URL}/`,
    });

    if (session.url) return c.json({ url: session.url });
    else throw new Error("Portal URL not found");
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post('/api/webhook', async (c) => {
  const sig = c.req.header('stripe-signature');
  const body = await c.req.text();
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

  let event;
  try {
    if (!sig) throw new Error("No signature");
    event = await stripe.webhooks.constructEventAsync(body, sig, c.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    return c.text(`Webhook Error: ${err.message}`, 400);
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'customer.subscription.updated') {
      const session = event.data.object as any;
      const customerId = session.customer;
      if (customerId) {
         const isActive = (session.status === 'active' || session.status === 'trialing');
         await c.env.DB.prepare("UPDATE users SET is_pro = ?, stripe_customer_id = ? WHERE stripe_customer_id = ? OR email = ?")
           .bind(isActive ? 1 : 0, customerId, customerId, session.customer_email || "").run();
      }
    }
    if (event.type === 'customer.subscription.deleted') {
      const session = event.data.object as any;
      const customerId = session.customer;
      if (customerId) {
        await c.env.DB.prepare("UPDATE users SET is_pro = 0 WHERE stripe_customer_id = ?").bind(customerId).run();
      }
    }
  } catch (e) { return c.text('DB Update Failed', 500); }

  return c.text('Received', 200);
});

export default app
