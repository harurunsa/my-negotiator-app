import { Hono } from 'hono';
import { cors } from 'hono/cors';

// 環境変数の型定義
type Bindings = {
  DB: D1Database;
  OPENAI_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS設定（すべてのアクセスを許可）
app.use('/*', cors());

// ========================================================================
// 🛠 Helper: OpenAI APIを叩く関数
// ========================================================================
async function fetchOpenAI(messages: any[], apiKey: string) {
  if (!apiKey) throw new Error('OpenAI API Key is missing.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: "gpt-4o-mini", // コスパ最強モデル
      messages: messages,
      temperature: 0.7,
    }),
  });

  const json: any = await res.json();
  if (!res.ok) throw new Error(json.error?.message || 'OpenAI API Error');
  return json.choices[0].message.content;
}

// ========================================================================
// 🤖 1. チャット機能 (メイン機能)
// ========================================================================
app.post('/api/chat', async (c) => {
  try {
    const { email, message } = await c.req.json();
    
    // A. ユーザー確認 & 作成
    let user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    
    if (!user) {
      // 初回ユーザー作成 (is_proは一旦0で固定)
      await c.env.DB.prepare("INSERT INTO users (email, usage_count, is_pro) VALUES (?, 0, 0)").bind(email).run();
      user = { email, usage_count: 0, is_pro: 0 };
    }

    // B. 制限チェック (無料版は1日10回までとする例)
    // ※Stripeがないので、全員無料ユーザーとして扱います
    const FREE_LIMIT = 10;
    if (user.usage_count >= FREE_LIMIT) {
      return c.json({ 
        error: "LIMIT_REACHED", 
        message: "本日の上限回数です。シェアして回復してください！" 
      }, 403);
    }

    // C. AIへの指示 (システムプロンプト)
    const systemPrompt = `
      あなたはADHDの脳内をハックする『Negotiator』です。
      ユーザーのタスクを極限まで小さく分解し、ゲームのように楽しく提案してください。
      口調はフレンドリーで、少しユーモアを交えて。紙吹雪が舞うような達成感を与えてください。
      出力はMarkdown形式で見やすくしてください。
    `;

    // 履歴を取得して文脈を作る (直近6件)
    const historyResults = await c.env.DB.prepare("SELECT role, content FROM messages WHERE user_email = ? ORDER BY created_at DESC LIMIT 6").bind(email).all();
    const history = historyResults.results.reverse().map((r: any) => ({ role: r.role, content: r.content }));

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message }
    ];

    // D. OpenAI呼び出し
    const aiResponse = await fetchOpenAI(messages, c.env.OPENAI_API_KEY);

    // E. 履歴保存 & 回数カウントアップ
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO messages (user_email, role, content, created_at) VALUES (?, 'user', ?, ?)").bind(email, message, Date.now()),
      c.env.DB.prepare("INSERT INTO messages (user_email, role, content, created_at) VALUES (?, 'assistant', ?, ?)").bind(email, aiResponse, Date.now()),
      c.env.DB.prepare("UPDATE users SET usage_count = usage_count + 1 WHERE email = ?").bind(email)
    ]);

    return c.json({ reply: aiResponse });

  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ========================================================================
// 🔄 2. シェア機能 (回復ロジック)
// ========================================================================
app.post('/api/recover-by-share', async (c) => {
  try {
    const { email } = await c.req.json();
    
    // 使用回数を3回分減らす（0未満にはしない）
    await c.env.DB.prepare("UPDATE users SET usage_count = MAX(0, usage_count - 3) WHERE email = ?").bind(email).run();
    
    return c.json({ success: true, message: "Recovered 3 credits!" });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default app;
