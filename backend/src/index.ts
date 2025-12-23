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

app.get('/', (c) => c.json({ message: "バックエンド稼働中" }))

app.get('/auth/login', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  if (!clientId) return c.text('エラー: GOOGLE_CLIENT_ID が設定されていません', 500)
  const callbackUrl = `${new URL(c.req.url).origin}/auth/callback`
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${callbackUrl}&response_type=code&scope=email%20profile`)
})

app.get('/auth/callback', async (c) => {
  try {
    const code = c.req.query('code')
    if (!code) throw new Error("Googleからコードが返ってきませんでした")

    // 1. 環境変数のチェック
    if (!c.env.DB) throw new Error("データベース(DB)が接続されていません。wrangler.tomlの設定を確認してください。")
    if (!c.env.GOOGLE_CLIENT_SECRET) throw new Error("GOOGLE_CLIENT_SECRET が設定されていません。")

    // 2. トークン交換
    const callbackUrl = `${new URL(c.req.url).origin}/auth/callback`
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ 
        code, 
        client_id: c.env.GOOGLE_CLIENT_ID, 
        client_secret: c.env.GOOGLE_CLIENT_SECRET, 
        redirect_uri: callbackUrl, 
        grant_type: 'authorization_code' 
      }),
    })
    const tokenData: any = await tokenRes.json()
    if (tokenData.error) throw new Error(`Googleトークン取得エラー: ${JSON.stringify(tokenData)}`)

    // 3. ユーザー情報取得
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const userData: any = await userRes.json()
    if (userData.error) throw new Error(`ユーザー情報取得エラー: ${JSON.stringify(userData)}`)

    // 4. DB保存
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)`
    ).bind(userData.id, userData.email, userData.name, Date.now()).run();

    // 成功したらリダイレクト
    return c.redirect(`https://my-negotiator-app.pages.dev?email=${userData.email}&name=${encodeURIComponent(userData.name)}`)

  } catch (e: any) {
    // ★ここでエラーの中身を全部画面に出す！
    return c.text(`【エラー発生】\n詳細: ${e.message}\n\n原因と思われる箇所:\n1. wrangler.tomlにDB設定がない\n2. Client Secretが間違っている\n3. リダイレクトURLが不一致`, 500)
  }
})

// チャット機能（そのまま）
app.post('/api/chat', async (c) => {
  try {
    const { message } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    if (!apiKey) return c.json({ error: 'API Key not set' }, 500)
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "店員として振る舞って。\nUser: " + message }] }] })
    });
    const data: any = await response.json();
    return c.json({ reply: data.candidates?.[0]?.content?.parts?.[0]?.text || "エラー" })
  } catch (e) { return c.json({ error: 'Chat Error' }, 500) }
})

export default app
