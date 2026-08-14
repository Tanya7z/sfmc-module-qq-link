/**
 * @sfmc-bds/module-qq-link — QQ↔MC 绑定 + 入服白名单生效 + 踢人 + 事件上报 + 聊天互通
 *
 * 流程（绑定）：
 *   1. QQ 侧发「绑定」取得短码
 *   2. 游戏内 !bind → 等待态 → 下一条聊天码 → confirm
 *
 * 流程（入服）：
 *   QQ 审批通过 → db approved → 本模块轮询 apply-queue → dedicatedServer.allowList.add
 *
 * 流程（踢人）：
 *   QQ「踢人」→ admin action-queue → kickPlayer
 *
 * 流程（事件）：
 *   join/leave/death → POST /api/sfmc/qq/events（db-server 聚合推群）
 *
 * 流程（聊天互通）：
 *   配 bridge_channel_id 后：游戏聊天 POST messages；轮询 QQ→MC 广播
 */

import { Player, system, world } from "@minecraft/server";
import { HttpRequestMethod } from "@minecraft/server-net";
import { ModuleRegistry, type ModuleDescriptor } from "@sfmc-bds/sdk/module-loader";
import { Command, HttpDB, Msg, Permission } from "@sfmc-bds/sdk/sapi/runtime";
import { startAllowListPoller } from "./allowlist-apply.js";
import {
  bootChatBridge,
  resetChatBridgeForTest,
  startChatBridgePoller,
  tryForwardPlayerChat,
} from "./chat-bridge.js";
import { registerGameEventReporters } from "./events.js";
import { startKickPoller } from "./kick.js";

/** 与 sapi/manifest.json 的 id 一致 */
export const MODULE_ID = "feature-qq-link";

/** 命令权限名 */
export const PERM = "qq_link.use";

/** 等待绑定码超时（tick；20 tick ≈ 1s） */
export const BIND_WAIT_TICKS = 20 * 60;

type PendingBind = {
  timeoutId: number;
};

const pendingByPlayer = new Map<string, PendingBind>();
const intervalIds: number[] = [];

/** 保存订阅回调，cleanup 时 unsubscribe */
let onChatSend: ((ev: { sender?: Player; message?: string; cancel?: boolean }) => void) | null = null;
/** 游戏事件上报的取消函数 */
let unsubGameEvents: (() => void) | null = null;

function clearPending(playerId: string): void {
  const p = pendingByPlayer.get(playerId);
  if (!p) return;
  try {
    system.clearRun(p.timeoutId);
  } catch {
    /* ignore */
  }
  pendingByPlayer.delete(playerId);
}

/** 平台 error 码 → 玩家可读文案 */
export function formatConfirmError(error: string | undefined): string {
  switch (error) {
    case "invalid_code":
      return "绑定码无效，请回 QQ 重新申请「绑定」";
    case "code_expired":
      return "绑定码已过期，请回 QQ 重新申请";
    case "qq_already_bound":
      return "该 QQ 已绑定其他玩家，请先在 QQ 侧「解绑」";
    case "player_already_bound":
      return "你已绑定其他 QQ，请先解绑后再试";
    case "network_error":
      return "无法连接数据库服务，请稍后重试";
    default:
      return error ? `绑定失败：${error}` : "绑定失败，请稍后重试";
  }
}

/** 调用平台 confirm（单测可 mock HttpDB） */
export async function postBindConfirm(
  player: { id: string; name: string },
  code: string
): Promise<{ ok: boolean; error?: string }> {
  const result = await HttpDB.typedRequest<{ success?: boolean; error?: string }>(
    HttpRequestMethod.POST,
    "/api/sfmc/qq/bind/confirm",
    {
      code,
      xuid: player.id,
      name: player.name,
    }
  );
  if (result.ok) return { ok: true };
  return { ok: false, error: result.error || "request_failed" };
}

function beginWait(player: Player): void {
  const id = player.id;
  clearPending(id);
  // 跨包 @minecraft/server 类型身份不一致（file: SDK vs 本仓），运行时同一 stub
  Msg.info("请在 60 秒内发送绑定码（纯数字，不要带 !）", player as never);
  const timeoutId = system.runTimeout(() => {
    if (!pendingByPlayer.has(id)) return;
    pendingByPlayer.delete(id);
    try {
      const online = world.getAllPlayers().find((p) => p.id === id);
      if (online) Msg.warning("绑定等待已超时，请重新输入 !bind", online as never);
    } catch {
      /* ignore */
    }
  }, BIND_WAIT_TICKS);
  pendingByPlayer.set(id, { timeoutId });
}

function registerPermissions(): void {
  Permission.register(PERM, Permission.Any);
}

function registerCommands(): void {
  Command.register(
    "bind",
    PERM,
    (player) => {
      if (!player) return;
      beginWait(player as Player);
    },
    "绑定 QQ（随后发送验证码）",
    MODULE_ID
  );
}

function registerEvents(): void {
  onChatSend = (ev) => {
    const player = ev.sender;
    if (!player) return;

    // 绑定等待态优先：拦截验证码，不转发 QQ
    if (pendingByPlayer.has(player.id)) {
      const raw = String(ev.message ?? "").trim();
      if (raw.startsWith("!") || raw.startsWith("！")) return;

      ev.cancel = true;
      clearPending(player.id);

      const code = raw.replace(/\s+/g, "");
      if (!/^\d{4,8}$/.test(code)) {
        Msg.error("绑定码应为 4–8 位数字，请重新 !bind 后再发", player as never);
        return;
      }

      system.run(() => {
        void (async () => {
          const result = await postBindConfirm(player, code);
          if (result.ok) {
            Msg.success("QQ 绑定成功", player as never);
          } else {
            Msg.error(formatConfirmError(result.error), player as never);
          }
        })();
      });
      return;
    }

    // 普通聊天 → QQ（不 cancel；命令由平台 ! 拦截）
    tryForwardPlayerChat(player, String(ev.message ?? ""), {
      isWaitingBind: (id) => pendingByPlayer.has(id),
    });
  };
  world.beforeEvents.chatSend.subscribe(onChatSend as never);

  // 上下线 / 死亡 → db-server 聚合推群
  unsubGameEvents = registerGameEventReporters();
}

function init(): void {
  intervalIds.push(startAllowListPoller());
  intervalIds.push(startKickPoller());
  // 异步解析 bridge_channel_id 后再开轮询
  system.run(() => {
    void (async () => {
      const ok = await bootChatBridge();
      if (ok) intervalIds.push(startChatBridgePoller());
    })();
  });
}

function cleanup(): void {
  for (const id of [...pendingByPlayer.keys()]) {
    clearPending(id);
  }
  for (const runId of intervalIds) {
    try {
      system.clearRun(runId);
    } catch {
      /* ignore */
    }
  }
  intervalIds.length = 0;
  resetChatBridgeForTest();
  if (onChatSend) {
    try {
      world.beforeEvents.chatSend.unsubscribe(onChatSend as never);
    } catch {
      /* ignore */
    }
    onChatSend = null;
  }
  if (unsubGameEvents) {
    try {
      unsubGameEvents();
    } catch {
      /* ignore */
    }
    unsubGameEvents = null;
  }
}

export const DESCRIPTOR: ModuleDescriptor = {
  id: MODULE_ID,
  afterWorldLoad: false,
  lifecycle: {
    registerPermissions,
    registerCommands,
    registerEvents,
    init,
    cleanup,
  },
};

ModuleRegistry.register(DESCRIPTOR);
