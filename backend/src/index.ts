import { Hono } from 'hono'
import { cors } from 'hono/cors'

// 環境変数の型定義
type Bindings = {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS許可
app.use('/*', cors())

// ルート確認用
app.get('/', (c) => c.json({ message: "バックエンドは正常です！" }))

// 1. Googleログインページへリダイレクトさせる
app.get('/auth/login', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  if (!clientId) return c.text('Error: GOOGLE_CLIENT_ID not set', 500)

  // バックエンドのURLを自動取得してコールバックURLを作る
  const callbackUrl = `${new URL(c.req.url).origin}/auth/callback`
  
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${callbackUrl}&response_type=code&scope=email%20profile`
  
  return c.redirect(url)
})

// 2. Googleから帰ってきたらトークンを交換してユーザー情報を取る
app.get('/auth/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.text('Error: No code provided', 400)

  const clientId = c.env.GOOGLE_CLIENT_ID
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET
  const callbackUrl = `${new URL(c.req.url).origin}/auth/callback`

  // Googleに「このコードで合ってる？」と問い合わせる
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    }),
  })
  const tokenData: any = await tokenResponse.json()

  // ユーザー情報を取得する
  const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })
  const userData: any = await userResponse.json()

  // ★重要: 本番ではここでDBに保存したり、JWTクッキーを発行したりします。
  // 今回はテスト用に、フロントエンドにメールアドレス付きでリダイレクトします。
  // あなたのフロントエンドURL (pages.dev) に書き換えてください！
  // ↓↓↓↓↓↓
  const frontendUrl = "https://my-negotiator-app.pages.dev" 
  
  return c.redirect(`${frontendUrl}?email=${userData.email}&name=${encodeURIComponent(userData.name)}`)
})

export default app
