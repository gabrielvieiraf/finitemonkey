export interface AllowMarker {
  readonly type: "allow";
  readonly guard: string;
  readonly reason: string;
}

export interface ApproveMarker {
  readonly type: "approve";
  readonly check: string;
  readonly task?: string;
  readonly reason: string;
}

export interface TrustMarker {
  readonly type: "trust";
  readonly task: string;
}

export type Marker = AllowMarker | ApproveMarker | TrustMarker;

const LINE = /^\s*(?:finitemonkey|fm):\s+(allow|approve|trust)\s+(\S+)(?:\s+(.*))?$/i;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,80}$/;
const NOT_FROM_PERSON = [
  /<task-notification\b/i,
  /<agent-message\b/i,
  /^\s*\[julius2claude\]/,
  /\[Subagent hand-back\]/i,
];

export const comesFromPerson = (prompt: string): boolean => !NOT_FROM_PERSON.some((pattern) => pattern.test(prompt));

const toMarker = (verb: string, target: string, rest: string): Marker | undefined => {
  if (!NAME.test(target)) return undefined;
  if (verb === "trust") return { type: "trust", task: target };
  if (verb === "allow") {
    return rest.length >= 3 ? { type: "allow", guard: target.toLowerCase(), reason: rest } : undefined;
  }
  const slash = target.indexOf("/");
  const task = slash < 0 ? undefined : target.slice(0, slash);
  const check = slash < 0 ? target : target.slice(slash + 1);
  if (check === "") return undefined;
  return { type: "approve", check, reason: rest, ...(task === undefined || task === "" ? {} : { task }) };
};

export const parseMarkers = (prompt: string): readonly Marker[] => {
  if (!comesFromPerson(prompt)) return [];
  return prompt.split(/\r?\n/).flatMap((line) => {
    const match = LINE.exec(line);
    if (match === null) return [];
    const marker = toMarker((match[1] ?? "").toLowerCase(), match[2] ?? "", (match[3] ?? "").trim());
    return marker === undefined ? [] : [marker];
  });
};
