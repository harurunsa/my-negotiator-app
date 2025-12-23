import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  DB: D1Database
  GEMINI_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

// 1. CORS許可
app.use('/*', cors())

// 2. 生存確認
app.get('/', (c) => c.json({ message: "バックエンド稼働中（ライブラリ不要版）" }))

// 3. ログイン開始
app.get('/auth/login', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  if (!clientId) return c.text('Error: GOOGLE_CLIENT_ID not set', 500)
  const callbackUrl = `${new URL(c.req.url).origin}/auth/callback`
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${callbackUrl}&response_type=code&scope=email%20profile`
  return c.redirect(url)
})

// 4. Googleログイン & DB保存
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
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const userData: any = await userResponse.json()

    // DB保存
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)`
    ).bind(userData.id, userData.email, userData.name, Date.now()).run();

    const frontendUrl = "https://my-negotiator-app.pages.dev"
    return c.redirect(`${frontendUrl}?email=${userData.email}&name=${encodeURIComponent(userData.name)}`)
  } catch (e) {
    console.error(e)
    return c.text('Authentication Failed', 500)
  }
})

// 5. ★AIチャット（ライブラリなし・fetch版）
app.post('/api/chat', async (c) => {
  try {
    const { message } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    if (!apiKey) return c.json({ error: 'API Key not set' }, 500)

    // システムプロンプト（店員の役割設定）
    const systemInstruction = `
      あなたは家電量販店のベテラン店員です。
      ユーザーは「値引き」を求めてきますが、簡単には応じず、最初は断ってください。
      最終的に30%引きまでなら許可しますが、粘り強く交渉してください。
      回答は短くお願いします。
    `

    // 直接GeminiのAPIを叩く
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: systemInstruction + "\n\nユーザーの発言: " + message }] }
        ]
      })
    });

    const data: any = await response.json();
    
    // エラーチェック
    if (data.error) {
      console.error(data.error);
      return c.json({ error: 'Gemini API Error' }, 500);
    }

    // 返信を取り出す
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "すみません、よく聞き取れませんでした。";

    return c.json({ reply })

  } catch (e) {
    console.error(e)
    return c.json({ error: 'Server Error' }, 500)
  }
})

export default app
