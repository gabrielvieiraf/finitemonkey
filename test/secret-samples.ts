const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

export const ALNUM = `${UPPER}${LOWER}${DIGITS}`;
export const BASE32 = `${UPPER}234567`;
export const BASE64 = `${ALNUM}+/`;
export const URLSAFE = `${ALNUM}_-`;

const generator = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
};

export const randomText = (length: number, alphabet: string = ALNUM, seed = 7): string => {
  const next = generator(seed);
  let out = "";
  for (let index = 0; index < length; index += 1) out += alphabet.charAt(next() % alphabet.length);
  return out;
};

const join = (...parts: readonly string[]): string => parts.join("");

export const SAMPLES = {
  awsAccessKey: join("AK", "IA", randomText(16, BASE32, 11)),
  awsSecretKey: randomText(40, BASE64, 12),
  githubPat: join("gh", "p_", randomText(36, ALNUM, 13)),
  githubOauth: join("gh", "o_", randomText(36, ALNUM, 14)),
  githubApp: join("gh", "s_", randomText(36, ALNUM, 15)),
  githubRefresh: join("gh", "r_", randomText(36, ALNUM, 16)),
  githubFineGrained: join("github", "_pat_", randomText(82, `${ALNUM}_`, 17)),
  gitlabPat: join("gl", "pat-", randomText(20, URLSAFE, 18)),
  npmToken: join("np", "m_", randomText(36, ALNUM, 19)),
  slackBot: join(
    "xo",
    "xb-",
    randomText(11, DIGITS, 20),
    "-",
    randomText(12, DIGITS, 21),
    "-",
    randomText(24, ALNUM, 22),
  ),
  slackUser: join(
    "xo",
    "xp-",
    randomText(11, DIGITS, 23),
    "-",
    randomText(11, DIGITS, 24),
    "-",
    randomText(12, DIGITS, 25),
    "-",
    randomText(32, `${LOWER}${DIGITS}`, 26),
  ),
  slackApp: join(
    "xa",
    "pp-1-A",
    randomText(10, `${UPPER}${DIGITS}`, 27),
    "-",
    randomText(13, DIGITS, 28),
    "-",
    randomText(64, `${LOWER}${DIGITS}`, 29),
  ),
  slackWebhook: join(
    "https://hooks.",
    "slack.com/services/T",
    randomText(8, `${UPPER}${DIGITS}`, 30),
    "/B",
    randomText(8, `${UPPER}${DIGITS}`, 31),
    "/",
    randomText(24, ALNUM, 32),
  ),
  stripeLive: join("sk", "_live_", randomText(32, ALNUM, 33)),
  anthropic: join("sk-", "ant-", "api03-", randomText(93, URLSAFE, 34), "AA"),
  openai: join("sk-", "proj-", randomText(40, URLSAFE, 35), "T3Blbk", "FJ", randomText(40, URLSAFE, 36)),
  gcp: join("AI", "za", randomText(35, URLSAFE, 37)),
  asaas: join("$aa", "ct_", "prod_", randomText(120, `${BASE64}=`, 38)),
  privateKey: join(
    "-----BEGIN RSA ",
    "PRIVATE KEY-----\n",
    randomText(64, BASE64, 39),
    "\n",
    randomText(64, BASE64, 40),
    "\n",
    randomText(40, BASE64, 41),
    "\n-----END RSA ",
    "PRIVATE KEY-----",
  ),
  jwt: join("ey", "JhbGciOiJIUzI1NiJ9.", "ey", "J", randomText(60, URLSAFE, 42), ".", randomText(43, URLSAFE, 43)),
  urlPassword: randomText(20, ALNUM, 44),
  genericValue: randomText(32, ALNUM, 45),
  password: join(randomText(10, ALNUM, 46), "9#q"),
  argValue: randomText(18, ALNUM, 47),
} as const;

export type SampleName = keyof typeof SAMPLES;
