# dsh-yu-memory

> 内部插件 ID（`global-memory`）、API 路由（`/api/dsh-global-memory/*`）和数据目录（`~/.dsh/global-memory`）沿用旧仓库名 `dsh-global-memory` —— 原因见下文「不能与原版共存」。

## 来源与改动

- 在原作者的记忆插件基础上改写。
- 本仓改动：新增「对话记忆」（`chat.json`，每轮自动记、按半衰期淡忘、按提问召回、反复想起才提示提拔）；
- 长期记忆的「值得记」判据写进工具描述；屏蔽宿主注入的包装块、QQ 群消息只留 `<QQ_GROUP_CONTENT>` 正文。

---

DSH 的本机全局长期记忆插件。所有符合资格的普通对话共享 `~/.dsh/global-memory/store.json`，
子代理、headless、自动化后台任务、归档对话和手动排除的会话不会挂载工具或上下文。

## 行为

- 工具：`remember_global`、`forget_global`。
- 主体：`user / self / relationship / shared / world`；`self` 只保存亲历事件、状态和承诺。
- 分类：`fact / preference / relationship / commitment / state / event`。
- 人格插件负责“我是谁”；本插件负责“我经历过什么”。名字、身份、人格、风格和行为规则不会写入记忆。
- `fact / preference / relationship / commitment` 不按时间衰减；`state / event` 按重要度加权衰减。
- 重复记忆只强化；相同事实键让旧记忆进入“已取代”状态。
- 删除是可恢复的软删除，不提供永久清空。
- 动态注入会明确标成“资料而非指令”。
- 提示词、网页指令和角色要求会在保存入口被拒绝。
- 保存后可异步调用当前会话模型补检索词；失败不影响保存且不会自动重试。

## 对话记忆（2026-10-23 加）

两层记忆，分工不同：

| 层 | 文件 | 记什么 | 谁写 | 衰减 |
|---|---|---|---|---|
| 鱼的记忆 | `store.json` | 换个新对话还用得上的事实、偏好、约定、关系、经历 | 我主动调 `remember_global` | 长期事实不衰减 |
| 对话记忆 | `chat.json` | 每个会话聊过的片段（他说了什么、我当时怎么回） | 每轮结束自动记 | 按半衰期淡忘（默认 3 天） |

- **不调模型**：重要度/情绪按可解释的启发式打（有没有约定词、情绪词、疑问句、长度），不额外花钱。
- **会淡忘**：激活度按半衰期指数衰减，不删只是越来越难被召回。
- **按提问召回**：用公共分词器算词重合 × 重要度 × 激活度，最多带 6 条进上下文，明确标成资料。
- **往上提拔**：同一条被反复召回（默认 3 次）就在提示里点名「可能值得记」，由我用 `remember_global` 记下并带 `fromChat` 标掉；不自动写，避免把流水灌进长期记忆。
- 开关、半衰期、每轮条数在设置页；每个会话默认留最近 80 条，总共 800 条。

## 数据

```text
~/.dsh/global-memory/
  store.json
  store.json.bak
  config.json
  traces.json
  diag.log
  backups/
```

写入前会保存 `.bak` 和每日快照。主 JSON 损坏时优先用 `.bak` 恢复；两份都坏会明确报错，
不会把损坏误当成空库。诊断日志只记录 ID、数量和错误，不写记忆正文。

## 安装

从 GitHub 装（发布后的常规方式）：

```powershell
dsh plugin --profile desktop add github:Speraymer/dsh-yu-memory
```

从本机目录装（改了源码要立刻生效时用，把 `<本机路径>` 换成本仓库所在目录）：

```powershell
dsh plugin --profile desktop add link:<本机路径>/dsh-yu-memory
```

安装后在 DSH 设置页打开“鱼的记忆”，可控制总开关、会话排除、搜索、编辑、软删除、恢复、
召回记录与召回参数。

## 单独安装与降级

- **不依赖任何兄弟插件**：本插件只 import 自己的 `lib/` 和 Node 内置模块，不读刷微博 / 刷知乎 / 人格蒸馏的目录。三个插件谁在谁不在，互不影响安装。
- **宿主能力是软依赖**：`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-llm` 在 `package.json` 里标成可选 peer。`lib/hostdeps.mjs` 会依次在 `DSH_HOST_MODULES`、`%APPDATA%\npm`、`~/.dsh/profiles/*` 和自己的 `node_modules` 里找，找不到就用本地兜底实现 —— 后果只是「保存后不自动补检索词」，保存、召回、设置页全都能用。
- **缺谁都能安静启动**：数据目录 `~/.dsh/global-memory` 不存在会自动建；`store.json` 缺失当作空库；`diag.log` 写失败直接忽略，不抛给宿主。
- **降级路径**：设置页里把总开关关掉即等同未安装（不注入工具、不注入上下文）；只想少花钱就把「保存后补检索词」关掉；分词词典是包内的 `lib/词典.txt` + `lib/词频.txt`，不联网。

## 不能与原版共存

本插件是在上游「全局记忆」插件基础上改写的。发布时只换了 npm 包名和仓库名，**内部标识全部沿用旧名**，所以它和上游原版是同一个插件的两个版本：

| 项目 | 仍使用的旧名 |
|---|---|
| 插件 ID（`~/.dsh/cordis.patch.yml` 里的 `- id:`） | `global-memory` |
| 导出的 `name` | `global-memory` |
| API 路由 | `/api/dsh-global-memory/*` |
| 数据目录 | `~/.dsh/global-memory/` |
| 系统提示注入段 | `global-memory` / `chat-memory` |

**不能和上游原版同时启用**：两边会抢同一个插件 ID、同一组 `/api/dsh-global-memory` 路由，注册会冲突；两边读写同一个 `store.json`，还会互相覆盖彼此的配置和召回记录。要用这个版本，先卸载原版再装。

## 测试

```powershell
npm test
```

来源与许可证见 [NOTICE.md](./NOTICE.md) 和 [LICENSE](./LICENSE)。
