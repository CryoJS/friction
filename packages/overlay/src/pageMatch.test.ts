import { describe, expect, it } from "vitest";
import { sameLoggedPage } from "./pageMatch";

describe("sameLoggedPage", () => {
  it("matches despite query-param drift (a tracking param appended, params reordered)", () => {
    expect(sameLoggedPage("https://shop.test/cart?a=1&b=2", "https://shop.test/cart?utm_source=x")).toBe(true);
  });

  it("does not match two different hash routes", () => {
    expect(sameLoggedPage("https://shop.test/app#/products/123", "https://shop.test/app#/products/456")).toBe(false);
  });

  it("matches the same hash route", () => {
    expect(sameLoggedPage("https://shop.test/app#/products/123", "https://shop.test/app#/products/123")).toBe(true);
  });

  it("ignores a plain, non-route fragment", () => {
    expect(sameLoggedPage("https://shop.test/page#section-2", "https://shop.test/page")).toBe(true);
  });

  it("does not match a different pathname", () => {
    expect(sameLoggedPage("https://shop.test/cart", "https://shop.test/checkout")).toBe(false);
  });

  it("does not match a different origin", () => {
    expect(sameLoggedPage("https://shop.test/cart", "https://other.test/cart")).toBe(false);
  });

  it("a route hash on only one side does not match", () => {
    expect(sameLoggedPage("https://shop.test/app#/products/123", "https://shop.test/app")).toBe(false);
  });

  it("returns false for an unparseable url rather than throwing", () => {
    expect(sameLoggedPage("not-a-url", "https://shop.test/cart")).toBe(false);
  });
});
