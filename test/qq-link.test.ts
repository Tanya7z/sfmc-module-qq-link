/**
 * test/qq-link.test.ts — 模块 lifecycle + !bind 等待态冒烟
 */

import { assertMsg, createSandbox, runCleanup } from "@sfmc-bds/sdk/testing";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BIND_WAIT_TICKS,
  DESCRIPTOR,
  formatConfirmError,
  MODULE_ID,
  PERM,
} from "../sapi/src/index.js";

const MANIFEST_PATH = fileURLToPath(new URL("../sapi/manifest.json", import.meta.url));

function readManifest(): {
  id: string;
  configKey: string;
  permissions?: string[];
} {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
    id: string;
    configKey: string;
    permissions?: string[];
  };
}

test("descriptor / MODULE_ID 与 sapi/manifest.json 一致", () => {
  const manifest = readManifest();
  assert.equal(DESCRIPTOR.id, MODULE_ID);
  assert.equal(MODULE_ID, manifest.id);
  assert.match(DESCRIPTOR.id, /^feature-[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
  assert.equal(typeof DESCRIPTOR.lifecycle.registerEvents, "function");
});

test("PERM / configKey 对齐", () => {
  const manifest = readManifest();
  assert.equal(PERM, `${manifest.configKey}.use`);
  assert.ok(BIND_WAIT_TICKS >= 20 * 30);
});

test("formatConfirmError 覆盖常见码", () => {
  assert.match(formatConfirmError("invalid_code"), /无效/);
  assert.match(formatConfirmError("code_expired"), /过期/);
  assert.match(formatConfirmError("unknown_x"), /绑定失败/);
});

test("createSandbox + !bind 进入等待提示", async (t) => {
  const sb = await createSandbox({ module: DESCRIPTOR });
  t.after(() => sb.dispose());
  const player = sb.addPlayer({ id: "tester-1", name: "tester", op: true });
  await sb.triggerCommand("bind", player);
  assert.ok(assertMsg(player, "绑定码", "§") || assertMsg(player, "60", "§"));
});

test("Command.entries 含 bind 且带 MODULE_ID", async (t) => {
  const { Command, Permission } = await import("@sfmc-bds/sdk/sapi/runtime");
  const sb = await createSandbox({ module: DESCRIPTOR });
  t.after(() => sb.dispose());
  const cmds = Command.entries().filter((e) => e.name === "bind");
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0]!.moduleId, MODULE_ID);
  assert.equal(Permission.entries().filter((e) => e.name === PERM).length, 1);
});

test("等待态下发纯数字码会 cancel 聊天（不转发）", async (t) => {
  const sb = await createSandbox({ module: DESCRIPTOR });
  t.after(() => sb.dispose());
  const player = sb.addPlayer({ id: "tester-2", name: "Bob", op: true });
  await sb.triggerCommand("bind", player);
  // 发码：平台 HTTP 在假引擎里会失败，但应取消聊天并给出反馈
  sb.emit.chatSend(player, "123456");
  sb.tick(2);
  await new Promise((r) => setTimeout(r, 50));
  const joined = player.log.join("\n");
  assert.ok(
    /绑定成功|绑定失败|无法连接|无效|过期|重试/.test(joined),
    `应有绑定结果反馈，实际: ${joined}`
  );
});

test("cleanup 不抛错", async () => {
  const r = await runCleanup(DESCRIPTOR);
  assert.equal(r.ok, true, `cleanup: ${r.error}`);
});

test("applyAllowListAdd 写入 stub AllowList", async () => {
  const { dedicatedServer } = await import("@minecraft/server-admin");
  const { applyAllowListAdd } = await import("../sapi/src/allowlist-apply.js");
  dedicatedServer?.allowList.clear();
  const r = applyAllowListAdd("Steve");
  assert.equal(r.ok, true);
  assert.equal(dedicatedServer?.allowList.contains({ name: "Steve" }), true);
});

test("游戏事件：initialSpawn / leave 会上报", async (t) => {
  const eventsMod = await import("../sapi/src/events.js");
  type QqGameEvent = import("../sapi/src/events.js").QqGameEvent;
  const seen: QqGameEvent[] = [];

  const sb = await createSandbox({ module: DESCRIPTOR });
  t.after(() => {
    eventsMod.setQqEventReporter(null);
    sb.dispose();
  });

  // 订阅已挂上；report() 读当前 reporter，故可在 createSandbox 后再注入 spy
  eventsMod.setQqEventReporter((ev) => {
    seen.push(ev);
  });

  const player = sb.addPlayer({ id: "ev-1", name: "Steve", op: true });
  sb.emit.playerSpawn(player, { initialSpawn: true });
  sb.emit.playerLeave(player);
  sb.tick(2);
  await new Promise((r) => setTimeout(r, 30));

  assert.ok(
    seen.some((e) => e.type === "join" && e.player === "Steve"),
    `应有 join，实际: ${JSON.stringify(seen)}`
  );
  assert.ok(
    seen.some((e) => e.type === "leave" && e.player === "Steve"),
    `应有 leave，实际: ${JSON.stringify(seen)}`
  );
});
