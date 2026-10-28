export const DS_SYNC_FEATURE = "ds-sync";
export const DS_WORKFLOW = ".github/workflows/ds-sync.yml";
export const DS_BRANCH = "ds-sync/update";

interface Pin {
  readonly name: string;
  readonly sha: string;
  readonly version: string;
}

const CHECKOUT: Pin = {
  name: "actions/checkout",
  sha: "3d3c42e5aac5ba805825da76410c181273ba90b1",
  version: "v7.0.1",
};
const SETUP_NODE: Pin = {
  name: "actions/setup-node",
  sha: "949feb2413d6458794dcd2491c4babbbce0c15c1",
  version: "v7.1.0",
};
const APP_LOGIN: Pin = {
  name: "actions/create-github-app-token",
  sha: "64ab729a6294000f5aa4a4bc0b73d1f32bc45510",
  version: "v3.3.0",
};

const uses = (pin: Pin): string => `${pin.name}@${pin.sha} # ${pin.version}`;

export interface DsWorkflowInput {
  readonly source: string;
  readonly sourceDir: string;
  readonly targetDir: string;
  readonly prototypes: string;
  readonly version: string;
}

const expression = (inner: string): string => `\${{ ${inner} }}`;

const HEADER = [
  "name: ds-sync",
  "",
  "on:",
  "  repository_dispatch:",
  "    types: [design-system-updated]",
  "  schedule:",
  '    - cron: "23 6 * * *"',
  "  workflow_dispatch:",
  "",
  "permissions:",
  "  contents: read",
  "",
  "concurrency:",
  "  group: ds-sync",
  "  cancel-in-progress: false",
  "",
  "jobs:",
  "  sync:",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 15",
  "    steps:",
] as const;

const checkoutSteps = (input: DsWorkflowInput): readonly string[] => {
  const [, sourceRepo = input.source] = input.source.split("/");
  return [
    "      - name: Token from the organization GitHub App",
    "        id: app",
    `        uses: ${uses(APP_LOGIN)}`,
    "        with:",
    `          app-id: ${expression("vars.DS_SYNC_APP_ID")}`,
    `          private-key: ${expression("secrets.DS_SYNC_APP_PRIVATE_KEY")}`,
    `          owner: ${expression("github.repository_owner")}`,
    `          repositories: ${expression("github.event.repository.name")},${sourceRepo}`,
    `      - uses: ${uses(CHECKOUT)}`,
    "        with:",
    "          path: product",
    "          persist-credentials: false",
    `      - uses: ${uses(CHECKOUT)}`,
    "        with:",
    `          repository: ${input.source}`,
    "          path: prototypes",
    `          token: ${expression("steps.app.outputs.token")}`,
    "          persist-credentials: false",
    `      - uses: ${uses(SETUP_NODE)}`,
    "        with:",
    "          node-version: 22",
  ];
};

const syncSteps = (input: DsWorkflowInput): readonly string[] => {
  const cli = `npx --yes finitemonkey@${input.version}`;
  return [
    "      - name: Copy the design system and write the summary",
    `        run: ${cli} ds-sync apply --from prototypes/${input.sourceDir} --to product/${input.targetDir} --summary summary.md`,
    "      - name: Open or update the sync pull request",
    "        working-directory: product",
    "        env:",
    `          GH_TOKEN: ${expression("steps.app.outputs.token")}`,
    "        run: |",
    '          git config user.name "ds-sync[bot]"',
    '          git config user.email "ds-sync[bot]@users.noreply.github.com"',
    `          git switch -C ${DS_BRANCH}`,
    `          git add -A ${input.targetDir}`,
    "          if git diff --cached --quiet; then exit 0; fi",
    '          git commit -m "chore(design-system): sync from prototypes"',
    `          git push --force "https://x-access-token:$GH_TOKEN@github.com/$GITHUB_REPOSITORY.git" ${DS_BRANCH}`,
    `          gh pr edit ${DS_BRANCH} --body-file ../summary.md || gh pr create --head ${DS_BRANCH} --title "chore(design-system): sync from prototypes" --body-file ../summary.md`,
    "      - name: Open or update one issue per prototype ready for dev",
    "        working-directory: product",
    "        env:",
    `          GH_TOKEN: ${expression("steps.app.outputs.token")}`,
    `        run: ${cli} ds-sync issue ../prototypes/${input.prototypes} --yes`,
  ];
};

export const dsWorkflow = (input: DsWorkflowInput): string =>
  [...HEADER, ...checkoutSteps(input), ...syncSteps(input), ""].join("\n");
