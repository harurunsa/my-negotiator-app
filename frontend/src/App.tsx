import { useState, useEffect, useRef } from 'react'

// ★ここが裏技！インストールせずにネットから直接読み込む設定
// @ts-ignore
import confetti from 'https://esm.sh/canvas-confetti';

const API_URL = "https://my-negotiator-app.yamashitahiro0628.workers.dev";

function App() {
  const [user, setUser] = useState<{email: string, name: string, streak: number, is_pro: number} | null>(null);
  const [input, setInput] = useState("");
  const [chatLog, setChatLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [currentGoal, setCurrentGoal] = useState<string>("");
  const [timerActive, setTimerActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  
  const timerRef = useRef<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null); 

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
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatLog, loading]);

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
    triggerConfetti(); 
    playNotificationSound();
    sendMessage(null, 'next');
  };

  const handleLogin = () => window.location.href = `${API_URL}/auth/login`;

  const sendMessage = async (manualMessage: string | null, action: 'normal' | 'retry' | 'next' = 'normal') => {
    if (action === 'normal' && !manualMessage?.trim()) return;
    
    if (navigator.vibrate) navigator.vibrate(10);

    let newLog = [...chatLog];
    if (action === 'normal' && manualMessage) {
      newLog.push({ role: "user", text: manualMessage });
    } else if (action === 'retry') {
      newLog.push({ role: "system", text: "😰 再調整中..." });
    } else if (action === 'next') {
      newLog.push({ role: "system", text: "🚀 次のステップへ！" });
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
          current_goal: currentGoal
        }),
      });
      const data = await res.json();

      if (data.detected_goal) setCurrentGoal(data.detected_goal);

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
    
    if (navigator.vibrate) navigator.vibrate(20);

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
      triggerConfetti();
      
      const t = suggestedTimer || 180;
      setTotalTime(t);
      setTimeLeft(t);
      setTimerActive(true);
    } else {
      sendMessage(null, 'retry');
    }
  };

  // ★紙吹雪演出
  const triggerConfetti = () => {
    const end = Date.now() + 1000;
    const colors = ['#00e676', '#2979ff', '#ffeb3b'];
    (function frame() {
      // ネットから借りたconfetti関数を使う
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: colors
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: colors
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    }());
  };

  const playNotificationSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.3);
    } catch(e) {}
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const RADIUS = 100;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const strokeDashoffset = CIRCUMFERENCE - (timeLeft / totalTime) * CIRCUMFERENCE;
  
  const getProgressColor = () => {
    const ratio = timeLeft / totalTime;
    if (ratio > 0.5) return "#00e676";
    if (ratio > 0.2) return "#ffeb3b";
    return "#ff1744";
  };

  return (
    <div style={styles.appContainer}>
      
      {timerActive && (
        <div style={styles.timerOverlay}>
          <div style={styles.timerContent}>
            <div style={styles.timerCircleWrapper}>
              <svg width="260" height="260" style={{ transform: 'rotate(-90deg)', filter: 'drop-shadow(0 0 10px rgba(0,255,100,0.3))' }}>
                <circle cx="130" cy="130" r={RADIUS} fill="transparent" stroke="#222" strokeWidth="12" />
                <circle
                  cx="130" cy="130" r={RADIUS}
                  fill="transparent"
                  stroke={getProgressColor()}
                  strokeWidth="12"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dashoffset 1s linear, stroke 1s ease' }}
                />
              </svg>
              <div style={styles.timerTextContainer}>
                <div style={styles.timerNumbers}>{formatTime(timeLeft)}</div>
                <div style={styles.timerLabel}>{currentGoal || "FOCUS"}</div>
              </div>
            </div>
            <button onClick={handleTimerComplete} style={styles.timerCompleteBtn}>
              Mission Complete
            </button>
          </div>
        </div>
      )}

      <header style={styles.header}>
        <div>
          <h1 style={styles.logoText}>Combo AI ⚡</h1>
          {currentGoal && <div style={styles.goalText}>Now: {currentGoal}</div>}
        </div>
        {user && (
           <div style={styles.streakBox}>
             <span style={styles.streakLabel}>COMBO</span>
             <span style={styles.streakValue}>{user.streak}</span>
           </div>
        )}
      </header>

      {!user ? (
        <div style={styles.loginContainer}>
           <button onClick={handleLogin} style={styles.loginBtn}>Googleでログイン</button>
        </div>
      ) : (
        <div style={styles.chatContainer}>
          <div style={styles.chatScrollArea}>
            {chatLog.map((log, i) => (
              <div key={i} style={{ 
                ...styles.messageRow, 
                justifyContent: log.role === 'user' ? 'flex-end' : (log.role === 'system' ? 'center' : 'flex-start') 
              }}>
                {log.role === 'system' && (
                  <span style={styles.systemMessage}>{log.text}</span>
                )}

                {log.role !== 'system' && (
                  <div style={{ 
                    ...styles.bubble,
                    background: log.role === 'user' ? 'linear-gradient(135deg, #2979ff, #00b0ff)' : '#fff',
                    color: log.role === 'user' ? '#fff' : '#333',
                    borderBottomRightRadius: log.role === 'user' ? '4px' : '20px',
                    borderBottomLeftRadius: log.role === 'ai' ? '4px' : '20px',
                  }}>
                    {log.text}

                    {log.role === 'ai' && !log.feedback_done && !timerActive && (
                      <div style={styles.actionButtonContainer}>
                        <button 
                          onClick={() => handleFeedback(i, log.used_style, true, log.timer_seconds)} 
                          className="pulse-button"
                          style={styles.actionBtnPrimary}
                        >
                          🔥 やる (START)
                        </button>
                        <button 
                          onClick={() => handleFeedback(i, log.used_style, false, 0)} 
                          style={styles.actionBtnSecondary}
                        >
                          😰 無理...
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div style={styles.loadingBubble}>
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div style={styles.inputArea}>
            <input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage(input, 'normal')}
              placeholder="ここに思考を吐き出す..."
              disabled={timerActive}
              style={styles.inputField}
            />
            <button 
              onClick={() => sendMessage(input, 'normal')} 
              disabled={loading || timerActive} 
              style={styles.sendBtn}
            >
              ↑
            </button>
          </div>
        </div>
      )}

      <style>{`
        body { margin: 0; background-color: #f0f2f5; }
        @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.05); } 100% { transform: scale(1); } }
        .pulse-button { animation: pulse 2s infinite; }
        .typing-dot {
          width: 6px; height: 6px; background: #bbb; border-radius: 50%;
          animation: typing 1.4s infinite ease-in-out both; margin: 0 2px;
        }
        .typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .typing-dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes typing { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
      `}</style>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  appContainer: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    maxWidth: '600px', margin: '0 auto', height: '100dvh', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden'
  },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0, height: '60px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 20px', zIndex: 10,
    background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(12px)',
    borderBottom: '1px solid rgba(0,0,0,0.05)'
  },
  logoText: { fontSize: '1.1rem', margin: 0, color: '#333' },
  goalText: { fontSize: '0.75rem', color: '#00b0ff', fontWeight: '600', marginTop: '2px', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  streakBox: { textAlign: 'right' },
  streakLabel: { fontSize: '0.6rem', color: '#999', display: 'block', letterSpacing: '1px' },
  streakValue: { fontSize: '1.4rem', fontWeight: '800', color: '#FFD700', lineHeight: 1 },
  
  loginContainer: { flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' },
  loginBtn: { background: '#333', color: '#fff', border: 'none', padding: '15px 30px', borderRadius: '50px', fontSize: '1rem', fontWeight: 'bold', boxShadow: '0 4px 15px rgba(0,0,0,0.2)' },

  chatContainer: { flex: 1, display: 'flex', flexDirection: 'column', paddingTop: '80px' }, 
  chatScrollArea: { flex: 1, overflowY: 'auto', padding: '0 15px 20px 15px', display: 'flex', flexDirection: 'column', gap: '15px' },
  
  messageRow: { display: 'flex', width: '100%' },
  systemMessage: { fontSize: '0.75rem', color: '#888', background: '#e0e0e0', padding: '4px 12px', borderRadius: '12px', fontWeight: '500' },
  
  bubble: {
    padding: '14px 18px', borderRadius: '20px', maxWidth: '85%',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)', lineHeight: '1.5', fontSize: '0.95rem',
    position: 'relative', transition: 'all 0.2s ease'
  },
  loadingBubble: { padding: '15px', background: '#fff', borderRadius: '20px', alignSelf: 'flex-start', display: 'flex', alignItems: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' },

  actionButtonContainer: {
    marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(0,0,0,0.05)',
    display: 'flex', gap: '10px', justifyContent: 'space-between'
  },
  actionBtnPrimary: {
    flex: 1, background: '#00e676', color: '#fff', border: 'none', padding: '10px 0',
    borderRadius: '12px', fontWeight: 'bold', fontSize: '0.9rem', cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0, 230, 118, 0.4)', transition: 'transform 0.1s'
  },
  actionBtnSecondary: {
    flex: 0.4, background: '#f5f5f5', color: '#777', border: 'none', padding: '10px 0',
    borderRadius: '12px', fontWeight: '600', fontSize: '0.8rem', cursor: 'pointer'
  },

  inputArea: {
    padding: '15px', background: '#fff', borderTop: '1px solid #eee',
    display: 'flex', gap: '10px', alignItems: 'center',
    paddingBottom: 'max(15px, env(safe-area-inset-bottom))'
  },
  inputField: {
    flex: 1, padding: '12px 16px', borderRadius: '25px', border: '1px solid #ddd',
    fontSize: '1rem', outline: 'none', background: '#f9f9f9'
  },
  sendBtn: {
    width: '45px', height: '45px', borderRadius: '50%', background: '#333', color: '#fff',
    border: 'none', fontSize: '1.2rem', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center'
  },

  timerOverlay: {
    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
    background: 'rgba(10, 10, 15, 0.95)', zIndex: 100,
    display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(5px)'
  },
  timerContent: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' },
  timerCircleWrapper: { position: 'relative', width: '260px', height: '260px', display: 'flex', justifyContent: 'center', alignItems: 'center' },
  timerTextContainer: { position: 'absolute', textAlign: 'center', color: '#fff' },
  timerNumbers: { fontSize: '3.5rem', fontWeight: '700', fontFamily: 'monospace', letterSpacing: '-2px', textShadow: '0 0 20px rgba(255,255,255,0.5)' },
  timerLabel: { fontSize: '1rem', color: '#aaa', marginTop: '5px', letterSpacing: '1px', textTransform: 'uppercase' },
  timerCompleteBtn: {
    marginTop: '40px', background: 'transparent', border: '2px solid #00e676', color: '#00e676',
    padding: '12px 40px', borderRadius: '50px', fontSize: '1.2rem', fontWeight: 'bold',
    cursor: 'pointer', boxShadow: '0 0 20px rgba(0, 230, 118, 0.2)',
    transition: 'all 0.2s'
  }
};

export default App
