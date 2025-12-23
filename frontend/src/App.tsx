import { useState, useEffect } from 'react'

const API_URL = "https://my-negotiator-app.yamashitahiro0628.workers.dev";

function App() {
  const [user, setUser] = useState<{email: string, name: string, streak: number, is_pro: number} | null>(null);
  const [input, setInput] = useState("");
  // used_style (今回使われたプロンプト文章) を持つ
  const [chatLog, setChatLog] = useState<{
    role: string, 
    text: string, 
    used_style?: string, 
    is_exploration?: boolean,
    feedback_done?: boolean
  }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const email = params.get('email');
    if (email) {
      const name = params.get('name') || "";
      const streak = parseInt(params.get('streak') || '0');
      const is_pro = parseInt(params.get('pro') || '0');
      setUser({ email, name, streak, is_pro });
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const handleLogin = () => window.location.href = `${API_URL}/auth/login`;

  const sendMessage = async () => {
    if (!input.trim()) return;
    const newLog = [...chatLog, { role: "user", text: input }];
    setChatLog(newLog);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input, email: user?.email }),
      });
      const data = await res.json();

      setChatLog([...newLog, { 
        role: "ai", 
        text: data.reply, 
        used_style: data.used_style, // ★使われたスタイル
        is_exploration: data.is_exploration, // ★実験中かどうか
        feedback_done: false
      }]);
    } catch (error) {
      setChatLog([...newLog, { role: "ai", text: "エラー..." }]);
    } finally {
      setLoading(false);
    }
  };

  const sendFeedback = async (index: number, used_style: string, is_success: boolean) => {
    if (!user) return;
    const updatedLog = [...chatLog];
    updatedLog[index].feedback_done = true;
    setChatLog(updatedLog);

    // バックエンドへ「このスタイルが良かった/悪かった」を送る
    const res = await fetch(`${API_URL}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, used_style, is_success }),
    });
    const data = await res.json();
    if (data.streak !== undefined) setUser({ ...user, streak: data.streak });
  };

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
      <header style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#333', color: 'white', padding: '15px', borderRadius: '12px' }}>
        <div>
          <h1 style={{fontSize: '1.2rem', margin: 0}}>Evolutionary AI 🧬</h1>
          {user && <span style={{fontSize: '0.8rem', color: '#bbb'}}>{user.is_pro ? "Premium" : "Free"}</span>}
        </div>
        {user && (
           <div style={{textAlign: 'right'}}>
             <div style={{fontSize: '0.8rem', color:'#aaa'}}>Combo Streak</div>
             <div style={{fontSize: '1.6rem', fontWeight: 'bold', color: '#FFD700'}}>🔥 {user.streak}</div>
           </div>
        )}
      </header>

      {!user ? (
        <div style={{textAlign: 'center', marginTop: '50px'}}>
           <button onClick={handleLogin} style={btnStyle}>Start Evolution</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: '70vh' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '15px', background: '#f8f9fa', borderRadius: '12px', marginBottom: '15px' }}>
            {chatLog.map((log, i) => (
              <div key={i} style={{ textAlign: log.role === 'user' ? 'right' : 'left', margin: '20px 0' }}>
                
                {/* AIの場合、どんな実験をしているか表示 */}
                {log.role === 'ai' && (
                  <div style={{fontSize: '10px', color: '#888', marginBottom: '4px', marginLeft: '10px'}}>
                    {log.is_exploration ? "🧬 突然変異スタイルをお試し中..." : "🛡️ 現在の最適スタイル"}
                  </div>
                )}

                <div style={{ 
                  display: 'inline-block', 
                  padding: '14px 20px', 
                  borderRadius: '20px', 
                  background: log.role === 'user' ? '#007bff' : (log.is_exploration ? '#e3f2fd' : '#fff'),
                  color: log.role === 'user' ? '#fff' : '#333',
                  border: log.is_exploration ? '1px solid #2196f3' : 'none',
                  boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
                  maxWidth: '85%'
                }}>
                  {log.text}
                  
                  {/* フィードバック: これが「進化」のトリガー */}
                  {log.role === 'ai' && !log.feedback_done && (
                    <div style={{marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #eee', display: 'flex', gap: '8px', justifyContent: 'flex-end'}}>
                      <span style={{fontSize: '11px', color: '#999', alignSelf:'center'}}>
                        {log.is_exploration ? "この変化はどう？" : "いつもの調子はどう？"}
                      </span>
                      <button onClick={() => sendFeedback(i, log.used_style!, true)} style={{...miniBtnStyle, background: '#28a745'}}>
                        👍 最高 (採用)
                      </button>
                      <button onClick={() => sendFeedback(i, log.used_style!, false)} style={{...miniBtnStyle, background: '#6c757d'}}>
                        🤔 微妙 (却下)
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && <p style={{fontSize: '12px', color: '#888', marginLeft: '10px'}}>AIが思考を進化させています...</p>}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="メッセージ..."
              style={{ flex: 1, padding: '15px', border: '1px solid #ddd', borderRadius: '30px', fontSize: '16px' }}
            />
            <button onClick={sendMessage} disabled={loading} style={{...btnStyle, borderRadius: '30px'}}>送信</button>
          </div>
        </div>
      )}
    </div>
  )
}

const btnStyle = { background: '#333', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' };
const miniBtnStyle = { color: 'white', border: 'none', padding: '6px 12px', borderRadius: '15px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' };
export default App
