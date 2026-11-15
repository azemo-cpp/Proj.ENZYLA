---
# Context Saver User Manual | 使用手册

## Quick Start | 快速开始

### Installation | 安装

```bash
# From PyPI (coming soon)
pip install context-saver

# From source | 从源码
git clone https://github.com/lcq225/context-saver.git
cd context-saver
pip install -e .
```

### Basic Usage | 基础用法

```python
from context_saver import AutoContextFlush, OperationTracker, CompressionGuard

# 1. Initialize components | 初始化组件
flusher = AutoContextFlush(save_dir="./context_history", max_snapshots=30)
tracker = OperationTracker(log_file="./operations.jsonl")
guard = CompressionGuard(context_file="./context.md", threshold_minutes=30)

# 2. Save session | 保存会话
flusher.save_session(
    session_id="session_001",
    todos=["Task 1", "Task 2"],
    decisions=["Decision 1"],
    recent_requests=["Request 1"]
)

# 3. Track operation | 跟踪操作
tracker.track(
    op_type="config_change",
    description="Updated threshold",
    details={"old": 100, "new": 200}
)

# 4. Check before compression | 压缩前检查
if guard.should_save():
    guard.force_save(flusher)
# Now safe to compress | 现在可以安全压缩
```

---

## API Reference | API 参考

### AutoContextFlush | 自动上下文刷新

#### Constructor | 构造函数

```python
AutoContextFlush(
    save_dir: str,           # Directory to save snapshots | 保存快照的目录
    max_snapshots: int = 30  # Maximum snapshots to keep | 保留的最大快照数
)
```

#### Methods | 方法

##### save_session() | 保存会话

```python
def save_session(
    session_id: str,              # Unique session ID | 唯一会话 ID
    todos: list,                  # List of pending tasks | 待办任务列表
    decisions: list,              # List of recent decisions | 最近决策列表
    recent_requests: list         # List of recent requests | 最近请求列表
) -> bool:                        # Returns True if successful | 成功返回 True
```

**Example | 示例：**
```python
result = flusher.save_session(
    session_id="session_20260401",
    todos=[
        {"task": "Implement feature X", "priority": "high"},
        {"task": "Fix bug Y", "priority": "medium"}
    ],
    decisions=[
        {"decision": "Use three-tier architecture", "reason": "Scalability"}
    ],
    recent_requests=[
        {"request": "How to implement feature X?", "timestamp": "2026-04-01T09:00:00"}
    ]
)
```

##### load_session() | 加载会话

```python
def load_session(
    session_id: str  # Session ID to load | 要加载的会话 ID
) -> dict:           # Session data | 会话数据
```

**Example | 示例：**
```python
session_data = flusher.load_session("session_20260401")
print(session_data['todos'])
```

##### cleanup() | 清理

```python
def cleanup() -> int:  # Number of files deleted | 删除的文件数
```

**Example | 示例：**
```python
deleted_count = flusher.cleanup()
print(f"Deleted {deleted_count} old snapshots")
```

---

### OperationTracker | 操作跟踪器

#### Constructor | 构造函数

```python
OperationTracker(
    log_file: str  # Path to log file | 日志文件路径
)
```

#### Methods | 方法

##### track() | 跟踪

```python
def track(
    op_type: str,         # Operation type | 操作类型
    description: str,     # Operation description | 操作描述
    details: dict         # Operation details | 操作详情
) -> bool:                # Returns True if successful | 成功返回 True
```

**Operation Types | 操作类型：**

| Type | 类型 | Description | 说明 |
|------|------|-------------|------|
| `config_change` | 配置变更 | Configuration modified | 配置修改 |
| `file_write` | 文件写入 | File created/modified | 文件创建/修改 |
| `file_delete` | 文件删除 | File deleted | 文件删除 |
| `decision` | 决策 | Important decision made | 重要决策 |
| `error` | 错误 | Error occurred | 发生错误 |
| `task_start` | 任务开始 | Task started | 任务开始 |
| `task_complete` | 任务完成 | Task completed | 任务完成 |
| `task_update` | 任务更新 | Task status changed | 任务状态变更 |
| `external` | 外部调用 | External API call | 外部 API 调用 |

**Example | 示例：**
```python
# Track config change | 跟踪配置变更
tracker.track(
    op_type="config_change",
    description="Updated memory threshold from 100 to 200",
    details={
        "old_value": 100,
        "new_value": 200,
        "reason": "Performance optimization"
    }
)

# Track decision | 跟踪决策
tracker.track(
    op_type="decision",
    description="Adopted three-tier architecture",
    details={
        "alternatives": ["two-tier", "four-tier"],
        "reason": "Better scalability and maintainability"
    }
)

# Track error | 跟踪错误
tracker.track(
    op_type="error",
    description="Connection timeout",
    details={
        "error_type": "network",
        "retry_count": 3,
        "resolution": "Increased timeout to 30s"
    }
)
```

##### get_logs() | 获取日志

```python
def get_logs(
    start_time: str = None,  # Start time (ISO format) | 开始时间（ISO 格式）
    end_time: str = None,    # End time (ISO format) | 结束时间（ISO 格式）
    op_type: str = None      # Filter by operation type | 按操作类型过滤
) -> list:                   # List of operation logs | 操作日志列表
```

**Example | 示例：**
```python
# Get all logs | 获取所有日志
all_logs = tracker.get_logs()

# Get logs by time range | 按时间范围获取日志
logs = tracker.get_logs(
    start_time="2026-04-01T00:00:00",
    end_time="2026-04-01T23:59:59"
)

# Get logs by type | 按类型获取日志
error_logs = tracker.get_logs(op_type="error")
```

##### export() | 导出

```python
def export(
    format: str = "json",  # Export format: "json" or "csv" | 导出格式
    output_file: str = None  # Output file path | 输出文件路径
) -> str:                  # Exported content or file path | 导出内容或文件路径
```

**Example | 示例：**
```python
# Export to JSON string | 导出为 JSON 字符串
json_content = tracker.export(format="json")

# Export to CSV file | 导出为 CSV 文件
csv_file = tracker.export(format="csv", output_file="./operations.csv")
```

---

### CompressionGuard | 压缩保护器

#### Constructor | 构造函数

```python
CompressionGuard(
    context_file: str,         # Path to context file | 上下文文件路径
    threshold_minutes: int = 30  # Age threshold in minutes | 年龄阈值（分钟）
)
```

#### Methods | 方法

##### should_save() | 是否应该保存

```python
def should_save() -> bool:  # True if context is stale | 上下文过期返回 True
```

**Example | 示例：**
```python
if guard.should_save():
    print("Context is stale, need to save")
else:
    print("Context is fresh, safe to compress")
```

##### force_save() | 强制保存

```python
def force_save(
    flusher: AutoContextFlush  # AutoContextFlush instance | 自动刷新实例
) -> bool:  # Returns True if successful | 成功返回 True
```

##### verify() | 验证

```python
def verify() -> bool:  # True if save is verified | 保存验证成功返回 True
```

---

## Integration Examples | 集成示例

### Example 1: AI Agent Integration | AI Agent 集成

```python
from context_saver import AutoContextFlush, OperationTracker, CompressionGuard

class MyAIAgent:
    def __init__(self):
        self.flusher = AutoContextFlush(save_dir="./agent_context")
        self.tracker = OperationTracker(log_file="./agent_ops.jsonl")
        self.guard = CompressionGuard(context_file="./agent_context.md")
        self.current_task = None
        self.todos = []
    
    def start_task(self, task_name):
        self.current_task = task_name
        self.todos.append(task_name)
        self.tracker.track(
            op_type="task_start",
            description=f"Started task: {task_name}",
            details={"task": task_name}
        )
        self._save_context()
    
    def complete_task(self, task_name):
        if task_name in self.todos:
            self.todos.remove(task_name)
            self.tracker.track(
                op_type="task_complete",
                description=f"Completed task: {task_name}",
                details={"task": task_name}
            )
            self._save_context()
    
    def _save_context(self):
        self.flusher.save_session(
            session_id=f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            todos=self.todos,
            decisions=[],
            recent_requests=[self.current_task] if self.current_task else []
        )
    
    def compress_context(self):
        if self.guard.should_save():
            self.guard.force_save(self.flusher)
        # Now safe to compress | 现在可以安全压缩
```

---

## Best Practices | 最佳实践

### 1. Save Frequently | 频繁保存

Save after every key operation: task start/complete, decision, error, config change.

### 2. Track All Key Operations | 跟踪所有关键操作

Track config changes, decisions, and errors — not just some operations.

### 3. Always Check Before Compression | 压缩前始终检查

```python
if guard.should_save():
    guard.force_save(flusher)
    if guard.verify():
        compress()
```

### 4. Use Descriptive Details | 使用描述性详情

Include `old_value`, `new_value`, `reason`, and `impact` in details where relevant.

### 5. Regular Cleanup | 定期清理

Call `flusher.cleanup()` regularly to avoid unbounded snapshot growth.

---

## Troubleshooting | 故障排查

| Problem | Cause | Fix |
|---------|-------|-----|
| `save_session()` returns False | Permission denied / no disk space | Check directory permissions and disk space |
| Log file too large (>100MB) | No rotation | Export old logs, implement rotation |
| `should_save()` raises exception | Context file missing | Create the file or use an absolute path |

---

## Agent Context-Efficiency Instructions

> These instructions apply to Kiro and any AI agent working in this workspace.

**Prioritize targeted file access over bulk loading:**

1. **Search before reading.** Use `grep`/`Select-String` or the semantic search tool to locate the relevant lines before opening any file. Never read an entire large file speculatively.
2. **Read only relevant line ranges.** When a specific function, section, or block is needed, pass `offset` and `limit` to `read_file` to fetch only those lines.
3. **Avoid loading binary and generated assets.** Do not read `.glb`, `.tif`, `.png`, `.jpg`, `.mp4`, or any file listed in `.kiroignore`.
4. **Cache directory awareness.** `node_modules/`, `dist/`, `.vite/`, `.vite-temp/`, and `public/clrshade-tiles/` contain thousands of files — never recurse into them.
5. **Log files are transient.** `*.log`, `*.log.err`, and `texture-gen.log*` change every session; do not load them for context.
6. **Lockfiles are noise.** `package-lock.json` and `.package-lock.json` add thousands of lines of resolved dependency data with no architectural signal — skip them.
7. **When uncertain about structure,** run a targeted shell command (`Get-ChildItem -Depth 1`) rather than recursively listing the whole tree.

---

## Support | 支持

- **GitHub Issues:** https://github.com/lcq225/context-saver/issues
- **Discussions:** https://github.com/lcq225/context-saver/discussions

---

**Version | 版本：** 1.0.0
**Last Updated | 最后更新：** 2026-04-01
**Author | 作者：** Mr Lee
