import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  inspectServiceManagerInstallation,
  type ProbeRunner,
} from "../../src/service-manager-probe";
import { removeTreeWithRetry } from "../helpers/remove-tree";
import { serviceLogPath, serviceStatusSummary } from "../../src/service";
import { isSystemd } from "../../src/service/systemd";

test("Linux reports systemd absent when systemctl cannot be spawned", () => {
  const home = mkdtempSync(join(tmpdir(), "ocx-probe-docker-"));
  const run: ProbeRunner = () => ({
    status: null,
    stdout: "",
    stderr: "spawn systemctl ENOENT",
    timedOut: false,
    spawnFailed: true,
  });

  try {
    expect(inspectServiceManagerInstallation({ run, platform: "linux", home })).toEqual({
      kind: "absent",
    });
  } finally {
    removeTreeWithRetry(home);
  }
});

test("status summary reports service availability or the service log path", () => {
  const summary = serviceStatusSummary();
  if (process.platform === "linux" && existsSync("/.dockerenv")) expect(summary).toBe("unsupported in Docker");
  else if (process.platform === "linux" && !isSystemd()) expect(summary).toBe("unsupported: systemd not found");
  else expect(summary).toContain(serviceLogPath());
});
