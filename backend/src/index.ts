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

// --- ★修正: 差別化のための「超・適応型」ロジック ---
app.post('/api/chat', async (c) => {
  try {
    const { message, email, action, prev_context, current_goal } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    let stylePrompt = user.current_best_style || "優しく励ます";
    const userMemory = user.memory || "特になし";

    let contextInstruction = "";
    
    // ゴールの維持（ここも強化）
    const goalInstruction = current_goal 
      ? `【絶対目標】: "${current_goal}"\n(※全ての提案はこの達成に向かうこと。関係ない話題へ逸れるのは禁止)`
      : `会話から「ユーザーが今達成したいゴール」を推測し、そこにロックオンしてください。`;

    if (action === 'retry') {
      // ★ここが差別化ポイント: 「無理」と言われたら劇的にハードルを下げる
      contextInstruction = `
        【緊急事態: ユーザーの拒絶】
        直前の提案 "${prev_context}" は「難しすぎる/やりたくない」と却下されました。
        
        ★絶対的な指示:
        1. 即座に謝罪し、「もっともっと簡単で、笑っちゃうようなこと」を提案してください。
        2. 「タスクの粒度」を現在の1/100にしてください。
        3. 精神論（がんばろう等）は禁止。物理的な最小動作のみを指示する。
        例: 「掃除」が無理 → 「ゴミ袋を1枚取るだけ」
        例: 「PC作業」が無理 → 「PCの前に座って深呼吸するだけ」
      `;
    } else if (action === 'next') {
      contextInstruction = `
        【コンボ継続中！ドーパミン放出中】
        ユーザーはノッています。
        指示:
        1. 短く、テンション高く褒める（絵文字付き）。
        2. 間髪入れずに「次のステップ」を出す。思考の隙間を与えない。
        3. 大目標 "${current_goal}" に向かって一直線に進める。
      `;
    }

    // AIリクエスト生成
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const systemInstruction = `
      あなたはADHDの脳特性をハックする「実行機能拡張AI」です。
      従来のToDoアプリとは違い、あなたは「感情」と「行動の着火」に特化しています。

      【現在のペルソナ】: "${stylePrompt}"
      【ユーザーの記憶】: ${userMemory}
      
      ${goalInstruction}
      ${contextInstruction}
      
      【出力ルール】JSONのみ
      {
        "reply": "ユーザーへの言葉（マークダウン対応）",
        "timer_seconds": 推奨秒数(整数),
        "score": 0〜100,
        "is_combo": boolean,
        "detected_goal": "推測される大目標（維持・更新）。なければnull",
        "reason": "理由"
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
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let result = JSON.parse(rawText);
    
    result.used_style = stylePrompt;

    if (action === 'normal') {
      c.executionCtx.waitUntil((async () => {})());
    }

    return c.json(result);

  } catch (e: any) {
    return c.json({ reply: `Error: ${e.message}` })
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
