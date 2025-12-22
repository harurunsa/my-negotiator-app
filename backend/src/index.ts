import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

// フロントエンドからの通信を許可する
app.use('/*', cors())

// API: アクセスされたらメッセージを返す
app.get('/', (c) => {
  return c.json({ message: "成功！バックエンドと繋がっています！" })
})

export default app
