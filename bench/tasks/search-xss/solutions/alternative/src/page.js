const { escapeHtml } = require("./html.js");
const { searchProducts } = require("./search.js");

const highlight = (name, query) => {
  const needle = String(query).trim().toLowerCase();
  if (needle === "") return escapeHtml(name);
  let out = "";
  let from = 0;
  const lower = name.toLowerCase();
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    out += escapeHtml(name.slice(from, at)) + "<mark>" + escapeHtml(name.slice(at, at + needle.length)) + "</mark>";
    from = at + needle.length;
  }
  return out + escapeHtml(name.slice(from));
};

// Server-side render of /search?q=..., sent to the browser as is.
exports.renderSearchPage = (products, query) => {
  const found = searchProducts(products, query);
  const heading = `<h2>Results for &ldquo;${escapeHtml(String(query).trim())}&rdquo;</h2>`;
  const items = found.map((product) => `<li class="{{cls}}">${highlight(product.name, query)}</li>`).join("");
  return `<main><h1>Search</h1>${heading}<ul>${items}</ul></main>`;
};
