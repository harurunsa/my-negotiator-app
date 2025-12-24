import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  DB: D1Database
  GEMINI_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/*', cors())

// --- 言語別の定数定義 ---
const MESSAGES = {
  ja: {
    retry_instruction: "【緊急: ユーザー拒絶】直前の提案は却下されました。即座に謝罪し、タスクを物理的最小単位（指一本動かすだけ等）に分解してください。精神論は禁止。",
    next_instruction: "【コンボ継続中！】短くテンション高く褒めて、間髪入れずに次のステップを出してください。",
    goal_instruction: (goal: string) => `【絶対目標】: "${goal}"\n(※全ての提案はこの達成に向かうこと。関係ない話題は禁止)`,
    goal_default: "会話からユーザーのゴールを推測し、そこにロックオンしてください。",
    ai_persona: "あなたはADHDの脳特性をハックする実行機能拡張AIです。"
  },
  en: {
    retry_instruction: "[URGENT: User Rejection] The previous proposal was rejected. Apologize immediately and break the task down to the absolute physical minimum (e.g., just moving a finger). No motivational speeches, just easy physics.",
    next_instruction: "[COMBO ACTIVE!] Praise shortly and energetically, then present the next step immediately.",
    goal_instruction: (goal: string) => `[ABSOLUTE GOAL]: "${goal}"\n(*All proposals must lead to this. No distractions.)`,
    goal_default: "Infer the user's current goal from the conversation and lock onto it.",
    ai_persona: "You are an Executive Function Augmentation AI that hacks ADHD brain characteristics. Be punchy, empathetic, and gamified."
  }
};

// --- ヘルパー関数: JSONのお掃除 ---
function cleanJson(text: string): string {
  // Markdownのコードブロック記号 (```json ... ```) を削除
  return text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
}

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
    const frontendUrl = "https://my-negotiator-app.pages.dev"
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
    const t = (MESSAGES as any)[lang] || MESSAGES.ja; 
    
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    let stylePrompt = user.current_best_style || (lang === 'en' ? "Supportive and punchy partner" : "優しく励ますパートナー");
    const userMemory = user.memory || "";

    let contextInstruction = "";
    let isExploration = false;

    // ゴール指示
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
      const mutationUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const systemInstruction = `
      ${t.ai_persona}
      [Language]: Reply in ${lang === 'en' ? 'English' : 'Japanese'}.
      [Current Persona]: "${usedStyle}"
      [User Memory]: ${userMemory}
      
      ${goalInstruction}
      ${contextInstruction}
      
      [OUTPUT RULES]: Output JSON ONLY. No markdown formatting.
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

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: systemInstruction + "\n\n" + requestText }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const data: any = await response.json();
    
    // ★修正: JSONパースを頑丈にする
    let result;
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    
    try {
      const cleanedText = cleanJson(rawText);
      result = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error("JSON Parse Error:", rawText);
      // パース失敗時のフォールバック (アプリを止めない)
      result = {
        reply: lang === 'en' ? "Sorry, I'm thinking too hard! Let's just do it." : "すみません、少し考えすぎました！とにかくやりましょう。",
        timer_seconds: 180,
        score: 50,
        is_combo: false,
        detected_goal: current_goal
      };
    }
    
    result.used_style = usedStyle; 
    result.is_exploration = isExploration;

    // 記憶更新
    if (action === 'normal' || action === 'next') {
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
    // どんなエラーでもJSONで返して、フロントエンドをフリーズさせない
    return c.json({ 
      reply: `System Error: ${e.message}`, 
      timer_seconds: 0 
    });
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
