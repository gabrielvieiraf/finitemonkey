export const ACTIONS = {
  checkout: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
  setupNode: "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0",
  buildx: "docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1",
  login: "docker/login-action@81c6f93d4bc991e510b342a00b419b3bb4efc5c6 # v4.7.0",
  build: "docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0",
} as const;

export interface DeployTemplateInput {
  readonly branch: string;
  readonly checks: readonly string[];
  readonly node: boolean;
  readonly install: string | undefined;
  readonly port: number;
  readonly health: string;
}

export const WORKFLOW_PATH = ".github/workflows/deploy.yml";
export const REMOTE_PATH = "deploy/remote.sh";
export const COMPOSE_PATH = "deploy/compose.yml";

const header = (input: DeployTemplateInput): readonly string[] => [
  "# Written by finitemonkey deploy generate. The server keeps only compose.yml, .env and the digest.",
  "# One-time setup on the server: a non-root user `deploy` in the docker group, `docker login ghcr.io`",
  "# with a read:packages token, and the app's variables in ~/app/.env.",
  "# Repository secrets: DEPLOY_HOST, DEPLOY_SSH_KEY and DEPLOY_KNOWN_HOSTS (the host line from",
  "# `ssh-keyscan <host>`, checked against the fingerprint the provider shows).",
  "name: Deploy",
  "",
  "on:",
  "  push:",
  `    branches: [${input.branch}]`,
  "  workflow_dispatch:",
  "",
  "permissions: {}",
  "",
  "concurrency:",
  "  group: deploy-production",
  "  cancel-in-progress: false",
  "",
];

const checkJob = (input: DeployTemplateInput): readonly string[] => [
  "  check:",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 15",
  "    permissions:",
  "      contents: read",
  "    steps:",
  `      - uses: ${ACTIONS.checkout}`,
  "        with:",
  "          persist-credentials: false",
  ...(input.node ? [`      - uses: ${ACTIONS.setupNode}`, "        with:", "          node-version: 22"] : []),
  ...(input.install === undefined ? [] : [`      - run: ${input.install}`]),
  ...input.checks.map((command) => `      - run: ${command}`),
];

const imageJob = (): readonly string[] => [
  "  image:",
  "    needs: check",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 20",
  "    permissions:",
  "      contents: read",
  "      packages: write",
  "    outputs:",
  "      image: ${{ steps.name.outputs.image }}",
  "      digest: ${{ steps.build.outputs.digest }}",
  "    steps:",
  `      - uses: ${ACTIONS.checkout}`,
  "        with:",
  "          persist-credentials: false",
  "      - id: name",
  '        run: echo "image=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_OUTPUT"',
  `      - uses: ${ACTIONS.buildx}`,
  `      - uses: ${ACTIONS.login}`,
  "        with:",
  "          registry: ghcr.io",
  "          username: ${{ github.actor }}",
  "          password: ${{ secrets.GITHUB_TOKEN }}",
  "      - id: build",
  `        uses: ${ACTIONS.build}`,
  "        with:",
  "          context: .",
  "          push: true",
  "          tags: ${{ steps.name.outputs.image }}:${{ github.sha }}",
  "          labels: org.opencontainers.image.revision=${{ github.sha }}",
];

const deployJob = (input: DeployTemplateInput): readonly string[] => [
  "  deploy:",
  "    needs: image",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 15",
  "    environment: production",
  "    permissions:",
  "      contents: read",
  "    steps:",
  `      - uses: ${ACTIONS.checkout}`,
  "        with:",
  "          persist-credentials: false",
  "      - name: Pin the server host key",
  "        env:",
  "          KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}",
  "          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}",
  "        run: |",
  "          install -m 700 -d ~/.ssh",
  "          printf '%s\\n' \"$KNOWN_HOSTS\" > ~/.ssh/known_hosts",
  "          printf '%s\\n' \"$SSH_KEY\" > ~/.ssh/deploy_key",
  "          chmod 600 ~/.ssh/known_hosts ~/.ssh/deploy_key",
  "      - name: Start the digest, roll back if unhealthy",
  "        env:",
  "          HOST: ${{ secrets.DEPLOY_HOST }}",
  "          IMAGE: ${{ needs.image.outputs.image }}@${{ needs.image.outputs.digest }}",
  `          HEALTH_URL: http://127.0.0.1:${String(input.port)}${input.health}`,
  "        run: |",
  '          ssh_opts="-i $HOME/.ssh/deploy_key -o StrictHostKeyChecking=yes -o BatchMode=yes"',
  '          scp $ssh_opts deploy/compose.yml "deploy@$HOST:app/compose.yml"',
  '          ssh $ssh_opts "deploy@$HOST" sh -s -- "$IMAGE" "$HEALTH_URL" < deploy/remote.sh',
];

export const deployWorkflow = (input: DeployTemplateInput): string =>
  [...header(input), "jobs:", ...checkJob(input), "", ...imageJob(), "", ...deployJob(input), ""].join("\n");

export const remoteScript = (): string =>
  [
    "#!/bin/sh",
    "set -eu",
    'image="$1"',
    'health="$2"',
    'dir="${DEPLOY_DIR:-$HOME/app}"',
    'tries="${HEALTH_TRIES:-30}"',
    'wait_s="${HEALTH_WAIT_S:-2}"',
    'cd "$dir"',
    "",
    'log() { printf \'%s %s\\n\' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> deploy.log; }',
    "",
    "start() {",
    "  printf 'IMAGE=%s\\n' \"$1\" > image.env",
    "  docker compose --env-file image.env pull app || return 1",
    '  if [ -n "${MIGRATE:-}" ]; then',
    '    docker compose --env-file image.env run --rm app sh -c "$MIGRATE" || return 1',
    "  fi",
    "  docker compose --env-file image.env up -d --no-build --remove-orphans || return 1",
    "}",
    "",
    "healthy() {",
    "  n=0",
    '  while [ "$n" -lt "$tries" ]; do',
    '    if curl -fsS --max-time 5 "$health" > /dev/null 2>&1; then return 0; fi',
    "    n=$((n + 1))",
    '    sleep "$wait_s"',
    "  done",
    "  return 1",
    "}",
    "",
    'previous="$(cat digest 2> /dev/null || true)"',
    'if start "$image" && healthy; then',
    "  printf '%s\\n' \"$image\" > digest",
    '  if [ -n "$previous" ]; then printf \'%s\\n\' "$previous" > previous; fi',
    '  log "deployed $image"',
    "  exit 0",
    "fi",
    'log "unhealthy $image"',
    'if [ -n "$previous" ]; then',
    "  MIGRATE=",
    '  if start "$previous" && healthy; then log "rolled back to $previous"; else log "rollback to $previous is unhealthy"; fi',
    "fi",
    "exit 1",
    "",
  ].join("\n");

export const composeFile = (port: number): string =>
  [
    "# Written by finitemonkey deploy generate. IMAGE comes from deploy/remote.sh as image@sha256:digest.",
    "# Migrations in MIGRATE run before the new version starts and must be expansive (add, never drop);",
    "# drop columns in a later deploy.",
    "services:",
    "  app:",
    "    image: ${IMAGE:?set by deploy/remote.sh}",
    "    restart: unless-stopped",
    "    env_file: .env",
    "    ports:",
    `      - "127.0.0.1:${String(port)}:${String(port)}"`,
    "    security_opt:",
    "      - no-new-privileges:true",
    "",
  ].join("\n");
