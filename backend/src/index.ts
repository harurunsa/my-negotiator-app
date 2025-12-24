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

// --- 言語定義 ---
const MESSAGES = {
  ja: {
    system_retry: "😰 ハードルを極限まで下げています...",
    system_next: "🚀 ナイス！次のステップへ！",
    retry_instruction: "【緊急: ユーザー拒絶】直前の提案は却下されました。即座に謝罪し、タスクを物理的最小単位（指一本動かすだけ等）に分解してください。精神論は禁止。",
    next_instruction: "【コンボ継続中！】短くテンション高く褒めて、間髪入れずに次のステップを出してください。",
    goal_instruction: (goal: string) => `【絶対目標】: "${goal}"\n(※全ての提案はこの達成に向かうこと。関係ない話題は禁止)`,
    goal_default: "会話からユーザーのゴールを推測し、そこにロックオンしてください。",
    ai_persona: "あなたはADHDの脳特性をハックする実行機能拡張AIです。"
  },
  en: {
    system_retry: "😰 Lowering the hurdle to the absolute limit...",
    system_next: "🚀 Nice work! Next step!",
    retry_instruction: "[URGENT: User Rejection] The previous proposal was rejected. Apologize immediately and break the task down to the absolute physical minimum. No motivational speeches.",
    next_instruction: "[COMBO ACTIVE!] Praise shortly and energetically, then present the next step immediately.",
    goal_instruction: (goal: string) => `[ABSOLUTE GOAL]: "${goal}"\n(*All proposals must lead to this. No distractions.)`,
    goal_default: "Infer the user's current goal from the conversation and lock onto it.",
    ai_persona: "You are an Executive Function Augmentation AI that hacks ADHD brain characteristics."
  }
};

// --- 認証 (変更なし) ---
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
      `INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name`
    ).bind(userData.id, userData.email, userData.name, Date.now()).run();

    const user: any = await c.env.DB.prepare("SELECT streak, is_pro FROM users WHERE id = ?").bind(userData.id).first();
    const frontendUrl = "https://my-negotiator-app.pages.dev"
    return c.redirect(`${frontendUrl}?email=${userData.email}&name=${encodeURIComponent(userData.name)}&streak=${user.streak || 0}&pro=${user.is_pro || 0}`)
  } catch (e: any) {
    return c.text(`Auth Error: ${e.message}`, 500)
  }
})

// --- ★修正版チャットAPI ---
app.post('/api/chat', async (c) => {
  try {
    const { message, email, action, prev_context, current_goal, lang = 'ja' } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    const t = (MESSAGES as any)[lang] || MESSAGES.ja;
    
    // DB取得
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    let stylePrompt = user.current_best_style || (lang === 'en' ? "Supportive partner" : "優しく励ますパートナー");
    const userMemory = user.memory || "";

    // プロンプト作成
    let contextInstruction = "";
    const goalInstruction = current_goal ? t.goal_instruction(current_goal) : t.goal_default;
    let isExploration = false;

    if (action === 'retry') {
      const safeContext = prev_context ? prev_context.substring(0, 100) : "previous task";
      contextInstruction = t.retry_instruction + `\n(Rejected: "${safeContext}")`;
    } else if (action === 'next') {
      isExploration = Math.random() < 0.3;
      contextInstruction = t.next_instruction;
    } else {
      isExploration = Math.random() < 0.2;
    }

    // 変異ロジック (エラーが出ても無視して進む)
    let usedStyle = stylePrompt;
    if (isExploration && action !== 'retry') {
      try {
        const mutationUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const mBody = { contents: [{ role: "user", parts: [{ text: `Variation of: "${stylePrompt}"` }] }] };
        const mRes = await fetch(mutationUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mBody) });
        const mData: any = await mRes.json();
        const mutated = mData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (mutated) usedStyle = mutated.trim();
      } catch (e) {}
    }

    // 本番リクエスト (gemini-1.5-flashを使用)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const systemInstruction = `
      ${t.ai_persona}
      [Language]: ${lang === 'en' ? 'English' : 'Japanese'}
      [Style]: "${usedStyle}"
      [Memory]: ${userMemory}
      ${goalInstruction}
      ${contextInstruction}
      
      [CRITICAL RULE]: Output JSON ONLY. No markdown. No intro text.
      JSON Format:
      {
        "reply": "message string",
        "timer_seconds": 180,
        "score": 80,
        "is_combo": true,
        "detected_goal": "goal string or null",
        "reason": "reason string"
      }
    `;

    const requestText = action === 'normal' ? `User: ${message}` : `(System: ${action})`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: systemInstruction + "\n\n" + requestText }] }],
        generationConfig: { response_mime_type: "application/json" } // JSONモード強制
      })
    });

    const data: any = await response.json();
    
    // Google APIのエラーチェック
    if (data.error) {
      console.error("Gemini API Error:", data.error);
      return c.json({ reply: `(API Error: ${data.error.message})` });
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    
    // ★ここが修正点: JSONパースエラー時の救済措置
    let result;
    try {
      result = JSON.parse(rawText);
    } catch (e) {
      console.error("JSON Parse Failed, using raw text:", rawText);
      // JSONじゃなかった場合、生のテキストをreplyとして扱う
      result = {
        reply: rawText.replace(/```json|```/g, '').trim(), // コードブロック除去
        score: 50,
        is_combo: false,
        timer_seconds: 0,
        detected_goal: current_goal
      };
    }
    
    result.used_style = usedStyle;
    result.is_exploration = isExploration;

    // 記憶更新 (通常時のみ、エラー無視)
    if (action === 'normal') {
      c.executionCtx.waitUntil((async () => {
        try {
          const memBody = { contents: [{ role: "user", parts: [{ text: `Update memory based on: "${message}" -> "${result.reply}". Current: "${userMemory}". Output updated memory text only.` }] }] };
          const memRes = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(memBody) });
          const memData: any = await memRes.json();
          const newMemory = memData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (newMemory) await c.env.DB.prepare("UPDATE users SET memory = ? WHERE email = ?").bind(newMemory, email).run();
        } catch (err) {}
      })());
    }

    return c.json(result);

  } catch (e: any) {
    console.error("Server Error:", e);
    // サーバーエラー時もJSONを返してフロントエンドを落とさない
    return c.json({ reply: "通信エラーが発生しましたが、大丈夫です。もう一度試してください。", error: e.message });
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
