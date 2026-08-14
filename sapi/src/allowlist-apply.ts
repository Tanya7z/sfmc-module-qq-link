/**
 * allowlist-apply.ts — 消费入服 apply-queue，调用 @minecraft/server-admin AllowList
 */

import { system, world } from "@minecraft/server";
import { HttpRequestMethod } from "@minecraft/server-net";
import { dedicatedServer } from "@minecraft/server-admin";
import { HttpDB } from "@sfmc-bds/sdk/sapi/runtime";

/** 轮询间隔（tick） */
export const APPLY_INTERVAL_TICKS = 20 * 5;

type QueueItem = { id?: string; player_name?: string };

export async function pullApplyQueue(): Promise<QueueItem[]> {
  const result = await HttpDB.typedRequest<{ success?: boolean; queue?: QueueItem[] }>(
    HttpRequestMethod.GET,
    "/api/sfmc/qq/join/apply-queue"
  );
  if (!result.ok || !Array.isArray(result.data?.queue)) return [];
  return result.data.queue;
}

export async function reportApplied(id: string, ok: boolean, error?: string): Promise<void> {
  await HttpDB.typedRequest(HttpRequestMethod.POST, "/api/sfmc/qq/join/applied", {
    id,
    ok,
    error: error ?? undefined,
  });
}

/** 将一名玩家写入 BDS allowList */
export function applyAllowListAdd(playerName: string): { ok: boolean; error?: string } {
  try {
    if (!dedicatedServer) {
      return { ok: false, error: "dedicatedServer_unavailable" };
    }
    dedicatedServer.allowList.add({ name: playerName });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "allowlist_add_failed" };
  }
}

export function startAllowListPoller(): number {
  return system.runInterval(() => {
    void (async () => {
      const queue = await pullApplyQueue();
      for (const item of queue) {
        const id = String(item.id ?? "");
        const name = String(item.player_name ?? "").trim();
        if (!id || !name) continue;
        const r = applyAllowListAdd(name);
        await reportApplied(id, r.ok, r.error);
        if (r.ok) {
          try {
            world.sendMessage(`§a[√] 已将 ${name} 加入白名单（QQ 入服审批）`);
          } catch {
            /* ignore */
          }
        }
      }
    })();
  }, APPLY_INTERVAL_TICKS);
}
