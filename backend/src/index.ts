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

// --- 認証周り (前回と同じなので省略可ですが、コピペ用に残します) ---
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

    // 初期スタイル設定
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

// --- ★進化したAIチャットロジック ---
app.post('/api/chat', async (c) => {
  try {
    const { message, email, action, prev_context } = await c.req.json() // action: 'normal' | 'retry' | 'next'
    const apiKey = c.env.GEMINI_API_KEY
    
    // 1. ユーザー情報取得
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    let stylePrompt = user.current_best_style || "優しく励ます";
    const userMemory = user.memory || "特になし";

    // 2. アクションに応じたプロンプト調整 (コンテキストバンディット的対応)
    let contextInstruction = "";
    let isExploration = false; // 今回実験するかどうか

    if (action === 'retry') {
      // ★リカバリー: 却下された場合
      // 変異はさせず、確実に「もっと小さく」する安全策をとる
      contextInstruction = `
        【重要状況: ユーザー拒絶】
        直前のあなたの提案は「難しすぎる」か「気に食わない」と却下されました。
        直前の提案: "${prev_context}"
        
        指示:
        1. まず短く謝ってください。
        2. タスクの粒度を「さらに半分以下」に小さくしてください。（例: PCを開く→PCの前に座る）
        3. スタイルは維持しますが、少し低姿勢にしてください。
      `;
    } else if (action === 'next') {
      // ★コンボ: 成功した場合
      // ユーザーはノッているので、探索(変異)を入れても良いタイミング
      isExploration = Math.random() < 0.2; 
      contextInstruction = `
        【重要状況: コンボ継続中！】
        ユーザーは直前のタスクを完了しました！ドーパミンが出ています！
        
        指示:
        1. 「ナイス！」「その調子！」と短く褒めてください。
        2. 間髪入れずに「次のマイクロステップ」を提示してください。
        3. 勢いを止めないでください。
      `;
    } else {
      // 通常会話
      isExploration = Math.random() < 0.2;
    }

    // 3. スタイルの突然変異 (探索)
    let usedStyle = stylePrompt;
    if (isExploration && action !== 'retry') {
      const mutationUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      const mutationPrompt = `
        現在の接客スタイル: "${stylePrompt}"
        指示: このスタイルを少しだけ変更（厳しく/優しく/短く/絵文字多め 等）して、バリエーションを作ってください。出力は説明文のみ。
      `;
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

    // 4. Geminiリクエスト生成
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const systemInstruction = `
      あなたはADHDサポートAIです。
      【現在のスタイル設定】: "${usedStyle}"
      【ユーザーの記憶】: ${userMemory}
      
      ${contextInstruction}
      
      【出力ルール】JSONのみ
      {
        "reply": "ユーザーへの言葉",
        "timer_seconds": 推奨タイマー秒数(整数。タスクが小さいなら180、大きいなら300など。最大600),
        "score": 0〜100,
        "is_combo": boolean,
        "reason": "理由"
      }
    `;

    const requestText = action === 'normal' ? `User Input: ${message}` : `(System Trigger: ${action})`;

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

    // 5. 記憶更新 (通常会話のみ)
    if (action === 'normal') {
      c.executionCtx.waitUntil((async () => {
         // (記憶更新ロジックは省略)
      })());
    }

    return c.json(result);

  } catch (e: any) {
    return c.json({ reply: `Error: ${e.message}` })
  }
})

// --- フィードバック ---
app.post('/api/feedback', async (c) => {
  const { email, used_style, is_success } = await c.req.json();
  try {
    if (is_success) {
      // 成功時のみスタイルを上書き保存 (強化学習)
      await c.env.DB.prepare("UPDATE users SET current_best_style = ?, streak = streak + 1 WHERE email = ?")
        .bind(used_style, email).run();
    }
    const user: any = await c.env.DB.prepare("SELECT streak FROM users WHERE email = ?").bind(email).first();
    return c.json({ streak: user.streak });
  } catch (e) { return c.json({ error: "DB Error" }, 500); }
});

export default app
