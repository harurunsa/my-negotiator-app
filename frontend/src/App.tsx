import { useState, useEffect } from 'react'

// あなたのWorkersのURL (末尾のスラッシュなし)
const API_URL = "https://my-negotiator-app.yamashitahiro0628.workers.dev";

function App() {
  const [user, setUser] = useState<{email: string, name: string} | null>(null);

  useEffect(() => {
    // URLのパラメータからユーザー情報を読み取る (簡易ログイン)
    const params = new URLSearchParams(window.location.search);
    const email = params.get('email');
    const name = params.get('name');
    if (email && name) {
      setUser({ email, name });
    }
  }, []);

  const handleLogin = () => {
    // バックエンドのログインURLへ移動
    window.location.href = `${API_URL}/auth/login`;
  };

  return (
    <div style={{ padding: '50px', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h1>The Negotiator 🧠</h1>
      
      {user ? (
        <div>
          <h2>ようこそ、{user.name} さん！</h2>
          <p>Email: {user.email}</p>
          <p>ログイン成功です🎉</p>
        </div>
      ) : (
        <div>
          <p>Googleアカウントでログインしてください</p>
          <button 
            onClick={handleLogin} 
            style={{ 
              padding: '12px 24px', 
              fontSize: '16px', 
              background: '#4285F4', 
              color: 'white', 
              border: 'none', 
              borderRadius: '5px', 
              cursor: 'pointer' 
            }}
          >
            Googleでログイン
          </button>
        </div>
      )}
    </div>
  )
}

export default App
