# pi-packages

[English](./README.md) | 简体中文

适用于 [Pi](https://pi.dev/) 的模块化扩展插件合集。

## 包含的 Packages

- **`pi-craft-tui`** (`src/pi-craft-tui`) —— Claude Code 风格 Header、Codex 风格输入区与单行 Footer 状态栏。
- **`pi-simple-permission`** (`src/pi-simple-permission`) —— 轻量权限拦截与守护扩展。
- **`pi-auto-compact`** (`src/pi-auto-compact`) —— 原生优先的上下文压缩扩展，支持按自然结束后的窗口百分比提前压缩。

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
- **Footer** —— 单行：`model high · 126k/400k · cwd (main) · tok/s · CH87.3%`；其他扩展状态显示在上一行

**交互**

- **`/clear` 与 `/cls`** —— 仅视觉填满视口；不触碰会话
- **`/stats`** —— 会话统计卡：token 汇总（↑↓R/W Σ）、缓存命中、花费、消息数（prompts/responses/tool calls）、工具明细、异常终止，以及 Agent 执行周期与分支总时长
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

适用于 Pi 0.84.4+ 的原生优先上下文预算扩展。插件不再打断任何正在执行的 Agent run。

- **原生接管活跃回合** —— Pi 在工具执行后、下一次 Assistant 响应前完成 threshold/overflow 压缩，并用重建后的上下文在同一 run 内继续。
- **自然结束后提前压缩** —— 仅在 `agent_settled` 后按模型窗口百分比（默认 80%）提前压缩，为下一项用户任务释放空间。
- **安全守卫** —— aborted/error/length 结束不压缩；调用公共压缩 API 前再次检查 `ctx.isIdle()` 与待处理消息。
- **固定质量指令** —— 在 Pi 原生结构化摘要上追加精简且不可配置的聚焦要求，确保目标、未完成文件、决策、下一步及文件清单完整。
- **失败安全降级** —— 使用官方压缩结果事件；插件触发失败一次后，本会话不再主动尝试，Pi 原生恢复流程仍保持启用。
- **仅一个配置项** —— 只保留 `triggerPercent`，在每次 session 启动时从全局配置和可选的受信任项目覆盖中读取一次。

### 配置文件示例 (`config.json`)

```json
{
  "autoCompact": {
    "triggerPercent": 80
  }
}
```

`triggerPercent` 范围为 50～95，默认 80。配置仅在 session 启动时读取，修改后执行 `/reload`。其它旧扩展字段会被忽略；如需禁用，请通过 Pi 的 package 配置关闭插件，不再维护第二套启用开关。

如果希望在**活跃 run** 中也按预算线无缝压缩，应直接配置 Pi 原生能力。例如 272k 窗口约在 80% 触发时，可设置 `reserveTokens: 54400`：

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 54400,
    "keepRecentTokens": 20000
  }
}
```

`reserveTokens` 是绝对 Token 数，切换不同窗口模型时需要复核。本扩展刻意不读写 Pi settings。

## 设计原则

- **Pi 原生优先。** 只用公共 API；原生组件只包装、组合，不重造；不接管 Pi 或其他扩展拥有的槽位、命令和工具。
- **保持兼容。** 只依赖稳定公共接口，安装完全可逆，每次 Pi 升级后重新核对。
- **开销趋近于零。** 格式化保持纯函数并复用计算结果，高频路径节流，会话资源懒构建、全清理；确属必要的开销也取最小实现并注明取舍。

## License

[MIT](./LICENSE)
