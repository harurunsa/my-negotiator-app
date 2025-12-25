// ▼▼▼ この変数を定義（IDはStripeダッシュボードからコピペ） ▼▼▼
const PRICE_YEARLY = "price_1Qxxxxxxxxxxxxxx";  // 年額 $39.99
const PRICE_MONTHLY = "price_1Qyyyyyyyyyyyyyy"; // 月額 $7.99
const API_URL = "https://your-backend.workers.dev"; // あなたのAPI URL

// ... Component関数の中 ...

  // ▼▼▼ 課金ボタンを押した時の処理 ▼▼▼
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
        window.location.href = data.url; // Stripeへ飛ばす
      } else {
        alert("Payment Error: " + (data.error || "Unknown"));
      }
    } catch(e) { alert("Connection Error"); }
  };

  // ▼▼▼ サブスク管理（解約）ボタンを押した時の処理 ▼▼▼
  const handlePortal = async () => {
    if (!user) return;
    const res = await fetch(`${API_URL}/api/create-portal-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email })
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else alert("サブスク情報が見つかりません。");
  };

  // ... (return の中、モーダルを表示する部分) ...

  {/* ▼▼▼ アップグレードモーダルの中身（ここが重要） ▼▼▼ */}
  {showUpgradeModal && (
    <div style={styles.modalOverlay} onClick={() => setShowUpgradeModal(false)}>
      <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
        
        <h2 style={{textAlign:'center', marginBottom:'20px'}}>Upgrade to Pro 🚀</h2>

        {/* 👑 年額プラン (Main) - デカく、目立つように */}
        <div 
          onClick={() => handleCheckout(PRICE_YEARLY)}
          style={{
            border: '3px solid #FFD700', 
            borderRadius: '12px', 
            padding: '20px', 
            background: '#FFFBE6', 
            cursor: 'pointer',
            textAlign: 'center',
            marginBottom: '20px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }}
        >
          <div style={{fontWeight:'bold', color:'#D97706', marginBottom:'5px'}}>
            BEST VALUE (Save 60%) 🔥
          </div>
          <div style={{fontSize:'1.4rem', fontWeight:'900', color:'#333'}}>
            Yearly Plan
          </div>
          <div style={{fontSize:'2rem', fontWeight:'bold', margin:'10px 0'}}>
            $39.99 <span style={{fontSize:'1rem', color:'#666'}}>/ year</span>
          </div>
          <div style={{fontSize:'0.9rem', color:'#555'}}>
            Pay once. Peace of mind forever.
          </div>
        </div>

        {/* 月額プラン (Sub) - 地味に */}
        <div 
          onClick={() => handleCheckout(PRICE_MONTHLY)}
          style={{
            border: '1px solid #ddd', 
            borderRadius: '8px', 
            padding: '15px', 
            textAlign: 'center', 
            cursor: 'pointer',
            opacity: 0.8
          }}
        >
          <div style={{fontWeight:'bold', color:'#333'}}>Monthly Plan</div>
          <div>$7.99 / month</div>
        </div>

        <div style={{marginTop:'20px', fontSize:'0.8rem', color:'#999', textAlign:'center'}}>
          Cancel anytime via settings.
        </div>

      </div>
    </div>
  )}

  {/* ▼▼▼ 設定画面などに置く「管理ボタン」 ▼▼▼ */}
  {/* user.is_pro === 1 の時だけ表示 */}
  {user?.is_pro === 1 && (
    <button onClick={handlePortal} style={{marginTop:'20px', fontSize:'0.9rem', textDecoration:'underline', background:'none', border:'none', cursor:'pointer'}}>
      Manage Subscription
    </button>
  )}
