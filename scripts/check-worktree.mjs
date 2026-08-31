import { spawnSync } from "node:child_process";

const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (probe.status !== 0 || probe.stdout.trim() !== "true") {
  console.log("Git metadata is not present; worktree diff check skipped for the extracted source package.");
  process.exit(0);
}

const check = spawnSync("git", ["diff", "--check"], { stdio: "inherit" });
if (check.error) throw check.error;
process.exitCode = check.status ?? 1;
