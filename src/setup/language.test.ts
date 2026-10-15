import { describe, expect, it } from "vitest";
import { languageFromAcceptLanguage, resolveLanguage } from "./language";
import { growthRatio, LINEAR_RATIO_LIMIT, RATIO_TEST_TIMEOUT_MS } from "../../test/timing";

const ORIGIN = "https://example.com";

function requestWith(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { headers });
}

describe("languageFromAcceptLanguage", () => {
  it.each([
    { header: "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7", expected: "de" },
    { header: "de,en-US;q=0.7,en;q=0.3", expected: "de" },
    { header: "en-US,en;q=0.9", expected: "en" },
    { header: "de-DE,de;q=0.9", expected: "de" },
    { header: "fr-FR,fr;q=0.9,de;q=0.8,en;q=0.7", expected: "de" },
    { header: "de;q=0,en;q=0.1", expected: "en" },
    { header: "fr", expected: "en" },
    { header: null, expected: "en" },
    { header: "", expected: "en" },
    { header: "de;q=0.5,en;q=0.5", expected: "de" },
    { header: "en;q=0.5,de;q=0.5", expected: "en" },
    { header: "de;q=1.5", expected: "en" },
    { header: "de;q=0.0001", expected: "en" },
    { header: "de ; q=0.8", expected: "de" },
    { header: "DE-at", expected: "de" },
    { header: "deu", expected: "en" },
    { header: "*", expected: "en" },
  ])("languageFromAcceptLanguage returns $expected for $header", ({ header, expected }) => {
    const language = languageFromAcceptLanguage(header);

    expect(language, "language").toBe(expected);
  });

  // The length n is divisible by 2, 3, 9 and 17 (the patterns below repeat a piece of that length).
  const BASE_LENGTH = 30_600;

  it.each([
    { name: "spaces", inputAt: (length: number) => " ".repeat(length) },
    { name: "semicolons", inputAt: (length: number) => ";".repeat(length) },
    { name: "commas", inputAt: (length: number) => ",".repeat(length) },
    { name: "subtags", inputAt: (length: number) => "de" + "-x".repeat(length / 2) },
    { name: "a weight that never ends", inputAt: (length: number) => "de;q=" + "0".repeat(length) },
    { name: "weights that never get a value", inputAt: (length: number) => "de" + ";q=".repeat(length / 3) },
    { name: "many valid entries", inputAt: (length: number) => "en;q=0.1,".repeat(length / 9) },
  ])(
    "languageFromAcceptLanguage takes time linear in the header length for $name",
    ({ inputAt }) => {
      const ratio = growthRatio(languageFromAcceptLanguage, inputAt, BASE_LENGTH);

      expect(ratio, "duration at 10 n divided by duration at n").toBeLessThan(LINEAR_RATIO_LIMIT);
    },
    RATIO_TEST_TIMEOUT_MS,
  );
});

describe("resolveLanguage", () => {
  it("resolveLanguage takes the query parameter over the cookie and the header", () => {
    const request = requestWith("/setup?lang=en", { cookie: "seluna_lang=de", "accept-language": "de" });

    const resolved = resolveLanguage(request);

    expect(resolved, "resolved language").toEqual({ language: "en", fromQuery: true });
  });

  it("resolveLanguage takes the cookie over the header", () => {
    const request = requestWith("/setup", { cookie: "seluna_lang=en", "accept-language": "de" });

    const resolved = resolveLanguage(request);

    expect(resolved, "resolved language").toEqual({ language: "en", fromQuery: false });
  });

  it("resolveLanguage takes the header without query or cookie", () => {
    const request = requestWith("/setup", { "accept-language": "de-DE,de;q=0.9" });

    const resolved = resolveLanguage(request);

    expect(resolved, "resolved language").toEqual({ language: "de", fromQuery: false });
  });

  it("resolveLanguage takes English without query, cookie or header", () => {
    const request = requestWith("/setup");

    const resolved = resolveLanguage(request);

    expect(resolved, "resolved language").toEqual({ language: "en", fromQuery: false });
  });

  it.each(["DE", "english", "", "de-DE"])("resolveLanguage ignores lang=%s", (value) => {
    const request = requestWith(`/setup?lang=${value}`, { "accept-language": "de" });

    const resolved = resolveLanguage(request);

    expect(resolved, "resolved language").toEqual({ language: "de", fromQuery: false });
  });
});
