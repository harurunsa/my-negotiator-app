import { useState } from 'react';

// 画面の状態遷移
type ViewState = 'INPUT' | 'NEGOTIATION' | 'TIMER' | 'RESULT';

export default function App() {
  const [view, setView] = useState<ViewState>('INPUT');
  const [inputTask, setInputTask] = useState('');
  
  // AIからの提案データ
  const [proposal, setProposal] = useState({ text: '', duration: 0, message: '' });
  const [rejectionCount, setRejectionCount] = useState(0);

  // 交渉開始
  const startNegotiation = async () => {
    // ローディング表示等は省略
    const res = await fetch('https://your-worker.workers.dev/api/negotiate', {
      method: 'POST',
      body: JSON.stringify({ task: inputTask, rejectionCount })
    });
    const data = await res.json();
    setProposal(data);
    setView('NEGOTIATION');
  };

  // 拒否した場合（もっと簡単にして！）
  const handleReject = () => {
    setRejectionCount(prev => prev + 1);
    startNegotiation(); // 再度AIに問い合わせ
  };

  // 承諾した場合
  const handleAccept = () => {
    setView('TIMER');
    // ここでタイマーコンポーネントを開始させる
  };

  // タイマー終了（完了）
  const handleComplete = async () => {
    // コンボ提案を取得
    const res = await fetch('https://your-worker.workers.dev/api/complete', {
      method: 'POST',
      body: JSON.stringify({ originalTask: inputTask, lastAction: proposal.text })
    });
    const data = await res.json();
    setProposal(data); // 次のタスクをセット
    setView('RESULT'); // リザルト画面（コンボ誘導）へ
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      
      {/* 1. 入力画面 */}
      {view === 'INPUT' && (
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold mb-4 text-center">The Negotiator</h1>
          <input 
            type="text" 
            value={inputTask}
            onChange={(e) => setInputTask(e.target.value)}
            placeholder="今、何が重荷になってる？"
            className="w-full p-4 bg-gray-900 border border-gray-700 rounded-lg text-xl focus:outline-none focus:border-blue-500"
            onKeyDown={(e) => e.key === 'Enter' && startNegotiation()}
          />
          <p className="text-gray-500 text-center mt-2 text-sm">Enterで交渉開始</p>
        </div>
      )}

      {/* 2. 交渉画面 */}
      {view === 'NEGOTIATION' && (
        <div className="text-center">
          <p className="text-gray-400 mb-2">{proposal.message}</p>
          <h2 className="text-3xl font-bold mb-8">{proposal.text}</h2>
          <div className="text-xl text-yellow-500 mb-8">⏱ {proposal.duration}秒</div>
          
          <div className="flex gap-4 justify-center">
            <button onClick={handleReject} className="px-6 py-3 bg-red-900 rounded hover:bg-red-800 transition">
              無理 (NO)
            </button>
            <button onClick={handleAccept} className="px-6 py-3 bg-blue-600 rounded hover:bg-blue-500 transition font-bold">
              やる (YES)
            </button>
          </div>
        </div>
      )}

      {/* 3. タイマー画面（簡易版） */}
      {view === 'TIMER' && (
        <div className="text-center">
          <h2 className="text-2xl mb-4">実行中...</h2>
          <div className="w-64 h-64 border-4 border-blue-500 rounded-full flex items-center justify-center mx-auto mb-8 animate-pulse">
            <span className="text-4xl">FOCUSED</span>
          </div>
          <button onClick={handleComplete} className="px-8 py-4 bg-green-600 rounded-full text-xl font-bold">
            終わった！
          </button>
        </div>
      )}

      {/* 4. リザルト & コンボ画面 */}
      {view === 'RESULT' && (
        <div className="text-center">
          <h1 className="text-4xl mb-4">🎉 AMAZING!</h1>
          <p className="mb-8">お前は天才だ。</p>
          
          <div className="bg-gray-800 p-6 rounded-lg border border-yellow-600">
            <p className="text-yellow-400 font-bold mb-2">🔥 COMBO CHANCE</p>
            <p className="text-xl mb-4">{proposal.text} ({proposal.duration}秒)</p>
            <p className="text-sm text-gray-400 mb-4">"{proposal.message}"</p>
            
            <div className="flex gap-4 justify-center">
              <button onClick={() => setView('INPUT')} className="px-4 py-2 text-gray-400">
                休む
              </button>
              <button onClick={handleAccept} className="px-6 py-2 bg-yellow-600 text-black font-bold rounded">
                コンボを繋ぐ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
