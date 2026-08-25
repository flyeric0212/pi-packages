# pi-craft-tui

[English](./README.md) | 简体中文

给 [Pi](https://pi.dev/) TUI 换上 Claude Code 风格的 Header、Codex 风格的输入区和单行 Footer。需要 Pi **0.84.2** 或更高版本。

![总览](./assets/overview.png)

![Header](./assets/header.png)

![输入区与 Footer](./assets/editor.png)

## 安装

先用 `pi config` 关掉其他 TUI。

安装到当前用户：

```bash
pi install git:github.com/flyeric0212/pi-craft-tui
```

只安装到当前项目：

```bash
pi install -l git:github.com/flyeric0212/pi-craft-tui
```

不安装、只跑一次：

```bash
pi -e git:github.com/flyeric0212/pi-craft-tui
```

然后新开一个 Pi 会话，或执行 `/reload`。本包不会写入 `settings.json`，也不会改 `quietStartup`。

## 功能介绍

- Header：新进程启动时播放一次 Pi Logo 动画，展示版本、标语、模型、推理强度和项目目录
- 输入区：Codex 风格填充输入框，粗体 `❯`；发送、转向、队列、历史、`/`、`@`、bash 都走 Pi 原生
- Footer：`model high · 126k/400k · cwd · tok/s · CH87.3%`；CH 是当前分支累计命中率，固定在末尾，还没有 cache 读时整段隐藏；其他扩展的 `setStatus()` 出现在上一行
- `/clear` 和 `/cls` 只清屏，历史、`/tree` 和模型上下文都保留
- `/skill-name` 运行已加载的 skill（等同 `/skill:skill-name`）
- 斜杠命令：命令名用主题强调色；Enter 在部分匹配时只补全，打全了才提交
- 折叠的 `grep` / `find` / `ls` / `bash` 最多显示 3 行结果；同一轮里连续成功的折叠 `read` 合成一组路径列表；单条 `read` 仍是一行、没有色块；`write` 和 `edit` 保持原生；`Ctrl+O` 展开为 Pi 原生渲染
- 工具预览只会在 `read` / `bash` / `grep` / `find` / `ls` 仍由 Pi 内置持有时同名重新注册它们。升级 Pi 后请回归这五个工具的折叠和展开显示

## License

[MIT](./LICENSE)
