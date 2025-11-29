
import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatMessage from './components/ChatMessage';
import LogViewer from './components/LogViewer';
import { AgentMessage, AppSettings, TableSchema, AgentStep } from './types';
import { processExcelFile, registerTable, getDatabaseSchema, executeSql } from './services/dataService';
import { runAgent } from './services/llmService';
import { logger } from './services/logger';
import { Send, Loader2 } from 'lucide-react';

const App: React.FC = () => {
  // --- State ---
  const [settings, setSettings] = useState<AppSettings>({
    apiKey: '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-flash'
  });

  const [tables, setTables] = useState<TableSchema[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '你好！我是你的 SQL 智能数据分析助手。请上传 Excel 表格，我会自动分析表结构并根据你的问题进行 SQL 查询。',
      timestamp: Date.now()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [showLogViewer, setShowLogViewer] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // --- Effects ---
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    logger.info("System", "App Initialized", { version: "1.0.0" });
  }, []);

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // --- Handlers ---

  const handleFileUpload = async (files: FileList) => {
    setIsLoadingFile(true);
    const newTables: any[] = [];
    
    try {
      for (let i = 0; i < files.length; i++) {
        const processed = await processExcelFile(files[i]);
        registerTable(processed);
        newTables.push(processed);
      }
      
      const updatedSchema = getDatabaseSchema(newTables);
      
      setTables(prev => {
        const combined = [...prev];
        updatedSchema.forEach(newT => {
          const index = combined.findIndex(t => t.tableName === newT.tableName);
          if (index >= 0) combined[index] = newT;
          else combined.push(newT);
        });
        return combined;
      });

      // --- 自动 SQL 自检逻辑 ---
      const diagReports = updatedSchema.map(t => {
        const checkSql = `SELECT * FROM [${t.tableName}] LIMIT 3`;
        const res = executeSql(checkSql);
        const isHealthy = !res.error && res.data.length > 0;
        
        return {
          name: t.originalName || t.tableName, 
          sqlName: t.tableName,
          isHealthy,
          columns: t.columns,
          preview: res.data,
          error: res.error
        };
      });

      const reportContent = diagReports.map(r => {
        const status = r.isHealthy ? '✅ 正常 (SQL 可检索)' : `❌ 异常 (${r.error || '空表'})`;
        return `**源文件**: ${r.name}
**SQL ID**: ${r.sqlName}
**状态**: ${status}
**列清单**: ${r.columns.join(', ')}
**SQL 数据预览 (前3行)**:
\`\`\`json
${JSON.stringify(r.preview, null, 2)}
\`\`\``;
      }).join('\n\n---\n\n');

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `成功加载 ${files.length} 个文件。\n\n### 🛡️ 自动 SQL 自检报告\n系统已自动执行 SQL 试运行，结果如下：\n\n${reportContent}\n\n数据已就绪，请提问！`,
        timestamp: Date.now()
      }]);
      
      logger.info("System", "File Upload Complete", { count: files.length });

    } catch (error: any) {
      console.error(error);
      logger.error("System", "File Upload Failed", { error: error.message });
      alert("处理文件失败，请确保是有效的 Excel 格式。");
    } finally {
      setIsLoadingFile(false);
    }
  };

  const handleClearData = () => {
    setTables([]);
    logger.info("System", "Data Cleared");
    setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `所有表格数据已清空。`,
        timestamp: Date.now()
    }]);
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;
    
    if (tables.length === 0) {
        alert("请先在左侧上传 Excel 数据表。");
        return;
    }

    const userMsg: AgentMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      timestamp: Date.now()
    };

    const agentMsgId = (Date.now() + 1).toString();
    const initialAgentMsg: AgentMessage = {
      id: agentMsgId,
      role: 'assistant',
      content: '',
      steps: [],
      timestamp: Date.now(),
      isStreaming: true
    };

    setMessages(prev => [...prev, userMsg, initialAgentMsg]);
    setInputValue('');
    setIsProcessing(true);

    try {
      await runAgent(
        userMsg.content!,
        tables,
        settings,
        (updatedSteps: AgentStep[]) => {
            setMessages(prev => prev.map(msg => 
                msg.id === agentMsgId 
                ? { ...msg, steps: updatedSteps }
                : msg
            ));
        },
        (finalAnswer: string) => {
            setMessages(prev => prev.map(msg => 
                msg.id === agentMsgId 
                ? { ...msg, content: finalAnswer }
                : msg
            ));
        }
      );

    } catch (error: any) {
       setMessages(prev => prev.map(msg => 
         msg.id === agentMsgId
         ? { ...msg, content: `执行出错: ${error.message}`, isStreaming: false }
         : msg
       ));
    } finally {
      setIsProcessing(false);
      setMessages(prev => prev.map(msg => 
        msg.id === agentMsgId 
        ? { ...msg, isStreaming: false }
        : msg
      ));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden">
      
      {/* Sidebar */}
      <Sidebar 
        settings={settings}
        onSettingsChange={setSettings}
        tables={tables}
        onFileUpload={handleFileUpload}
        onClearData={handleClearData}
        isLoadingFile={isLoadingFile}
        onOpenLogs={() => setShowLogViewer(true)}
      />

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full relative">
        
        {/* Chat History */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10 scrollbar-thin scrollbar-thumb-slate-300">
          <div className="max-w-4xl mx-auto">
            {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        </div>

        {/* Input Area */}
        <div className="p-6 bg-white border-t border-slate-200">
            <div className="max-w-4xl mx-auto relative flex items-end gap-2 p-2 bg-white border border-slate-300 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-400 transition-all">
                <textarea
                    className="w-full max-h-32 p-3 bg-transparent border-none resize-none focus:ring-0 text-slate-700 placeholder-slate-400 text-sm"
                    placeholder="请输入你的问题 (例如: '统计每个城市的销售总额' 或 '查询张三的记录')..."
                    rows={1}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isProcessing}
                />
                <button 
                    onClick={handleSendMessage}
                    disabled={isProcessing || !inputValue.trim()}
                    className="mb-2 mr-2 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                >
                    {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </button>
            </div>
            <div className="text-center mt-2">
                 <p className="text-xs text-slate-400">
                    基于 React Agent 的 SQL 生成系统。请核对查询结果。
                 </p>
            </div>
        </div>
      </div>

      <LogViewer isOpen={showLogViewer} onClose={() => setShowLogViewer(false)} />
    </div>
  );
};

export default App;
