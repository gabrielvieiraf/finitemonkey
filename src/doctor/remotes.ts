import { remotesWithCredentials } from "../secrets/remotes.js";
import { type Check, finding } from "./types.js";

export const checkRemoteCredentials: Check = ({ root, runtime }) => {
  const remotes = remotesWithCredentials(runtime, root);
  if (remotes.length === 0) return [];
  const params = { remotes: remotes.join(", "), remote: remotes[0] ?? "origin" };
  return [
    finding(
      "secrets.remote_credential",
      "warn",
      "doctor.secrets.remote_credential",
      params,
      "doctor.secrets.fix_remote_credential",
    ),
  ];
};
