
import React, { useRef } from 'react';
import { Settings, Database, FileSpreadsheet, Plus, Trash2, Key, Server, Cpu, ScrollText } from 'lucide-react';
import { AppSettings, TableSchema } from '../types';

interface SidebarProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  tables: TableSchema[];
  onFileUpload: (files: FileList) => void;
  onClearData: () => void;
  isLoadingFile: boolean;
  onOpenLogs: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  settings,
  onSettingsChange,
  tables,
  onFileUpload,
  onClearData,
  isLoadingFile,
  onOpenLogs
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    onSettingsChange({ ...settings, [name]: value });
  };

  return (
    <div className="w-80 h-full bg-slate-900 text-slate-100 flex flex-col border-r border-slate-700 shadow-xl">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 flex items-center gap-2">
        <Database className="w-6 h-6 text-blue-400" />
        <h1 className="text-xl font-bold tracking-tight">数据分析 Agent</h1>
      </div>

      {/* Settings Section */}
      <div className="p-4 space-y-4 border-b border-slate-700 bg-slate-800/50">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-400 mb-2">
          <Settings className="w-4 h-4" />
          <span>模型配置 (OpenAI 格式)</span>
        </div>
        
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 flex items-center gap-1">
              <Server className="w-3 h-3" /> Base URL (接口地址)
            </label>
            <input
              type="text"
              name="baseUrl"
              value={settings.baseUrl}
              onChange={handleInputChange}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 flex items-center gap-1">
              <Key className="w-3 h-3" /> API Key
            </label>
            <input
              type="password"
              name="apiKey"
              value={settings.apiKey}
              onChange={handleInputChange}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 flex items-center gap-1">
              <Cpu className="w-3 h-3" /> Model (模型名称)
            </label>
            <input
              type="text"
              name="model"
              value={settings.model}
              onChange={handleInputChange}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Tables Section */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-400">
            <FileSpreadsheet className="w-4 h-4" />
            <span>已加载数据表</span>
          </div>
          {tables.length > 0 && (
            <button 
              onClick={onClearData}
              className="p-1 hover:bg-red-900/30 text-slate-500 hover:text-red-400 rounded transition-colors"
              title="清空所有表格"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {tables.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm border-2 border-dashed border-slate-700 rounded-lg">
            <p>暂无数据</p>
            <p className="text-xs mt-1">请上传 Excel 文件开始分析</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tables.map((table) => (
              <div key={table.tableName} className="bg-slate-800 rounded-md p-3 text-xs border border-slate-700 shadow-sm">
                <div className="font-bold text-blue-300 mb-1 truncate" title={`原始文件名: ${table.originalName}`}>
                  {table.originalName || table.tableName}
                </div>
                <div className="text-[10px] text-slate-500 mb-1 truncate font-mono">
                   SQL_ID: {table.tableName}
                </div>
                <div className="text-slate-400 flex justify-between">
                  <span>{table.rowCount} 行</span>
                  <span>{table.columns.length} 列</span>
                </div>
                <div className="mt-2 text-slate-500 truncate" title={table.columns.join(', ')}>
                  {table.columns.slice(0, 3).join(', ')}...
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <div className="p-4 border-t border-slate-700 bg-slate-800 space-y-2">
        <button
            onClick={onOpenLogs}
            className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200 py-1.5 rounded-md text-xs font-medium transition-colors border border-slate-600"
        >
            <ScrollText className="w-3 h-3" /> 查看系统日志
        </button>

        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => e.target.files && onFileUpload(e.target.files)}
          multiple
          accept=".xlsx, .xls, .csv"
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoadingFile}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoadingFile ? (
            <span className="animate-pulse">数据处理中...</span>
          ) : (
            <>
              <Plus className="w-4 h-4" /> 上传 Excel 表格
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
