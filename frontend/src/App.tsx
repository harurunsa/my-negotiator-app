import React, { useState, useEffect } from 'react';
import './App.css';

const BACKEND_URL = 'http://localhost:8787';

interface NegotiationResult {
  task: string;
  negotiation: string;
  firstStep: string;
  reasoning: string;
  timestamp: string;
}

function App() {
  const [email, setEmail] = useState<string | null>(null);
  const [task, setTask] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NegotiationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // URLからemailパラメータを取得
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get('email');
    const errorParam = params.get('error');

    if (emailParam) {
      setEmail(emailParam);
      // URLをクリーンに
      window.history.replaceState({}, '', '/');
    }

    if (errorParam) {
      setError(`認証エラー: ${errorParam}`);
    }
  }, []);

  const handleLogin = () => {
    window.location.href = `${BACKEND_URL}/auth/login`;
  };

  const handleLogout = () => {
    setEmail(null);
    setResult(null);
    setError(null);
  };

  const handleNegotiate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!task.trim()) {
      setError('タスクを入力してください');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/negotiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ task, email }),
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const data = await response.json();
      setResult(data);
      setTask(''); // タスクをクリア
    } catch (err) {
      console.error('Negotiation failed:', err);
      setError('タスク分解に失敗しました。もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  if (!email) {
    return (
      <div className="app">
        <div className="login-container">
          <h1>🧠 The Negotiator</h1>
          <p className="tagline">ADHD向けタスク分解アシスタント</p>
          <p className="description">
            圧倒される大きなタスクを、10秒で終わる小さな一歩に分解します
          </p>
          
          {error && <div className="error">{error}</div>}
          
          <button onClick={handleLogin} className="login-button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Googleでログイン
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🧠 The Negotiator</h1>
        <div className="user-info">
          <span>{email}</span>
          <button onClick={handleLogout} className="logout-button">ログアウト</button>
        </div>
      </header>

      <main className="main">
        <div className="chat-container">
          <div className="welcome">
            <h2>やあ! 何を先延ばしにしてる?</h2>
            <p>大きすぎて圧倒されるタスクを教えてください。10秒で終わる最初の一歩を提案します。</p>
          </div>

          {result && (
            <div className="result-card">
              <div className="original-task">
                <strong>あなたのタスク:</strong> {result.task}
              </div>
              
              <div className="negotiation">
                <h3>💬 The Negotiatorより</h3>
                <p>{result.negotiation}</p>
              </div>

              <div className="first-step">
                <h3>✨ 最初の一歩 (10秒)</h3>
                <p className="step-text">{result.firstStep}</p>
              </div>

              <div className="reasoning">
                <small><strong>なぜこれが簡単か:</strong> {result.reasoning}</small>
              </div>
            </div>
          )}

          {error && <div className="error">{error}</div>}

          <form onSubmit={handleNegotiate} className="input-form">
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="例: 部屋の掃除、レポート書く、運動を始める..."
              rows={3}
              disabled={loading}
            />
            <button type="submit" disabled={loading || !task.trim()}>
              {loading ? '交渉中...' : '分解してもらう'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

export default App;
