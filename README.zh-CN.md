# pi-packages

[English](./README.md) | 简体中文

适用于 [Pi](https://pi.dev/) 的模块化扩展插件合集。

## 包含的 Packages

- **`pi-craft-tui`** (`src/pi-craft-tui`) —— Claude Code 风格 Header、Codex 风格输入区与单行 Footer 状态栏。
- **`pi-simple-permission`** (`src/pi-simple-permission`) —— 轻量权限拦截与守护扩展。
- **`pi-auto-compact`** (`src/pi-auto-compact`) —— 上下文自动压缩扩展，支持真实 Token 压力评估、回合中拦截与自动续跑。

## 安装

先用 `pi config` 关掉其他冲突的扩展（如其他 TUI）。

```bash
# 1. 克隆仓库
git clone https://github.com/flyeric0212/pi-packages.git /path/to/pi-packages

# 2. 安装扩展
pi install /path/to/pi-packages/src/pi-craft-tui
pi install /path/to/pi-packages/src/pi-simple-permission
pi install /path/to/pi-packages/src/pi-auto-compact
```

然后新开一个 Pi 会话，或执行 `/reload`。

## pi-craft-tui 功能介绍

![总览](./assets/overview.png)

**界面**

- **Header** —— 新进程播放一次 π logo 动画，展示版本、标语、模型、推理强度和项目目录
- **Editor** —— Codex 风格填充输入框，粗体 `❯`；历史消息保留同一标记；`!` 开头切换 bash 模式配色
- **Footer** —— 单行：`model high · 126k/400k · cwd (main) · tok/s · CH87.3%`；其他扩展的状态显示在上一行

**交互**

- **`/clear` 与 `/cls`** —— 仅视觉填满视口；不触碰会话
- **`/stats`** —— 会话统计卡：token 汇总（↑↓R/W Σ）、缓存命中、轮次与时长
- **技能短命令** —— `/name` 运行已加载的 skill（等同 `/skill:name`）；补全菜单显示短名
- **斜杠命令** —— 行首命令名用主题强调色；Enter 在部分匹配时只补全，打全了才提交

## pi-simple-permission 功能介绍

轻量、确定、透明的权限守护扩展。解决复杂命令包装（如 `xargs`）误杀与 Subagents 频繁弹窗问题。

> 当前仅面向 macOS/Linux 等 Unix-like Bash 环境；暂不支持 Windows 原生 PowerShell 命令检查。

- **确定性规则匹配** —— 支持通配符（`*`）、严格正则转义与后置规则覆盖优先。
- **Wrapper 分层检查** —— 识别 `xargs`、`sudo`、`env`、`timeout`、shell `-c` 等常见包装器；安全批处理静默放行，危险内层命令仍会命中规则。
- **复合命令检查** —— 分别检查管道、链式/后台命令和可执行的命令替换，同时避免误判单引号或转义后的文本。
- **敏感路径保护** —— 对直接文件工具的路径做 `~`、`@`、相对路径归一化，保护 `*.env`、`~/.ssh/*` 等路径并允许显式例外。
- **分层 JSON 配置** —— 内建默认值、全局配置、可信项目配置依次合并；无效配置会告警而不是静默放行。

### 配置文件示例 (`config.json`)

```json
{
  "permission": {
    "*": "allow",
    "path": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    },
    "bash": {
      "*": "allow",
      "rm -rf *": "deny",
      "sudo *": "ask",
      "git push*": "ask"
    },
    "external_directory": {
      "*": "allow",
      "~/.ssh/*": "deny"
    }
  }
}
```

同一分类中后写的具体规则优先，`"*"` 始终只是兜底。项目配置仅在 Pi 信任该项目后加载。该扩展是轻量防误操作规则器，不是完整 Shell 解析器或沙箱；路径规则只覆盖直接文件工具，Bash 和符号链接仍需依赖独立沙箱保护。

## pi-auto-compact 功能介绍

适用于 Pi 的上下文自动压缩扩展，用于控制上下文增长，解决多工具调用的长链路回合（马拉松回合）中上下文暴涨与 Token 成本翻倍问题。

- **真实上下文压力计算** —— 优先使用原生 `totalTokens`，否则按 `input + output + cacheRead + cacheWrite` 计算，完整覆盖缓存命中与 Assistant 输出。
- **回合中打断与回合间触发** —— `interruptTurn` 开启时通过 `message_end` 拦截马拉松工具链，关闭时仅在 `agent_end` 触发。
- **压缩后自动续跑** —— 压缩完成后自动注入引导指令，让模型基于摘要无感接续执行当前任务，无需人工手动发消息继续。
- **多层防抖与熔断保护** —— 包含增长防抖、失败降级（回落前 disarm）与连续 3 次失败熔断，同时保留 Pi 原生 overflow recovery。
- **分层 JSON 配置与热加载** —— 支持全局配置（`~/.pi/agent/extensions/pi-auto-compact/config.json`）与受信任项目配置（`.pi/pi-auto-compact.json`），支持字段级容错与基于 `mtime` 的热更新。

### 配置文件示例 (`config.json`)

```json
{
  "autoCompact": {
    "enabled": true,
    "triggerPercent": 80,
    "debounceTokens": 20000,
    "interruptTurn": true,
    "notifyOnly": false,
    "customInstructions": "Focus the summary on: 1) the current task goal and acceptance criteria; 2) unfinished changes with their exact file paths; 3) key decisions made and the rationale behind them; 4) concrete next steps. Keep <read-files>/<modified-files> complete and accurate. The summary body language may follow the conversation language.",
    "lang": "zh"
  }
}
```

只需配置需要修改的字段，未声明字段使用默认值。Pi 原生 threshold 压缩始终作为安全兜底，仅在本扩展自己的压缩正在进行时取消；overflow recovery 与手动 `/compact` 保持不变。

## 设计原则

- **Pi 原生优先。** 只用公共 API；原生组件只包装、组合，不重造；不接管 Pi 或其他扩展拥有的槽位、命令和工具。
- **保持兼容。** 只依赖稳定公共接口，安装完全可逆，每次 Pi 升级后重新核对。
- **开销趋近于零。** 格式化保持纯函数并复用计算结果，高频路径节流，会话资源懒构建、全清理；确属必要的开销也取最小实现并注明取舍。

## License

[MIT](./LICENSE)
