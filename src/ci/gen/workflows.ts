import { checkout, type Job, type Step, type Workflow, workflowText } from "./steps.js";
import type { Toolchain } from "./toolchain.js";

export interface WorkflowInput {
  readonly tools: Toolchain;
  readonly finitemonkey: string;
  readonly mergeQueue: boolean;
  readonly defaultBranch: string;
  readonly attribution: boolean;
  readonly oidc: boolean;
}

export const GATE_JOB = "finitemonkey ci gate";

const ATTRIBUTION_PATTERN =
  "Co-Authored-By:.*(claude|anthropic|copilot|cursor)|noreply@anthropic\\.com|generated with \\[?(claude|copilot|cursor)|claude\\.ai/code/session";

const attributionJob: Job = {
  id: "attribution",
  name: "no AI attribution",
  if: "github.event_name == 'pull_request'",
  timeout: 5,
  steps: [
    {
      name: "pull request title and body credit no AI tool",
      env: {
        TITLE: "${{ github.event.pull_request.title }}",
        BODY: "${{ github.event.pull_request.body }}",
      },
      run: [
        `pattern='${ATTRIBUTION_PATTERN}'`,
        'if printf \'%s\\n%s\\n\' "$TITLE" "$BODY" | grep -Eiq "$pattern"; then',
        '  echo "::error::Remove the AI attribution line from the pull request title or body."',
        "  exit 1",
        "fi",
      ].join("\n"),
    },
  ],
};

export const ciWorkflow = (input: WorkflowInput): string => {
  const gate: Job = {
    id: "check",
    name: GATE_JOB,
    timeout: 20,
    steps: [
      checkout({ "fetch-depth": "0" }),
      ...input.tools.setup,
      ...input.tools.checks,
      ...input.tools.build,
      { name: GATE_JOB, run: `${input.finitemonkey} ci gate` },
    ],
  };
  const workflow: Workflow = {
    name: "CI",
    on: [
      "push:",
      `  branches: [${input.defaultBranch}]`,
      "pull_request:",
      ...(input.mergeQueue ? ["merge_group:"] : []),
    ],
    concurrency: { group: "ci-${{ github.ref }}", cancel: "${{ github.event_name == 'pull_request' }}" },
    jobs: [gate, ...(input.attribution ? [attributionJob] : [])],
  };
  return workflowText(workflow);
};

const DEPLOY_PLACEHOLDER = ['echo "::error::Write the deploy command in .github/workflows/deploy.yml."', "exit 1"].join(
  "\n",
);

export const deployWorkflow = (input: WorkflowInput, command: string | undefined): string =>
  workflowText({
    name: "Deploy",
    on: ["workflow_run:", "  workflows: [CI]", "  types: [completed]", `  branches: [${input.defaultBranch}]`],
    concurrency: { group: "deploy-production", cancel: "false" },
    jobs: [
      {
        id: "deploy",
        if: "github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'",
        timeout: 30,
        environment: "production",
        permissions: { contents: "read", ...(input.oidc ? { "id-token": "write" } : {}) },
        steps: [
          checkout({ ref: "${{ github.event.workflow_run.head_sha }}" }),
          ...input.tools.setup,
          ...input.tools.build,
          { name: "deploy", run: command ?? DEPLOY_PLACEHOLDER },
        ],
      },
    ],
  });

const signedTag: Step = {
  name: "the tag carries a signature GitHub verified",
  env: { GH_TOKEN: "${{ github.token }}", TAG: "${{ github.ref_name }}" },
  run: [
    'sha="$(git rev-parse "refs/tags/$TAG")"',
    'verified="$(gh api "repos/$GITHUB_REPOSITORY/git/tags/$sha" --jq .verification.verified)"',
    'test "$verified" = true || { echo "::error::Tag $TAG is not signed or the signature is not verified."; exit 1; }',
  ].join("\n"),
};

export const releaseWorkflow = (input: WorkflowInput, artifacts: string): string =>
  workflowText({
    name: "Release",
    on: ["push:", '  tags: ["v*"]'],
    concurrency: { group: "release", cancel: "false" },
    jobs: [
      {
        id: "release",
        timeout: 30,
        environment: "release",
        permissions: { contents: "write", "id-token": "write", attestations: "write" },
        steps: [
          checkout({ "fetch-depth": "0" }),
          signedTag,
          ...input.tools.setup,
          ...input.tools.build,
          { uses: "anchore/sbom-action", with: { "output-file": "sbom.spdx.json", "upload-artifact": "false" } },
          { uses: "actions/attest-build-provenance", with: { "subject-path": artifacts } },
          {
            name: "release with changelog and SBOM",
            env: { GH_TOKEN: "${{ github.token }}", TAG: "${{ github.ref_name }}" },
            run: 'gh release create "$TAG" --verify-tag --generate-notes sbom.spdx.json',
          },
        ],
      },
    ],
  });

export const securityWorkflow = (input: WorkflowInput): string =>
  workflowText({
    name: "Security",
    on: ["schedule:", '  - cron: "23 6 * * 1"', "workflow_dispatch:"],
    concurrency: { group: "security", cancel: "true" },
    jobs: [
      {
        id: "security",
        timeout: 20,
        steps: [
          checkout({ "fetch-depth": "0" }),
          ...input.tools.setup.filter((step) => step.uses !== undefined),
          { name: "secrets in the whole history", run: `${input.finitemonkey} secrets scan --history` },
          {
            name: "known vulnerabilities",
            uses: "google/osv-scanner-action/osv-scanner-action",
            with: { "scan-args": "-r ./" },
          },
          { name: "workflow audit", run: `${input.finitemonkey} ci audit` },
        ],
      },
    ],
  });

export const REVIEW_TRIGGER = "@finitemonkey-review";

export const reviewWorkflow = (): string =>
  workflowText({
    name: "Claude review",
    on: ["issue_comment:", "  types: [created]"],
    concurrency: { group: "review-${{ github.event.issue.number }}", cancel: "true" },
    jobs: [
      {
        id: "review",
        if: [
          "github.event.issue.pull_request",
          `contains(github.event.comment.body, '${REVIEW_TRIGGER}')`,
          'contains(fromJSON(\'["OWNER","MEMBER","COLLABORATOR"]\'), github.event.comment.author_association)',
        ].join(" && "),
        timeout: 15,
        permissions: { contents: "read", "pull-requests": "read" },
        steps: [
          checkout(),
          {
            id: "app",
            name: "token of the review app",
            uses: "actions/create-github-app-token",
            with: {
              "client-id": "${{ vars.REVIEW_APP_CLIENT_ID }}",
              "private-key": "${{ secrets.REVIEW_APP_PRIVATE_KEY }}",
              "permission-contents": "read",
              "permission-pull-requests": "write",
            },
          },
          {
            uses: "anthropics/claude-code-action",
            with: {
              anthropic_api_key: "${{ secrets.ANTHROPIC_API_KEY }}",
              github_token: "${{ steps.app.outputs.token }}",
              trigger_phrase: `"${REVIEW_TRIGGER}"`,
            },
          },
        ],
      },
    ],
  });
