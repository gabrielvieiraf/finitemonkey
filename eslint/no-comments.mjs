const MESSAGE = "No comments in code. Names, types and tests say what the code does; decisions go to docs/.";
const ALLOWED = /^\s*(eslint-disable|eslint-enable|@ts-expect-error\s+\S)/;

export const noComments = {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow comments, except the shebang and lint or type directives with a reason" },
    messages: { noComments: MESSAGE },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang" || ALLOWED.test(comment.value)) continue;
          context.report({ loc: comment.loc, messageId: "noComments" });
        }
      },
    };
  },
};

export const finitemonkeyPlugin = { meta: { name: "finitemonkey" }, rules: { "no-comments": noComments } };
