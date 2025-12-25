import { useState, useEffect, useRef } from 'react'
// @ts-ignore
import confetti from 'https://esm.sh/canvas-confetti';

const API_URL = "https://my-negotiator-app.yamashitahiro0628.workers.dev";

// --- 翻訳辞書 ---
const TRANSLATIONS = {
  ja: {
    logo: "Negotiator",
    goal_prefix: "Running:",
    streak_label: "STREAK",
    login_badge: "Beta v1.0",
    hero_title: "Hack Your\nExecutive Function.",
    hero_sub: "脳の「司令塔」を外部化する。\nADHDのための、最強のパートナーAI。",
    btn_login: "Googleで始める",
    features: ["🧠 脳内会議の代行", "🎮 人生をゲーム化", "💊 デジタル・サプリ"],
    empty_icon: "🧠",
    empty_text: "「部屋が汚い...」「メール返したくない...」\nその思考、私に預けてください。",
    btn_start: "🔥 やる (START)",
    btn_impossible: "😰 無理...",
    placeholder: "思考を吐き出す...",
    timer_focus: "FOCUS",
    timer_complete: "Mission Complete",
    system_retry: "😰 ハードルを極限まで下げています...",
    system_next: "🚀 ナイス！次のステップへ！"
  },
  en: {
    logo: "Negotiator",
    goal_prefix: "Goal:",
    streak_label: "STREAK",
    login_badge: "Beta v1.0",
    hero_title: "Hack Your\nExecutive Function.",
    hero_sub: "Externalize your brain's command center.\nThe ultimate AI partner for ADHD minds.",
    btn_login: "Start with Google",
    features: ["🧠 Outsource Overthinking", "🎮 Gamify Your Life", "💊 Digital Supplement"],
    empty_icon: "🧠",
    empty_text: "\"My room is a mess...\" \"I can't reply...\"\nOffload those thoughts to me.",
    btn_start: "🔥 Let's Do It",
    btn_impossible: "😰 No way...",
    placeholder: "Dump your thoughts here...",
    timer_focus: "FOCUS",
    timer_complete: "Mission Complete",
    system_retry: "😰 Lowering hurdles to the limit...",
    system_next: "🚀 Nice! Next step!"
  }
};

function App() {
  const [user, setUser] = useState<{email: string, name: string, streak: number, is_pro: number} | null>(null);
  const [input, setInput] = useState("");
  const [chatLog, setChatLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentGoal, setCurrentGoal] = useState<string>("");
  const [showLimitModal, setShowLimitModal] = useState(false); // ★ 追加
  
  // ★言語設定
  const [lang, setLang] = useState<'ja' | 'en'>(
    navigator.language.startsWith('en') ? 'en' : 'ja'
  );
  const t = TRANSLATIONS[lang];

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

  const toggleLang = () => {
    setLang(prev => prev === 'ja' ? 'en' : 'ja');
  };

  const handleTimerComplete = () => {
    setTimerActive(false);
    triggerConfetti(); 
    playNotificationSound();
    sendMessage(null, 'next');
  };

  const handleLogin = () => window.location.href = `${API_URL}/auth/login`;

  const handleUpgrade = async () => {
    if (!user) return;
    try {
      const res = await fetch(`${API_URL}/api/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email })
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch (e) { console.error(e); }
  };

  const handleShare = async () => {
    if (!user) return;
    const text = encodeURIComponent(`ADHDの脳内会議を代行してくれるAIアプリ「Negotiator」を使ってみた！\n#MyNegotiatorApp`);
    const url = encodeURIComponent(window.location.href);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');

    await fetch(`${API_URL}/api/share-recovery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email })
    });
    
    setShowLimitModal(false);
    alert("回復しました！(Chat Reset)");
  };

  const sendMessage = async (manualMessage: string | null, action: 'normal' | 'retry' | 'next' = 'normal') => {
    if (action === 'normal' && !manualMessage?.trim()) return;
    
    if (navigator.vibrate) navigator.vibrate(10);

    let newLog = [...chatLog];
    if (action === 'normal' && manualMessage) {
      newLog.push({ role: "user", text: manualMessage });
    } else if (action === 'retry') {
      newLog.push({ role: "system", text: t.system_retry });
    } else if (action === 'next') {
      newLog.push({ role: "system", text: t.system_next });
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
          current_goal: currentGoal,
          lang 
        }),
      });
      const data = await res.json();

      // ★ 制限チェック
      if (data.limit_reached) {
        setShowLimitModal(true);
        setLoading(false);
        return;
      }

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
      const t_sec = suggestedTimer || 180;
      setTotalTime(t_sec);
      setTimeLeft(t_sec);
      setTimerActive(true);
    } else {
      sendMessage(null, 'retry');
    }
  };

  const triggerConfetti = () => {
    const end = Date.now() + 1000;
    const colors = ['#00FFC2', '#0099FF', '#FF00CC'];
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
    if (ratio > 0.5) return "#00FFC2";
    if (ratio > 0.2) return "#FFEB3B";
    return "#FF0055";
  };

  return (
    <div style={styles.appContainer}>
      
      {/* 課金誘導モーダル */}
      {showLimitModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={{fontSize:'3rem', marginBottom:'10px'}}>🔋</div>
            <h2 style={{margin:'0 0 10px 0', color:'#333'}}>Energy Low</h2>
            <p style={{color:'#666', lineHeight:'1.5'}}>
              {lang === 'ja' 
                ? "無料版の会話上限(1日5回)に達しました。\nシェアして回復するか、Pro版で無制限に。"
                : "Daily limit reached.\nShare to reset or Go Pro."}
            </p>
            <div style={{display:'flex', gap:'10px', flexDirection:'column', marginTop:'20px'}}>
              <button onClick={handleShare} style={styles.modalBtnShare}>
                🐦 Tweet & Reset (Free)
              </button>
              <button onClick={handleUpgrade} style={styles.modalBtnPro}>
                👑 Upgrade to Pro (Yearly)
              </button>
              <button onClick={() => setShowLimitModal(false)} style={styles.modalBtnClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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
                <div style={styles.timerLabel}>{currentGoal || t.timer_focus}</div>
              </div>
            </div>
            <button onClick={handleTimerComplete} className="btn-shine" style={styles.timerCompleteBtn}>
              {t.timer_complete}
            </button>
          </div>
        </div>
      )}

      <header style={styles.header}>
        <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
          <div style={styles.logoIcon}>⚡</div>
          <div>
            <h1 style={styles.logoText}>{t.logo}</h1>
            {currentGoal && <div className="fade-in" style={styles.goalText}>{t.goal_prefix} {currentGoal}</div>}
          </div>
        </div>
        
        <div style={{display:'flex', alignItems:'center', gap:'15px'}}>
          <button onClick={toggleLang} style={styles.langBtn}>
            {lang === 'ja' ? 'EN' : 'JP'}
          </button>
          {user && (
             <div style={styles.streakBox}>
               <span style={styles.streakLabel}>{t.streak_label}</span>
               <span className="pop-in" style={styles.streakValue}>{user.streak}</span>
             </div>
          )}
        </div>
      </header>

      {!user ? (
        <div style={styles.landingContainer}>
           <div style={styles.landingContent}>
             <div style={styles.badge}>{t.login_badge}</div>
             <h1 style={styles.heroTitle} dangerouslySetInnerHTML={{__html: t.hero_title.replace('\n', '<br/>')}}></h1>
             <p style={styles.heroSub} dangerouslySetInnerHTML={{__html: t.hero_sub.replace('\n', '<br/>')}}></p>
             <button onClick={handleLogin} className="btn-shine" style={styles.googleBtn}>
               {t.btn_login}
             </button>
             <div style={styles.featureGrid}>
               {t.features.map((f:any, i:number) => <div key={i} style={styles.featureItem}>{f}</div>)}
             </div>
           </div>
           <div style={styles.bgBlob1}></div>
           <div style={styles.bgBlob2}></div>
        </div>
      ) : (
        <div style={styles.chatContainer}>
          <div style={styles.chatScrollArea}>
            {chatLog.length === 0 && (
              <div className="fade-in" style={styles.emptyState}>
                <div style={{fontSize: '3rem', marginBottom: '20px'}}>{t.empty_icon}</div>
                <p style={{whiteSpace:'pre-line'}}>{t.empty_text}</p>
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
                          {t.btn_start}
                        </button>
                        <button 
                          onClick={() => handleFeedback(i, log.used_style, false, 0)} 
                          style={styles.actionBtnSecondary}
                        >
                          {t.btn_impossible}
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
              placeholder={t.placeholder}
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

      {/* Global CSS */}
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
        
        .btn-shine { position: relative; overflow: hidden; }
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
  
  langBtn: {
    padding: '5px 10px', fontSize: '0.7rem', borderRadius: '15px', border: '1px solid #ddd',
    background: '#fff', cursor: 'pointer', fontWeight: 'bold', color: '#555'
  },
  streakBox: { textAlign: 'right' },
  streakLabel: { fontSize: '0.6rem', color: '#999', display: 'block', letterSpacing: '1px', fontWeight: '700' },
  streakValue: { fontSize: '1.4rem', fontWeight: '900', color: '#1a1a1a', lineHeight: 1, letterSpacing: '-1px' },
  
  landingContainer: { 
    flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center',
    background: '#0F172A', color: '#fff', position: 'relative', overflow: 'hidden'
  },
  landingContent: { zIndex: 2, padding: '40px', maxWidth: '400px', width: '100%', textAlign: 'left' },
  badge: {
    display: 'inline-block', padding: '4px 12px', background: 'rgba(255,255,255,0.1)', 
    borderRadius: '20px', fontSize: '0.75rem', marginBottom: '20px', border: '1px solid rgba(255,255,255,0.2)'
  },
  heroTitle: { fontSize: '3rem', margin: '0 0 20px 0', lineHeight: 1.1, fontWeight: '800', letterSpacing: '-1px' },
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
  
  chatContainer: { flex: 1, display: 'flex', flexDirection: 'column', paddingTop: '70px' }, 
  chatScrollArea: { flex: 1, overflowY: 'auto', padding: '0 15px 20px 15px', display: 'flex', flexDirection: 'column', gap: '20px' },
  emptyState: { textAlign: 'center', marginTop: '100px', color: '#999', lineHeight: '1.8' },
  messageRow: { display: 'flex', width: '100%' },
  systemMessage: { fontSize: '0.75rem', color: '#888', background: '#eef2f6', padding: '6px 14px', borderRadius: '20px', fontWeight: '600' },
  bubble: { padding: '16px 20px', maxWidth: '85%', lineHeight: '1.6', fontSize: '1rem', position: 'relative' },
  loadingBubble: { padding: '15px', background: '#fff', borderRadius: '24px', alignSelf: 'flex-start', display: 'flex', alignItems: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' },
  actionButtonContainer: { marginTop: '15px', paddingTop: '15px', borderTop: '1px solid rgba(0,0,0,0.05)', display: 'flex', gap: '12px', justifyContent: 'space-between' },
  actionBtnPrimary: { flex: 1, background: '#1a1a1a', color: '#fff', border: 'none', padding: '12px 0', borderRadius: '12px', fontWeight: '700', fontSize: '0.9rem', cursor: 'pointer', boxShadow: '0 4px 15px rgba(0,0,0,0.2)' },
  actionBtnSecondary: { flex: 0.4, background: '#F1F5F9', color: '#64748B', border: 'none', padding: '12px 0', borderRadius: '12px', fontWeight: '600', fontSize: '0.85rem', cursor: 'pointer' },
  inputArea: { padding: '15px', background: '#fff', display: 'flex', gap: '12px', alignItems: 'center', paddingBottom: 'max(15px, env(safe-area-inset-bottom))', boxShadow: '0 -5px 20px rgba(0,0,0,0.03)' },
  inputField: { flex: 1, padding: '16px 20px', borderRadius: '25px', border: 'none', fontSize: '1rem', outline: 'none', background: '#F1F5F9', color: '#1a1a1a' },
  sendBtn: { width: '50px', height: '50px', borderRadius: '50%', background: '#3A86FF', color: '#fff', border: 'none', fontSize: '1.4rem', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', boxShadow: '0 4px 12px rgba(58, 134, 255, 0.3)' },
  
  timerOverlay: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(10, 10, 15, 0.96)', zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(10px)' },
  timerContent: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' },
  timerCircleWrapper: { position: 'relative', width: '280px', height: '280px', display: 'flex', justifyContent: 'center', alignItems: 'center' },
  timerTextContainer: { position: 'absolute', textAlign: 'center', color: '#fff' },
  timerNumbers: { fontSize: '4rem', fontWeight: '700', fontFamily: 'monospace', letterSpacing: '-2px', textShadow: '0 0 30px rgba(0,255,194,0.3)' },
  timerLabel: { fontSize: '1rem', color: '#888', marginTop: '5px', letterSpacing: '2px', textTransform: 'uppercase', fontWeight: '600' },
  timerCompleteBtn: { marginTop: '60px', background: '#00FFC2', border: 'none', color: '#000', padding: '16px 50px', borderRadius: '50px', fontSize: '1.2rem', fontWeight: '800', cursor: 'pointer', boxShadow: '0 0 30px rgba(0, 255, 194, 0.4)', textTransform: 'uppercase', letterSpacing: '1px' },

  // モーダル用
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(5px)', zIndex: 200, display: 'flex', justifyContent: 'center', alignItems: 'center' },
  modalContent: { background: 'white', padding: '30px', borderRadius: '24px', maxWidth: '340px', width: '90%', textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' },
  modalBtnShare: { background: '#1DA1F2', color: 'white', border: 'none', padding: '14px', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', width: '100%', fontSize: '1rem' },
  modalBtnPro: { background: 'linear-gradient(135deg, #FFD700 0%, #FDB931 100%)', color: '#333', border: 'none', padding: '14px', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', width: '100%', fontSize: '1rem', boxShadow: '0 4px 15px rgba(253, 185, 49, 0.4)' },
  modalBtnClose: { background: 'transparent', border: 'none', color: '#999', padding: '10px', cursor: 'pointer', fontSize: '0.9rem', marginTop: '10px' }
};

export default App
