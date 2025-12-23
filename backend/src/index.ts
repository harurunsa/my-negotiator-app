import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  DB: D1Database
  GEMINI_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/*', cors())

app.get('/', (c) => c.json({ message: "ADHD Support Backend (Powered by Gemini 3 Flash)" }))

// --- 認証周り (変更なし) ---
app.get('/auth/login', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  if (!clientId) return c.text('Error: GOOGLE_CLIENT_ID not set', 500)
  const callbackUrl = `${new URL(c.req.url).origin}/auth/callback`
  // scopeに openid も明示的に入れておくと安心です
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${callbackUrl}&response_type=code&scope=openid%20email%20profile`
  return c.redirect(url)
})

app.get('/auth/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.text('Error: No code provided', 400)
  const clientId = c.env.GOOGLE_CLIENT_ID
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET
  const callbackUrl = `${new URL(c.req.url).origin}/auth/callback`

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: callbackUrl, grant_type: 'authorization_code' }),
    })
    const tokenData: any = await tokenResponse.json()
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const userData: any = await userResponse.json()

    // DB保存
    if (c.env.DB) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)`
      ).bind(userData.id, userData.email, userData.name, Date.now()).run();
    }

    const frontendUrl = "https://my-negotiator-app.pages.dev"
    return c.redirect(`${frontendUrl}?email=${userData.email}&name=${encodeURIComponent(userData.name)}`)
  } catch (e: any) {
    return c.text(`Auth Error: ${e.message}`, 500)
  }
})

// --- ★修正: Gemini 3 Flash & ADHDサポート ---
app.post('/api/chat', async (c) => {
  try {
    const { message } = await c.req.json()
    const apiKey = c.env.GEMINI_API_KEY
    
    if (!apiKey) return c.json({ reply: "【エラー】GEMINI_API_KEY が設定されていません" })

    // ★モデルを 'gemini-3-flash' に指定 (最新版)
    // 万が一API側でまだエイリアスが貼られていない場合は 'gemini-3-flash-preview' または 'gemini-2.5-flash' を試してください
    const modelName = 'gemini-3-flash'; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    const systemInstruction = `
      あなたはADHD（注意欠如・多動症）を持つユーザーをサポートする「実行機能パートナー」です。
      「Negotiator（交渉人）」というアプリ名ですが、ここでの交渉相手は「他者」ではなく「ユーザー自身の脳」です。

      あなたの役割:
      1. 共感と受容: ユーザーの「できない」「めんどくさい」を否定せず、脳の特性として受け止める。
      2. 認知の書き換え: 巨大に見えるタスクを、笑ってしまうほど小さな「マイクロステップ」に分解して提案する。
      3. ドーパミン報酬: ユーザーが相談したこと、些細な一歩を踏み出したことを全力で称賛し、スコア化する。

      【出力ルール】
      必ず以下のJSON形式のみで返答してください。Markdownや余計な挨拶は不要です。
      
      {
        "reply": "励ましの言葉と、具体的なマイクロステップ（例: 「まずはスマホを裏返すだけでOK！」など）",
        "score": 0〜100の整数 (相談行動自体を高評価すること。基本甘めに採点),
        "is_combo": trueまたはfalse (ユーザーが連続して行動できそうならtrue),
        "reason": "スコアの理由（短く褒める）"
      }
    `;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: systemInstruction + "\n\nUser Input: " + message }] }
        ],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const data: any = await response.json();

    if (data.error) {
      // エラー時にモデル名も表示して確認しやすくする
      return c.json({ reply: `【Gemini API Error】\nModel: ${modelName}\nMessage: ${data.error.message}\nCode: ${data.error.code}` });
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return c.json({ reply: "AIからの返答が空でした。モデルが応答していません。" });

    try {
      const result = JSON.parse(rawText);
      return c.json(result);
    } catch (e) {
      // JSONパース失敗時の救済措置
      return c.json({ 
        reply: rawText, 
        score: 10, 
        is_combo: false, 
        reason: "解析エラーですが、AIからのメッセージを受信しました" 
      });
    }

  } catch (e: any) {
    return c.json({ reply: `【Server Error】${e.message}` })
  }
})

export default app
