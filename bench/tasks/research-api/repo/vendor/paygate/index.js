const calls = [];

exports.calls = calls;
exports.create = (request) => {
  calls.push(request);
  return { id: `ch_${String(calls.length)}`, status: "pending" };
};
