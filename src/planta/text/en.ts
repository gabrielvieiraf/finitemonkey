import type { BlueprintText } from "./types.js";

export const en: BlueprintText = {
  problem: {
    title: "Problem and audience written down",
    why: "Without a named problem and person, every feature looks equally urgent.",
    minimum: "One paragraph: who has the problem, what it costs them today, how they solve it now.",
  },
  rules: {
    title: "Business rules written",
    why: "Rules that live only in someone's head get coded differently in each screen.",
    minimum: "A document under docs/ with the rules the code must follow, one per line.",
  },
  pricing: {
    title: "Plans and prices",
    why: "Billing, limits and the landing page all depend on what each plan includes.",
    minimum: "A table of plans with price, period and what each one unlocks.",
  },
  api: {
    title: "API separate from the screens",
    why: "Rules inside screens cannot be tested, reused or protected on the server.",
    minimum: "Server routes in their own folder, called by the screens.",
  },
  database: {
    title: "Database with migrations",
    why: "Changing tables by hand in production loses data and cannot be repeated.",
    minimum: "A migrations folder or schema file that creates every table from zero.",
  },
  auth: {
    title: "Accounts and sign-in",
    why: "Without accounts, anyone sees anyone's data.",
    minimum: "Sign-up, sign-in and sign-out through a maintained library.",
  },
  "password-reset": {
    title: "Password recovery",
    why: "People forget passwords on the first week; without recovery they leave.",
    minimum: "A reset link by email that expires and works once.",
  },
  tenants: {
    title: "Separation between customer companies (B2B)",
    why: "In B2B, one company seeing another's records ends the contract.",
    minimum: "Every query filtered by the company or workspace id.",
  },
  states: {
    title: "Loading, empty and error states",
    why: "A screen that shows nothing while loading or failing looks broken.",
    minimum: "Each data screen has loading, empty and error states besides the normal one.",
  },
  billing: {
    title: "Billing",
    why: "Without charging, it is a free tool, not a SaaS.",
    minimum: "Checkout through a payment provider tied to the account.",
  },
  webhooks: {
    title: "Idempotent payment webhooks",
    why: "Providers resend events; without idempotency a payment is applied twice.",
    minimum: "Each event id is stored and a repeated one is ignored.",
  },
  "renewal-refund": {
    title: "Renewal and refund",
    why: "Subscriptions renew and people ask for money back; both change access.",
    minimum: "Renewal extends access, a refund removes it, both recorded.",
  },
  cents: {
    title: "Money in cents",
    why: "Floating point turns 0.1 + 0.2 into 0.30000000000000004 on an invoice.",
    minimum: "Amounts stored and computed as integer cents.",
  },
  types: {
    title: "Type checking",
    why: "Types catch wrong fields and missing values before the user does.",
    minimum: "A type checker configured and running on the whole project.",
  },
  lint: {
    title: "Linter",
    why: "A linter finds unused code and common bugs on every change.",
    minimum: "A linter configured for the project's language.",
  },
  tests: {
    title: "Tests of the business rules",
    why: "Without tests, every change can silently break billing or access.",
    minimum: "Tests for the rules that move money or permissions, passing on this tree.",
  },
  ci: {
    title: "Continuous integration",
    why: "Checks that only run on one laptop stop running.",
    minimum: "A CI workflow that runs types, lint and tests on every push.",
  },
  secrets: {
    title: "Secrets out of the code",
    why: "A key committed once stays in the history for anyone with the repository.",
    minimum: "Keys only in environment variables; the secrets check passes on this tree.",
  },
  "rate-limit": {
    title: "Request limits",
    why: "Without limits, one script can take down the service or test passwords forever.",
    minimum: "A limit on sign-in and on the public routes.",
  },
  privacy: {
    title: "Personal data: legal basis and deletion",
    why: "Data protection laws require a way to delete or export a person's data.",
    minimum: "An account deletion or data export path.",
  },
  backup: {
    title: "Tested backup",
    why: "A backup never restored is a guess.",
    minimum: "Automatic database backup and one restore done and written down.",
  },
  environments: {
    title: "Test and production environments",
    why: "Testing in production breaks it for real users.",
    minimum: "Separate settings per environment, documented in .env.example.",
  },
  rollback: {
    title: "Deploy with a way back",
    why: "A bad deploy without rollback keeps the site down while someone fixes it live.",
    minimum: "Deploys from a pipeline, and the previous version can be restored in minutes.",
  },
  logs: {
    title: "Logs and alerts",
    why: "Without logs, the first report of an error comes from an angry customer.",
    minimum: "Errors logged with context and an alert on spikes.",
  },
  terms: {
    title: "Terms of use and privacy policy",
    why: "Charging money and storing personal data without them is a legal risk.",
    minimum: "Terms and privacy pages linked from sign-up.",
  },
  message: {
    title: "One clear promise",
    why: "Visitors decide in seconds whether the page is for them.",
    minimum: "A headline that says who it is for and what they get.",
  },
  "call-to-action": {
    title: "Call to action",
    why: "A page without a next step only gets read.",
    minimum: "One main button or link that leads to the next step.",
  },
  contact: {
    title: "Way to reach you",
    why: "Interested visitors with no way to reply are lost.",
    minimum: "A form, email or chat link that reaches a person.",
  },
  responsive: {
    title: "Works on phones",
    why: "Most visits to a landing page come from a phone.",
    minimum: "Layout that adapts to narrow screens, with a viewport tag.",
  },
  metadata: {
    title: "Title and share preview",
    why: "The title and preview are what people see in search and when the link is shared.",
    minimum: "A page title, description and share image.",
  },
  analytics: {
    title: "Visit measurement",
    why: "Without numbers, nobody knows whether the page converts.",
    minimum: "An analytics script counting visits and clicks on the main button.",
  },
  "visual-check": {
    title: "Visual check",
    why: "Overflow and broken layouts only show on a real render.",
    minimum: "The look check passes on this tree.",
  },
  "landing-terms": {
    title: "Privacy notice",
    why: "A form that collects email or phone collects personal data.",
    minimum: "A privacy page linked next to the form.",
  },
  domain: {
    title: "Own domain with HTTPS",
    why: "A temporary address and a browser warning cost trust.",
    minimum: "The page served on its own domain over HTTPS.",
  },
};
