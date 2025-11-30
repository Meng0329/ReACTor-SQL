
import OpenAI from 'openai';
import { AppSettings, TableSchema, AgentStep } from '../types';
import { executeSql } from './dataService';
import { logger } from './logger';

// ... (Existing Tools Definition unchanged) ...
const TOOLS = [
  {
    type: 'function', 
    function: {
      name: 'get_database_schema',
      description: '获取数据库中所有表的名称、列名。在开始查询前必须调用。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_sql',
      description: '执行 SQL 查询。使用 SQLite/Alasql 语法。支持 JOIN、GROUP BY、ORDER BY、UNION ALL 等。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '需要执行的 SQL 语句。',
          },
        },
        required: ['query'],
      },
    },
  },
] as const;

// ... (detectManualToolCall unchanged) ...
const detectManualToolCall = (content: string): any | null => {
  const sqlMatchDouble = content.match(new RegExp('run_sql\\s*\\(\\s*["\'](.+?)["\']\\s*\\)', 's'));
  const backtickPattern = new RegExp("run_sql\\s*\\(\\s*`(.+?)`\\s*\\)", "s");
  const sqlMatchBacktick = content.match(backtickPattern);

  const sqlMatch = sqlMatchDouble || sqlMatchBacktick;

  if (sqlMatch) {
    return {
      id: `manual-sql-${Date.now()}`,
      type: 'function',
      function: {
        name: 'run_sql',
        arguments: JSON.stringify({ query: sqlMatch[1] })
      }
    };
  }

  if (content.includes('get_database_schema') && (content.includes('()') || content.toLowerCase().includes('call'))) {
    return {
      id: `manual-schema-${Date.now()}`,
      type: 'function',
      function: {
        name: 'get_database_schema',
        arguments: '{}'
      }
    };
  }

  return null;
};

const sanitizeSql = (sql: string): string => {
  if (!sql) return sql;
  let aliasIndex = 1;
  const aliasPattern = /\bAS\s+(\[[^\]]+\]|[^\s,\)\]]+)/gi;
  let sanitized = sql.replace(aliasPattern, (match, alias) => {
    const raw = String(alias);
    const trimmed = raw.trim().replace(/^["']|["']$/g, "");
    if (!trimmed) return match;
    if (/^\[[^\]]+\]$/.test(trimmed)) return match;
    const inner = trimmed.replace(/^\[|\]$/g, "");
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(inner)) {
      return match.replace(alias, inner);
    }
    if (/[\u4e00-\u9fa5]/.test(inner)) {
      return match.replace(alias, `[${inner}]`);
    }
    const safeAlias = `col_${aliasIndex++}`;
    return match.replace(alias, safeAlias);
  });

  const wrapChineseIdentifierInOrderGroup = (input: string, clause: 'ORDER BY' | 'GROUP BY'): string => {
    const regex = clause === 'ORDER BY'
      ? /\bORDER\s+BY\s+([^;]+)/gi
      : /\bGROUP\s+BY\s+([^;]+)/gi;

    return input.replace(regex, (full, body) => {
      const updated = body.replace(/([^\s,]+)(\s+(ASC|DESC))?/gi, (segment, ident, orderPart) => {
        const idTrim = String(ident).trim();
        if (!idTrim) return segment;
        if (/^\[[^\]]+\]$/.test(idTrim)) return segment;
        if (/[\u4e00-\u9fa5]/.test(idTrim) && /^[\u4e00-\u9fa5A-Za-z0-9_]+$/.test(idTrim)) {
          const wrapped = `[${idTrim}]`;
          return wrapped + (orderPart || '');
        }
        return segment;
      });

      return `${clause} ${updated}`;
    });
  };

  sanitized = wrapChineseIdentifierInOrderGroup(sanitized, 'ORDER BY');
  sanitized = wrapChineseIdentifierInOrderGroup(sanitized, 'GROUP BY');

  return sanitized;
};

/**
 * 基于加权复杂度模型计算自适应批次大小。
 *
 * 数学模型：
 *  总复杂度 C = w_f × C_f + w_l × C_l + w_t × C_t ∈ [0, 1]
 *  其中：
 *    C_f = min(F / F_norm, 1)         字段复杂度（F为字段数量）
 *    C_l = min(L / L_norm, 1)         长度复杂度（L为平均行长）
 *    C_t = α × R_text + β × R_long    类型复杂度（R_text为文本比例，R_long为长文本比例）
 *
 *  批次大小：B = B_max - (B_max - B_min) × C
 */
const calculateAdaptiveBatchSize = (data: any[]): number => {
  if (!data || data.length === 0) return 10;

  const sampleCount = Math.min(data.length, 20);
  let totalFields = 0;
  let totalRowChars = 0;
  let totalCells = 0;
  let textCells = 0;
  let longTextCells = 0;

  for (let i = 0; i < sampleCount; i++) {
    const row = data[i];
    if (!row || typeof row !== 'object') continue;

    const keys = Object.keys(row);
    const fieldCount = keys.length || 0;
    totalFields += fieldCount;

    let rowStr = '';
    try {
      rowStr = JSON.stringify(row);
    } catch {
      rowStr = keys.map(k => String((row as any)[k] ?? '')).join(' ');
    }
    totalRowChars += rowStr.length;

    for (const key of keys) {
      const value = (row as any)[key];
      if (value === null || value === undefined) continue;
      totalCells++;
      if (typeof value === 'string') {
        textCells++;
        if (value.length >= 256) {
          longTextCells++;
        }
      }
    }
  }

  if (sampleCount === 0) return 10;

  const avgFields = totalFields / sampleCount;
  const avgRowLen = totalRowChars / sampleCount;

  // 归一化常数
  const F_NORM = 40;   // 40 列以上认为字段复杂度接近上限
  const L_NORM = 4000; // 单行 4000 字符以上认为长度复杂度接近上限

  const Cf = Math.min(avgFields / F_NORM, 1);
  const Cl = Math.min(avgRowLen / L_NORM, 1);

  const R_text = totalCells > 0 ? textCells / totalCells : 0;
  const R_long = totalCells > 0 ? longTextCells / totalCells : 0;

  const ALPHA = 0.5;
  const BETA = 0.5;
  const Ct = ALPHA * R_text + BETA * R_long;

  const W_F = 0.4;
  const W_L = 0.3;
  const W_T = 0.3;
  const C = Math.min(Math.max(W_F * Cf + W_L * Cl + W_T * Ct, 0), 1);

  const B_MIN = 5;
  const B_MAX = 100;
  const B = B_MAX - (B_MAX - B_MIN) * C;

  const batchSize = Math.floor(B);
  return Math.max(B_MIN, Math.min(batchSize, B_MAX));
};

/**
 * Smart Iterative Compression using LLM (Serial Accumulator Pattern)
 */
const smartCompressData = async (
  data: any[],
  question: string,
  sql: string,
  openai: OpenAI,
  model: string,
  onProgress?: (msg: string) => void
): Promise<string> => {
  if (!data || data.length === 0) return "[]";

  logger.info("Compression", "Starting smart compression", { totalRows: data.length });

  // 自适应批次大小（基于加权复杂度模型）
  const BATCH_SIZE = calculateAdaptiveBatchSize(data);
  
  const batches: any[][] = [];
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    batches.push(data.slice(i, i + BATCH_SIZE));
  }

  let accumulatedResult = "";

  // Serial processing loop
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    
    if (onProgress) {
      onProgress(`正在进行智能迭代压缩... (第 ${i + 1}/${batches.length} 轮, 每轮 ${BATCH_SIZE} 行) \n处理模式: 提取/计算并合并...`);
    }

    const batchJson = JSON.stringify(batch);
    
    const prompt = `
你是一个智能数据分析师与数据压缩引擎。
你的任务是处理分批到达的数据库查询结果，根据用户问题，**提取核心数据**并**计算业务洞察**。

**任务上下文**:
- 用户问题: "${question}"
- 当前执行SQL: "${sql}"
- 之前的累积结果 (Previous Context):
"""
${accumulatedResult || "(暂无，这是第一批数据)"}
"""

**当前新数据批次 (New Data Batch)**:
"""
${batchJson}
"""

**处理指令 (Instructions)**:
请根据用户问题判断执行模式，并输出更新后的**完整累积结果**：

模式 A: **提取与明细 (Detail Extraction)** 
- 场景：用户查询列表、记录详情或寻找特定行。
- 行动：从新批次中提取关键字段 (格式: "字段:值")，追加到结果中。
- 要求：保留回答问题所需的全部上下文，对长文本进行摘要。

模式 B: **计算与洞察 (Calculation & Insight)**
- 场景：用户查询统计数据（总和、平均、趋势、极值）。
- 行动：
  1. **聚合更新**: 利用新数据更新统计值 (如: 累加 Sum, 更新 Max/Min)。
  2. **洞察发现**: 关注数据中的异常值、显著趋势或分布特征。
- 示例：若之前 Sum=100，新批次 Sum=50，输出 Sum=150。同时标记 "发现单笔最大金额为 X"。

**输出要求**:
1. 请直接输出更新后的**最终纯文本**。
2. 必须使用清晰的格式（推荐 "字段名：值"）。
3. 必须包含数据背后的业务含义（如：不仅仅列出数字，还要通过上下文保留数据的定性描述）。
4. 请仅输出文本内容（Plain Text）。
`;
    
    logger.info("Compression", `Batch ${i+1}/${batches.length} Request`, { promptLength: prompt.length });

    try {
      const response = await openai.chat.completions.create({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1, 
      });
      
      const newContent = response.choices[0].message.content?.trim() || "";
      logger.info("Compression", `Batch ${i+1}/${batches.length} Response`, { contentLength: newContent.length, content: newContent });
      accumulatedResult = newContent;

    } catch (e: any) {
      logger.error("Compression", `Batch ${i+1} Failed`, { error: e.message });
      accumulatedResult += `\n[Batch ${i} Raw]: ${JSON.stringify(batch)}`;
    }
  }

  return accumulatedResult;
};

/**
 * Main Agent Loop
 */
export const runAgent = async (
  question: string,
  schema: TableSchema[],
  settings: AppSettings,
  onStepUpdate: (steps: AgentStep[]) => void,
  onFinalAnswer: (answer: string) => void
) => {
  if (!settings.apiKey) throw new Error("API Key 未配置");

  logger.info("Agent", "New Agent Session Started", { question, model: settings.model });

  const openai = new OpenAI({
    apiKey: settings.apiKey,
    baseURL: settings.baseUrl,
    dangerouslyAllowBrowser: true,
  });

  const steps: AgentStep[] = [];
  const MAX_ITERATIONS = 50;
  
  // Optimized System Prompt
  const systemPrompt = `
# Role & Objective
你是一位**专家级数据分析 ReAct Agent**，精通 SQL 生成与业务洞察 。你的目标是通过执行工具、编写精准的 SQL 代码，并分析结果来回答用户的业务问题。

# Context & Environment
1. **表结构特征**: 
   - 表名采用系统生成的唯一**SQL_ID**（如 \`t_12345\`）。
   - 必须通过 \`get_database_schema\` 返回的 **Source (Original File)** 字段，将业务概念（如“2020年表”）映射到 **SQL_ID**。
   - **严禁**直接使用文件名作为表名，查询必须使用 \`SELECT ... FROM [t_12345]\`。
   - 列名中的空格/特殊字符已替换为下划线 \`_\`。
   - 所有数值字段在数据库中存储为**字符串**类型，计算时可能需要转换。
2. **核心职责**:
   - **Knowledge Discovery**: 理解全量 Schema，识别分表模式（如按年份分表），并根据 \`Source\` 字段关联业务含义。
   - **Text-to-Code**: 将自然语言转换为方言兼容的 SQL。
   - **Insights**: 不仅仅展示数据，必须结合上下文提供业务结论。

# Few-Shot Examples (Strictly Follow These Patterns)

**User**: "查看2020年和2021年北京地区的直接经济损失总额"
**Thought**: 
1. 观察 Schema，发现 \`t_89ab\` 对应 \`2020.xlsx\`，\`t_cdef\` 对应 \`2021.xlsx\`。
2. 关键词"北京"需要模糊匹配 \`LIKE '%北京%'\`。
3. 必须使用 \`UNION ALL\` 合并这两张表。
4. "经济损失"映射为 \`[直接经济损失]\`。
**SQL**:
\`\`\`sql
SELECT SUM(CAST([直接经济损失] AS DECIMAL)) as 总损失 
FROM (
    SELECT [直接经济损失] FROM t_89ab WHERE [地区] LIKE '%北京%'
    UNION ALL
    SELECT [直接经济损失] FROM t_cdef WHERE [地区] LIKE '%北京%'
) as combined_table
\`\`\`

**User**: "分析台风事件造成的受灾人口占比"
**Thought**: 
1. "占比"意味着需要计算（部分/整体）。
2. "台风"是事件类型，需要筛选 \`[事件类型] = '台风'\`。
**SQL**:
\`\`\`sql
SELECT 
    (SELECT SUM(CAST([受灾人口] AS DECIMAL)) FROM t_events WHERE [事件类型] = '台风') * 100.0 / 
    (SELECT SUM(CAST([受灾人口] AS DECIMAL)) FROM t_events) as 占比百分比
\`\`\`

# SQL Generation Standards (Reasoning & Acting) 

在生成 SQL 之前，必须执行以下 ReAct 思考流程：

1. **Schema Check (Knowledge Discovery)**:
   - 必须优先调用 \`get_database_schema\`。
   - **语义映射**: 注意表名是随机 ID（如 \`t_a1b2\`）。你必须读取 **Source** 描述来确认这张表是 "2020数据" 还是 "天气数据"。
   - **分表识别**: 如果多个表的 Source 只有年份不同（如 Source: 2020.xlsx, Source: 2021.xlsx），**必须使用 \`UNION ALL\` 穷尽所有相关表**。

2. **SQL Syntax Rules (Text-to-Code)**:
   - **表名引用**: FROM 子句必须使用 **SQL_ID**（如 \`t_a1b2\`），**绝对禁止**使用中文文件名。
   - **列名保护**: 所有列名**必须**使用方括号 \`[]\` 包裹（例如 \`SELECT [上报单位]\`）。
   - **模糊搜索**: 所有查询条件列名**必须**使用 \`LIKE '%关键词%'\`（例如 "北京" -> \`LIKE '%北京%'\`）。
   - **数据类型**: 由于所有值为字符串，进行聚合计算（SUM/AVG）或排序时，**必须显式 CAST 为数值类型** (e.g. \`CAST([col] AS DECIMAL)\`)。
   - **列别名规范**: 使用 \`AS\` 为结果列起别名时，**只能使用英文字母、数字和下划线**（如 \`AS total_count\`），**禁止使用中文或包含空格的别名**，否则 SQL 可能解析失败。

3. **Analysis & Insight (Final Output)**:
   - 如果查询结果为空，请执行**局部验证**（移除 WHERE 条件）以诊断是数据缺失还是匹配条件过严。
   - 回答必须包含：直接答案（数字/列表）、趋势分析（基于数据的推断）和异常发现（如果有）。

# Execution Workflow
User Input -> Thought (Schema Map & Strategy) -> Action (SQL Generation) -> Observation (Data) -> Final Answer (Business Insight).

Current Date: ${new Date().toLocaleDateString('zh-CN')}
`;

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question },
  ];

  let iteration = 0;

  const pushStep = (step: AgentStep) => {
    steps.push(step);
    onStepUpdate([...steps]);
  };

  const updateLastStep = (content: string, status: 'streaming' | 'complete' = 'streaming') => {
    if (steps.length === 0) return;
    const last = steps[steps.length - 1];
    last.content = content;
    last.status = status;
    onStepUpdate([...steps]);
  };

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    logger.info("Agent", `Starting Iteration ${iteration}`);
    console.log(`--- Agent Iteration ${iteration} ---`);

    const currentStepId = `step-${Date.now()}`;
    pushStep({
      id: currentStepId,
      type: 'thought',
      content: '',
      status: 'streaming',
    });

    let currentThought = '';
    let toolCallsBuffer: any[] = [];

    try {
      const stream = await openai.chat.completions.create({
        model: settings.model,
        messages: messages,
        tools: TOOLS as any,
        tool_choice: 'auto',
        stream: true,
        temperature: 0.1,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0].delta;

        if (delta.content) {
          let cleanContent = delta.content.replace(/<\/tool_call>/g, '');
          currentThought += cleanContent;
          updateLastStep(currentThought, 'streaming');
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index;
            if (!toolCallsBuffer[index]) {
              toolCallsBuffer[index] = { id: tc.id, function: { name: "", arguments: "" }, type: 'function' };
            }
            if (tc.id) toolCallsBuffer[index].id = tc.id;
            if (tc.function?.name) toolCallsBuffer[index].function.name += tc.function.name;
            if (tc.function?.arguments) toolCallsBuffer[index].function.arguments += tc.function.arguments;
          }
        }
      }

      updateLastStep(currentThought, 'complete');
      logger.info("Agent", `Iteration ${iteration} Thought`, { thought: currentThought });

      if (toolCallsBuffer.length === 0) {
        const manualCall = detectManualToolCall(currentThought);
        if (manualCall) {
          console.warn("Detected manual tool call in text, rescuing...", manualCall);
          logger.warn("Agent", "Detected manual tool call in text", manualCall);
          toolCallsBuffer.push(manualCall);
        }
      }

      if (toolCallsBuffer.length > 0) {
        messages.push({
          role: 'assistant',
          content: null, 
          tool_calls: toolCallsBuffer,
        });

        for (const toolCall of toolCallsBuffer) {
          const fnName = toolCall.function.name;
          let fnArgs: any = {};
          
          const actionStepId = `action-${Date.now()}`;
          pushStep({
            id: actionStepId,
            type: 'action',
            content: 'parsing...',
            toolName: fnName,
            status: 'streaming'
          });

          let resultString = '';
          let resultData: any = null;

          try {
             fnArgs = JSON.parse(toolCall.function.arguments || '{}');
             steps[steps.length - 1].content = JSON.stringify(fnArgs);
             steps[steps.length - 1].status = 'complete';
             onStepUpdate([...steps]);
             logger.info("Tool", `Invoking Tool: ${fnName}`, fnArgs);
          } catch (e: any) {
             const errorMsg = "Error: Invalid JSON arguments provided for tool call.";
             resultString = errorMsg;
             steps[steps.length - 1].content = `Error parsing: ${toolCall.function.arguments}`;
             steps[steps.length - 1].status = 'error';
             onStepUpdate([...steps]);
             logger.error("Tool", `JSON Parse Error for ${fnName}`, { args: toolCall.function.arguments });
          }

          if (!resultString) {
              if (fnName === 'get_database_schema') {
                 // --- FIX: Provide Semantic Mapping to Agent ---
                 const schemaStr = schema.map(t => {
                    const sourceInfo = t.originalName ? `(Source_File: ${t.originalName})` : '';
                    return `[Table_SQL_ID: ${t.tableName} ${sourceInfo}, Rows: ${t.rowCount}] Columns: ${t.columns.join(", ")}`;
                 }).join("\n");
                 
                 resultString = schemaStr || "数据库为空。请提示用户先上传 Excel 文件。";
                 resultData = schema;
              } else if (fnName === 'run_sql') {
                const sql = sanitizeSql(fnArgs.query);
                const queryResult = executeSql(sql);
                 
                 if (queryResult.error) {
                   resultString = `SQL 执行错误: ${queryResult.error}`;
                   logger.warn("Tool", "SQL Error", { error: queryResult.error });
                 } else {
                   const rowCount = queryResult.data.length;
                   logger.info("Tool", "SQL Success", { rowCount });
                   
                   if (rowCount === 0) {
                     resultString = `查询结果: [] (0 行)。
⚠️ **结果为空！**
1. 请检查你的 WHERE 条件是否太严格。尝试把 AND 换成 OR。
2. 请确认你使用了 LIKE '%...%' 而不是 =。
3. 请尝试执行局部验证查询 (Partial Verification) 来检查数据是否存在。`;
                   } else {
                     try {

                         const estimatedBatchSize = calculateAdaptiveBatchSize(queryResult.data);

                         pushStep({
                            id: `compress-${Date.now()}`,
                            type: 'thought',
                            content: `正在对 ${rowCount} 行数据进行智能迭代压缩与分析...\n目标: 提取核心数据并生成业务洞察。\n预计每轮处理 ${estimatedBatchSize} 行。`,
                            status: 'streaming'
                         });

                         const compressedText = await smartCompressData(
                             queryResult.data, 
                             question, 
                             sql, 
                             openai, 
                             settings.model,
                             (progressMsg) => {
                                 const lastStep = steps[steps.length - 1];
                                 if (lastStep.type === 'thought' && lastStep.id.startsWith('compress')) {
                                     lastStep.content = progressMsg;
                                     onStepUpdate([...steps]);
                                 }
                             }
                         );

                         steps[steps.length - 1].status = 'complete';
                         onStepUpdate([...steps]);
                         
                         logger.info("Compression", "Compression Complete", { length: compressedText.length });

                         resultString = `查询结果 (已分析与压缩):\n${compressedText}`;
                     } catch (err: any) {
                         console.error("Compression failed, falling back to raw", err);
                         logger.error("Compression", "Compression Failed", { error: err.message });
                         const limitedData = queryResult.data.slice(0, 50);
                         resultString = `查询结果 (压缩失败，展示前50行):\n${JSON.stringify(limitedData)}`;
                     }
                   }
                 }
                 resultData = queryResult;
              } else {
                 resultString = "错误: 未知工具调用";
                 logger.error("Tool", "Unknown tool called", { fnName });
              }
          }

          pushStep({
            id: `obs-${Date.now()}`,
            type: 'observation',
            content: resultString, 
            result: resultData,    
            status: 'complete'
          });

          messages.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            name: fnName,
            content: resultString,
          });
        }
      } else {
        if (currentThought) {
            onFinalAnswer(currentThought);
            messages.push({ role: 'assistant', content: currentThought });
            logger.info("Agent", "Final Answer", { content: currentThought });
        }
        break;
      }

    } catch (error: any) {
      console.error("Agent Error:", error);
      logger.error("Agent", "Agent Execution Loop Error", { error: error.message });
      pushStep({
        id: `err-${Date.now()}`,
        type: 'thought',
        content: `Agent Error: ${error.message}`,
        status: 'error'
      });
      break; 
    }
  }
};
