const DEFAULT_BRANCHES = ["main", "master"] as const;

const pushTo = (branch: string): readonly string[] => [
  `Bash(git push * ${branch})`,
  `Bash(git push * ${branch} *)`,
  `Bash(git push *:${branch})`,
  `Bash(git push *:${branch} *)`,
];

export const ASK_FLOOR = {
  push: DEFAULT_BRANCHES.flatMap(pushTo),
  deploy: [
    "Bash(npm publish *)",
    "Bash(pnpm publish *)",
    "Bash(yarn publish *)",
    "Bash(yarn npm publish *)",
    "Bash(bun publish *)",
    "Bash(vercel * --prod*)",
    "Bash(vercel --prod*)",
    "Bash(netlify deploy * --prod*)",
    "Bash(fly deploy *)",
    "Bash(flyctl deploy *)",
    "Bash(firebase deploy *)",
    "Bash(wrangler deploy *)",
    "Bash(serverless deploy *)",
    "Bash(sls deploy *)",
    "Bash(cdk deploy *)",
    "Bash(terraform apply *)",
    "Bash(tofu apply *)",
    "Bash(pulumi up *)",
    "Bash(kubectl apply *)",
    "Bash(helm install *)",
    "Bash(helm upgrade *)",
  ],
} as const;

export const ASK_RULES: readonly string[] = [...ASK_FLOOR.push, ...ASK_FLOOR.deploy];
