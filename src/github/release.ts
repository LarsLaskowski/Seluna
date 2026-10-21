import { parseReleaseTag } from "../version";
import type { Version } from "../version";
import { publicGitHubRequest, sendGitHub } from "./http";
import type { GitHubFetch } from "./conversion";

/** The repository whose releases the release check reads. */
export const UPSTREAM_REPOSITORY = "LarsLaskowski/Seluna";
/** The one path the release check requests. */
export const LATEST_RELEASE_PATH = "/repos/LarsLaskowski/Seluna/releases/latest";

/** What the request for the latest release came to. */
export type LatestRelease =
  | { readonly kind: "found"; readonly version: Version }
  | { readonly kind: "none" }
  | { readonly kind: "refused" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "malformed" };

/** The version of the answer's `tag_name`, or `undefined` when the answer or the tag has another form. */
export function parseLatestRelease(body: unknown): Version | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body) || !("tag_name" in body)) {
    return undefined;
  }
  return typeof body.tag_name === "string" ? parseReleaseTag(body.tag_name) : undefined;
}

/** One request; never throws. */
export async function fetchLatestRelease(fetcher: GitHubFetch, version: string): Promise<LatestRelease> {
  const reply = await sendGitHub(fetcher, publicGitHubRequest(LATEST_RELEASE_PATH, version));
  switch (reply.kind) {
    case "failed":
      return { kind: "unavailable" };
    case "refused":
      return reply.status === 404 ? { kind: "none" } : { kind: "refused" };
    case "ok": {
      const parsed = parseLatestRelease(reply.body);
      return parsed === undefined ? { kind: "malformed" } : { kind: "found", version: parsed };
    }
  }
}
