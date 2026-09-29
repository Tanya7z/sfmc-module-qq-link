# 已归档

`@sfmc-bds/module-qq-link` 已收编进平台仓库，不再从模块索引安装。

维护副本：`ScriptsForMinecraftServer/modules/packages/qq-link`。

本目录只保留与平台包一致的游戏侧源码，便于仍链接到此仓库的服务器在重新部署前停止读取已删除的 `bridge_channel_id`，并去掉踢人队列。请改用平台包后移除此链接。

聊天互通由聊天模块的频道开关负责。QQ 机器人管理不再提供踢人。
