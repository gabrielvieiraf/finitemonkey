import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { configAt, configList, parseConfigYaml } from "../git/project-config.js";
import { CITE_FEATURE, citeVerifier } from "../judge/cite.js";
import type { JudgeDeps } from "../judge/deps.js";
import { curlFetcher } from "../judge/fetch.js";
import {
  DEFAULT_NUMBER_EXCEPTIONS,
  NUMBER_FEATURE,
  type NumberOptions,
  numberVerifier,
} from "../judge/number-verify.js";
import { NUMBER_LOCALES } from "../judge/numbers.js";
import { oneOf } from "../judge/types.js";
import { DEFAULT_VERIFIERS } from "../judge/verify.js";
import { featureMode } from "../policy/feature.js";
import { policyPath } from "../policy/policy.js";
import { type FmPaths, fmPaths } from "../task/paths.js";

export const numberOptions = (ctx: Pick<Ctx, "runtime">, paths: FmPaths): NumberOptions => {
  const text = ctx.runtime.readText(policyPath(paths.root));
  const tree = text.ok ? parseConfigYaml(text.value) : {};
  const exceptions = configList(tree, "judge", "numberExceptions");
  return {
    locale: oneOf(NUMBER_LOCALES, configAt(tree, "judge", "numberLocale")) ?? "en",
    exceptions: exceptions.length === 0 ? DEFAULT_NUMBER_EXCEPTIONS : exceptions,
  };
};

export const judgeDeps = (ctx: Ctx, root: string): JudgeDeps => {
  const paths = fmPaths(toAbsolutePath(root));
  const on = (feature: string): boolean => featureMode(ctx.runtime, paths, feature) !== "off";
  const cite = on(CITE_FEATURE);
  return {
    runtime: ctx.runtime,
    paths,
    ...(cite ? { fetcher: curlFetcher(ctx.runtime, root) } : {}),
    verifiers: {
      ...DEFAULT_VERIFIERS,
      ...(cite ? { "source-span": citeVerifier, prose: citeVerifier } : {}),
      ...(on(NUMBER_FEATURE) ? { number: numberVerifier(numberOptions(ctx, paths)) } : {}),
    },
  };
};
