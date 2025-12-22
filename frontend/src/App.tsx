import { useState, useEffect } from 'react';

// あなたのWorkers（バックエンド）のURLに書き換えてください
// デプロイ後に確定しますが、仮で置いておきます
const API_URL = "https://negotiator-backend.harurunsa.workers.dev"; 

export default function App() {
  const [user, setUser] = useState<{email: string} | null>(null);

  // ログイン後にURLパラメータ (?email=...) を受け取って表示する簡易実装
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const email = params.get('email');
    if (email) {
      setUser({ email });
    }
  }, []);

  const handleLogin = () => {
    // バックエンドの認証エンドポイントへジャンプ
    window.location.href = `${API_URL}/auth/login`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '50px' }}>
      <h1>Google Login Test</h1>
      
      {user ? (
        <div style={{ padding: '20px', border: '1px solid green', borderRadius: '8px' }}>
          <p>✅ ログイン成功！</p>
          <p>あなたのメールアドレス: <strong>{user.email}</strong></p>
        </div>
      ) : (
        <button 
          onClick={handleLogin}
          style={{ padding: '10px 20px', fontSize: '16px', cursor: 'pointer', backgroundColor: '#4285F4', color: 'white', border: 'none', borderRadius: '4px' }}
        >
          Googleでログイン
        </button>
      )}
    </div>
  );
}
