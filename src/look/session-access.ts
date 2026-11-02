import { localSend } from "../app/node-probe.js";
import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { loadProjectConfig } from "../git/project-config.js";
import { accessConfig, resourcesOf, scanRoutes } from "../scenarios/plan.js";
import { localUrl, seedHttp, userHeaders } from "../scenarios/run.js";
import type { SessionAccess } from "./ux-sessions.js";

export const sessionAccess = (runtime: Runtime, root: AbsolutePath): SessionAccess | undefined => {
  const config = accessConfig(loadProjectConfig(runtime, root));
  if (config === undefined) return undefined;
  return {
    users: userHeaders(config),
    ...(config.flowUser === undefined ? {} : { flowUser: config.flowUser }),
    seed: async () => {
      await seedHttp(
        resourcesOf(scanRoutes(runtime, root)),
        config,
        localSend((path) => localUrl(config.port, path)),
      );
    },
  };
};
