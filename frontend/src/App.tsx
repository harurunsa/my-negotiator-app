import { useState, useEffect } from 'react'

// ★デプロイ後にバックエンドのURLに書き換える場所
const BACKEND_URL = "http://localhost:8787"; 

function App() {
  const [email, setEmail] = useState("");
  const [task, setTask] = useState("");
  const [proposal, setProposal] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // URLからログイン情報を取得
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mail = params.get('email');
    if (mail) setEmail(mail);
  }, []);

  const handleLogin = () => {
    window.location.href = `${BACKEND_URL}/auth/login`;
  };

  const handleNegotiate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/negotiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task })
      });
      const data = await res.json();
      setProposal(data);
    } catch (e) {
      alert("エラー発生");
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h1>The Negotiator 🧠</h1>

      {!email ? (
        <button onClick={handleLogin} style={{ padding: '10px 20px', fontSize: '1.2rem', background: '#4285F4', color: 'white', border: 'none', borderRadius: '5px' }}>
          Googleでログインして開始
        </button>
      ) : (
        <div>
          <p>Logged in as: <b>{email}</b></p>
          
          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <input 
              type="text" 
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="何が面倒くさい？ (例: 部屋の掃除)"
              style={{ flex: 1, padding: '10px', fontSize: '1rem' }}
            />
            <button onClick={handleNegotiate} disabled={loading} style={{ padding: '10px 20px' }}>
              {loading ? "思考中..." : "相談"}
            </button>
          </div>

          {proposal && (
            <div style={{ marginTop: '30px', padding: '20px', border: '2px solid #333', borderRadius: '10px', background: '#f9f9f9' }}>
              <p style={{ color: '#666' }}>{proposal.message}</p>
              <h2 style={{ fontSize: '2rem', margin: '10px 0' }}>{proposal.text}</h2>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#d32f2f' }}>⏱ {proposal.duration} 秒</p>
              <button style={{ width: '100%', padding: '15px', background: 'black', color: 'white', fontSize: '1.2rem', marginTop: '10px' }}>
                やる (YES)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
