import React, { useState } from 'react';
import { AgentMessage, AgentStep } from '../types';
import { Bot, User, ChevronDown, ChevronRight, Terminal, Table as TableIcon, Activity, Database, CheckCircle2, BrainCircuit } from 'lucide-react';

interface ChatMessageProps {
  message: AgentMessage;
}

const StepRenderer: React.FC<{ step: AgentStep }> = ({ step }) => {
  const [isOpen, setIsOpen] = useState(false); // Default collapsed for conciseness
  const [showSql, setShowSql] = useState(true);

  if (step.type === 'thought') {
    if (!step.content) return null;
    return (
      <div className="flex gap-2 mb-3 text-slate-600 animate-in fade-in duration-300">
        <BrainCircuit className="w-4 h-4 mt-1 flex-shrink-0 text-amber-500" />
        <div className="text-sm whitespace-pre-wrap font-medium italic opacity-90">
            {step.content}
        </div>
      </div>
    );
  }

  if (step.type === 'action') {
    const isSql = step.toolName === 'run_sql';
    const args = JSON.parse(step.content || '{}');
    
    return (
      <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 overflow-hidden shadow-sm animate-in slide-in-from-left-2">
        <div 
          onClick={() => setIsOpen(!isOpen)} 
          className="flex items-center gap-2 px-3 py-2 bg-slate-100 cursor-pointer hover:bg-slate-200 transition-colors text-xs font-semibold text-slate-700"
        >
          {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {isSql ? <Terminal className="w-3 h-3 text-blue-600" /> : <Database className="w-3 h-3 text-purple-600" />}
          <span>执行动作: {step.toolName === 'run_sql' ? 'SQL查询' : '获取表结构'}</span>
        </div>
        
        {isOpen && (
            <div className="p-3 bg-slate-900 text-slate-300 text-xs font-mono overflow-x-auto">
                {isSql ? (
                    <code className="text-green-400">{args.query}</code>
                ) : (
                    <code>{JSON.stringify(args, null, 2)}</code>
                )}
            </div>
        )}
      </div>
    );
  }

  if (step.type === 'observation') {
    // If it's a query result (data object)
    if (step.result && step.result.columns) {
        const { columns, data, error } = step.result;
        if (error) {
            return (
                <div className="mb-3 p-3 bg-red-50 text-red-600 border border-red-200 rounded text-xs flex gap-2 items-center">
                    <Activity className="w-4 h-4" />
                    执行错误: {error}
                </div>
            );
        }

        return (
            <div className="mb-4 rounded-md border border-slate-200 shadow-sm bg-white overflow-hidden animate-in zoom-in-95">
                 <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs text-slate-500">
                    <div className="flex items-center gap-2">
                        <TableIcon className="w-3 h-3" />
                        <span>查询结果: {data.length} 行</span>
                    </div>
                    <button onClick={() => setIsOpen(!isOpen)} className="text-blue-500 hover:underline">
                        {isOpen ? '隐藏表格' : '查看表格'}
                    </button>
                 </div>
                 {isOpen && (
                     <div className="overflow-x-auto max-h-60">
                        <table className="w-full text-xs text-left">
                            <thead className="bg-slate-50 text-slate-500 sticky top-0">
                                <tr>
                                    {columns.map((c: string) => <th key={c} className="px-3 py-2 border-b font-medium">{c}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {data.map((row: any, i: number) => (
                                    <tr key={i} className="border-b hover:bg-slate-50">
                                        {columns.map((c: string) => (
                                            <td key={c} className="px-3 py-2 whitespace-nowrap text-slate-700">
                                                {(row[c] === null || row[c] === undefined) ? '' : String(row[c])}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                     </div>
                 )}
            </div>
        );
    }

    // Generic observation
    return (
        <div className="mb-3 p-3 bg-slate-100 text-slate-600 rounded text-xs border border-slate-200 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
            <span className="font-bold text-slate-500">观察结果:</span> {step.content}
        </div>
    );
  }

  return null;
};

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';
  
  return (
    <div className={`flex w-full mb-8 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[95%] md:max-w-[85%] ${isUser ? 'flex-row-reverse' : 'flex-row'} gap-3`}>
        
        {/* Avatar */}
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${
          isUser ? 'bg-blue-600' : 'bg-emerald-600'
        }`}>
          {isUser ? <User className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-white" />}
        </div>

        {/* Content Container */}
        <div className={`flex flex-col gap-1 min-w-0 ${isUser ? 'items-end' : 'items-start'} flex-1`}>
          
            {/* User Message Bubble */}
            {isUser && (
                <div className="px-5 py-3 rounded-2xl bg-blue-600 text-white rounded-tr-none shadow-md text-sm leading-relaxed whitespace-pre-wrap">
                    {message.content}
                </div>
            )}

            {/* Assistant ReAct Stream */}
            {!isUser && (
                <div className="w-full">
                    {/* Steps (Thoughts/Actions/Observations) */}
                    <div className="pl-2 border-l-2 border-slate-200 ml-1 space-y-2">
                        {message.steps?.map((step) => (
                            <StepRenderer key={step.id} step={step} />
                        ))}
                    </div>

                    {/* Final Answer Bubble (distinct from thoughts) */}
                    {message.content && (
                         <div className="mt-4 px-5 py-4 rounded-2xl bg-white border border-slate-200 text-slate-800 rounded-tl-none shadow-sm text-sm leading-relaxed whitespace-pre-wrap animate-in fade-in slide-in-from-bottom-2">
                            <div className="flex items-center gap-2 mb-2 text-emerald-600 font-bold text-xs uppercase tracking-wider">
                                <CheckCircle2 className="w-4 h-4" />
                                最终回答
                            </div>
                            {message.content}
                         </div>
                    )}
                    
                    {/* Loading Indicator */}
                    {message.isStreaming && !message.content && message.steps && message.steps.length > 0 && message.steps[message.steps.length - 1].status !== 'streaming' && (
                         <div className="mt-2 text-slate-400 text-xs animate-pulse flex items-center gap-2 pl-4">
                            <div className="w-2 h-2 bg-slate-400 rounded-full"></div>
                            思考中...
                         </div>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;