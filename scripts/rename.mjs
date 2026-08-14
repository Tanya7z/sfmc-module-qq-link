#!/usr/bin/env node
/**
 * scripts/rename.mjs — 把模板里 example 占位符替换为你的模块 id。
 *
 * 用法：
 *   node scripts/rename.mjs <kebab-id> --scope <npmUser> [--name <显示名>]
 *   node scripts/rename.mjs <kebab-id> --official [--name <显示名>]
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const PLACEHOLDER_ID = "example";
const PLACEHOLDER_PERM = "example.use";
const PLACEHOLDER_LOGICAL = "feature-example";
const PLACEHOLDER_CONFIG = "example";
const PLACEHOLDER_DISPLAY = "示例模块";
const PLACEHOLDER_MSG = "示例模块已就绪";
const PLACEHOLDER_PKG = "@CHANGE_ME/sfmc-module-example";

function die(msg, code = 1) {
  console.error(`[rename] ${msg}`);
  process.exit(code);
}

function parseArgs(argv) {
  const flags = { name: null, scope: null, official: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") flags.name = argv[++i] ?? null;
    else if (a.startsWith("--name=")) flags.name = a.slice("--name=".length);
    else if (a === "--scope") flags.scope = argv[++i] ?? null;
    else if (a.startsWith("--scope=")) flags.scope = a.slice("--scope=".length);
    else if (a === "--official") flags.official = true;
    else if (a.startsWith("--")) die(`未知参数: ${a}`);
    else positional.push(a);
  }
  return { flags, positional };
}

const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function main() {
  const ROOT = process.cwd();
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const folderId = positional[0];
  if (!folderId) die("用法: node scripts/rename.mjs <kebab-id> --scope <user> [--name 显示名]");
  if (!KEBAB_RE.test(folderId)) die(`id 须为小写 kebab-case（例: my-feature），收到: ${folderId}`);
  if (folderId === PLACEHOLDER_ID) die("id 不能仍为 example；请换一个。");
  if (folderId.startsWith("feature-") || folderId.startsWith("core-")) {
    die("id 须为短名（不含 feature-/core- 前缀），例如 area 而非 feature-area");
  }
  if (!flags.official && !flags.scope) {
    die("社区包请传 --scope <npm用户名>；官方包请传 --official");
  }

  const logicalId = `feature-${folderId}`;
  const configKey = folderId.replace(/-/g, "_");
  const cmdName = folderId.replace(/-/g, "_");
  const displayName = (flags.name ?? folderId).trim();
  const scope = (flags.scope ?? "").replace(/^@/, "");
  const pkgName = flags.official ? `@sfmc-bds/module-${folderId}` : `@${scope}/sfmc-module-${folderId}`;
  const readyMsg = `${displayName}已就绪`;

  const replace = (file, replacer) => {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) {
      console.warn(`[rename] 跳过（不存在）: ${file}`);
      return;
    }
    const before = fs.readFileSync(abs, "utf8");
    const after = replacer(before);
    if (after === before) {
      console.log(`[rename] 无变更: ${file}`);
      return;
    }
    fs.writeFileSync(abs, after, "utf8");
    console.log(`[rename] 已写入: ${file}`);
  };

  replace("package.json", (s) => s.replaceAll(PLACEHOLDER_PKG, pkgName));

  replace("sapi/manifest.json", (s) => {
    let r = s;
    r = r.replaceAll(`"${PLACEHOLDER_LOGICAL}"`, `"${logicalId}"`);
    r = r.replaceAll(`"${PLACEHOLDER_DISPLAY}"`, `"${displayName}"`);
    r = r.replaceAll(`"${PLACEHOLDER_CONFIG}"`, `"${configKey}"`);
    r = r.replaceAll(`config:read:${PLACEHOLDER_CONFIG}`, `config:read:${configKey}`);
    return r;
  });

  replace("sapi/src/index.ts", (s) => {
    let r = s;
    r = r.replaceAll(PLACEHOLDER_PKG, pkgName);
    r = r.replaceAll(`"${PLACEHOLDER_LOGICAL}"`, `"${logicalId}"`);
    r = r.replaceAll(`"${PLACEHOLDER_PERM}"`, `"${cmdName}.use"`);
    r = r.replaceAll(`"${PLACEHOLDER_ID}"`, `"${cmdName}"`);
    r = r.replaceAll(`"${PLACEHOLDER_MSG}"`, `"${readyMsg}"`);
    r = r.replaceAll(PLACEHOLDER_DISPLAY, displayName);
    return r;
  });

  replace("README.md", (s) => {
    let r = s.replaceAll(PLACEHOLDER_ID, folderId);
    r = r.replaceAll(PLACEHOLDER_LOGICAL, logicalId);
    return r;
  });

  const oldTest = path.join(ROOT, "test", "example.test.ts");
  const newTest = path.join(ROOT, "test", `${folderId}.test.ts`);
  if (fs.existsSync(oldTest)) {
    let body = fs.readFileSync(oldTest, "utf8");
    body = body
      .replaceAll(`"${PLACEHOLDER_ID}"`, `"${cmdName}"`)
      .replaceAll(PLACEHOLDER_ID, folderId)
      .replaceAll(PLACEHOLDER_LOGICAL, logicalId)
      .replaceAll(PLACEHOLDER_MSG, readyMsg)
      .replaceAll(PLACEHOLDER_PERM, `${cmdName}.use`);
    fs.writeFileSync(newTest, body, "utf8");
    if (oldTest !== newTest) fs.unlinkSync(oldTest);
    console.log(`[rename] 已写入: test/${folderId}.test.ts`);
  }

  replace(".sfmc/sandbox-script.json", (s) => {
    let r = s.replaceAll(`"!${PLACEHOLDER_ID}"`, `"!${cmdName}"`);
    r = r.replaceAll(PLACEHOLDER_MSG, readyMsg);
    return r;
  });

  console.log(`\n[rename] 完成。新 id: ${folderId}（manifest id: ${logicalId}）`);
  console.log(`[rename] npm: ${pkgName}`);
  console.log("[rename] 接下来:");
  console.log("          npm install && npm run typecheck && npm test");
  console.log(`          sfmc mod install ${folderId} --from dir:${ROOT} --link`);
  console.log("          （在 SFMC 工作目录执行；扩展也可设 sfmc.root 后 Start Watch）");
}

main();
