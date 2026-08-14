# @sfmc-bds/module-qq-link

SFMC QQ↔MC 身份绑定 + 入服白名单生效 + 踢人（独立作者仓）。

## 能力

| 能力 | 说明 |
| --- | --- |
| `!bind` | QQ「绑定」得码 → 游戏内等待态发数字码 |
| 白名单生效 | 轮询 `apply-queue` → `@minecraft/server-admin` `dedicatedServer.allowList.add` |
| 踢人 | 轮询 `action-queue` → `kickPlayer`（须在线） |

平台（db-server / qq-bridge）只做审批状态，**不**写 BDS `allowlist.json`。

## 绑定流程

1. QQ 群/私聊对机器人发「绑定」，获得 6 位短码  
2. 游戏内 `!bind`（进入 60 秒等待）  
3. 在聊天中发送短码（纯数字，不要带 `!`）  
4. 成功后可用 QQ「我的绑定 / whoami」查看  

解绑：QQ 侧发「解绑」。

## 入服流程

1. QQ「申请入服 \<玩家名\>」→ 管理员通过（若 `require_approval`）  
2. 本模块约每 5s 拉队列并写入 allowList  
3. BDS 须在跑；停服时审批可积压，起来后自动 applied  

### 开关（`configs/qq_link.json`）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `allowlist_enabled` | `true` | 入服白名单总开关 |
| `require_approval` | `true` | 是否需要管理员审批 |
| `treat_group_admins_as_admins` | `false` | 群主/群管是否视作 SFMC 管理员；**仅改本文件**，群聊只读 |

也可由 QQ 管理员发「配置」打开互动面板切换白名单/审批（写入同一文件）。「配置」会显示群管开关；不可在群聊改该开关。

## 依赖

- 平台 db-server：`/api/sfmc/qq/bind/*`、`/api/sfmc/qq/join/*`、`/api/sfmc/qq/admin/*`
- `@sfmc-bds/sdk` runtime + `@minecraft/server-admin`（BP 由平台组装时声明）

## 开发

```bash
npm i
npm run typecheck
npm test
```

联调：

```bash
sfmc mod install qq-link --from dir:<本仓路径> --link
sfmc behavior-pack build && sfmc behavior-pack deploy
```

然后重启 BDS。
