import { useState, useEffect, useRef } from 'react'
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
      newLog.push({ role: "system", text: "😰 ハードルを極限まで下げています..." });
    } else if (action === 'next') {
      newLog.push({ role: "system", text: "🚀 ナイス！次のステップへ！" });
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

  const triggerConfetti = () => {
    const end = Date.now() + 1000;
    const colors = ['#00FFC2', '#0099FF', '#FF00CC']; // ネオンカラー
    (function frame() {
      confetti({ particleCount: 4, angle: 60, spread: 55, origin: { x: 0 }, colors: colors });
      confetti({ particleCount: 4, angle: 120, spread: 55, origin: { x: 1 }, colors: colors });
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
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.5);
    } catch(e) {}
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const RADIUS = 110;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const strokeDashoffset = CIRCUMFERENCE - (timeLeft / totalTime) * CIRCUMFERENCE;
  
  const getProgressColor = () => {
    const ratio = timeLeft / totalTime;
    if (ratio > 0.5) return "#00FFC2"; // Neon Green
    if (ratio > 0.2) return "#FFEB3B"; // Yellow
    return "#FF0055"; // Red
  };

  return (
    <div style={styles.appContainer}>
      
      {/* Focus Mode Overlay (Timer) */}
      {timerActive && (
        <div style={styles.timerOverlay}>
          <div style={styles.timerContent}>
            <div className="pulse-slow" style={styles.timerCircleWrapper}>
              <svg width="280" height="280" style={{ transform: 'rotate(-90deg)', filter: 'drop-shadow(0 0 15px rgba(0,255,194,0.4))' }}>
                <circle cx="140" cy="140" r={RADIUS} fill="transparent" stroke="#2a2a2a" strokeWidth="15" strokeLinecap="round"/>
                <circle
                  cx="140" cy="140" r={RADIUS}
                  fill="transparent"
                  stroke={getProgressColor()}
                  strokeWidth="15"
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
            <button onClick={handleTimerComplete} className="btn-shine" style={styles.timerCompleteBtn}>
              Mission Complete
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={styles.header}>
        <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
          <div style={styles.logoIcon}>⚡</div>
          <div>
            <h1 style={styles.logoText}>Negotiator</h1>
            {currentGoal && <div className="fade-in" style={styles.goalText}>Running: {currentGoal}</div>}
          </div>
        </div>
        {user && (
           <div style={styles.streakBox}>
             <span style={styles.streakLabel}>STREAK</span>
             <span className="pop-in" style={styles.streakValue}>{user.streak}</span>
           </div>
        )}
      </header>

      {/* ★ Premium Landing Page (Login) */}
      {!user ? (
        <div style={styles.landingContainer}>
           <div style={styles.landingContent}>
             <div style={styles.badge}>Beta v1.0</div>
             <h1 style={styles.heroTitle}>
               Hack Your <br/>
               <span style={styles.gradientText}>Executive Function.</span>
             </h1>
             <p style={styles.heroSub}>
               脳の「司令塔」を外部化する。<br/>
               ADHDのための、最強のパートナーAI。
             </p>
             
             <button onClick={handleLogin} className="btn-shine" style={styles.googleBtn}>
               Googleで始める
             </button>

             <div style={styles.featureGrid}>
               <div style={styles.featureItem}>🧠 脳内会議の代行</div>
               <div style={styles.featureItem}>🎮 人生をゲーム化</div>
               <div style={styles.featureItem}>💊 デジタル・サプリ</div>
             </div>
           </div>
           
           {/* Decorative Background Elements */}
           <div style={styles.bgBlob1}></div>
           <div style={styles.bgBlob2}></div>
        </div>
      ) : (
        <div style={styles.chatContainer}>
          <div style={styles.chatScrollArea}>
            {chatLog.length === 0 && (
              <div className="fade-in" style={styles.emptyState}>
                <div style={{fontSize: '3rem', marginBottom: '20px'}}>🧠</div>
                <p>「部屋が汚い...」「メール返したくない...」<br/>その思考、私に預けてください。</p>
              </div>
            )}
            
            {chatLog.map((log, i) => (
              <div key={i} style={{ 
                ...styles.messageRow, 
                justifyContent: log.role === 'user' ? 'flex-end' : (log.role === 'system' ? 'center' : 'flex-start') 
              }}>
                {log.role === 'system' && (
                  <span className="pop-in" style={styles.systemMessage}>{log.text}</span>
                )}

                {log.role !== 'system' && (
                  <div className="pop-in" style={{ 
                    ...styles.bubble,
                    background: log.role === 'user' ? 'linear-gradient(135deg, #3A86FF, #00C2FF)' : '#ffffff',
                    color: log.role === 'user' ? '#fff' : '#1a1a1a',
                    borderBottomRightRadius: log.role === 'user' ? '4px' : '24px',
                    borderBottomLeftRadius: log.role === 'ai' ? '4px' : '24px',
                    boxShadow: log.role === 'ai' ? '0 4px 20px rgba(0,0,0,0.05)' : '0 4px 15px rgba(58, 134, 255, 0.3)',
                  }}>
                    {log.text}

                    {log.role === 'ai' && !log.feedback_done && !timerActive && (
                      <div className="fade-in" style={styles.actionButtonContainer}>
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
              <div className="pop-in" style={styles.loadingBubble}>
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
              placeholder="思考を吐き出す..."
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

      {/* Global CSS & Animations */}
      <style>{`
        body { margin: 0; background-color: #F7F9FC; color: #1a1a1a; }
        
        @keyframes popIn { 0% { opacity: 0; transform: scale(0.9) translateY(10px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes pulse { 0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(0, 255, 194, 0.7); } 70% { transform: scale(1.02); box-shadow: 0 0 0 10px rgba(0, 255, 194, 0); } 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(0, 255, 194, 0); } }
        @keyframes pulseSlow { 0% { transform: scale(1); } 50% { transform: scale(1.02); } 100% { transform: scale(1); } }
        @keyframes float { 0% { transform: translateY(0px); } 50% { transform: translateY(-20px); } 100% { transform: translateY(0px); } }
        
        .pop-in { animation: popIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .fade-in { animation: fadeIn 0.5s ease forwards; }
        .pulse-button { animation: pulse 2s infinite; }
        .pulse-slow { animation: pulseSlow 3s infinite ease-in-out; }
        
        .btn-shine {
          position: relative; overflow: hidden;
        }
        .btn-shine::after {
          content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
          background: linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0) 100%);
          transform: rotate(45deg); transition: all 0.5s; animation: shine 3s infinite;
        }
        @keyframes shine { 0% { left: -100%; top: -100%; } 20% { left: 100%; top: 100%; } 100% { left: 100%; top: 100%; } }

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
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    maxWidth: '600px', margin: '0 auto', height: '100dvh', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
    backgroundColor: '#F7F9FC'
  },
  
  // Header
  header: {
    position: 'absolute', top: 0, left: 0, right: 0, height: '60px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 20px', zIndex: 10,
    background: 'rgba(247, 249, 252, 0.9)', backdropFilter: 'blur(10px)',
    borderBottom: '1px solid rgba(0,0,0,0.03)'
  },
  logoIcon: { fontSize: '1.5rem', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' },
  logoText: { fontSize: '1.1rem', margin: 0, color: '#1a1a1a', fontWeight: '800', letterSpacing: '-0.5px' },
  goalText: { fontSize: '0.75rem', color: '#00C2FF', fontWeight: '600', marginTop: '2px', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  streakBox: { textAlign: 'right' },
  streakLabel: { fontSize: '0.6rem', color: '#999', display: 'block', letterSpacing: '1px', fontWeight: '700' },
  streakValue: { fontSize: '1.4rem', fontWeight: '900', color: '#1a1a1a', lineHeight: 1, letterSpacing: '-1px' },

  // Landing Page (Login)
  landingContainer: { 
    flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center',
    background: '#0F172A', color: '#fff', position: 'relative', overflow: 'hidden'
  },
  landingContent: {
    zIndex: 2, padding: '40px', maxWidth: '400px', width: '100%', textAlign: 'left'
  },
  badge: {
    display: 'inline-block', padding: '4px 12px', background: 'rgba(255,255,255,0.1)', 
    borderRadius: '20px', fontSize: '0.75rem', marginBottom: '20px', border: '1px solid rgba(255,255,255,0.2)'
  },
  heroTitle: { fontSize: '3rem', margin: '0 0 20px 0', lineHeight: 1.1, fontWeight: '800', letterSpacing: '-1px' },
  gradientText: { 
    background: 'linear-gradient(to right, #00C2FF, #00FFC2)', 
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' 
  },
  heroSub: { fontSize: '1.1rem', opacity: 0.8, marginBottom: '40px', lineHeight: 1.6, fontWeight: '300' },
  googleBtn: { 
    width: '100%', padding: '18px', borderRadius: '16px', border: 'none',
    background: '#fff', color: '#000', fontSize: '1rem', fontWeight: '700',
    cursor: 'pointer', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', marginBottom: '40px'
  },
  featureGrid: { display: 'grid', gap: '15px' },
  featureItem: { 
    background: 'rgba(255,255,255,0.05)', padding: '12px 20px', borderRadius: '12px', 
    fontSize: '0.9rem', border: '1px solid rgba(255,255,255,0.05)', backdropFilter: 'blur(5px)'
  },
  // Bg Blobs
  bgBlob1: {
    position: 'absolute', top: '-20%', right: '-20%', width: '500px', height: '500px',
    background: 'radial-gradient(circle, rgba(0,194,255,0.2) 0%, rgba(0,0,0,0) 70%)',
    animation: 'float 10s infinite ease-in-out'
  },
  bgBlob2: {
    position: 'absolute', bottom: '-20%', left: '-20%', width: '600px', height: '600px',
    background: 'radial-gradient(circle, rgba(0,255,194,0.15) 0%, rgba(0,0,0,0) 70%)',
    animation: 'float 15s infinite ease-in-out reverse'
  },

  // Chat Area
  chatContainer: { flex: 1, display: 'flex', flexDirection: 'column', paddingTop: '70px' }, 
  chatScrollArea: { flex: 1, overflowY: 'auto', padding: '0 15px 20px 15px', display: 'flex', flexDirection: 'column', gap: '20px' },
  emptyState: { textAlign: 'center', marginTop: '100px', color: '#999', lineHeight: '1.8' },

  messageRow: { display: 'flex', width: '100%' },
  systemMessage: { fontSize: '0.75rem', color: '#888', background: '#eef2f6', padding: '6px 14px', borderRadius: '20px', fontWeight: '600' },
  
  bubble: {
    padding: '16px 20px', maxWidth: '85%', lineHeight: '1.6', fontSize: '1rem',
    position: 'relative'
  },
  loadingBubble: { padding: '15px', background: '#fff', borderRadius: '24px', alignSelf: 'flex-start', display: 'flex', alignItems: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' },

  actionButtonContainer: {
    marginTop: '15px', paddingTop: '15px', borderTop: '1px solid rgba(0,0,0,0.05)',
    display: 'flex', gap: '12px', justifyContent: 'space-between'
  },
  actionBtnPrimary: {
    flex: 1, background: '#1a1a1a', color: '#fff', border: 'none', padding: '12px 0',
    borderRadius: '12px', fontWeight: '700', fontSize: '0.9rem', cursor: 'pointer',
    boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
  },
  actionBtnSecondary: {
    flex: 0.4, background: '#F1F5F9', color: '#64748B', border: 'none', padding: '12px 0',
    borderRadius: '12px', fontWeight: '600', fontSize: '0.85rem', cursor: 'pointer'
  },

  // Input
  inputArea: {
    padding: '15px', background: '#fff', 
    display: 'flex', gap: '12px', alignItems: 'center',
    paddingBottom: 'max(15px, env(safe-area-inset-bottom))',
    boxShadow: '0 -5px 20px rgba(0,0,0,0.03)'
  },
  inputField: {
    flex: 1, padding: '16px 20px', borderRadius: '25px', border: 'none',
    fontSize: '1rem', outline: 'none', background: '#F1F5F9', color: '#1a1a1a'
  },
  sendBtn: {
    width: '50px', height: '50px', borderRadius: '50%', background: '#3A86FF', color: '#fff',
    border: 'none', fontSize: '1.4rem', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center',
    boxShadow: '0 4px 12px rgba(58, 134, 255, 0.3)'
  },

  // Focus Mode Overlay
  timerOverlay: {
    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
    background: 'rgba(10, 10, 15, 0.96)', zIndex: 100,
    display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(10px)'
  },
  timerContent: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' },
  timerCircleWrapper: { position: 'relative', width: '280px', height: '280px', display: 'flex', justifyContent: 'center', alignItems: 'center' },
  timerTextContainer: { position: 'absolute', textAlign: 'center', color: '#fff' },
  timerNumbers: { fontSize: '4rem', fontWeight: '700', fontFamily: 'monospace', letterSpacing: '-2px', textShadow: '0 0 30px rgba(0,255,194,0.3)' },
  timerLabel: { fontSize: '1rem', color: '#888', marginTop: '5px', letterSpacing: '2px', textTransform: 'uppercase', fontWeight: '600' },
  timerCompleteBtn: {
    marginTop: '60px', background: '#00FFC2', border: 'none', color: '#000',
    padding: '16px 50px', borderRadius: '50px', fontSize: '1.2rem', fontWeight: '800',
    cursor: 'pointer', boxShadow: '0 0 30px rgba(0, 255, 194, 0.4)', textTransform: 'uppercase', letterSpacing: '1px'
  }
};

export default App
