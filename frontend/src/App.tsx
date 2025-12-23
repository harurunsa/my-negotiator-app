import { useState, useEffect, useRef } from 'react'

const API_URL = "https://my-negotiator-app.yamashitahiro0628.workers.dev";

function App() {
  const [user, setUser] = useState<{email: string, name: string, streak: number, is_pro: number} | null>(null);
  const [input, setInput] = useState("");
  const [chatLog, setChatLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  // ★タイマー関連のstate
  const [timerActive, setTimerActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef<number | null>(null);

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

  // タイマーのカウントダウン処理
  useEffect(() => {
    if (timerActive && timeLeft > 0) {
      timerRef.current = window.setTimeout(() => setTimeLeft(prev => prev - 1), 1000);
    } else if (timerActive && timeLeft === 0) {
      // ★タイマー完了！ -> 自動で「次のタスク」を要求
      handleTimerComplete();
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [timerActive, timeLeft]);

  const handleTimerComplete = () => {
    setTimerActive(false);
    playNotificationSound(); // 音を鳴らす（関数は下部に定義）
    // AIに「次！」とリクエスト
    sendMessage(null, 'next');
  };

  const handleLogin = () => window.location.href = `${API_URL}/auth/login`;

  // messageがnullの場合は、action ('retry' or 'next') を送る
  const sendMessage = async (manualMessage: string | null, action: 'normal' | 'retry' | 'next' = 'normal') => {
    if (action === 'normal' && !manualMessage?.trim()) return;
    
    // ユーザーのログ表示 (normalの時だけ)
    let newLog = [...chatLog];
    if (action === 'normal' && manualMessage) {
      newLog.push({ role: "user", text: manualMessage });
    } else if (action === 'retry') {
      newLog.push({ role: "system", text: "😰 難しすぎます..." });
    } else if (action === 'next') {
      newLog.push({ role: "system", text: "✅ タスク完了！次へ！" });
    }
    
    setChatLog(newLog);
    if(manualMessage) setInput("");
    setLoading(true);

    // 直前のAIのメッセージ（リトライ時に使用）
    const lastAiMsg = chatLog.length > 0 ? chatLog[chatLog.length - 1].text : "";

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: manualMessage, 
          email: user?.email, 
          action, 
          prev_context: lastAiMsg 
        }),
      });
      const data = await res.json();

      setChatLog(prev => [...prev, { 
        role: "ai", 
        text: data.reply, 
        used_style: data.used_style,
        is_exploration: data.is_exploration,
        timer_seconds: data.timer_seconds, // AIが指定した秒数
        feedback_done: false
      }]);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // フィードバック送信
  const handleFeedback = async (index: number, used_style: string, is_success: boolean, suggestedTimer: number) => {
    if (!user) return;
    
    // UI更新
    const updatedLog = [...chatLog];
    updatedLog[index].feedback_done = true;
    setChatLog(updatedLog);

    // バックエンドへ通知
    fetch(`${API_URL}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, used_style, is_success }),
    }).then(res => res.json()).then(data => {
      if (data.streak !== undefined) setUser({ ...user, streak: data.streak });
    });

    if (is_success) {
      // ★採用！ -> タイマー起動
      setTimeLeft(suggestedTimer || 180); // デフォルト3分
      setTimerActive(true);
    } else {
      // ★却下！ -> リトライリクエスト
      sendMessage(null, 'retry');
    }
  };

  const playNotificationSound = () => {
    // 簡易的なビープ音
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.2);
    } catch(e) {}
  };

  // 秒数を mm:ss 表記に
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto', padding: '20px', paddingBottom: '100px' }}>
      
      {/* --- タイマーオーバーレイ (コンボ中のみ表示) --- */}
      {timerActive && (
        <div style={{
          position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
          background: '#222', color: '#fff', padding: '15px 30px', borderRadius: '30px',
          boxShadow: '0 5px 20px rgba(0,0,0,0.3)', zIndex: 100, display: 'flex', alignItems: 'center', gap: '15px'
        }}>
          <div style={{fontSize: '0.8rem', color: '#aaa'}}>FOCUS</div>
          <div style={{fontSize: '2rem', fontWeight: 'bold', fontFamily: 'monospace', color: '#00e676'}}>
            {formatTime(timeLeft)}
          </div>
          <button onClick={handleTimerComplete} style={{...miniBtnStyle, background: 'transparent', border: '1px solid #555'}}>
            完了!
          </button>
        </div>
      )}

      {/* ヘッダー */}
      <header style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#333', color: 'white', padding: '15px', borderRadius: '12px' }}>
        <div>
          <h1 style={{fontSize: '1.2rem', margin: 0}}>Combo AI ⚡</h1>
          {user && <span style={{fontSize: '0.8rem', color: '#bbb'}}>{user.is_pro ? "PRO" : "Free"}</span>}
        </div>
        {user && (
           <div style={{textAlign: 'right'}}>
             <div style={{fontSize: '0.8rem', color:'#aaa'}}>Combo</div>
             <div style={{fontSize: '1.6rem', fontWeight: 'bold', color: '#FFD700'}}>🔥 {user.streak}</div>
           </div>
        )}
      </header>

      {!user ? (
        <div style={{textAlign: 'center', marginTop: '50px'}}>
           <button onClick={handleLogin} style={btnStyle}>Start Login</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ overflowY: 'auto', minHeight: '50vh', padding: '10px' }}>
            {chatLog.map((log, i) => (
              <div key={i} style={{ textAlign: log.role === 'user' ? 'right' : (log.role === 'system' ? 'center' : 'left'), margin: '15px 0' }}>
                
                {/* システムメッセージ（リトライ/完了通知） */}
                {log.role === 'system' && (
                  <span style={{fontSize: '12px', color: '#888', background: '#eee', padding: '4px 8px', borderRadius: '10px'}}>
                    {log.text}
                  </span>
                )}

                {/* ユーザーとAIのメッセージ */}
                {log.role !== 'system' && (
                  <div style={{ 
                    display: 'inline-block', 
                    padding: '14px 20px', 
                    borderRadius: '20px', 
                    background: log.role === 'user' ? '#007bff' : (log.is_exploration ? '#e3f2fd' : '#fff'),
                    color: log.role === 'user' ? '#fff' : '#333',
                    border: log.is_exploration ? '1px solid #2196f3' : '1px solid #eee',
                    maxWidth: '85%',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.05)'
                  }}>
                    {log.text}

                    {/* アクションボタン: AI発言 かつ 未評価 かつ タイマー中でない時 */}
                    {log.role === 'ai' && !log.feedback_done && !timerActive && (
                      <div style={{marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #eee', display: 'flex', gap: '8px', justifyContent: 'flex-end'}}>
                        <button 
                          onClick={() => handleFeedback(i, log.used_style, true, log.timer_seconds)} 
                          style={{...miniBtnStyle, background: '#28a745', padding: '8px 16px', fontSize: '14px'}}
                        >
                          👍 最高 (やる)
                        </button>
                        <button 
                          onClick={() => handleFeedback(i, log.used_style, false, 0)} 
                          style={{...miniBtnStyle, background: '#6c757d'}}
                        >
                          🤔 無理...
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
             {loading && <p style={{fontSize: '12px', color: '#888', textAlign: 'center'}}>Thinking...</p>}
          </div>

          {/* 入力エリア (タイマー中は非表示推奨だが、一応残す) */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage(input, 'normal')}
              placeholder="話しかける..."
              disabled={timerActive}
              style={{ flex: 1, padding: '15px', border: '1px solid #ddd', borderRadius: '30px', fontSize: '16px' }}
            />
            <button onClick={() => sendMessage(input, 'normal')} disabled={loading || timerActive} style={{...btnStyle, borderRadius: '30px'}}>送信</button>
          </div>
        </div>
      )}
    </div>
  )
}

const btnStyle = { background: '#333', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' };
const miniBtnStyle = { color: 'white', border: 'none', padding: '6px 12px', borderRadius: '15px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' };

export default App
