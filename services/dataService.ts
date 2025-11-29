
import * as XLSX from 'xlsx';
import alasql from 'alasql';
import { ProcessedFile, QueryResult, TableSchema } from '../types';
import { logger } from './logger';

// Initialize alasql
alasql.options.errorlog = false;

/**
 * Reads an Excel file and converts it to a JSON array.
 */
export const processExcelFile = async (file: File): Promise<ProcessedFile> => {
  logger.info('DataService', `开始处理文件: ${file.name}`, { size: file.size, type: file.type });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {  
      try {
        const data = e.target?.result;
        // Use ArrayBuffer for better unicode support (Chinese characters)
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0]; // Assume first sheet for simplicity
        const sheet = workbook.Sheets[sheetName];
        
        // Use raw: false to ensure dates/numbers are parsed as formatted strings
        const jsonData = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: "" });
        
        if (jsonData.length === 0) {
          throw new Error("Sheet is empty");
        }

        // Get original columns
        const originalColumns = Object.keys(jsonData[0] as object);

        // Sanitize Column Names: Strict Allow-list
        const columnMap: Record<string, string> = {};
        const cleanColumns = originalColumns.map(col => {
          let clean = col.trim();
          // Replace non-allowed characters with underscore
          clean = clean.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_]/g, "_");
          // Remove leading/trailing underscores
          clean = clean.replace(/^_+|_+$/g, "");
          if (!clean) clean = `col_${Math.random().toString(36).substr(2, 5)}`;
          
          columnMap[col] = clean;
          return clean;
        });

        // Rebuild data with clean keys
        const cleanData = jsonData.map((row: any) => {
          const newRow: any = {};
          originalColumns.forEach((oldCol, idx) => {
            const newCol = cleanColumns[idx];
            let val = row[oldCol];
            if (val === null || val === undefined) val = "";
            newRow[newCol] = String(val).trim(); 
          });
          return newRow;
        });

        // --- FIX: Generate a Safe SQL Table Name ---
        const rawName = file.name.replace(/\.[^\/.]+$/, ""); // Remove extension
        const safeId = Math.random().toString(36).substring(2, 8);
        const timestamp = Date.now().toString().substring(8); // Last few digits
        const tableName = `t_${timestamp}_${safeId}`; 
        
        logger.info('DataService', `文件解析成功`, { 
          originalName: rawName, 
          sqlTableName: tableName,
          rowCount: cleanData.length,
          columns: cleanColumns 
        });

        resolve({
          name: tableName,
          originalName: rawName,
          data: cleanData,
          columns: cleanColumns
        });
      } catch (err: any) {
        logger.error('DataService', `文件解析失败: ${file.name}`, { error: err.message });
        reject(err);
      }
    };
    reader.onerror = (err) => {
        logger.error('DataService', `FileReader Error`, err);
        reject(err);
    };
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Registers data into Alasql as a table.
 */
export const registerTable = (table: ProcessedFile) => {
  logger.info('DataService', `注册 SQL 表: [${table.name}]`);
  // Drop if exists
  try {
    alasql(`DROP TABLE IF EXISTS [${table.name}]`);
  } catch (e) {
    console.warn("Table did not exist, skipping drop");
  }

  // Create table using the SAFE name
  alasql(`CREATE TABLE [${table.name}]`);
  alasql(`SELECT * INTO [${table.name}] FROM ?`, [table.data]);
};

/**
 * Executes a SQL query against the in-memory Alasql database.
 */
export const executeSql = (sql: string): QueryResult => {
  logger.info('SQL', `Executing Query`, { sql });
  try {
    const result = alasql(sql);
    
    // Safety check: Alasql should return something
    if (result === undefined || result === null) {
         logger.warn('SQL', `Query returned undefined`, { sql });
         return { columns: [], data: [], error: "SQL query returned no result (undefined). The table might not exist or the query format is invalid." };
    }

    if (Array.isArray(result)) {
      logger.info('SQL', `Query Execution Success`, { rowCount: result.length });
      if (result.length === 0) {
        return { columns: [], data: [] };
      }

      if (typeof result[0] === 'object' && result[0] !== null) {
          const rawCols = Object.keys(result[0]);
          const columns = rawCols.filter(k => k !== 'undefined' && k !== '' && !k.startsWith('_'));
          
          const cleanData = result.map(row => {
              const newRow: any = {};
              columns.forEach(col => {
                  newRow[col] = row[col];
              });
              return newRow;
          });

          return { columns, data: cleanData };
      } else {
          return { columns: ['Value'], data: result.map(v => ({ Value: v })) };
      }
    } else {
        // Non-array result (e.g. from CREATE/DROP or aggregated scalar if Alasql behaves weirdly)
        logger.info('SQL', `Query returned object/scalar`, { result });
        if (typeof result === 'object') {
             const keys = Object.keys(result).filter(k => !k.startsWith('_'));
             if (keys.length > 0) {
                 return { columns: keys, data: [result] };
             }
        }
        return { columns: ['Result'], data: [{ Result: result }] };
    }
  } catch (error: any) {
    logger.error('SQL', `Execution Error`, { error: error.message, sql });
    return { columns: [], data: [], error: error.message || "Unknown SQL Error" };
  }
};

export const getDatabaseSchema = (tables: ProcessedFile[]): TableSchema[] => {
  return tables.map(t => ({
    tableName: t.name,
    originalName: t.originalName, // Pass original name for context
    columns: t.columns,
    rowCount: t.data.length,
    samples: t.data.slice(0, 3) 
  }));
};
