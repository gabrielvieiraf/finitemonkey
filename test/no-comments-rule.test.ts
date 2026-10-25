import { describe, it } from "node:test";

import { RuleTester } from "eslint";

import { noComments } from "../eslint/no-comments.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2023, sourceType: "module" } });

tester.run("finitemonkey/no-comments", noComments, {
  valid: [
    { code: "#!/usr/bin/env node\nexport const a = 1;" },
    { code: "export const a = 1; // eslint-disable-line no-unused-vars" },
    { code: "/* eslint-disable no-console */\nconsole.log(1);" },
    { code: 'export const url = "https://example.com/#anchor";' },
  ],
  invalid: [
    { code: "// explains the obvious\nexport const a = 1;", errors: [{ messageId: "noComments" }] },
    { code: "/** jsdoc */\nexport const a = 1;", errors: [{ messageId: "noComments" }] },
    {
      code: "export const a = 1; /* trailing */ // and another",
      errors: [{ messageId: "noComments" }, { messageId: "noComments" }],
    },
  ],
});
