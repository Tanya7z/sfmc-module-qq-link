/**
 * test/qq-link.test.ts — qq-link 纯逻辑与元数据校验
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { formatConfirmError } from "../sapi/src/util.ts";

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

describe("qq-link metadata & logic", () => {
  it("manifest 契约声明校验", () => {
    const manifest = readManifest();
    assert.equal(manifest.id, "feature-qq-link");
    assert.equal(manifest.configKey, "qq_link");
    assert.match(manifest.id, /^feature-[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
  });

  it("formatConfirmError 覆盖常见码", () => {
    assert.match(formatConfirmError("invalid_code"), /无效/);
    assert.match(formatConfirmError("code_expired"), /过期/);
    assert.match(formatConfirmError("qq_already_bound"), /已绑定/);
    assert.match(formatConfirmError("player_already_bound"), /已绑定/);
    assert.match(formatConfirmError("network_error"), /无法连接/);
    assert.match(formatConfirmError("unknown_x"), /绑定失败/);
  });
});
