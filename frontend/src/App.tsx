import { useState, useEffect } from 'react'

// バックエンドURL (ここだけあなたのURLか確認してください)
const API_URL = "https://my-negotiator-app.yamashitahiro0628.workers.dev";

function App() {
  const [user, setUser] = useState<{email: string, name: string} | null>(null);
  const [input, setInput] = useState("");
  const [chatLog, setChatLog] = useState<{role: string, text: string}[]>([]);
  const [loading, setLoading] = useState(false);

  // ログイン情報取得
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const email = params.get('email');
    const name = params.get('name');
    if (email && name) setUser({ email, name });
  }, []);

  const handleLogin = () => {
    window.location.href = `${API_URL}/auth/login`;
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    
    // 自分のメッセージを追加
    const newLog = [...chatLog, { role: "user", text: input }];
    setChatLog(newLog);
    setInput("");
    setLoading(true);

    try {
      // AIに送信
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input }),
      });
      const data = await res.json();

      // AIの返信を追加
      setChatLog([...newLog, { role: "ai", text: data.reply || "エラーが発生しました" }]);
    } catch (error) {
      setChatLog([...newLog, { role: "ai", text: "通信エラーです..." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
      <header style={{ marginBottom: '20px', textAlign: 'center' }}>
        <h1>The Negotiator 🧠</h1>
        {user ? (
          <p>Player: <b>{user.name}</b></p>
        ) : (
          <button onClick={handleLogin} style={btnStyle}>Googleでログインして開始</button>
        )}
      </header>

      {/* チャット画面 (ログイン時のみ表示) */}
      {user && (
        <div style={{ border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ height: '400px', overflowY: 'auto', padding: '20px', background: '#f9f9f9' }}>
            {chatLog.length === 0 && <p style={{color: '#888', textAlign: 'center'}}>店員に話しかけて値引き交渉してください！</p>}
            
            {chatLog.map((log, i) => (
              <div key={i} style={{ textAlign: log.role === 'user' ? 'right' : 'left', margin: '10px 0' }}>
                <div style={{ 
                  display: 'inline-block', 
                  padding: '10px 15px', 
                  borderRadius: '15px', 
                  background: log.role === 'user' ? '#007bff' : '#fff',
                  color: log.role === 'user' ? '#fff' : '#333',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                  maxWidth: '80%'
                }}>
                  {log.text}
                </div>
              </div>
            ))}
            {loading && <p style={{fontSize: '12px', color: '#666'}}>店員が考え中...</p>}
          </div>

          <div style={{ display: 'flex', borderTop: '1px solid #ddd', padding: '10px' }}>
            <input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="メッセージを入力..."
              style={{ flex: 1, padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }}
            />
            <button onClick={sendMessage} disabled={loading} style={{ ...btnStyle, marginLeft: '10px' }}>
              送信
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const btnStyle = {
  background: '#4285F4', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer'
};

export default App
