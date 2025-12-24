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

// --- 1. Google認証 ---
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

    // ユーザー初期化（既存ユーザーなら名前だけ更新、記憶やスタイルは維持）
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

// --- 2. メインチャット機能（進化＆記憶） ---
app.post('/api/chat', async (c) => {
  try {
    const { message, email, action, prev_context, current_goal } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    
    // ユーザー情報のロード
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    let stylePrompt = user.current_best_style || "優しく励ます"; // 現在の最適スタイル
    const userMemory = user.memory || "特になし"; // 長期記憶

    let contextInstruction = "";
    let isExploration = false; // 今回「実験（変異）」をするかどうか

    // ゴール維持指示
    const goalInstruction = current_goal 
      ? `【絶対目標】: "${current_goal}"\n(※全ての提案はこの達成に向かうこと。関係ない話題へ逸れるのは禁止)`
      : `会話から「ユーザーが今達成したいゴール」を推測し、そこにロックオンしてください。`;

    // アクション分岐
    if (action === 'retry') {
      // ★「無理」と言われた時: 徹底的にハードルを下げる
      contextInstruction = `
        【緊急: ユーザー拒絶】
        直前の提案 "${prev_context}" は却下されました。
        指示:
        1. 即座に謝罪してください。
        2. タスクを「物理的に可能な最小単位（指を動かすだけ等）」まで分解してください。
        3. 精神論禁止。物理的なイージーさを提示すること。
      `;
    } else if (action === 'next') {
      // ★コンボ中: 勢いを殺さない
      // ここで少し「実験（口調の変化）」を混ぜる確率を上げる
      isExploration = Math.random() < 0.3; 
      contextInstruction = `
        【コンボ継続中！】
        指示:
        1. 短くテンション高く褒める。
        2. 間髪入れずに次のステップを出す。
      `;
    } else {
      // 通常会話: 20%で変異
      isExploration = Math.random() < 0.2;
    }

    // ★進化的アルゴリズム: スタイルの突然変異
    let usedStyle = stylePrompt;
    if (isExploration && action !== 'retry') {
      const mutationUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      try {
        const mRes = await fetch(mutationUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `現在の接客スタイル: "${stylePrompt}"\nこれのバリエーション（少し厳しく/もっとフランクになど）を1つ作成せよ。出力は説明文のみ。` }] }] })
        });
        const mData: any = await mRes.json();
        const mutated = mData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (mutated) usedStyle = mutated.trim(); // 変異スタイル採用
      } catch (e) {}
    }

    // Geminiへのリクエスト
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const systemInstruction = `
      あなたはADHDの脳特性をハックする実行機能拡張AIです。
      【現在のペルソナ】: "${usedStyle}"
      【ユーザーの記憶】: ${userMemory}
      
      ${goalInstruction}
      ${contextInstruction}
      
      【出力ルール】JSONのみ
      {
        "reply": "ユーザーへの言葉",
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
    
    // フロントエンドに「今回使ったスタイル」を返す（フィードバック用）
    result.used_style = usedStyle; 
    result.is_exploration = isExploration;

    // --- ★ここが追加箇所: 記憶の更新 (バックグラウンド処理) ---
    if (action === 'normal' || action === 'next') {
      c.executionCtx.waitUntil((async () => {
        try {
          const memoryPrompt = `
            あなたはユーザーの記憶管理者です。
            【現在の記憶】: "${userMemory}"
            【直前のやり取り】: User="${message}" / AI="${result.reply}"
            
            指示:
            会話から「ユーザーの苦手なこと、成功したパターン、生活習慣」等の新しい事実があれば、
            現在の記憶を更新・追記してください。
            出力は「更新後の記憶テキスト」のみ。
          `;

          const memRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: memoryPrompt }] }] })
          });
          const memData: any = await memRes.json();
          const newMemory = memData.candidates?.[0]?.content?.parts?.[0]?.text;
          
          if (newMemory) {
            await c.env.DB.prepare("UPDATE users SET memory = ? WHERE email = ?").bind(newMemory, email).run();
            console.log("Memory Updated:", newMemory);
          }
        } catch (err) {
          console.error("Memory update failed", err);
        }
      })());
    }

    return c.json(result);

  } catch (e: any) {
    return c.json({ reply: `Error: ${e.message}` })
  }
})

// --- 3. フィードバック (進化の確定) ---
app.post('/api/feedback', async (c) => {
  const { email, used_style, is_success } = await c.req.json();
  try {
    if (is_success) {
      // 成功したら、そのスタイルを「最強」として保存 (進化確定)
      await c.env.DB.prepare("UPDATE users SET current_best_style = ?, streak = streak + 1 WHERE email = ?").bind(used_style, email).run();
    }
    const user: any = await c.env.DB.prepare("SELECT streak FROM users WHERE email = ?").bind(email).first();
    return c.json({ streak: user.streak });
  } catch (e) { return c.json({ error: "DB Error" }, 500); }
});

export default app
