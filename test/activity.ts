import type { MalformedField } from "./issue";
import { ABSENT } from "./pull-request";

/** Ids that are not a safe integer, for `sender.id` and `repository.id`. */
const UNSAFE_IDS: readonly { readonly label: string; readonly value: unknown }[] = [
  { label: "missing", value: ABSENT },
  { label: "null", value: null },
  { label: "a string", value: "2000" },
  { label: "a fraction", value: 1.5 },
  { label: "NaN", value: Number.NaN },
  { label: "beyond the safe range", value: Number.MAX_SAFE_INTEGER + 1 },
];

/** The wrong shapes of E1 that every `star` and `fork` delivery shares: the repository and the sender's login. */
export const MALFORMED_ACTIVITY_FIELDS: readonly MalformedField[] = [
  { field: "repository", label: "missing", path: ["repository"], value: ABSENT },
  { field: "repository", label: "null", path: ["repository"], value: null },
  { field: "repository", label: "an array", path: ["repository"], value: [] },
  { field: "repository", label: "a string", path: ["repository"], value: "example-owner/example-repo" },
  ...UNSAFE_IDS.map(({ label, value }) => ({
    field: "repository.id",
    label,
    path: ["repository", "id"],
    value,
  })),
  { field: "repository.full_name", label: "missing", path: ["repository", "full_name"], value: ABSENT },
  { field: "repository.full_name", label: "a number", path: ["repository", "full_name"], value: 7 },
  { field: "repository.full_name", label: "null", path: ["repository", "full_name"], value: null },
  { field: "sender.login", label: "missing", path: ["sender", "login"], value: ABSENT },
  { field: "sender.login", label: "a number", path: ["sender", "login"], value: 7 },
  { field: "sender.login", label: "null", path: ["sender", "login"], value: null },
];

/** The wrong shapes of E1 of a `fork` delivery's `forkee` object. */
export const MALFORMED_FORKEE_FIELDS: readonly MalformedField[] = [
  { field: "forkee", label: "missing", path: ["forkee"], value: ABSENT },
  { field: "forkee", label: "null", path: ["forkee"], value: null },
  { field: "forkee", label: "an array", path: ["forkee"], value: [] },
  { field: "forkee", label: "a string", path: ["forkee"], value: "example-other-user/example-repo" },
  { field: "forkee.full_name", label: "missing", path: ["forkee", "full_name"], value: ABSENT },
  { field: "forkee.full_name", label: "a number", path: ["forkee", "full_name"], value: 7 },
  { field: "forkee.html_url", label: "missing", path: ["forkee", "html_url"], value: ABSENT },
  { field: "forkee.html_url", label: "a number", path: ["forkee", "html_url"], value: 7 },
];

/** A `stargazers_count` and the line 3 or `starCount` it gives; `expected` is `undefined` for an unusable count. */
export interface StarCountCase {
  readonly case: string;
  readonly value: unknown;
  readonly expected: number | undefined;
}

/** The counts of E2: a whole number from 0 to 2^53 - 1 is usable, anything else leaves the count out. */
export const STAR_COUNTS: readonly StarCountCase[] = [
  { case: "0", value: 0, expected: 0 },
  { case: "1", value: 1, expected: 1 },
  { case: "1,234", value: 1234, expected: 1234 },
  { case: "2^53 - 1", value: Number.MAX_SAFE_INTEGER, expected: Number.MAX_SAFE_INTEGER },
  { case: "-1", value: -1, expected: undefined },
  { case: "1.5", value: 1.5, expected: undefined },
  { case: 'the text "5"', value: "5", expected: undefined },
  { case: "2^53", value: 2 ** 53, expected: undefined },
  { case: "NaN", value: Number.NaN, expected: undefined },
  { case: "null", value: null, expected: undefined },
  { case: "absent", value: ABSENT, expected: undefined },
];

/** The actions of the `star` event other than `created`, and for the removal other than `deleted`. */
export const OTHER_STAR_ACTIONS: readonly string[] = ["edited", "some_new_action", "", "Created", "Deleted"];
