import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Ai } from '@cloudflare/ai'

type Bindings = {
  AI: any
  DB: D1Database
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

const app = new Hono<{ Bindings: Bindings }>()

// 1. CORS許可 (これがないとフロントエンドから叩けない)
app.use('/*', cors({
  origin: '*', // テスト用になんでも許可。本番はURL指定推奨
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['POST', 'GET', 'OPTIONS'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
}))

// 2. ルート確認用
app.get('/', (c) => c.text('Negotiator API is running!'))

// 3. 交渉AI API
app.post('/api/negotiate', async (c) => {
  const ai = new Ai(c.env.AI);
  const { task } = await c.req.json();

  const prompt = `
    You are a strict but helpful ADHD coach.
    User task: "${task}"
    Instruction: Break this down into ONE ridiculously small step (takes 10 seconds).
    Output JSON ONLY: { "text": "action...", "duration": 10, "message": "You can do this." }
  `;

  try {
    const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }]
    });
    // @ts-ignore
    return c.json(JSON.parse(response.response));
  } catch (e) {
    return c.json({ text: "深呼吸しよう", duration: 10, message: "AIエラー。でも大丈夫。" });
  }
});

// 4. Googleログイン (URL生成)
app.get('/auth/login', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${new URL(c.req.url).origin}/auth/callback`;
  
  if (!clientId) return c.text('GOOGLE_CLIENT_ID not set', 500);

  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=email%20profile`;
  return c.redirect(url);
});

// 5. Googleログイン (コールバック)
app.get('/auth/callback', async (c) => {
  const code = c.req.query('code');
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${new URL(c.req.url).origin}/auth/callback`;

  // トークン交換
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: code || '',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokenData: any = await tokenRes.json();
  
  // ユーザー情報取得
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const userData: any = await userRes.json();

  // DB保存 (簡易)
  try {
    const id = crypto.randomUUID();
    await c.env.DB.prepare('INSERT INTO users (id, email, google_id) VALUES (?, ?, ?)')
      .bind(id, userData.email, userData.id).run();
  } catch (e) {
    // 既にいる場合は無視
  }

  // ★重要: フロントエンドに戻す
  // ※実際のデプロイURLに書き換える必要あり。まずはlocalhost用
  return c.redirect(`http://localhost:5173?email=${userData.email}`);
});

export default app
