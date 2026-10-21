import type { Version } from "../version";
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
  throw new Error("Not implemented");
}

/** One request; never throws. */
export function fetchLatestRelease(fetcher: GitHubFetch, version: string): Promise<LatestRelease> {
  return Promise.reject(new Error("Not implemented"));
}
