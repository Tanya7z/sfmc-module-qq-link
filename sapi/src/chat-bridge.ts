/**
 * chat-bridge.ts — 游戏聊天 ↔ QQ 群（经 db-server /api/sfmc/messages）
 *
 * - 启动读 bridge_channel_id；空则禁用并只 log 一次
 * - MC→QQ：非命令、非绑定等待态聊天 → POST messages（channelId=bridge）
 * - QQ→MC：轮询 GET messages → Msg 广播；仅展示 qq_* 来源，跳过本进程刚发出的 id
 */

import { Player, system, world } from "@minecraft/server";
import { HttpRequestMethod } from "@minecraft/server-net";
import { HttpDB, Msg } from "@sfmc-bds/sdk/sapi/runtime";

/** 轮询间隔（tick；20 ≈ 1s） */
export const CHAT_POLL_INTERVAL_TICKS = 20 * 2;

/** 本进程刚发出的消息保留多久，避免轮询回显 */
const OUTBOUND_TTL_MS = 15_000;

type ChatRow = {
  id?: string;
  channel_id?: string;
  from_id?: string;
  from_name?: string;
  content?: string;
  created_at?: number;
};

type ChatBridgeState = {
  channelId: string;
  /** 下一轮 minCreatedAt（含边界；用 last+1 避免重复） */
  cursor: number;
  outboundIds: Map<string, number>;
};

let state: ChatBridgeState | null = null;
let disabledLogged = false;

function pruneOutbound(now: number): void {
  if (!state) return;
  for (const [id, ts] of state.outboundIds) {
    if (now - ts > OUTBOUND_TTL_MS) state.outboundIds.delete(id);
  }
}

/** 读取 bridge_channel_id；空字符串表示未配置 */
export async function fetchBridgeChannelId(): Promise<string> {
  const result = await HttpDB.typedRequest<{ value?: unknown }>(
    HttpRequestMethod.GET,
    "/api/sfmc/settings/bridge_channel_id"
  );
  if (!result.ok) return "";
  const v = result.data?.value;
  return String(v ?? "").trim();
}

/** 初始化频道；未配置则返回 null */
export async function resolveChatBridgeChannel(): Promise<string | null> {
  const channelId = await fetchBridgeChannelId();
  if (!channelId) {
    if (!disabledLogged) {
      console.info("[qq-link] bridge_channel_id 未配置，游戏聊天互通已禁用");
      disabledLogged = true;
    }
    return null;
  }
  return channelId;
}

/** 启动时调用：解析频道并设置游标为「现在」，避免刷历史 */
export async function bootChatBridge(): Promise<boolean> {
  const channelId = await resolveChatBridgeChannel();
  if (!channelId) {
    state = null;
    return false;
  }
  state = {
    channelId,
    cursor: Date.now(),
    outboundIds: new Map(),
  };
  console.info(`[qq-link] 游戏聊天互通已启用 channel=${channelId}`);
  return true;
}

export function getChatBridgeChannelId(): string | null {
  return state?.channelId ?? null;
}

export function isChatBridgeEnabled(): boolean {
  return !!state?.channelId;
}

/** 玩家普通聊天 → POST（不 cancel 原聊天） */
export function tryForwardPlayerChat(
  player: Player,
  message: string,
  opts?: { isWaitingBind?: (playerId: string) => boolean }
): void {
  if (!state) return;
  const raw = String(message ?? "").trim();
  if (!raw) return;
  if (raw.startsWith("!") || raw.startsWith("！")) return;
  if (opts?.isWaitingBind?.(player.id)) return;

  const now = Date.now();
  const id = `${player.id}_${now}`;
  state.outboundIds.set(id, now);
  pruneOutbound(now);

  const channelId = state.channelId;
  void (async () => {
    try {
      await HttpDB.typedRequest(HttpRequestMethod.POST, "/api/sfmc/messages", {
        messages: [
          {
            id,
            channelId,
            fromid: player.id,
            fromName: player.name,
            type: "text",
            content: raw,
            showTimestamp: true,
            timestamp: now,
          },
        ],
      });
    } catch {
      /* ignore */
    }
  })();
}

function broadcastQqLine(fromName: string, content: string): void {
  const line = `[QQ] ${fromName}: ${content}`;
  for (const p of world.getAllPlayers()) {
    try {
      Msg.info(line, p as never);
    } catch {
      /* ignore */
    }
  }
}

/** 单次拉取并展示 */
export async function pollIncomingChatOnce(): Promise<void> {
  if (!state) return;
  const { channelId, cursor } = state;
  const q =
    `/api/sfmc/messages?channelId=${encodeURIComponent(channelId)}` +
    `&minCreatedAt=${encodeURIComponent(String(cursor))}`;
  const result = await HttpDB.typedRequest<{ messages?: ChatRow[] }>(HttpRequestMethod.GET, q);
  if (!result.ok || !Array.isArray(result.data?.messages)) return;

  const now = Date.now();
  pruneOutbound(now);

  let maxCreated = cursor;
  for (const row of result.data.messages) {
    const created = Number(row.created_at ?? 0);
    if (created > maxCreated) maxCreated = created;

    const id = String(row.id ?? "");
    if (id && state.outboundIds.has(id)) continue;

    const fromId = String(row.from_id ?? "");
    // 仅展示 QQ→MC；本服玩家消息已在游戏聊天可见
    if (!fromId.startsWith("qq_")) continue;

    const fromName = String(row.from_name ?? "QQ").trim() || "QQ";
    const content = String(row.content ?? "").trim();
    if (!content) continue;
    broadcastQqLine(fromName, content);
  }

  // 下一轮从 last+1 起，避免同毫秒重复
  if (maxCreated >= cursor) state.cursor = maxCreated + 1;
}

export function startChatBridgePoller(): number {
  return system.runInterval(() => {
    void pollIncomingChatOnce();
  }, CHAT_POLL_INTERVAL_TICKS);
}

/** cleanup / 单测重置 */
export function resetChatBridgeForTest(): void {
  state = null;
  disabledLogged = false;
}
