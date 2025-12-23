import { Hono } from 'hono'
import { cors } from 'hono/cors'

// 環境変数の型定義 (DBが増えました！)
type Bindings = {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  DB: D1Database // ★ここが追加: データベースを使うための準備
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS許可
app.use('/*', cors())

// 生存確認用
app.get('/', (c) => c.json({ message: "バックエンドもDBも正常です！" }))

// 1. ログイン開始
app.get('/auth/login', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  const callbackUrl = `${new URL(c.req.url).origin}/auth/callback`
  
  if (!clientId) return c.text('Error: GOOGLE_CLIENT_ID not set', 500)

  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${callbackUrl}&response_type=code&scope=email%20profile`
  return c.redirect(url)
})

// 2. Googleから帰ってきたら保存してリダイレクト
app.get('/auth/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.text('Error: No code provided', 400)

  const clientId = c.env.GOOGLE_CLIENT_ID
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET
  const callbackUrl = `${new URL(c.req.url).origin}/auth/callback`

  // Googleに問い合わせてトークンをもらう
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

  // ★★★ ここが新機能！データベースに保存する ★★★
  try {
    // ユーザーID、メアド、名前、今の時間を保存
    // "INSERT OR IGNORE" なので、既に登録済みの人は無視してエラーになりません
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)`
    ).bind(userData.id, userData.email, userData.name, Date.now()).run();
    
    console.log("ユーザー保存完了:", userData.email);
  } catch (e) {
    console.error("DB保存エラー:", e);
    // 万が一保存できなくても、ログイン自体は進めてあげる
  }

  // フロントエンドに戻す
  // ※ あなたのPagesのURLになっているか確認してください！
  const frontendUrl = "https://my-negotiator-app.pages.dev" 
  
  return c.redirect(`${frontendUrl}?email=${userData.email}&name=${encodeURIComponent(userData.name)}`)
})

export default app
