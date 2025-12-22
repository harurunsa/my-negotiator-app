import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Ai } from '@cloudflare/ai'; // Workers AI用SDK

// 型定義
type Bindings = {
  AI: any;
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  FRONTEND_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS設定（フロントエンドからのアクセス許可）
app.use('/*', cors());

/**
 * 🛠️ The Negotiator: タスク分解交渉API
 * ユーザーがNOと言うたびに、rejectionCountが増えてリクエストが来る想定
 */
app.post('/api/negotiate', async (c) => {
  const ai = new Ai(c.env.AI);
  const { task, rejectionCount } = await c.req.json();

  // プロンプトの強度調整（拒否されるほど甘やかす）
  let strictness = "be somewhat strict but helpful";
  if (rejectionCount > 0) strictness = "be very easy and gentle";
  if (rejectionCount > 2) strictness = "suggest something ridiculously easy, take only 10 seconds";

  // Llama-3 への指示
  // JSONで返させるのがコツ
  const systemPrompt = `
    You are an ADHD coach.
    User Task: "${task}"
    Rejection Count: ${rejectionCount}
    Style: ${strictness}
    
    Instruction: Break down the task into ONE single immediate step.
    Output JSON format ONLY: { "text": "action text", "duration": seconds_integer, "message": "encouraging words" }
  `;

  try {
    const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: 'You are a JSON generator. Output only valid JSON.' },
        { role: 'user', content: systemPrompt }
      ]
    });

    // Llamaはたまに余計な文章をつけるので、JSON部分だけ抽出する工夫が必要
    // 今回は簡易的にそのままパース（本番ではregex抽出推奨）
    // @ts-ignore
    const result = JSON.parse(response.response); 
    return c.json(result);

  } catch (e) {
    // 失敗時はフォールバック（AIがコケてもアプリを止めない）
    return c.json({ 
      text: "とりあえず深呼吸しよう", 
      duration: 10, 
      message: "AIも疲れちゃったみたい。一回休もう。" 
    });
  }
});

/**
 * 🔥 Combo Offer: 完了後の追撃提案
 */
app.post('/api/complete', async (c) => {
  const ai = new Ai(c.env.AI);
  const { originalTask, lastAction } = await c.req.json();

  const prompt = `
    User just completed: "${lastAction}" (Part of: "${originalTask}").
    Suggest ONE quick follow-up task (under 60 seconds) to keep the momentum.
    Output JSON format ONLY: { "text": "action text", "duration": 60, "message": "tempting offer" }
  `;

  const response = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      { role: 'system', content: 'Output JSON only.' },
      { role: 'user', content: prompt }
    ]
  });

  // @ts-ignore
  return c.json(JSON.parse(response.response));
});

/**
 * 🔑 Auth: Google Login (簡易版)
 * 本来はredirect処理などを書くが、今回はモック（ダミー）を置いておく
 */
app.post('/api/auth/google', async (c) => {
  // TODO: ここに google-auth-library 等を使った検証ロジックを入れる
  // 今回は「ログインできた」としてダミーユーザーを返す
  return c.json({ 
    user: { id: "user_123", email: "demo@gmail.com", status: "free" },
    token: "dummy_jwt_token"
  });
});

export default app;
