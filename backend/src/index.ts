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
      `INSERT INTO users (id, email, name, created_at, current_best_style) 
       VALUES (?, ?, ?, ?, 'タスクを極限まで小さく分解し、優しく励ますパートナー')
       ON CONFLICT(id) DO UPDATE SET name=excluded.name`
    ).bind(userData.id, userData.email, userData.name, Date.now()).run();

    const user: any = await c.env.DB.prepare("SELECT streak, is_pro FROM users WHERE id = ?").bind(userData.id).first();
    const frontendUrl = "https://my-negotiator-app.pages.dev"
    return c.redirect(`${frontendUrl}?email=${userData.email}&name=${encodeURIComponent(userData.name)}&streak=${user.streak || 0}&pro=${user.is_pro || 0}`)
  } catch (e: any) {
    return c.text(`Auth Error: ${e.message}`, 500)
  }
})

// --- ★修正: 文脈維持機能付きチャット ---
app.post('/api/chat', async (c) => {
  try {
    // ★ current_goal を受け取るように追加
    const { message, email, action, prev_context, current_goal } = await c.req.json() 
    const apiKey = c.env.GEMINI_API_KEY
    
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    let stylePrompt = user.current_best_style || "優しく励ます";
    const userMemory = user.memory || "特になし";

    let contextInstruction = "";
    let isExploration = false;

    if (action === 'retry') {
      contextInstruction = `
        【状況: ユーザー拒絶】
        直前の提案「${prev_context}」は却下されました。
        指示:
        1. 謝罪し、タスクの粒度をさらに半分以下にしてください。
        2. 目標「${current_goal || '今のタスク'}」を諦めさせないでください。
      `;
    } else if (action === 'next') {
      // ★ここを修正！目標に関連するタスクのみを出させる
      isExploration = Math.random() < 0.2; 
      contextInstruction = `
        【状況: コンボ継続中！】
        ユーザーは直前のステップを完了しました。
        
        ★最重要: ユーザーの現在の最終目標は【 ${current_goal} 】です。
        
        指示:
        1. 「ナイス！」と短く褒めてください。
        2. 目標【 ${current_goal} 】を達成するための、論理的な「次のマイクロステップ」を提示してください。
        3. 決して関係ない話題（デスクワークなど）に飛ばないでください。文脈を維持してください。
      `;
    } else {
      isExploration = Math.random() < 0.2;
    }

    // 探索（変異）ロジック
    let usedStyle = stylePrompt;
    if (isExploration && action !== 'retry') {
      const mutationUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      const mutationPrompt = `現在の接客スタイル: "${stylePrompt}"。指示: このスタイルを少しだけ変更（厳しく/優しく/短く/絵文字多め 等）して、バリエーションを作ってください。出力は説明文のみ。`;
      try {
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
      あなたはADHDサポートAIです。
      【現在のスタイル】: "${usedStyle}"
      【ユーザーの記憶】: ${userMemory}
      ${contextInstruction}
      
      【出力ルール】JSONのみ
      {
        "reply": "言葉",
        "timer_seconds": 推奨タイマー秒数(整数),
        "score": 0〜100,
        "is_combo": boolean,
        "reason": "理由"
      }
    `;

    // 通常会話なら入力を、アクションならトリガーを送る
    const requestText = action === 'normal' 
      ? `User Input: ${message}` 
      : `(System Trigger: ${action} - Current Goal: ${current_goal})`;

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
    let result = JSON.parse(rawText);
    
    result.used_style = usedStyle;
    result.is_exploration = isExploration;

    if (action === 'normal') {
      c.executionCtx.waitUntil((async () => { /* 記憶更新処理(省略) */ })());
    }

    return c.json(result);

  } catch (e: any) {
    return c.json({ reply: `Error: ${e.message}` })
  }
})

// --- フィードバック (変更なし) ---
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
