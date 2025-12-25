import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  FRONTEND_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', cors());

// --- ヘルパー関数: Stripe APIを直接叩くやつ ---
async function fetchStripe(path: string, method: string, apiKey: string, bodyData?: Record<string, string>) {
  const params = new URLSearchParams();
  if (bodyData) {
    for (const [key, value] of Object.entries(bodyData)) {
      params.append(key, value);
    }
  }

  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'POST' ? params : undefined,
  });

  if (!res.ok) {
    const err = await res.json() as any;
    throw new Error(err.error?.message || 'Stripe API Error');
  }
  return res.json();
}

// --- 1. 決済画面作成 (Checkout) ---
app.post('/api/create-checkout-session', async (c) => {
  const { email, priceId } = await c.req.json();
  const apiKey = c.env.STRIPE_SECRET_KEY;

  try {
    // A. まずDBから顧客IDを探す
    const user: any = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    let customerId = user?.stripe_customer_id;

    // B. なければStripeで検索 or 作成
    if (!customerId) {
      // メールで検索
      const searchRes: any = await fetchStripe(`/customers?email=${encodeURIComponent(email)}&limit=1`, 'GET', apiKey);
      
      if (searchRes.data && searchRes.data.length > 0) {
        customerId = searchRes.data[0].id;
      } else {
        // 新規作成
        const newCustomer: any = await fetchStripe('/customers', 'POST', apiKey, { email });
        customerId = newCustomer.id;
      }
      
      // DBに保存しておく
      await c.env.DB.prepare("UPDATE users SET stripe_customer_id = ? WHERE email = ?").bind(customerId, email).run();
    }

    // C. 決済セッション作成 (ここが手動だと少しパラメーターが多い)
    // URLSearchParamsはネストに対応していないので、キー名を直接書く
    const params = new URLSearchParams();
    params.append('customer', customerId);
    params.append('mode', 'subscription');
    params.append('line_items[0][price]', priceId);
    params.append('line_items[0][quantity]', '1');
    params.append('success_url', `${c.env.FRONTEND_URL}?payment=success`);
    params.append('cancel_url', `${c.env.FRONTEND_URL}?payment=cancel`);
    params.append('allow_promotion_codes', 'true');

    // fetchStripeヘルパーを使わず、ここでは直接fetchする（複雑なキーに対応するため）
    const sessionRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params
    });
    
    const session: any = await sessionRes.json();
    if(session.error) throw new Error(session.error.message);

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

    const session: any = await fetchStripe('/billing_portal/sessions', 'POST', apiKey, {
      customer: user.stripe_customer_id,
      return_url: c.env.FRONTEND_URL
    });

    return c.json({ url: session.url });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- 3. Webhook (簡易版) ---
// ライブラリがないので署名検証はスキップし、JSONボディを直接見る
// ※セキュリティ的にはWebhook URLを推測されにくいものにするのがベター（例: /api/webhook_xyz123）
app.post('/api/webhook', async (c) => {
  const body: any = await c.req.json();
  const apiKey = c.env.STRIPE_SECRET_KEY;

  try {
    const eventType = body.type;
    const dataObject = body.data.object;

    // A. 決済完了・更新成功
    if (eventType === 'checkout.session.completed' || eventType === 'invoice.payment_succeeded') {
      const customerId = dataObject.customer;
      
      // 有効期限を取得するためにSubscription情報をStripeに取りに行く
      const subId = dataObject.subscription;
      if(subId) {
        const subData: any = await fetchStripe(`/subscriptions/${subId}`, 'GET', apiKey);
        const currentPeriodEnd = subData.current_period_end;

        // DB更新: 有料会員へ
        await c.env.DB.prepare(`
          UPDATE users SET is_pro = 1, subscription_status = 'active', current_period_end = ? 
          WHERE stripe_customer_id = ? OR email = ?
        `).bind(currentPeriodEnd, customerId, dataObject.customer_email).run();
      }
    }

    // B. 解約・支払い失敗
    if (eventType === 'customer.subscription.deleted' || eventType === 'invoice.payment_failed') {
      const customerId = dataObject.customer;
      // 無料会員へ戻す
      await c.env.DB.prepare(`
        UPDATE users SET is_pro = 0, subscription_status = 'canceled' 
        WHERE stripe_customer_id = ?
      `).bind(customerId).run();
    }

    return c.json({ received: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

export default app;
