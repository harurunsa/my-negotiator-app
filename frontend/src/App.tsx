import { useState } from 'react';

// ========================================================================
// ⚙️ 設定 & 定数
// ========================================================================
// デプロイ後は自動で環境変数が読み込まれます。ローカルではlocalhostになります。
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

// ★Stripeの商品ID (ダッシュボードからコピペしてください)
const PRICE_YEARLY = "prod_SmS1bGELErBkDp"; 
const PRICE_MONTHLY = "prod_SmKGlWKaPxm783"; 

// ========================================================================
// 🗣️ 翻訳データ (ここがエラー原因だったので修正しました)
// ========================================================================
const translations = {
  en: {
    title: "Negotiator AI",
    login_placeholder: "Enter Email",
    btn_start: "Start",
    btn_upgrade: "Upgrade to Pro 🚀",
    manage_sub: "Manage Subscription",
    share_recover: "Share to Recover Limits 🐦",
    pro_badge: "★ PRO",
    free_badge: "(Free)",
    chat_placeholder: "Ex: I can't clean my room...",
    send: "Send",
    thinking: "Thinking...",
    limit_reached: "Daily limit reached! Share to recover.", // ★追加
    recover_success: "Recovered 3 credits! Please reload.",
    modal_title: "Upgrade to Pro 🚀",
    modal_yearly_badge: "🔥 SAVE 60%",
    modal_yearly_sub: "Unlimited Access Forever",
    modal_monthly: "Monthly Plan",
    modal_close: "Close",
    payment_error: "Payment Error: ",
    sub_not_found: "Subscription info not found."
  },
  ja: {
    title: "Negotiator AI",
    login_placeholder: "メールアドレスを入力",
    btn_start: "開始",
    btn_upgrade: "Proにアップグレード 🚀",
    manage_sub: "サブスク管理 (解約)",
    share_recover: "シェアして回数回復 🐦",
    pro_badge: "★ PRO",
    free_badge: "(無料会員)",
    chat_placeholder: "例: 部屋の掃除ができない...",
    send: "送信",
    thinking: "思考中...",
    limit_reached: "本日の上限です！シェアして回復。", // ★追加
    recover_success: "3回分回復しました！画面をリロードしてください。",
    modal_title: "Proプランへアップグレード 🚀",
    modal_yearly_badge: "🔥 60% OFF",
    modal_yearly_sub: "年払いで安心を手に入れる",
    modal_monthly: "月額プラン",
    modal_close: "閉じる",
    payment_error: "決済エラー: ",
    sub_not_found: "サブスクリプション情報が見つかりません。"
  }
};

// 型定義
type User = {
  email: string;
  is_pro: number; 
  usage_count: number;
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

// ========================================================================
// 🎨 スタイル
// ========================================================================
const styles = {
  container: { maxWidth: '600px', margin: '0 auto', padding: '20px', fontFamily: '"Helvetica Neue", Arial, sans-serif', color: '#333' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '10px', borderBottom: '1px solid #eee' },
  chatBox: { border: '1px solid #ddd', borderRadius: '12px', padding: '15px', height: '50vh', overflowY: 'auto' as const, marginBottom: '15px', background: '#f8f9fa' },
  message: (role: string) => ({
    background: role === 'user' ? '#007bff' : '#fff',
    color: role === 'user' ? '#fff' : '#333',
    padding: '10px 14px', borderRadius: '12px', marginBottom: '10px',
    alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
    maxWidth: '80%',
    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
    lineHeight: '1.5'
  }),
  inputArea: { display: 'flex', gap: '10px' },
  input: { flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #ccc', fontSize: '16px' },
  button: { padding: '12px 24px', borderRadius: '8px', border: 'none', background: '#007bff', color: '#fff', cursor: 'pointer', fontWeight: 'bold' as const },
  secondaryBtn: { padding: '8px 12px', borderRadius: '6px', border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: '0.85rem' },
  upgradeBtn: { padding: '8px 12px', borderRadius: '6px', border: 'none', background: '#FFD700', color: '#333', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold' as const },
  
  // モーダル
  modalOverlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999 },
  modalContent: { background: '#fff', padding: '30px', borderRadius: '16px', maxWidth: '400px', width: '90%', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' },
};

export default function App() {
  // 言語設定 (簡易的にブラウザの言語判定、デフォルトは英語)
  const lang = navigator.language.startsWith('ja') ? 'ja' : 'en';
  const t = translations[lang];

  // State
  const [user, setUser] = useState<User | null>(null); 
  const [emailInput, setEmailInput] = useState(""); 
  const [messages, setMessages] = useState<Message[]>([]); 
  const [input, setInput] = useState(""); 
  const [isLoading, setIsLoading] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // ----------------------------------------------------------------------
  // API連携
  // ----------------------------------------------------------------------

  // ログイン
  const handleLogin = async () => {
    if (!emailInput) return;
    // モックログイン (実際はAPIで認証してください)
    setUser({ email: emailInput, is_pro: 0, usage_count: 0 });
  };

  // チャット送信
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
        if (data.error === "LIMIT_REACHED") {
          alert(t.limit_reached); // ★ここで使っていたので辞書に追加しました
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

  // 課金 (Stripe)
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
        alert(t.payment_error + (data.error || "Unknown"));
      }
    } catch(e) { alert("Network Error"); }
  };

  // サブスク管理
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
      else alert(t.sub_not_found);
    } catch(e) { alert("Network Error"); }
  };

  // シェア回復
  const handleShareRecover = async () => {
    if (!user) return;
    const text = encodeURIComponent("ADHDハックツール... #Negotiator");
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${window.location.href}`, '_blank');
    
    try {
      await fetch(`${API_URL}/api/recover-by-share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email })
      });
      alert(t.recover_success);
    } catch(e) { console.error(e); }
  };

  // ----------------------------------------------------------------------
  // UI描画
  // ----------------------------------------------------------------------

  // ログイン前
  if (!user) {
    return (
      <div style={{...styles.container, textAlign:'center', marginTop:'100px'}}>
        <h1>🧠 {t.title}</h1>
        <div style={{maxWidth: '300px', margin: '0 auto'}}>
          <input 
            style={{...styles.input, width: '100%', marginBottom: '10px'}} 
            placeholder={t.login_placeholder}
            value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
          />
          <button style={{...styles.button, width: '100%'}} onClick={handleLogin}>
            {t.btn_start}
          </button>
        </div>
      </div>
    );
  }

  // ログイン後 (メイン画面)
  return (
    <div style={styles.container}>
      {/* ヘッダー */}
      <div style={styles.header}>
        <div>
          <strong>{user.email}</strong> 
          {user.is_pro === 1 ? <span style={{color:'gold', fontWeight:'bold'}}> {t.pro_badge}</span> : <span style={{color:'#888', fontSize:'0.9rem'}}> {t.free_badge}</span>}
        </div>
        <div>
          {user.is_pro === 1 ? (
            <button onClick={handlePortal} style={styles.secondaryBtn}>{t.manage_sub}</button>
          ) : (
            <button onClick={() => setShowUpgradeModal(true)} style={styles.upgradeBtn}>
              {t.btn_upgrade}
            </button>
          )}
        </div>
      </div>

      {/* チャットエリア */}
      <div style={styles.chatBox}>
        {messages.length === 0 && (
          <div style={{textAlign:'center', color:'#aaa', marginTop:'40px', padding:'20px'}}>
            <div style={{fontSize:'3rem', marginBottom:'10px'}}>💭</div>
            <p>Tell me your task.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{display:'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start'}}>
            <div style={styles.message(m.role)}>
              {m.content}
            </div>
          </div>
        ))}
        {isLoading && <div style={{textAlign:'center', fontSize:'0.8rem', color:'#888'}}>{t.thinking}</div>}
      </div>

      {/* 入力エリア */}
      <div style={styles.inputArea}>
        <input 
          style={styles.input} 
          value={input} 
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder={t.chat_placeholder}
        />
        <button style={styles.button} onClick={handleSend} disabled={isLoading}>{t.send}</button>
      </div>

      {/* シェア回復ボタン (無料のみ) */}
      {user.is_pro === 0 && (
        <div style={{textAlign:'center', marginTop:'20px'}}>
          <button onClick={handleShareRecover} style={{background:'none', border:'none', color:'#1da1f2', cursor:'pointer', textDecoration:'underline', fontSize:'0.9rem'}}>
            {t.share_recover}
          </button>
        </div>
      )}

      {/* 課金モーダル */}
      {showUpgradeModal && (
        <div style={styles.modalOverlay} onClick={() => setShowUpgradeModal(false)}>
          <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2 style={{textAlign:'center', marginTop:0, marginBottom:'20px'}}>{t.modal_title}</h2>
            
            {/* 年額プラン (Main) */}
            <div 
              onClick={() => handleCheckout(PRICE_YEARLY)}
              style={{
                border: '3px solid #FFD700', borderRadius: '12px', padding: '20px', 
                background: '#FFFBE6', cursor: 'pointer', textAlign: 'center', marginBottom: '15px',
                transition: 'transform 0.1s'
              }}
            >
              <div style={{color:'#D97706', fontWeight:'bold', fontSize:'0.9rem', marginBottom:'5px'}}>{t.modal_yearly_badge}</div>
              <div style={{fontSize:'1.8rem', fontWeight:'900', color:'#333'}}>$39.99 <span style={{fontSize:'0.9rem', fontWeight:'normal'}}>/ year</span></div>
              <small style={{color:'#666'}}>{t.modal_yearly_sub}</small>
            </div>

            {/* 月額プラン (Sub) */}
            <div 
              onClick={() => handleCheckout(PRICE_MONTHLY)}
              style={{
                border: '1px solid #ddd', borderRadius: '8px', padding: '12px', 
                textAlign: 'center', cursor: 'pointer', opacity: 0.8, background: '#f9f9f9'
              }}
            >
              <strong>{t.modal_monthly}</strong>: $7.99 / month
            </div>

            <button 
              onClick={() => setShowUpgradeModal(false)}
              style={{marginTop:'25px', width:'100%', padding:'12px', border:'none', background:'#eee', borderRadius:'8px', cursor:'pointer', fontSize:'0.9rem', fontWeight:'bold'}}
            >
              {t.modal_close}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
