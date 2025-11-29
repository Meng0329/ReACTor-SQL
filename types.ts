
export interface TableSchema {
  tableName: string;     // The safe SQL identifier (e.g., t_12345)
  originalName?: string; // The original human-readable name (e.g., 2025 Data)
  columns: string[];
  rowCount: number;
  samples?: any[]; 
}

export interface QueryResult {
  columns: string[];
  data: any[];
  error?: string;
}

// --- Agent Types ---

export type StepType = 'thought' | 'action' | 'observation' | 'final';

export interface AgentStep {
  id: string;
  type: StepType;
  content: string; // The text content, SQL, or JSON of tool args
  status?: 'streaming' | 'complete' | 'error';
  toolName?: string; // If type is action
  result?: any; // If type is observation (the data)
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content?: string; // The final display message
  steps?: AgentStep[]; // The history of the agent's reasoning
  timestamp: number;
  isStreaming?: boolean;
}

export interface AppSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ProcessedFile {
  name: string;         // The safe SQL identifier
  originalName: string; // The original filename
  data: any[];
  columns: string[];
}
