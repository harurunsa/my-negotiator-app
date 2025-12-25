import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
  STRIPE_SECRET_KEY: string;  // sk_live_...
  FRONTEND_URL: string;       // https://myapp.pages.dev
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', cors());

// --- Helper: Stripe APIを直接fetchで叩く関数 ---
async function fetchStripe(path: string, method: string, apiKey: string, bodyParams?: URLSearchParams) {
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
  const { email, priceId } = await c.req.json();
  const apiKey = c.env.STRIPE_SECRET_KEY;

  try {
    // A. DBからユーザーを確認
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    let customerId = user?.stripe_customer_id;

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
    params.append('allow_promotion_codes', 'true'); // クーポン有効化

    const session = await fetchStripe('/checkout/sessions', 'POST', apiKey, params);
    return c.json({ url: session.url });

  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- 2. 管理画面作成 (Portal) ---
app.post('/api/create-portal-session', async (c) => {
  const { email } = await c.req.json();
  const apiKey = c.env.STRIPE_SECRET_KEY;

  try {
    const user: any = await c.env.DB.prepare("SELECT stripe_customer_id FROM users WHERE email = ?").bind(email).first();
    if (!user || !user.stripe_customer_id) throw new Error("Subscription not found");

    const params = new URLSearchParams();
    params.append('customer', user.stripe_customer_id);
    params.append('return_url', c.env.FRONTEND_URL);

    const session = await fetchStripe('/billing_portal/sessions', 'POST', apiKey, params);
    return c.json({ url: session.url });

  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- 3. Webhook (Stripeからの通知) ---
// セキュリティのため、本来は署名検証が必要ですが、簡易版としてURLを隠す運用推奨
app.post('/api/webhook', async (c) => {
  const body: any = await c.req.json();
  const apiKey = c.env.STRIPE_SECRET_KEY;
  const eventType = body.type;
  const dataObject = body.data.object;

  try {
    // 決済完了 or 更新完了
    if (eventType === 'checkout.session.completed' || eventType === 'invoice.payment_succeeded') {
      const customerId = dataObject.customer;
      
      // 有効期限を確認
      let currentPeriodEnd = 0;
      if (dataObject.subscription) {
        const subData = await fetchStripe(`/subscriptions/${dataObject.subscription}`, 'GET', apiKey);
        currentPeriodEnd = subData.current_period_end;
      }

      // Pro有効化
      await c.env.DB.prepare(`
        UPDATE users SET is_pro = 1, subscription_status = 'active', current_period_end = ? 
        WHERE stripe_customer_id = ? OR email = ?
      `).bind(currentPeriodEnd, customerId, dataObject.customer_email).run();
    }

    // 解約完了 or 支払い失敗
    if (eventType === 'customer.subscription.deleted' || eventType === 'invoice.payment_failed') {
      const customerId = dataObject.customer;
      // Pro無効化
      await c.env.DB.prepare(`
        UPDATE users SET is_pro = 0, subscription_status = 'canceled' 
        WHERE stripe_customer_id = ?
      `).bind(customerId).run();
    }

    return c.json({ received: true });
  } catch (e: any) {
    console.error(e);
    return c.json({ error: e.message }, 400);
  }
});

export default app;
