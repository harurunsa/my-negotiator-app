import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
  AI: any;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  FRONTEND_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS設定
app.use('/*', cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ヘルスチェック
app.get('/', (c) => {
  return c.json({ message: 'The Negotiator API is running!' });
});

// Google OAuth ログイン
app.get('/auth/login', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${c.req.url.split('/auth/login')[0]}/auth/callback`;
  
  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', clientId);
  googleAuthUrl.searchParams.set('redirect_uri', redirectUri);
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'openid email profile');
  googleAuthUrl.searchParams.set('access_type', 'offline');
  
  return c.redirect(googleAuthUrl.toString());
});

// Google OAuth コールバック
app.get('/auth/callback', async (c) => {
  const code = c.req.query('code');
  
  if (!code) {
    return c.redirect(`${c.env.FRONTEND_URL}?error=no_code`);
  }

  try {
    // トークン交換
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${c.req.url.split('/auth/callback')[0]}/auth/callback`,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json();
    
    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', tokenData);
      return c.redirect(`${c.env.FRONTEND_URL}?error=token_exchange_failed`);
    }

    // ユーザー情報取得
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const userInfo = await userInfoResponse.json();
    
    if (!userInfoResponse.ok) {
      console.error('User info fetch failed:', userInfo);
      return c.redirect(`${c.env.FRONTEND_URL}?error=userinfo_failed`);
    }

    // DBにユーザーを保存または取得
    const existingUser = await c.env.DB.prepare(
      'SELECT * FROM users WHERE google_id = ?'
    ).bind(userInfo.id).first();

    if (!existingUser) {
      await c.env.DB.prepare(
        'INSERT INTO users (email, google_id) VALUES (?, ?)'
      ).bind(userInfo.email, userInfo.id).run();
    }

    // フロントエンドにリダイレクト
    return c.redirect(`${c.env.FRONTEND_URL}?email=${encodeURIComponent(userInfo.email)}`);
  } catch (error) {
    console.error('Auth callback error:', error);
    return c.redirect(`${c.env.FRONTEND_URL}?error=auth_failed`);
  }
});

// The Negotiator - タスク分解API
app.post('/api/negotiate', async (c) => {
  try {
    const { task, email } = await c.req.json();

    if (!task || !email) {
      return c.json({ error: 'Task and email are required' }, 400);
    }

    // ユーザー確認
    const user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE email = ?'
    ).bind(email).first();

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Workers AI でタスク分解
    const prompt = `You are "The Negotiator" - an AI assistant for people with ADHD who helps break down overwhelming tasks into ridiculously small, achievable first steps.

Task from user: "${task}"

Your job: Break this task down into ONE ridiculously small step that takes less than 10 seconds to complete. This should be the absolute smallest possible first action.

Respond in JSON format:
{
  "negotiation": "A brief, encouraging message (1-2 sentences)",
  "firstStep": "The tiny 10-second action",
  "reasoning": "Why this step is so easy (1 sentence)"
}

Keep it casual, supportive, and ADHD-friendly. No overwhelming details.`;

    const aiResponse = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: 'You are The Negotiator, an ADHD-friendly task breakdown assistant. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 300,
    });

    // レスポンスをパース
    let negotiationResult;
    try {
      const responseText = aiResponse.response || JSON.stringify(aiResponse);
      
      // JSONを抽出 (```json ... ``` や ``` ... ``` を除去)
      let cleanedText = responseText.trim();
      if (cleanedText.includes('```json')) {
        cleanedText = cleanedText.split('```json')[1].split('```')[0].trim();
      } else if (cleanedText.includes('```')) {
        cleanedText = cleanedText.split('```')[1].split('```')[0].trim();
      }
      
      negotiationResult = JSON.parse(cleanedText);
    } catch (parseError) {
      // パースに失敗した場合のフォールバック
      negotiationResult = {
        negotiation: "Let's start super small!",
        firstStep: "Open your task manager or grab a piece of paper",
        reasoning: "Getting started is half the battle"
      };
    }

    return c.json({
      task,
      ...negotiationResult,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Negotiation error:', error);
    return c.json({ 
      error: 'Failed to negotiate task',
      details: error.message 
    }, 500);
  }
});

export default app;
