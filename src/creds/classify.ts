export type CredType = "static" | "scoped" | "federated";
export type CredRisk = "high" | "medium" | "low";
export type Cloud = "aws" | "gcp" | "azure";

export const STATIC_CLOUD: Readonly<Record<string, Cloud>> = {
  AWS_ACCESS_KEY_ID: "aws",
  AWS_SECRET_ACCESS_KEY: "aws",
  GOOGLE_APPLICATION_CREDENTIALS: "gcp",
  GOOGLE_CREDENTIALS: "gcp",
  GCP_CREDENTIALS: "gcp",
  GCP_SA_KEY: "gcp",
  GCP_SERVICE_ACCOUNT_KEY: "gcp",
  AZURE_CLIENT_SECRET: "azure",
  AZURE_CREDENTIALS: "azure",
  ARM_CLIENT_SECRET: "azure",
};

const FEDERATED =
  /^(?:AWS_ROLE_ARN|AWS_WEB_IDENTITY_TOKEN_FILE|AZURE_FEDERATED_TOKEN_FILE|ACTIONS_ID_TOKEN_REQUEST_\w+|\w*WORKLOAD_IDENTITY_PROVIDER)$/;
const SCOPED = /^(?:GITHUB_TOKEN|GH_TOKEN)$/;
const CREDENTIAL_LIKE =
  /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|DSN|AUTH|CERT|SALT|WEBHOOK|CONNECTION|DATABASE_URL|REDIS_URL|MONGO\w*_URI|_ARN)/;

export const isCredentialName = (name: string): boolean =>
  CREDENTIAL_LIKE.test(name.toUpperCase()) && !/^(?:NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC|NUXT_PUBLIC)_/.test(name);

export const credType = (name: string): CredType => {
  if (FEDERATED.test(name)) return "federated";
  if (SCOPED.test(name)) return "scoped";
  return "static";
};

export const credRisk = (name: string, services: number): CredRisk => {
  const type = credType(name);
  if (type !== "static") return "low";
  return STATIC_CLOUD[name] !== undefined || services > 1 ? "high" : "medium";
};

const PUBLIC_PREFIX = /^(NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC|NUXT_PUBLIC|PUBLIC|GATSBY)_/;
const SECRET_LIKE = /(?:SECRET|PRIVATE|PASSWORD|PASSWD|SERVICE_ROLE|ACCESS_KEY|CREDENTIAL|DATABASE_URL|ADMIN_KEY)/;

export const publicSecretName = (name: string): boolean => {
  const prefix = PUBLIC_PREFIX.exec(name);
  return prefix !== null && SECRET_LIKE.test(name.slice(prefix[0].length));
};
