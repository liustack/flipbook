---
name: Bug 报告
about: 命令报错、验收漏判或误判、成片不对
title: ''
labels: bug
assignees: ''
---

提交前先看 [docs/report-schema.zh-CN.md](../../docs/report-schema.zh-CN.md)，里面列了每个类型码的含义和修法。

## 发生了什么

一两句话说清楚。

## 确切命令

```bash
flipbook ...
```

## 完整输出

贴 stdout 的 JSON 报告和 stderr 全文，不要转述。

```
...
```

## 附件

- check 的 JSON 报告
- 联系表 PNG（`out/snapshot/contact-sheet.png` 或 `out/contact-sheet.png`，没过验收时在 `.flipbook/rejected/`）
- 能复现的最小合成目录（index.html 加 timeline.json），不方便公开就描述它做了什么

## 环境

- 宿主（Claude Code、Codex、终端）：
- `flipbook --version`：
- `flipbook doctor --json` 的输出：
- 系统和芯片：

## 期望

你期望的结果。
