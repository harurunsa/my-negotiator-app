import { useState } from 'react'

// ★重要: ここは一旦ローカルで動かすためのURLです
const API_URL = "https://my-negotiator-app.pages.dev";

function App() {
  const [message, setMessage] = useState("ボタンを押してください");

  const handleClick = async () => {
    try {
      const res = await fetch(API_URL);
      const data = await res.json();
      setMessage(data.message);
    } catch (e) {
      setMessage("エラー：バックエンドが起動していません");
    }
  };

  return (
    <div style={{ padding: '50px', textAlign: 'center' }}>
      <h1>最小構成テスト</h1>
      <p style={{ fontSize: '20px', fontWeight: 'bold' }}>{message}</p>
      <button onClick={handleClick} style={{ padding: '10px 20px', fontSize: '16px' }}>
        APIを叩く
      </button>
    </div>
  )
}

export default App
