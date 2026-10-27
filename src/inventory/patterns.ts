export interface GrepPattern {
  readonly pattern: string;
  readonly ignoreCase?: boolean;
}

export const ROUTES: GrepPattern = {
  pattern:
    "(^|[^A-Za-z0-9_])(app|router|server|api|route|r)\\.(get|post|put|patch|delete|all|route)\\(|@(Get|Post|Put|Patch|Delete|Request)(Mapping)?\\(|@(app|router|bp|blueprint)\\.(route|get|post|put|patch|delete)\\(|(^|[^A-Za-z0-9_])path\\([\"']|HandleFunc\\(",
};

export const TABLES: GrepPattern = {
  pattern:
    "create table|(pg|sqlite|mysql)Table\\(|^model [A-Z][A-Za-z0-9_]* *\\{|__tablename__|@Entity\\(|createTable\\(|(^|[^A-Za-z0-9_])define\\([\"'][A-Za-z_]+[\"'], *\\{",
  ignoreCase: true,
};

export const QUEUES: GrepPattern = {
  pattern:
    "new (Queue|Worker|QueueScheduler)\\(|createQueue\\(|@Processor\\(|\\.consume\\(|(^|[^A-Za-z0-9_])sqs([^A-Za-z0-9_]|$)|SendMessageCommand|(^|[^A-Za-z0-9_])kafka([^A-Za-z0-9_]|$)|(^|[^A-Za-z0-9_])amqp([^A-Za-z0-9_]|$)|(^|[^A-Za-z0-9_])pubsub([^A-Za-z0-9_]|$)|@shared_task|@celery",
  ignoreCase: true,
};

export const JOBS: GrepPattern = {
  pattern:
    "cron\\.schedule\\(|new CronJob\\(|@Cron\\(|@Scheduled\\(|^[[:space:]]*-? *cron: |schedule\\.every\\(|setInterval\\(",
};

export const ENV: GrepPattern = {
  pattern:
    'process\\.env(\\.[A-Z_][A-Z0-9_]*|\\[["\'][A-Z_][A-Z0-9_]*)|import\\.meta\\.env\\.[A-Z_]|os\\.environ|os\\.getenv\\(|Getenv\\(|ENV\\[["\'][A-Z_]|env\\("[A-Z_]',
};

export const CREDENTIAL_HINTS: GrepPattern = {
  pattern:
    "(key|secret|token|passw|pwd|bearer|auth|credential|private)|sk_live|ghp_|github_pat_|AKIA|xox[bp]-|-----BEGIN|://[^/ ]+:[^@ ]+@",
  ignoreCase: true,
};

const ENV_NAME =
  /(?:process\.env\.|process\.env\[["']|import\.meta\.env\.|os\.environ\.get\(["']|os\.environ\[["']|os\.getenv\(["']|Getenv\(["']|ENV\[["']|env\(["'])([A-Z_][A-Z0-9_]*)/g;

export const envNamesIn = (text: string): readonly string[] =>
  [...text.matchAll(ENV_NAME)].map((match) => match[1] ?? "").filter((name) => name !== "");

export const SKIPPED = [
  ":(exclude,glob)**/node_modules/**",
  ":(exclude,glob)**/dist/**",
  ":(exclude,glob)**/build/**",
  ":(exclude,glob)**/vendor/**",
  ":(exclude,glob)**/*.min.js",
  ":(exclude,glob)**/package-lock.json",
  ":(exclude,glob)**/yarn.lock",
  ":(exclude,glob)**/pnpm-lock.yaml",
  ":(exclude,glob)docs/plan/**",
  ":(exclude,glob).finitemonkey/**",
];

export const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;

export const DEPLOY_FILE =
  /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml|fly\.toml|vercel\.json|netlify\.toml|Procfile|render\.yaml|app\.yaml|serverless\.ya?ml|wrangler\.toml|railway\.json)$|^\.github\/workflows\/|\.tf$|(^|\/)(k8s|kubernetes|helm|deploy)\//;
