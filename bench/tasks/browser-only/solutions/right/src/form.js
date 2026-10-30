exports.renderForm = () =>
  [
    "<form method=\"post\" action=\"/signup\">",
    "  <input name=\"email\" type=\"email\" required>",
    "  <button type=\"submit\" class=\"primary\">{{label}}</button>",
    "</form>",
  ].join("\n");
