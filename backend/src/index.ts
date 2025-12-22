import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS許可（フロントエンドからのアクセス用）
app.use('/*', cors());

// 1. Googleのログイン画面へリダイレクトさせる
app.get('/auth/login', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  // 認証後に戻ってくるURL (あなたのWorkersのURL + /auth/callback)
  // ※注意: Google Cloud ConsoleでもこのURLを「承認済みのリダイレクトURI」に登録する必要があります
  const redirectUri = `${new URL(c.req.url).origin}/auth/callback`;
  
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=email%20profile`;
  
  return c.redirect(url);
});

// 2. Googleから戻ってきた時の処理
app.get('/auth/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.text('No code provided', 400);

  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${new URL(c.req.url).origin}/auth/callback`;

  // A. コードをアクセストークンに交換
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokenData: any = await tokenResp.json();

  // B. アクセストークンでユーザー情報を取得
  const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const userData: any = await userResp.json();
  const email = userData.email;
  const googleId = userData.id;

  // C. D1データベースに保存 (Upsert)
  try {
    // ユーザーが存在するか確認
    const existingUser = await c.env.DB.prepare('SELECT * FROM users WHERE google_id = ?').bind(googleId).first();
    
    if (!existingUser) {
        // 新規作成
        await c.env.DB.prepare('INSERT INTO users (id, google_id, email) VALUES (?, ?, ?)')
            .bind(crypto.randomUUID(), googleId, email).run();
    }
  } catch (e) {
      console.error("DB Error:", e);
      // DBエラーでも一旦画面遷移はさせる（デバッグ用）
  }

  // D. フロントエンドに戻る（クエリパラメータにメアドをつけて簡易ログイン状態にする）
  // ※本来はCookieを使いますが、まずは動くこと優先でURLにつけます
  // PagesのURLに書き換えてください
  const frontendUrl = "https://my-negotiator-app.pages.dev"; 
  return c.redirect(`${frontendUrl}?email=${email}`);
});

export default app;
