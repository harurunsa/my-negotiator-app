import { useState } from 'react';

// ========================================================================
// ⚙️ 設定 & 定数 (StripeのIDなどをここに設定)
// ========================================================================
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787"; // ローカル開発用。本番は環境変数で上書き推奨
const PRICE_YEARLY = "price_xxxxxxxxxxxxxx";  // ★Stripeの年額プランIDに書き換え
const PRICE_MONTHLY = "price_yyyyyyyyyyyyyy"; // ★Stripeの月額プランIDに書き換え

// 型定義
type User = {
  email: string;
  is_pro: number; // 0:無料, 1:有料
  usage_count: number;
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

// ========================================================================
// 🎨 シンプルなCSSスタイル (インラインスタイル)
// ========================================================================
const styles = {
  container: { maxWidth: '600px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  chatBox: { border: '1px solid #ddd', borderRadius: '8px', padding: '10px', height: '400px', overflowY: 'auto' as const, marginBottom: '10px', background: '#f9f9f9' },
  message: (role: string) => ({
    background: role === 'user' ? '#e0f7fa' : '#fff',
    padding: '8px 12px', borderRadius: '12px', marginBottom: '8px',
    alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
    maxWidth: '80%'
  }),
  inputArea: { display: 'flex', gap: '10px' },
  input: { flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc' },
  button: { padding: '10px 20px', borderRadius: '4px', border: 'none', background: '#007bff', color: '#fff', cursor: 'pointer' },
  secondaryBtn: { padding: '5px 10px', borderRadius: '4px', border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: '0.8rem' },
  
  // モーダル用
  modalOverlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalContent: { background: '#fff', padding: '30px', borderRadius: '12px', maxWidth: '400px', width: '90%', boxShadow: '0 5px 15px rgba(0,0,0,0.3)' },
};

export default function App() {
  // ========================================================================
  // 🎣 State (状態管理)
  // ========================================================================
  const [user, setUser] = useState<User | null>(null); // ログインユーザー
  const [emailInput, setEmailInput] = useState(""); // ログイン用
  const [messages, setMessages] = useState<Message[]>([]); // チャット履歴
  const [input, setInput] = useState(""); // チャット入力
  const [isLoading, setIsLoading] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false); // 課金モーダル表示

  // ========================================================================
  // 🔌 API連携関数
  // ========================================================================

  // 1. 簡易ログイン (本来はパスワード認証などが必要ですが、モックとしてEmailのみで通す)
  const handleLogin = async () => {
    if (!emailInput) return;
    // 本来はAPIでユーザー情報を取得するが、ここでは簡易的にセット
    // ※実際は /api/me などのエンドポイントを作って取得してください
    setUser({ email: emailInput, is_pro: 0, usage_count: 0 });
  };

  // 2. チャット送信
  const handleSend = async () => {
    if (!input.trim() || !user) return;
    const userMsg = input;
    setInput("");
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, message: userMsg })
      });
      const data = await res.json();
      
      if (res.ok) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      } else {
        // エラーハンドリング (制限到達など)
        if (data.error === "LIMIT_REACHED") {
          alert(data.message);
          // 無料ユーザーなら課金モーダルを出すなどの誘導
          setShowUpgradeModal(true);
        } else {
          alert("Error: " + data.error);
        }
      }
    } catch (e) {
      alert("Connection Error");
    } finally {
      setIsLoading(false);
    }
  };

  // 3. 課金開始 (Stripeへ遷移)
  const handleCheckout = async (priceId: string) => {
    if (!user) return;
    try {
      const res = await fetch(`${API_URL}/api/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, priceId })
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert("Payment Error: " + (data.error || "Unknown"));
      }
    } catch(e) { alert("Network Error"); }
  };

  // 4. サブスク管理 (解約など)
  const handlePortal = async () => {
    if (!user) return;
    try {
      const res = await fetch(`${API_URL}/api/create-portal-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email })
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert("Subscription info not found.");
    } catch(e) { alert("Network Error"); }
  };

  // 5. シェアして回復
  const handleShareRecover = async () => {
    if (!user) return;
    const text = encodeURIComponent("ADHDハックツール... #Negotiator");
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${window.location.href}`, '_blank');
    
    // APIに報告
    try {
      await fetch(`${API_URL}/api/recover-by-share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email })
      });
      alert("3回分回復しました！(画面上はリロード推奨)");
    } catch(e) { console.error(e); }
  };


  // ========================================================================
  // 🖥️ UI描画
  // ========================================================================
  
  // A. ログイン画面
  if (!user) {
    return (
      <div style={{...styles.container, textAlign:'center', marginTop:'100px'}}>
        <h1>🧠 Negotiator AI</h1>
        <p>Login with Email (Mock)</p>
        <input 
          style={styles.input} 
          placeholder="email@example.com" 
          value={emailInput}
          onChange={e => setEmailInput(e.target.value)}
        />
        <button style={{...styles.button, marginLeft:'10px'}} onClick={handleLogin}>
          Start
        </button>
      </div>
    );
  }

  // B. メイン画面
  return (
    <div style={styles.container}>
      {/* ヘッダー */}
      <div style={styles.header}>
        <div>
          <strong>{user.email}</strong> 
          {user.is_pro === 1 ? <span style={{color:'gold'}}> ★PRO</span> : <span style={{color:'#888'}}> (Free)</span>}
        </div>
        <div>
          {user.is_pro === 1 ? (
            <button onClick={handlePortal} style={styles.secondaryBtn}>Manage Sub</button>
          ) : (
            <button onClick={() => setShowUpgradeModal(true)} style={{...styles.secondaryBtn, background:'#FFD700', border:'none', fontWeight:'bold'}}>
              Upgrade 🚀
            </button>
          )}
        </div>
      </div>

      {/* チャットエリア */}
      <div style={styles.chatBox}>
        {messages.length === 0 && <p style={{textAlign:'center', color:'#aaa', marginTop:'20px'}}>何でもタスクを投げてください。<br/>細かく分解します。</p>}
        {messages.map((m, i) => (
          <div key={i} style={{display:'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start'}}>
            <div style={styles.message(m.role)}>
              {m.content}
            </div>
          </div>
        ))}
        {isLoading && <div style={{textAlign:'center', fontSize:'0.8rem'}}>Thinking...</div>}
      </div>

      {/* 入力エリア */}
      <div style={styles.inputArea}>
        <input 
          style={styles.input} 
          value={input} 
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="例: 部屋の掃除ができない..."
        />
        <button style={styles.button} onClick={handleSend} disabled={isLoading}>Send</button>
      </div>

      {/* シェア回復ボタン (無料ユーザーのみ) */}
      {user.is_pro === 0 && (
        <div style={{textAlign:'center', marginTop:'20px'}}>
          <small>制限にかかった？ </small>
          <button onClick={handleShareRecover} style={{background:'none', border:'none', color:'#1da1f2', cursor:'pointer', textDecoration:'underline'}}>
            Xでシェアして回復 🐦
          </button>
        </div>
      )}

      {/* ▼▼▼ 課金モーダル ▼▼▼ */}
      {showUpgradeModal && (
        <div style={styles.modalOverlay} onClick={() => setShowUpgradeModal(false)}>
          <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2 style={{textAlign:'center', marginTop:0}}>Upgrade to Pro 🚀</h2>
            
            {/* 年額プラン */}
            <div 
              onClick={() => handleCheckout(PRICE_YEARLY)}
              style={{
                border: '3px solid #FFD700', borderRadius: '12px', padding: '15px', 
                background: '#FFFBE6', cursor: 'pointer', textAlign: 'center', marginBottom: '15px'
              }}
            >
              <div style={{color:'#D97706', fontWeight:'bold', fontSize:'0.9rem'}}>🔥 SAVE 60%</div>
              <div style={{fontSize:'1.5rem', fontWeight:'bold'}}>$39.99 <span style={{fontSize:'0.8rem'}}>/ year</span></div>
              <small>Unlimited Access Forever</small>
            </div>

            {/* 月額プラン */}
            <div 
              onClick={() => handleCheckout(PRICE_MONTHLY)}
              style={{
                border: '1px solid #ddd', borderRadius: '8px', padding: '10px', 
                textAlign: 'center', cursor: 'pointer', opacity: 0.8
              }}
            >
              <strong>Monthly Plan</strong>: $7.99 / month
            </div>

            <button 
              onClick={() => setShowUpgradeModal(false)}
              style={{marginTop:'20px', width:'100%', padding:'10px', border:'none', background:'#eee', borderRadius:'4px', cursor:'pointer'}}
            >
              Close
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
