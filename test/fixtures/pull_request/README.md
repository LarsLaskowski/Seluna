# Pull request fixtures

These five files are **real `pull_request` deliveries**, captured from the owner's GitHub App (the private App each
Seluna instance registers) and supplied on issue #13 on 2026-10-18 (Product Manager's decision: real payloads instead
of reference-built ones). They are anonymized: logins, ids, `node_id`s, repository names, the homepage, the commit
SHAs, the pull request title and body and the installation id are replaced by invented values (`example-owner`,
`example-repo`, `ANON_NODE_ID_n`, `https://example.com`, ...). The structure and the field set are untouched, so the
shape the rules read is the shape GitHub sends.

| File                          | `action`           | `draft` | Covers                                                                                              |
| ----------------------------- | ------------------ | ------- | --------------------------------------------------------------------------------------------------- |
| `opened.json`                 | `opened`           | `false` | A pull request opened as ready for review (#143, repository `example-other-repo`)                   |
| `opened-draft.json`           | `opened`           | `true`  | A pull request opened as a draft (#272)                                                             |
| `ready_for_review.json`       | `ready_for_review` | `false` | A draft marked ready for review (#274); `draft` is already `false` in this delivery                 |
| `review_requested.json`       | `review_requested` | `false` | A review requested from a user (`requested_reviewer` of type `User`) on a ready pull request (#274) |
| `review_requested-draft.json` | `review_requested` | `true`  | A review requested from a user on a draft pull request (#274, same reviewer)                        |

In all five, `sender` and `pull_request.user` are the owner.

## Variants not available

No real sample exists for these shapes, so none is invented as a fixture; tests that need a variant of a real payload
build it in the test from one of these files:

- A review requested from a **team**: GitHub sends `requested_team` instead of `requested_reviewer`.
- A pull request from a **fork**: `head.repo` is another repository, or `null` after the fork was deleted.
- A `ready_for_review` delivery with `draft` `true`: not observed (one sample only).

A later real sample is added as its own file, never edited into these.
