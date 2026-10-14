import { describe, expect, it } from "vitest";
import { body, headers, secret } from "../test/fixtures/ping/form-delivery.json";
import { verifySignature } from "./signature";

describe("verifySignature", () => {
  it("verifySignature returns true for the real GitHub ping delivery", async () => {
    const bytes = new TextEncoder().encode(body);

    const result = await verifySignature(bytes, headers["x-hub-signature-256"], secret);

    expect(result, "result").toBe(true);
  });
});
