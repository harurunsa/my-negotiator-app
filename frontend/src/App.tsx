import { useState, useEffect, useRef } from 'react'

const API_URL = "https://my-negotiator-app.yamashitahiro0628.workers.dev";

function App() {
  const [user, setUser] = useState<{email: string, name: string, streak: number, is_pro: number} | null>(null);
  const [input, setInput] = useState("");
  const [chatLog, setChatLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  // ★ゴールの維持
  const [currentGoal, setCurrentGoal] = useState<string>("");

  // ★タイマー関連
  const [timerActive, setTimerActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [totalTime, setTotalTime] = useState(0); // 円グラフ計算用
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

  useEffect(() => {
    if (timerActive && timeLeft > 0) {
      timerRef.current = window.setTimeout(() => setTimeLeft(prev => prev - 1), 1000);
    } else if (timerActive && timeLeft === 0) {
      handleTimerComplete();
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [timerActive, timeLeft]);

  const handleTimerComplete = () => {
    setTimerActive(false);
    playNotificationSound();
    sendMessage(null, 'next');
  };

  const handleLogin = () => window.location.href = `${API_URL}/auth/login`;

  const sendMessage = async (manualMessage: string | null, action: 'normal' | 'retry' | 'next' = 'normal') => {
    if (action === 'normal' && !manualMessage?.trim()) return;
    
    let newLog = [...chatLog];
    if (action === 'normal' && manualMessage) {
      newLog.push({ role: "user", text: manualMessage });
    } else if (action === 'retry') {
      newLog.push({ role: "system", text: "😰 再調整中..." });
    } else if (action === 'next') {
      newLog.push({ role: "system", text: "✅ 次のステップへ！" });
    }
    
    setChatLog(newLog);
    if(manualMessage) setInput("");
    setLoading(true);

    const lastAiMsg = chatLog.length > 0 ? chatLog[chatLog.length - 1].text : "";

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: manualMessage, 
          email: user?.email, 
          action, 
          prev_context: lastAiMsg,
          current_goal: currentGoal // ★現在の大目標をバックエンドに伝える
        }),
      });
      const data = await res.json();

      // AIがゴールを検出したら更新
      if (data.detected_goal) {
        setCurrentGoal(data.detected_goal);
      }

      setChatLog(prev => [...prev, { 
        role: "ai", 
        text: data.reply, 
        used_style: data.used_style,
        is_exploration: data.is_exploration,
        timer_seconds: data.timer_seconds,
        feedback_done: false
      }]);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleFeedback = async (index: number, used_style: string, is_success: boolean, suggestedTimer: number) => {
    if (!user) return;
    const updatedLog = [...chatLog];
    updatedLog[index].feedback_done = true;
    setChatLog(updatedLog);

    fetch(`${API_URL}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, used_style, is_success }),
    }).then(res => res.json()).then(data => {
      if (data.streak !== undefined) setUser({ ...user, streak: data.streak });
    });

    if (is_success) {
      // タイマー開始
      const t = suggestedTimer || 180;
      setTotalTime(t);
      setTimeLeft(t);
      setTimerActive(true);
    } else {
      sendMessage(null, 'retry');
    }
  };

  const playNotificationSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.2);
    } catch(e) {}
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // ★円グラフの計算
  // 半径80px, 全周 2*PI*80 ≒ 502
  const RADIUS = 80;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const strokeDashoffset = CIRCUMFERENCE - (timeLeft / totalTime) * CIRCUMFERENCE;
  
  // 残り時間に応じた色
  const getProgressColor = () => {
    const ratio = timeLeft / totalTime;
    if (ratio > 0.5) return "#00e676"; // 緑
    if (ratio > 0.2) return "#ffeb3b"; // 黄
    return "#ff1744"; // 赤
  };

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto', padding: '20px', paddingBottom: '100px' }}>
      
      {/* --- ★新タイマーUI (オーバーレイ) --- */}
      {timerActive && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.85)', zIndex: 999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{ position: 'relative', width: '250px', height: '250px' }}>
            {/* 背景円 */}
            <svg width="250" height="250" style={{ transform: 'rotate(-90deg)' }}>
              <circle
                cx="125" cy="125" r={RADIUS}
                fill="transparent"
                stroke="#333"
                strokeWidth="15"
              />
              {/* 進捗円 */}
              <circle
                cx="125" cy="125" r={RADIUS}
                fill="transparent"
                stroke={getProgressColor()}
                strokeWidth="15"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 1s linear, stroke 1s ease' }}
              />
            </svg>
            
            {/* 中央のテキスト */}
            <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              textAlign: 'center', color: 'white'
            }}>
              <div style={{ fontSize: '3rem', fontWeight: 'bold', fontFamily: 'monospace' }}>
                {formatTime(timeLeft)}
              </div>
              <div style={{ fontSize: '0.9rem', opacity: 0.7, marginTop: '5px' }}>
                {currentGoal ? `Goal: ${currentGoal}` : "FOCUS"}
              </div>
            </div>
          </div>

          <button onClick={handleTimerComplete} style={{
            marginTop: '30px', background: 'transparent', border: '2px solid #fff', color: '#fff',
            padding: '10px 30px', borderRadius: '30px', fontSize: '1.2rem', cursor: 'pointer'
          }}>
            完了！
          </button>
        </div>
      )}

      {/* ヘッダー */}
      <header style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#333', color: 'white', padding: '15px', borderRadius: '12px' }}>
        <div>
          <h1 style={{fontSize: '1.2rem', margin: 0}}>Combo AI ⚡</h1>
          {/* ゴール表示 */}
          {currentGoal && <div style={{fontSize: '0.8rem', color: '#4fc3f7', marginTop: '4px'}}>Now: {currentGoal}</div>}
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
                
                {log.role === 'system' && (
                  <span style={{fontSize: '12px', color: '#888', background: '#eee', padding: '4px 8px', borderRadius: '10px'}}>
                    {log.text}
                  </span>
                )}

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
                    {log.role === 'ai' && !log.feedback_done && !timerActive && (
                      <div style={{marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #eee', display: 'flex', gap: '8px', justifyContent: 'flex-end'}}>
                        <button 
                          onClick={() => handleFeedback(i, log.used_style, true, log.timer_seconds)} 
                          style={{...miniBtnStyle, background: '#28a745', padding: '8px 16px', fontSize: '14px'}}
                        >
                          👍 やる (Timer)
                        </button>
                        <button 
                          onClick={() => handleFeedback(i, log.used_style, false, 0)} 
                          style={{...miniBtnStyle, background: '#6c757d'}}
                        >
                          🤔 無理
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
             {loading && <p style={{fontSize: '12px', color: '#888', textAlign: 'center'}}>Thinking...</p>}
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage(input, 'normal')}
              placeholder="メッセージ..."
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
