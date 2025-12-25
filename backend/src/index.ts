import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Cloudflare環境変数の型定義
type Bindings = {
  DB: D1Database;
  STRIPE_SECRET_KEY: string; // ここに秘密鍵が入ってくる
  FRONTEND_URL: string;      // 戻り先のURL
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS許可（フロントエンドからのアクセスを許す）
app.use('/*', cors());

// --- Helper: Stripe APIを直接叩く関数 (ライブラリ不要) ---
async function fetchStripe(path: string, method: string, apiKey: string, bodyParams?: URLSearchParams) {
  if (!apiKey) throw new Error('Stripe API Key is missing in environment variables.');

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

// --- 1. 決済画面作成 (Checkout) ---
app.post('/api/create-checkout-session', async (c) => {
  try {
    const { email, priceId } = await c.req.json();
    const apiKey = c.env.STRIPE_SECRET_KEY; // 環境変数から取得

    // A. DBからユーザーを確認
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user) throw new Error("User not found in DB");

    let customerId = user.stripe_customer_id;

    // B. Stripe顧客IDがなければ作成 or 検索
    if (!customerId) {
      // メールでStripe側を検索
      const searchData = await fetchStripe(`/customers?email=${encodeURIComponent(email)}&limit=1`, 'GET', apiKey);
      
      if (searchData.data && searchData.data.length > 0) {
        customerId = searchData.data[0].id;
      } else {
        // Stripe側に新規作成
        const params = new URLSearchParams();
        params.append('email', email);
        // 必要ならmetadataでuserIdなども保存可能
        const newCustomer = await fetchStripe('/customers', 'POST', apiKey, params);
        customerId = newCustomer.id;
      }
      // DBに紐付け保存
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
    params.append('allow_promotion_codes', 'true'); // クーポン入力欄を表示

    // metadataを入れておくとWebhookで照合しやすい
    params.append('metadata[userId]', user.id);
    params.append('metadata[userEmail]', email);

    const session = await fetchStripe('/checkout/sessions', 'POST', apiKey, params);
    
    return c.json({ url: session.url });

  } catch (e: any) {
    console.error(e);
    return c.json({ error: e.message }, 500);
  }
});

// --- 2. 管理画面作成 (Portal) ---
// 解約やカード変更はこちら
app.post('/api/create-portal-session', async (c) => {
  try {
    const { email } = await c.req.json();
    const apiKey = c.env.STRIPE_SECRET_KEY;

    const user: any = await c.env.DB.prepare("SELECT stripe_customer_id FROM users WHERE email = ?").bind(email).first();
    if (!user || !user.stripe_customer_id) throw new Error("No subscription found (Customer ID missing)");

    const params = new URLSearchParams();
    params.append('customer', user.stripe_customer_id);
    params.append('return_url', c.env.FRONTEND_URL);

    const session = await fetchStripe('/billing_portal/sessions', 'POST', apiKey, params);
    
    return c.json({ url: session.url });

  } catch (e: any) {
    console.error(e);
    return c.json({ error: e.message }, 500);
  }
});

// --- 3. Webhook (Stripeからの通知受信) ---
app.post('/api/webhook', async (c) => {
  try {
    const body: any = await c.req.json();
    const apiKey = c.env.STRIPE_SECRET_KEY;
    const eventType = body.type;
    const dataObject = body.data.object;

    // === A. 決済完了 (初回・更新) ===
    if (eventType === 'checkout.session.completed' || eventType === 'invoice.payment_succeeded') {
      const customerId = dataObject.customer;
      
      // 有効期限(current_period_end)を取得
      let currentPeriodEnd = 0;
      // checkout.sessionの場合はsubscription IDから取得
      let subId = dataObject.subscription;
      
      if (subId) {
        // subscriptionオブジェクトを取得して期限を確認
        const subData = await fetchStripe(`/subscriptions/${subId}`, 'GET', apiKey);
        currentPeriodEnd = subData.current_period_end;
      }

      // DB更新: Pro有効化
      // emailが取れない場合もあるので、基本はstripe_customer_idで更新
      await c.env.DB.prepare(`
        UPDATE users 
        SET is_pro = 1, subscription_status = 'active', current_period_end = ? 
        WHERE stripe_customer_id = ?
      `).bind(currentPeriodEnd, customerId).run();

      // もしDBのstripe_customer_idが未設定の段階なら、emailでフォールバック更新
      if (dataObject.customer_email) {
         await c.env.DB.prepare(`
          UPDATE users 
          SET is_pro = 1, subscription_status = 'active', stripe_customer_id = ?, current_period_end = ? 
          WHERE email = ? AND stripe_customer_id IS NULL
        `).bind(customerId, currentPeriodEnd, dataObject.customer_email).run();
      }
    }

    // === B. 解約完了・支払い失敗 ===
    if (eventType === 'customer.subscription.deleted' || eventType === 'invoice.payment_failed') {
      const customerId = dataObject.customer;
      
      // DB更新: Pro無効化
      await c.env.DB.prepare(`
        UPDATE users 
        SET is_pro = 0, subscription_status = 'canceled' 
        WHERE stripe_customer_id = ?
      `).bind(customerId).run();
    }

    return c.json({ received: true });
  } catch (e: any) {
    console.error("Webhook Error:", e);
    // Stripeに200以外を返すとリトライされてしまうので、エラーでもログに出して400を返す
    return c.json({ error: e.message }, 400);
  }
});

export default app;
