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

    // 初期化: まだstyleが無ければデフォルトを入れる
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

// --- ★進化的AIロジック ---
app.post('/api/chat', async (c) => {
  try {
    const { message, email } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    
    // 1. ユーザーの記憶と「現在のベストスタイル」を取得
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    let stylePrompt = user.current_best_style || "優しく励ます";
    const userMemory = user.memory || "特になし";

    // 2. 探索と活用 (Epsilon-Greedy: 20%の確率でスタイルを変異させる)
    const isExploration = Math.random() < 0.2;
    let usedStyle = stylePrompt;

    if (isExploration) {
      // ★探索: Gemini自体に「スタイルをちょっと変えて」と頼む
      // これにより「もっと厳しく」「もっと短く」などがランダムに試される
      const mutationUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      const mutationPrompt = `
        現在の接客スタイル: "${stylePrompt}"
        
        指示:
        このスタイルを「少しだけ」変更してください。
        例: 少し厳しくする、少しフランクにする、絵文字を増やす、哲学的する、など。
        ランダムに1つ方向性を決めて書き換えてください。
        出力は書き換えたスタイル説明文のみ。
      `;
      
      try {
        const mRes = await fetch(mutationUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: mutationPrompt }] }] })
        });
        const mData: any = await mRes.json();
        const mutated = mData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (mutated) {
          usedStyle = mutated.trim(); // 変異したスタイルを採用
        }
      } catch (e) {
        // エラー時は変異せずそのまま
      }
    }

    // 3. 本番生成 (Gemini 3 Flash)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const systemInstruction = `
      あなたはADHDサポートAIです。
      
      【現在のあなたの設定（スタイル）】:
      "${usedStyle}"
      ※この設定に徹底的になりきってください。
      
      【ユーザーの記憶】:
      ${userMemory}
      
      【出力ルール】JSONのみ
      {
        "reply": "返答",
        "score": 0〜100,
        "is_combo": boolean,
        "reason": "理由"
      }
    `;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: systemInstruction + "\n\nUser: " + message }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const data: any = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let result = JSON.parse(rawText);
    
    // フロントエンドに「今回使ったスタイル」を返す（フィードバック用）
    result.used_style = usedStyle;
    result.is_exploration = isExploration; // 画面で「🧪 実験中」とか出せるように

    // 4. 記憶の更新 (WaitUntil)
    c.executionCtx.waitUntil((async () => {
      // 会話内容からユーザー情報を更新する処理（前回と同じなので省略可だが重要）
      // ... (ユーザーメモリ更新ロジック) ...
    })());

    return c.json(result);

  } catch (e: any) {
    return c.json({ reply: `Error: ${e.message}` })
  }
})

// ★フィードバック（ここが進化の鍵）
app.post('/api/feedback', async (c) => {
  const { email, used_style, is_success } = await c.req.json();
  
  try {
    if (is_success) {
      // ★コンボ成功！ -> 今回のスタイルを「新たなベスト」として保存
      // これにより、たまたま試した「変異スタイル」が良ければ、次回からそれが標準になる
      await c.env.DB.prepare("UPDATE users SET current_best_style = ?, streak = streak + 1 WHERE email = ?")
        .bind(used_style, email).run();
    } else {
      // 失敗 -> スタイルは保存せず、コンボだけ処理（今回は維持）
      // 変異したスタイルがダメだったら、それは捨てられるので元のベストが維持される
    }
    
    const user: any = await c.env.DB.prepare("SELECT streak FROM users WHERE email = ?").bind(email).first();
    return c.json({ streak: user.streak, saved: is_success });

  } catch (e) {
    return c.json({ error: "DB Error" }, 500);
  }
});

export default app
