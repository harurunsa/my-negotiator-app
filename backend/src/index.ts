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

app.get('/', (c) => c.json({ message: "ADHD Support Backend (Powered by Gemini 3 Flash)" }))

// --- 認証周り (変更なし) ---
app.get('/auth/login', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  if (!clientId) return c.text('Error: GOOGLE_CLIENT_ID not set', 500)
  const callbackUrl = `${new URL(c.req.url).origin}/auth/callback`
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${callbackUrl}&response_type=code&scope=openid%20email%20profile`
  return c.redirect(url)
})

app.get('/auth/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.text('Error: No code provided', 400)
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
    
    if (tokenData.error) {
       throw new Error(`Google Token Error: ${tokenData.error_description || tokenData.error}`);
    }

    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const userData: any = await userResponse.json()

    if (c.env.DB) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)`
      ).bind(userData.id, userData.email, userData.name, Date.now()).run();
    }

    const frontendUrl = "https://my-negotiator-app.pages.dev"
    return c.redirect(`${frontendUrl}?email=${userData.email}&name=${encodeURIComponent(userData.name)}`)
  } catch (e: any) {
    return c.text(`Auth Error: ${e.message}`, 500)
  }
})

// --- ★修正: Gemini 3 Flash (Preview) を指定 ---
app.post('/api/chat', async (c) => {
  try {
    const { message } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    
    if (!apiKey) return c.json({ reply: "【エラー】GEMINI_API_KEY が設定されていません" })

    // ★ここが重要です！正式なモデルIDを指定します
    // ドキュメントによると 'gemini-3-flash-preview' が正しいIDです
    const modelName = 'gemini-3-flash-preview'; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    const systemInstruction = `
      あなたはADHD（注意欠如・多動症）を持つユーザーをサポートする「実行機能パートナー」です。
      
      【役割】
      1. 共感と受容: 「できない」「めんどくさい」を脳の特性として肯定する。
      2. マイクロステップ分解: タスクを「PCを開く」「靴を履く」レベルまで分解して提案する。
      3. ドーパミン報酬: 相談したこと自体を即座に称賛し、高得点を与える。

      【出力形式】
      以下のJSONのみを返してください。
      {
        "reply": "励まし + 最初のマイクロステップ",
        "score": 0〜100 (基本80点以上),
        "is_combo": true/false (連続アクションならtrue),
        "reason": "短い褒め言葉"
      }
    `;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: systemInstruction + "\n\nUser Input: " + message }] }
        ],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const data: any = await response.json();

    if (data.error) {
      // エラー時にモデル名を確認しやすくするための詳細表示
      return c.json({ 
        reply: `【Gemini API Error】\nRequested Model: ${modelName}\nMessage: ${data.error.message}\nCode: ${data.error.code}\n\n※もし 'Not Found' になる場合は、'gemini-2.0-flash-exp' 等もお試しください。` 
      });
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return c.json({ reply: "AIからの返答が空でした。" });

    try {
      const result = JSON.parse(rawText);
      return c.json(result);
    } catch (e) {
      return c.json({ 
        reply: rawText, 
        score: 10, 
        is_combo: false, 
        reason: "解析エラーですがメッセージは受信しました" 
      });
    }

  } catch (e: any) {
    return c.json({ reply: `【Server Error】${e.message}` })
  }
})

export default app
