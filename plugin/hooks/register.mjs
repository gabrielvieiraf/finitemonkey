// src/mod/register.ts
async function onStart(_$, e, next) {
  return next(e);
}
function register(on) {
  on("session.start", onStart);
}
export {
  register
};
