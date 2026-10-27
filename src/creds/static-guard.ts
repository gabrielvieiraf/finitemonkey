import { toAbsolutePath } from "../core/brand.js";
import { toPosixPath } from "../core/posix-path.js";
import { logEvent } from "../evidence/log.js";
import { deny, FILE_TOOLS, grantFor, guardRoot } from "../guards/context.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import { toolInput, toolName, writtenTexts } from "../secrets/guards/tool-input.js";
import { fmPaths } from "../task/paths.js";
import { type Cloud, STATIC_CLOUD } from "./classify.js";

const ALLOW: HookDecision = { kind: "allow" };
const WORKFLOW = /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/;
const SECRET_REF = /\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export const OIDC_ALTERNATIVE: Readonly<Record<Cloud, { readonly provider: string; readonly alternative: string }>> = {
  aws: {
    provider: "AWS",
    alternative:
      "`permissions: id-token: write` plus `aws-actions/configure-aws-credentials` with `role-to-assume: arn:aws:iam::<account>:role/<role>`",
  },
  gcp: {
    provider: "Google Cloud",
    alternative:
      "`permissions: id-token: write` plus `google-github-actions/auth` with `workload_identity_provider` and `service_account`",
  },
  azure: {
    provider: "Azure",
    alternative:
      "`permissions: id-token: write` plus `azure/login` with `client-id`, `tenant-id` and `subscription-id`",
  },
};

const staticRefs = (text: string): readonly string[] =>
  [...text.matchAll(SECRET_REF)].map((match) => match[1] ?? "").filter((name) => STATIC_CLOUD[name] !== undefined);

const introduced = (input: HookInput, file: string, texts: readonly string[]): string | undefined => {
  const before = input.runtime.readText(toAbsolutePath(file, guardRoot(input)));
  const known = new Set(before.ok ? staticRefs(before.value) : []);
  return texts.flatMap(staticRefs).find((name) => !known.has(name));
};

export const credsStaticGuard: HookHandler = (input) => {
  const tool = toolName(input.payload);
  if (!FILE_TOOLS.has(tool)) return ALLOW;
  const written = writtenTexts(tool, toolInput(input.payload));
  const file = written[0]?.file ?? "";
  if (!WORKFLOW.test(toPosixPath(file))) return ALLOW;
  const variable = introduced(
    input,
    file,
    written.map((item) => item.text),
  );
  const cloud = variable === undefined ? undefined : STATIC_CLOUD[variable];
  if (variable === undefined || cloud === undefined) return ALLOW;
  const grant = grantFor(input, "creds-static");
  if (grant !== undefined) {
    logEvent(input.runtime, fmPaths(guardRoot(input)), "creds_exception", { file, variable, reason: grant.reason });
    return ALLOW;
  }
  const { provider, alternative } = OIDC_ALTERNATIVE[cloud];
  const params = { file, variable, provider, alternative };
  return deny(modelReason(input.t, "creds.block.static", params), input.t("creds.block.human", params));
};
