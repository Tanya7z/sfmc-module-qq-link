/**
 * kick.ts — 消费踢人队列，在服务端上下文执行 kick 命令
 */

import { Player, system, world } from "@minecraft/server";
import { HttpRequestMethod } from "@minecraft/server-net";
import { HttpDB } from "@sfmc-bds/sdk/sapi/runtime";

export const KICK_INTERVAL_TICKS = 20 * 5;

type ActionItem = {
  id?: string;
  kind?: string;
  target_name?: string;
  reason?: string;
};

export async function pullActionQueue(): Promise<ActionItem[]> {
  const result = await HttpDB.typedRequest<{ success?: boolean; queue?: ActionItem[] }>(
    HttpRequestMethod.GET,
    "/api/sfmc/qq/admin/action-queue"
  );
  if (!result.ok || !Array.isArray(result.data?.queue)) return [];
  return result.data.queue;
}

export async function reportActionDone(id: string, ok: boolean, error?: string): Promise<void> {
  await HttpDB.typedRequest(HttpRequestMethod.POST, "/api/sfmc/qq/admin/action-done", {
    id,
    ok,
    error: error ?? undefined,
  });
}

function findOnlineByName(name: string): Player | undefined {
  const lower = name.toLowerCase();
  return world.getAllPlayers().find((p) => p.name.toLowerCase() === lower);
}

export function startKickPoller(): number {
  return system.runInterval(() => {
    void (async () => {
      const queue = await pullActionQueue();
      for (const item of queue) {
        const id = String(item.id ?? "");
        if (!id) continue;
        if (String(item.kind) !== "kick") {
          await reportActionDone(id, false, "unsupported_kind");
          continue;
        }
        const target = String(item.target_name ?? "").trim();
        const reason = String(item.reason ?? "QQ 管理员踢出");
        const player = findOnlineByName(target);
        if (!player) {
          await reportActionDone(id, false, "player_offline");
          continue;
        }
        try {
          const safeName = player.name.replace(/["\r\n]/g, "").trim();
          const safeReason = reason.replace(/[\x00-\x1f]/g, " ").trim();
          if (!safeName) throw new Error("invalid_player_name");
          await new Promise<void>((resolve, reject) => {
            system.run(() => {
              try {
                world.getDimension("overworld").runCommand(
                  `kick "${safeName}" ${safeReason || "QQ 管理员踢出"}`,
                );
                resolve();
              } catch (error) {
                reject(error);
              }
            });
          });
          await reportActionDone(id, true);
        } catch (e) {
          await reportActionDone(id, false, (e as Error).message || "kick_failed");
        }
      }
    })();
  }, KICK_INTERVAL_TICKS);
}
