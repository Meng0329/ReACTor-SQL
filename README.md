# ReACTor-SQL

ReACTor-SQL 是一个基于人工智能的数据代理应用，允许用户通过自然语言查询数据库并获得结构化结果。该项目使用 React 和 TypeScript 构建，集成了大型语言模型（LLM）来理解和转换自然语言为 SQL 查询。

## 演示视频

为了更好地展示 ReACTor-SQL 的功能，我们提供了一个演示视频。该视频展示了如何使用自然语言查询数据库并获取结果的完整流程。

[点击这里下载演示视频](https://github.com/Meng0329/ReACTor-SQL/raw/main/Video%20Project.mp4)

> **注意**：点击上面的链接可以直接下载视频文件，您可以在本地播放器中观看。

## 功能特点

- 自然语言转 SQL 查询
- 本地 SQL 执行引擎
- 友好的聊天界面交互
- 实时查询结果展示
- 日志查看功能

## 运行环境要求

- Node.js >= 16.x
- npm >= 8.x
- Node.js >= 16.x
- npm >= 8.x

## 安装步骤

1. 克隆项目代码：
   ```bash
   git clone https://github.com/Meng0329/ReACTor-SQL.git
   cd dataagent-sql-react
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. （可选）配置环境变量：
   用户可以在网页界面上直接配置 base_url、api-key 和 model 参数，无需预先配置环境变量。

## 基本使用方法

1. 启动开发服务器：
   ```bash
   npm run dev
   ```

2. 在浏览器中打开 `http://localhost:5173`

3. 在聊天界面中输入自然语言查询，例如："显示用户表中的所有数据"

4. 系统将自动生成 SQL 查询并在本地执行，返回结果

## 项目结构

```
├── components/           # UI 组件
│   ├── ChatMessage.tsx  # 聊天消息组件
│   ├── LogViewer.tsx    # 日志查看器组件
│   └── Sidebar.tsx      # 侧边栏组件
├── services/            # 业务逻辑
│   ├── dataService.ts   # 数据处理服务
│   ├── llmService.ts    # LLM 服务
│   └── logger.ts        # 日志服务
├── App.tsx              # 主应用组件
├── index.html           # HTML 模板
└── index.tsx            # 应用入口文件
```

## 技术栈

- React 19 + TypeScript
- Vite 构建工具
- alasql (本地 SQL 处理)
- lucide-react (图标库)
- xlsx (Excel 解析)

## 注意事项

1. 本项目仅在本地环境中执行 SQL 查询，不会连接到外部数据库
2. 为保证安全性，请勿在生产环境中使用此应用处理敏感数据
3. 用户可以在网页界面上直接配置 LLM 服务参数（base_url、api-key 和 model）
4. 项目使用 alasql 在浏览器中执行 SQL，功能有限，不支持复杂查询

## 开发命令

- `npm run dev` - 启动开发服务器
- `npm run build` - 构建生产版本
- `npm run preview` - 预览构建结果

## 许可证

本项目仅供学习和研究使用。