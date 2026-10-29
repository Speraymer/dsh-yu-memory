# dsh-yu-memory

## 给 Agent 的安装与验收

执行 `dsh plugin --profile desktop add github:Speraymer/dsh-yu-memory`，重启 DSH 后确认“设置 → 鱼的记忆”出现，并运行 `dsh --profile desktop --dump-config`。安装和升级都不得删除或覆盖 `~/.dsh/global-memory/`。

DSH 的统一记忆插件：跨会话长期记忆 + 会淡忘的对话记忆。两层都是被动的 —— 自动记、自动淡忘、自动召回，不用手动操作。

> 2026-10-27：原来还有第三层「非线性记忆图」（主动那层：自己连线决定这一轮看什么）。
> 因为它必须手动操作才有用，已整层删除。代码在 git 历史 `44f9cd4` 里，想要可随时取回。

## 两层分工

| 层 | 负责什么 | 保存位置 |
|---|---|---|
| 长期记忆 | 用户事实、偏好、关系、承诺、长期状态和重要经历 | `~/.dsh/global-memory/store.json` |
| 对话记忆 | 普通会话最近聊过的片段，按半衰期淡忘并按问题召回 | `~/.dsh/global-memory/chat.json` |

人格插件继续独占“我是谁”；本插件只管理“我经历过什么”。

## 已移除：记忆图

那一层是“手工连接对话、笔记与材料，连线决定下一轮能看到什么”。它不是记忆优化，而是上下文选择器，
所以不主动操作就等于不存在 —— 权衡之后删掉，省下约 9.6 MB 的画布前端与运行时。

删掉的东西：`graph-app/`（画布 SPA）、`lib/graph-host.mjs`、`lib/graph-why.mjs`、`lib/graph-runtime/`、
`client.js` 里的侧栏入口与浮层。`lib/source.mjs` 留着（注入来源判定，现在永不触发，但拆它会碰到召回主流程）。

画布画过的图存在浏览器 localStorage 里，删这层不会动它；真要清就去清浏览器存储。


## 长期记忆

- 工具：`remember_global`、`forget_global`。
- 主体：`user / self / relationship / shared / world`；`self` 只允许事件、状态和承诺。
- 分类：`fact / preference / relationship / commitment / state / event`。
- 稳定事实不衰减；状态和事件按重要度加权衰减。
- 重复内容只强化；相同事实键的新内容会取代旧内容。
- 删除均为可恢复的软删除，不提供永久清空。
- 提示词、身份改写、网页指令和角色要求会在保存入口被拒绝。

## 对话记忆

- 每轮自动记录一次，不额外调用模型。
- 默认半衰期 3 天；按“词重合 × 重要度 × 激活度”召回。
- 同一条反复有用时才提示提炼进长期记忆，不会自动污染长期库。
- 每个会话默认保留 80 条，总计 800 条；参数可在设置页调整。

## 数据安全

- JSON 写入使用临时文件和原子替换。
- 修改前保留 `.bak` 与每日快照；主文件损坏时优先恢复备份，不静默返回空库。
- 子代理、headless、自动化后台任务、归档对话和手动排除会话不会挂载记忆。
- 诊断日志只记录 ID、数量和错误，不记录记忆正文。
- 不读取兄弟插件目录，不依赖其他自有插件；缺少任何兄弟插件都能独立使用。

## 安装

```powershell
dsh plugin --profile desktop add github:Speraymer/dsh-yu-memory
```

本地开发安装：

```powershell
dsh plugin --profile desktop add link:<本机路径>/dsh-yu-memory
```

## 测试

```powershell
npm test
```

本项目采用 MIT 许可证；第三方 MIT 版权声明见 [NOTICE.md](./NOTICE.md)。
