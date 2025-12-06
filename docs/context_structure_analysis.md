# 上下文存储结构分析报告

本文档详细分析了 Claude Code (`.claude`) 和 Codex CLI (`.codex`) 在本地文件系统中存储上下文和历史记录的方式。同时也简要说明了 Gemini CLI (`.gemini`) 的情况。

## 1. Claude Code (`.claude`)

Claude Code 将上下文信息存储在用户主目录下的 `.claude` 文件夹中。其结构设计以“项目”为核心，同时保留全局的历史记录。

### 1.1 目录结构概览

```
~/.claude/
├── history.jsonl           # 全局命令历史索引
├── projects/               # 项目级上下文存储
│   └── <encoded-path>/     # 针对特定项目的文件夹
│       └── <uuid>.jsonl    # 具体会话的详细记录
├── session-env/            # 会话环境信息（可能包含环境变量等）
├── file-history/           # 文件修改历史
└── ...
```

### 1.2 关键文件分析

#### `history.jsonl` (全局历史索引)
该文件记录了用户执行的每一个顶层交互的摘要。每一行是一个 JSON 对象。

**示例字段：**
- `display`: 显示给用户的文本（通常是命令输出或摘要）。
- `pastedContents`: 粘贴内容的元数据。
- `timestamp`: Unix 时间戳（毫秒）。
- `project`: 项目的绝对路径（例如 `/home/david/work/agent-studio`）。
- `sessionId`: 关联的会话 UUID。

#### `projects/` 目录
这是上下文存储的核心。目录名通常是项目绝对路径的编码形式（将 `/` 替换为 `-`）。
例如：`/home/david/work/agent-studio` -> `-home-david-work-agent-studio`

在项目目录下，包含以 `sessionId` 命名的 `.jsonl` 文件（例如 `daa97b59-....jsonl`）。这些文件包含完整的会话上下文。

**项目会话文件 (`<uuid>.jsonl`) 格式：**
每一行代表会话中的一个事件，类型丰富：
- **User Message**: 用户的输入。
  ```json
  {
    "type": "user",
    "message": { "role": "user", "content": "..." },
    "timestamp": "...",
    "uuid": "..."
  }
  ```
- **File Snapshot**: 文件内容快照，用于追踪上下文中的文件状态。
  ```json
  {
    "type": "file-history-snapshot",
    "snapshot": { ... }
  }
  ```
- **Assistant Response**: 模型回复、工具调用等（通常包含思维链 `thinkingMetadata` 和工具执行结果）。

### 1.3 总结
Claude Code 的上下文强关联于**项目路径**。它能够回溯特定项目下的特定会话，并且保存了非常详细的交互细节（包括文件快照），这使得它能够很好地恢复工作环境。

---

## 2. Codex CLI (`.codex`)

Codex CLI (`.codex`) 的存储结构更侧重于**时间维度**的会话记录。

### 2.1 目录结构概览

```
~/.codex/
├── history.jsonl           # 全局简要历史
├── sessions/               # 会话详细记录
│   └── <YYYY>/
│       └── <MM>/
│           └── <DD>/
│               └── rollout-<TIMESTAMP>-<UUID>.jsonl
└── config.toml             # 配置文件
```

### 2.2 关键文件分析

#### `history.jsonl`
记录简单的输入历史，用于 CLI 的上下键查找或历史回顾。
**格式：**
```json
{
  "session_id": "uuid",
  "ts": 1765027962,
  "text": "用户输入的命令或问题"
}
```

#### `sessions/` 目录
Codex 按 **年/月/日** 的层级结构组织会话文件。文件名格式为 `rollout-<ISO8601时间>-<UUID>.jsonl`。

**会话文件格式：**
也是 JSONL 格式，记录了会话的元数据和交互流。
- **Session Meta**: 会话开始时的环境信息（CWD, CLI 版本, 模型提供商等）。
  ```json
  {
    "type": "session_meta",
    "payload": { "cwd": "/home/david/work", ... }
  }
  ```
- **Response Item**: 包含用户输入 (`input_text`) 和模型响应。
  ```json
  {
    "type": "response_item",
    "payload": {
      "type": "message",
      "role": "user",
      "content": [ { "type": "input_text", "text": "..." } ]
    }
  }
  ```

### 2.3 总结
Codex 的上下文组织以**时间**为首要索引，其次通过元数据关联到工作目录 (`cwd`)。它的结构清晰地反映了“每日工作日志”的形态。

---

## 3. Gemini CLI (`.gemini`)

目前的分析显示，`~/.gemini` 目录主要用于存储配置和状态信息，尚未发现类似 Claude 或 Codex 的本地详细会话历史记录文件。

**目录内容：**
- `state.json`: 状态信息（如 Banner 显示次数）。
- `settings.json`, `oauth_creds.json`: 配置与认证。
- `tmp/`: 临时文件。

*注：Gemini CLI 可能依赖云端历史记录，或者其本地存储机制与前两者有较大差异，当前路径下未发现显式的上下文日志。*

---

## 4. 对比与转换思路

### 共同点
1.  **JSONL 格式**: Claude 和 Codex 都使用 JSON Lines 格式存储详细会话，利于流式读写和解析。
2.  **UUID 标识**: 都使用 UUID 来唯一标识会话。
3.  **元数据包含路径**: 都记录了会话发生的工作目录（CWD/Project）。

### 差异点
1.  **索引方式**:
    - Claude: **项目路径** -> 会话文件。
    - Codex: **日期** -> 会话文件 (内部包含路径信息)。
2.  **内容粒度**:
    - Claude 似乎保存了更多的上下文快照（如 `file-history-snapshot`），更强调“恢复工作状态”。
    - Codex 更像是一个标准的交互日志。

### 转换策略建议 (Context Resume)
要实现“复制上下文并恢复工作”，核心任务是将源工具的**最近一次相关会话**提取出来，并转换为目标工具能理解的格式（或提示词）。

1.  **提取**:
    - 对于 Claude: 根据当前目录，在 `~/.claude/projects/` 下找到对应文件夹，读取最新的 `.jsonl`。
    - 对于 Codex: 遍历 `~/.codex/sessions/` (从最新日期开始)，过滤出 `payload.cwd` 匹配当前目录的最新会话。
2.  **转换**:
    - 提取会话中的 User Query 和 Assistant Reply。
    - 忽略工具特定的元数据（如具体的快照 ID），保留纯文本交互历史。
3.  **注入**:
    - 由于直接修改目标工具的二进制历史文件可能复杂且易碎，建议将提取的上下文整理为一个**Summary**或**Context Prompt**，作为新会话的输入提供给目标工具。
