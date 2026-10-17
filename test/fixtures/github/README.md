# GitHub API fixtures

These files are **not captured from GitHub.** They are reference-built from GitHub's documentation and its OpenAPI
description (<https://github.com/github/rest-api-description>, `descriptions/api.github.com/api.github.com.json`),
because no real sample of the answers was available when the GitHub App step of the setup wizard was built (decision
0017, Product Manager's decision; the Telegram fixtures were built the same way, decision 0016). The App ID, slug,
owner, client id and client secret are the documentation's invented example values; the private key is the
documentation's example key, which is public and grants nothing.

| File                                         | Follows (sections of the description)                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `manifest-conversion.json`                   | `components.examples.integration-from-manifest.value`, the example answer of `POST /app-manifests/{code}/conversions` (status 201), **verbatim**: `pem` is PKCS#1 (`-----BEGIN RSA PRIVATE KEY-----`). Its `owner` (`login` `github`, `type` `User`) is inconsistent with the organization URLs beside it, so the owner is reference-built |
| `manifest-conversion-not-found.json`         | `components.responses.not_found` (status 404, schema `basic-error`: `message`, `documentation_url`, `status`), written from the schema                                                                                                                                                                                                     |
| `manifest-conversion-validation-failed.json` | `components.responses.validation_failed_simple` (status 422, schema `validation-error-simple`: `message`, `documentation_url`), written from the schema                                                                                                                                                                                    |
| `manifest-conversion-pkcs8.json`             | `{"pkcs8": "<PEM>"}`: the key of `manifest-conversion.json` converted with `openssl pkcs8 -topk8 -nocrypt` (OpenSSL 3.0.13), the expected output of `toPkcs8Pem`. Not an answer of GitHub                                                                                                                                                  |

Because they share the documentation's assumptions, tests built on them cannot catch a deviation of the real API from
the description. Replace them with captured answers (secrets removed) once the live check on a deployed copy yields
some; a deviation found by the live check is a new issue, not a silent edit of these files.
