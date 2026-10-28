export const CLASSIFICATIONS = ["fixes-itself", "asks"] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

const ASKS =
  /Resource not accessible by integration|HttpError: 40[13]|Bad credentials|secret\S* (?:is )?(?:not set|missing|empty)|rate limit|No space left on device|runner has received a shutdown|lost communication with the server|operation was canceled|maximum execution time|ETIMEDOUT|ECONNRESET|EAI_AGAIN|getaddrinfo|50[23] (?:Bad Gateway|Service Unavailable)|Permission denied \(publickey\)|waiting for approval|environment protection rules/i;

const FIXES_ITSELF =
  /error TS\d+|\beslint\b|prettier|Code style issues|AssertionError|\bFAIL\b|failing tests?|Tests? failed|SyntaxError|TypeError|ReferenceError|\bruff\b|\bmypy\b|\bpytest\b|commitlint|Conventional Commit|finitemonkey ci gate/i;

export const classifyLog = (log: string): Classification => {
  if (ASKS.test(log)) return "asks";
  return FIXES_ITSELF.test(log) ? "fixes-itself" : "asks";
};
