import { restoreConfig } from "../../db/restore.js";
import { CONFIG_FILE, parseConfigYaml } from "../../git/project-config.js";
import { checkout, workflowText } from "./steps.js";
import type { WorkflowInput } from "./workflows.js";

export const RESTORE_DRILL_ENVIRONMENT = "restore-drill";
const WEEKLY = "17 5 * * 1";
const MONTHLY = "17 5 1 * *";
const WEEK_DAYS = 7;

export const drillPeriodDays = (read: (path: string) => string | undefined): number =>
  restoreConfig(parseConfigYaml(read(CONFIG_FILE) ?? "")).periodDays;

export const drillCron = (periodDays: number): string => (periodDays <= WEEK_DAYS ? WEEKLY : MONTHLY);

export const restoreDrillWorkflow = (input: WorkflowInput, periodDays: number): string =>
  workflowText({
    name: "Restore drill",
    on: ["schedule:", `  - cron: "${drillCron(periodDays)}"`, "workflow_dispatch:"],
    concurrency: { group: "restore-drill", cancel: "false" },
    jobs: [
      {
        id: "drill",
        timeout: 60,
        environment: RESTORE_DRILL_ENVIRONMENT,
        permissions: { contents: "read" },
        steps: [
          checkout(),
          ...input.tools.setup,
          { name: "restore the latest backup into a throwaway target", run: `${input.finitemonkey} restore drill` },
        ],
      },
    ],
  });
