export const ONBOARD_START_FEATURE = "onboard-start";
export const MERGE_CANDIDATES_FEATURE = "merge-candidates";
export const MERGE_FETCH_FEATURE = "merge-fetch";
export const WAVE_CHECKS_FEATURE = "wave-checks";
export const STATUSLINE_LOOP_FEATURE = "statusline-loop";

export const MERGE_GUARDS = [
  ONBOARD_START_FEATURE,
  MERGE_CANDIDATES_FEATURE,
  MERGE_FETCH_FEATURE,
  WAVE_CHECKS_FEATURE,
  STATUSLINE_LOOP_FEATURE,
] as const;
