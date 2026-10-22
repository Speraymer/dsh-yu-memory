# 来源声明

本插件是独立实现，不依赖、也不修改 `dsh-fish-memory`。召回设计参考了
[`Yuuyuko-uu/dsh-fish-memory`](https://github.com/Yuuyuko-uu/dsh-fish-memory)
的 MIT 许可实现，包括中文切词、常见词降权、相关性门槛、时间衰减、重复强化和事实键取代这些思路。

`lib/词典.txt`、`lib/词频.txt` 与 `lib/词典-来源.txt` 原样取自
`dsh-fish-memory@1.2.1`；其上游词典来源和许可证逐项记录在 `lib/词典-来源.txt`。
本包保留原 MIT `LICENSE`。

本插件没有复制鱼记忆的会话存储、设置页面或工具名称，也不会读取或迁移
`~/.dsh/fish-memory/`。
