const { authorize } = require("./policy.js");
const { routes } = require("./routes.js");
const { userFor } = require("./store.js");

const match = (route, request) => {
  if (route.method !== request.method) return undefined;
  const want = route.path.split("/");
  const got = request.path.split("/");
  if (want.length !== got.length) return undefined;
  const params = {};
  for (let index = 0; index < want.length; index += 1) {
    const part = want[index];
    if (part.startsWith(":")) params[part.slice(1)] = got[index];
    else if (part !== got[index]) return undefined;
  }
  return params;
};

exports.handle = (request) => {
  const user = userFor(request.headers?.authorization);
  if (user === undefined) return { status: 401, body: { error: "sign in first" } };
  for (const route of routes) {
    const params = match(route, request);
    if (params === undefined) continue;
    const denied = authorize(route.name, user, params);
    if (denied !== undefined) return denied;
    return route.run(user, params, request.body ?? {});
  }
  return { status: 404, body: { error: "not found" } };
};
