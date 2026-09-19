import { describe, expect, it } from "vitest";
import { AnchorSchema, normalizeHost, type Anchor } from "./anchor";

const anchor: Anchor = {
  xpath: "/html/body/main/form/button",
  tag: "button",
  role: "button",
  name: "Add to cart",
  text: "Add to cart",
  attrs: { id: "add-to-cart" },
  ordinal: 0,
  path: "/products/hat",
};

describe("normalizeHost", () => {
  it("lowercases, strips www. and drops the port", () => {
    expect(normalizeHost("https://www.Example.com/products?x=1")).toBe("example.com");
    expect(normalizeHost("EXAMPLE.com:8080")).toBe("example.com");
    expect(normalizeHost("shop.example.co.uk")).toBe("shop.example.co.uk");
  });

  it("returns an empty string for junk rather than throwing", () => {
    expect(normalizeHost("")).toBe("");
    expect(normalizeHost("   ")).toBe("");
    expect(normalizeHost("not a host")).toBe("");
  });

  it("keeps localhost usable", () => {
    expect(normalizeHost("http://localhost:5173/")).toBe("localhost");
  });
});

describe("AnchorSchema", () => {
  it("accepts a well-formed anchor", () => {
    expect(AnchorSchema.parse(anchor)).toEqual(anchor);
  });

  it("rejects a negative ordinal", () => {
    expect(AnchorSchema.safeParse({ ...anchor, ordinal: -1 }).success).toBe(false);
  });

  it("truncating producers are the page script's job, so long text is rejected here", () => {
    expect(AnchorSchema.safeParse({ ...anchor, text: "x".repeat(91) }).success).toBe(false);
  });
});
