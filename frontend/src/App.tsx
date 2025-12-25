// ---------------------------------------------------
// 定数定義 (StripeダッシュボードからIDをコピペ)
// ---------------------------------------------------
const PRICE_YEARLY = "price_xxxxxxxxxxxxxx";  // 年額 (Main)
const PRICE_MONTHLY = "price_yyyyyyyyyyyyyy"; // 月額 (Sub)
const API_URL = "https://your-backend.workers.dev"; // あなたのバックエンドURL

// ... コンポーネント内部 ...

// 課金開始ボタン
const handleCheckout = async (priceId: string) => {
  if (!user) return alert("Please login first.");
  try {
    const res = await fetch(`${API_URL}/api/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, priceId })
    });
    const data = await res.json();
    if (data.url) window.location.href = data.url; // Stripeへ遷移
    else alert("Error: " + (data.error || "Unknown"));
  } catch(e) { alert("Network Error"); }
};

// サブスク管理ボタン (解約など)
const handlePortal = async () => {
  if (!user) return;
  const res = await fetch(`${API_URL}/api/create-portal-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email })
  });
  const data = await res.json();
  if (data.url) window.location.href = data.url;
  else alert("Subscription not found.");
};

// シェア回復ボタン (既存機能)
const handleShareRecover = async () => {
  // Xでシェアするウィンドウを開く
  const text = encodeURIComponent("ADHDハックツール... #Negotiator");
  window.open(`https://twitter.com/intent/tweet?text=${text}&url=${window.location.href}`, '_blank');
  
  // APIに報告して回復
  await fetch(`${API_URL}/api/recover-by-share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email })
  });
  alert("3回分回復しました！");
  // 画面リロードなど
};

// ... JSXのreturn内部 ...

{/* ▼▼▼ アップグレードモーダル (年額推しデザイン) ▼▼▼ */}
{showUpgradeModal && (
  <div style={styles.modalOverlay} onClick={() => setShowUpgradeModal(false)}>
    <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
      <h2 style={{textAlign:'center'}}>Upgrade to Pro 🚀</h2>

      {/* 年額プラン (Main) */}
      <div onClick={() => handleCheckout(PRICE_YEARLY)}
           style={{
             border: '3px solid #FFD700', background: '#FFFBE6', padding: '20px', 
             borderRadius: '12px', cursor: 'pointer', marginBottom: '15px', textAlign: 'center'
           }}>
        <div style={{color:'#D97706', fontWeight:'bold'}}>🔥 SAVE 60%</div>
        <div style={{fontSize:'1.8rem', fontWeight:'bold'}}>$39.99 <span style={{fontSize:'1rem'}}>/ year</span></div>
        <small>Best Choice for ADHDer</small>
      </div>

      {/* 月額プラン (Sub) */}
      <div onClick={() => handleCheckout(PRICE_MONTHLY)}
           style={{
             border: '1px solid #ccc', padding: '10px', borderRadius: '8px', 
             cursor: 'pointer', textAlign: 'center', opacity: 0.8
           }}>
        <strong>Monthly Plan</strong>: $7.99 / month
      </div>
    </div>
  </div>
)}

{/* ▼▼▼ 設定画面などに置くボタン ▼▼▼ */}
{/* Pro会員なら管理ボタン、無料ならアップグレードボタン */}
{user?.is_pro === 1 ? (
  <button onClick={handlePortal}>Manage Subscription (Cancel)</button>
) : (
  <button onClick={() => setShowUpgradeModal(true)}>Upgrade to Pro</button>
)}

{/* シェア回復ボタン */}
{user?.is_pro === 0 && (
  <button onClick={handleShareRecover}>Share to Recover Limits 🐦</button>
)}
