import { mkdirSync, cpSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const temp = mkdtempSync(join(tmpdir(), "clocktower-package-"));
const folder = join(temp, "clocktower-tb");
mkdirSync(folder);
try {
  for (const file of [
    "dist",
    "dist-server",
    "package.json",
    "package-lock.json",
    "README.md",
    "THIRD_PARTY_NOTICES.md",
    "启动说书人.command",
  ])
    cpSync(file, join(folder, file), { recursive: true });
  mkdirSync(join(folder, "scripts"));
  cpSync("scripts/launch.mjs", join(folder, "scripts/launch.mjs"));
  mkdirSync(join(folder, "licenses"));
  cpSync(
    "src/vendor/LICENSE.tiny-grimoire",
    join(folder, "licenses/LICENSE.tiny-grimoire"),
  );
  mkdirSync("release", { recursive: true });
  const archive = resolve("release/clocktower-tb-local.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", temp, "clocktower-tb"]);
  console.log(
    `${archive}\n${(statSync(archive).size / 1024).toFixed(1)} KiB; excludes upstream, node_modules, test data, SQLite, and screenshots.`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
