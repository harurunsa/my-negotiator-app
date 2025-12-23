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

// --- ★修正: 文脈維持ロジック ---
app.post('/api/chat', async (c) => {
  try {
    // current_goal を受け取るように追加
    const { message, email, action, prev_context, current_goal } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    let stylePrompt = user.current_best_style || "優しく励ます";
    const userMemory = user.memory || "特になし";

    let contextInstruction = "";
    let isExploration = false;

    // ★重要: ゴールの維持
    // ゴールが指定されている場合は、そこから逸れないように強く指示する
    const goalInstruction = current_goal 
      ? `【現在の大目標】: "${current_goal}"\n必ずこの目標の達成に向かって、論理的に繋がりのある次のステップを提案してください。関係のないタスク（例: 片付け中にPC作業など）は絶対禁止です。`
      : `会話からユーザーが達成したい「大目標（例: 部屋の掃除、レポート作成）」を推測し、それに向かって誘導してください。`;

    if (action === 'retry') {
      contextInstruction = `
        【状況: 拒絶】
        提案 "${prev_context}" は却下されました。
        指示:
        1. 謝罪し、タスクをさらに細分化してください。
        2. ${current_goal ? '大目標を見失わず、' : ''}ハードルを下げてください。
      `;
    } else if (action === 'next') {
      isExploration = Math.random() < 0.2; 
      contextInstruction = `
        【状況: コンボ継続中！】
        直前のステップ完了。ユーザーは集中しています。
        指示:
        1. 短く褒める。
        2. **${goalInstruction}**
        3. 勢いを止めない。
      `;
    } else {
      isExploration = Math.random() < 0.2;
    }

    // 探索（変異）ロジック
    let usedStyle = stylePrompt;
    if (isExploration && action !== 'retry') {
      const mutationUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      try {
        const mRes = await fetch(mutationUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `現在のスタイル: "${stylePrompt}"\nこれを少しだけ変更したスタイル説明文を作成せよ。` }] }] })
        });
        const mData: any = await mRes.json();
        const mutated = mData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (mutated) usedStyle = mutated.trim();
      } catch (e) {}
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const systemInstruction = `
      あなたはADHDサポートAIです。
      【スタイル】: "${usedStyle}"
      【記憶】: ${userMemory}
      
      ${goalInstruction}
      ${contextInstruction}
      
      【出力ルール】JSONのみ
      {
        "reply": "言葉",
        "timer_seconds": 推奨秒数(整数),
        "score": 0〜100,
        "is_combo": boolean,
        "detected_goal": "会話から推測される大目標（例: 部屋の掃除）。変更がなければ前の値を維持",
        "reason": "理由"
      }
    `;

    const requestText = action === 'normal' ? `User: ${message}` : `(System: ${action})`;

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

    // 通常会話なら記憶更新（省略）
    if (action === 'normal') {
      c.executionCtx.waitUntil((async () => {})());
    }

    return c.json(result);

  } catch (e: any) {
    return c.json({ reply: `Error: ${e.message}` })
  }
})

// フィードバック（変更なし）
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
