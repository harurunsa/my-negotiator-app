import { Hono } from 'hono'
import { cors } from 'hono/cors'

// 必要な環境変数の定義
type Bindings = {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

const app = new Hono<{ Bindings: Bindings }>()

// 1. CORS許可 (フロントエンドからのアクセスを許す)
app.use('/*', cors())

// 2. 生存確認用
app.get('/', (c) => c.json({ message: "バックエンドは正常に動いています！" }))

// 3. ログイン開始 (Googleの画面へ飛ばす)
app.get('/auth/login', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  // 自動で現在のURLを取得して、コールバックURLを作る
  const callbackUrl = `${new URL(c.req.url).origin}/auth/callback`
  
  if (!clientId) return c.text('エラー: GOOGLE_CLIENT_ID が設定されていません', 500)

  // Googleの認証画面のURLを作る
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${callbackUrl}&response_type=code&scope=email%20profile`
  
  return c.redirect(url)
})

// 4. Googleから帰ってきた時の処理
app.get('/auth/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.text('エラー: Googleからコードが返ってきませんでした', 400)

  const clientId = c.env.GOOGLE_CLIENT_ID
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET
  const callbackUrl = `${new URL(c.req.url).origin}/auth/callback`

  // Googleに「このコードで合ってる？」と問い合わせてトークンをもらう
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

  // トークンを使ってユーザー情報を取得する
  const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })
  const userData: any = await userResponse.json()

  // ★フロントエンドに戻す (あなたのPagesのURLに書き換えてください！)
  // 末尾にスラッシュは無しです
  const frontendUrl = "https://my-negotiator-app.pages.dev" 
  
  // 名前とメールアドレスをつけてフロントエンドに送り返す
  return c.redirect(`${frontendUrl}?email=${userData.email}&name=${encodeURIComponent(userData.name)}`)
})

export default app
