import { Hono } from 'hono';
import { cors } from 'hono/cors';

// 環境変数の型定義
type Bindings = {
  DB: D1Database;
  STRIPE_SECRET_KEY: string;
  OPENAI_API_KEY: string; // チャット用
  FRONTEND_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS設定（すべてのアクセスを許可）
app.use('/*', cors());

// ========================================================================
// 🛠 Helper: 外部API呼び出し関数 (ライブラリを使わない軽量実装)
// ========================================================================

// 1. Stripe APIを叩く関数
async function fetchStripe(path: string, method: string, apiKey: string, bodyParams?: URLSearchParams) {
  if (!apiKey) throw new Error('Stripe API Key is missing.');
  
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'POST' ? bodyParams : undefined,
  });

  const json: any = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || 'Stripe API Error');
  }
  return json;
}

// 2. OpenAI APIを叩く関数
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
    
    // A. ユーザー確認
    let user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    
    // ユーザーがいなければ作成 (初回ログイン時など)
    if (!user) {
      await c.env.DB.prepare("INSERT INTO users (email, usage_count, is_pro) VALUES (?, 0, 0)").bind(email).run();
      user = { email, usage_count: 0, is_pro: 0 };
    }

    // B. 制限チェック (無料版は1日10回までとする例)
    const FREE_LIMIT = 10;
    if (user.is_pro === 0 && user.usage_count >= FREE_LIMIT) {
      return c.json({ 
        error: "LIMIT_REACHED", 
        message: "無料枠の上限です。シェアして回復するか、Proプランにアップグレードしてください。" 
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
    // 時系列順に直す
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
      // 無料会員ならカウントを増やす
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

// ========================================================================
// 💳 3. Stripe 決済リンク作成 (購入)
// ========================================================================

app.post('/api/create-checkout-session', async (c) => {
  try {
    const { email, priceId } = await c.req.json();
    const apiKey = c.env.STRIPE_SECRET_KEY;

    // A. ユーザー確認
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user) throw new Error("User not found");

    let customerId = user.stripe_customer_id;

    // B. Stripe顧客IDがなければ作成 or 検索
    if (!customerId) {
      // メールで検索
      const searchData = await fetchStripe(`/customers?email=${encodeURIComponent(email)}&limit=1`, 'GET', apiKey);
      
      if (searchData.data && searchData.data.length > 0) {
        customerId = searchData.data[0].id;
      } else {
        // 新規作成
        const params = new URLSearchParams();
        params.append('email', email);
        params.append('metadata[userId]', String(user.id));
        const newCustomer = await fetchStripe('/customers', 'POST', apiKey, params);
        customerId = newCustomer.id;
      }
      // DB保存
      await c.env.DB.prepare("UPDATE users SET stripe_customer_id = ? WHERE email = ?").bind(customerId, email).run();
    }

    // C. 決済セッション作成
    const params = new URLSearchParams();
    params.append('customer', customerId);
    params.append('mode', 'subscription');
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');
    params.append('success_url', `${c.env.FRONTEND_URL}?payment=success`);
    params.append('cancel_url', `${c.env.FRONTEND_URL}?payment=cancel`);
    params.append('allow_promotion_codes', 'true'); // クーポンコード入力欄を出す

    const session = await fetchStripe('/checkout/sessions', 'POST', apiKey, params);
    return c.json({ url: session.url });

  } catch (e: any) {
    console.error(e);
    return c.json({ error: e.message }, 500);
  }
});

// ========================================================================
// ⚙️ 4. Stripe サブスク管理画面 (解約など)
// ========================================================================

app.post('/api/create-portal-session', async (c) => {
  try {
    const { email } = await c.req.json();
    const apiKey = c.env.STRIPE_SECRET_KEY;

    const user: any = await c.env.DB.prepare("SELECT stripe_customer_id FROM users WHERE email = ?").bind(email).first();
    if (!user || !user.stripe_customer_id) throw new Error("No subscription found");

    const params = new URLSearchParams();
    params.append('customer', user.stripe_customer_id);
    params.append('return_url', c.env.FRONTEND_URL);

    const session = await fetchStripe('/billing_portal/sessions', 'POST', apiKey, params);
    return c.json({ url: session.url });

  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ========================================================================
// 🔔 5. Stripe Webhook (決済通知の受け取り)
// ========================================================================

app.post('/api/webhook', async (c) => {
  try {
    const body: any = await c.req.json();
    const apiKey = c.env.STRIPE_SECRET_KEY;
    const eventType = body.type;
    const dataObject = body.data.object;

    // --- A. 決済完了 (Pro有効化) ---
    if (eventType === 'checkout.session.completed' || eventType === 'invoice.payment_succeeded') {
      const customerId = dataObject.customer;
      
      // 有効期限取得
      let currentPeriodEnd = 0;
      const subId = dataObject.subscription;
      if (subId) {
        const subData = await fetchStripe(`/subscriptions/${subId}`, 'GET', apiKey);
        currentPeriodEnd = subData.current_period_end;
      }

      // DB更新 (ProフラグON)
      // emailがある場合とない場合(invoice)があるので、customer_idを優先キーにする
      await c.env.DB.prepare(`
        UPDATE users 
        SET is_pro = 1, subscription_status = 'active', current_period_end = ? 
        WHERE stripe_customer_id = ?
      `).bind(currentPeriodEnd, customerId).run();

      // 初回決済時などでcustomer_idがDBにまだ入っていない場合のフォールバック (emailで更新)
      if (dataObject.customer_email) {
        await c.env.DB.prepare(`
          UPDATE users 
          SET is_pro = 1, subscription_status = 'active', stripe_customer_id = ?, current_period_end = ? 
          WHERE email = ? AND stripe_customer_id IS NULL
        `).bind(customerId, currentPeriodEnd, dataObject.customer_email).run();
      }
    }

    // --- B. 解約・支払い失敗 (Pro無効化) ---
    if (eventType === 'customer.subscription.deleted' || eventType === 'invoice.payment_failed') {
      const customerId = dataObject.customer;
      
      await c.env.DB.prepare(`
        UPDATE users 
        SET is_pro = 0, subscription_status = 'canceled' 
        WHERE stripe_customer_id = ?
      `).bind(customerId).run();
    }

    return c.json({ received: true });
  } catch (e: any) {
    // Webhookエラーはコンソールに出して400を返す
    console.error("Webhook Error:", e);
    return c.json({ error: e.message }, 400);
  }
});

export default app;
