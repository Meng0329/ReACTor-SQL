
import React, { useEffect, useState, useRef } from 'react';
import { logger, LogEntry } from '../services/logger';
import { X, Copy, Trash2, Terminal } from 'lucide-react';

interface LogViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

const LogViewer: React.FC<LogViewerProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLogs(logger.getLogs());
    const unsubscribe = logger.subscribe(setLogs);
    return unsubscribe;
  }, [isOpen]);

  useEffect(() => {
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleCopy = () => {
    const text = logs.map(l => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.category}] ${l.message}\n${l.data ? JSON.stringify(l.data, null, 2) : ''}`).join('\n\n');
    navigator.clipboard.writeText(text);
    alert('日志已复制到剪贴板');
  };

  const handleClear = () => {
      logger.clear();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 w-full max-w-4xl h-[80vh] rounded-lg shadow-2xl flex flex-col border border-slate-700">
        <div className="flex items-center justify-between p-4 border-b border-slate-700 bg-slate-800 rounded-t-lg">
          <div className="flex items-center gap-2 text-slate-100 font-mono font-bold">
            <Terminal className="w-5 h-5 text-green-400" />
            系统调试日志
          </div>
          <div className="flex gap-2">
            <button onClick={handleCopy} className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded transition-colors" title="复制全部">
                <Copy className="w-4 h-4" />
            </button>
            <button onClick={handleClear} className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors" title="清空日志">
                <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors">
                <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-3 bg-slate-950" ref={scrollRef}>
           {logs.length === 0 && <div className="text-slate-500 text-center mt-10">暂无日志</div>}
           {logs.map(log => (
             <div key={log.id} className="border-l-2 border-slate-800 pl-2 py-1">
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-slate-500">[{log.timestamp.split('T')[1].slice(0, -1)}]</span>
                    <span className={`font-bold ${
                        log.level === 'error' ? 'text-red-500' : 
                        log.level === 'warn' ? 'text-amber-500' : 'text-blue-400'
                    }`}>[{log.level.toUpperCase()}]</span>
                    <span className="text-purple-400">[{log.category}]</span>
                </div>
                <div className="text-slate-300 break-words whitespace-pre-wrap">{log.message}</div>
                {log.data && (
                    <div className="mt-1 bg-slate-900 p-2 rounded border border-slate-800 text-slate-400 overflow-x-auto">
                        <pre>{JSON.stringify(log.data, null, 2)}</pre>
                    </div>
                )}
             </div>
           ))}
        </div>
      </div>
    </div>
  );
};

export default LogViewer;
