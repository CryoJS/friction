/**
 * Mock mode only: a CANNED source mapping for the golden run.
 *
 * Mock mode has no GitHub and no model, so no verified fix is ever mapped to
 * source and a scan would end with nothing to open a pull request for. This
 * stands in for repo.ts (findSourceFile + generateSourceFix) the way
 * goldenFixer stands in for the fix proposer: the golden run's verified
 * dead_click fix maps to a plausible file of the demo shop, with a recorded
 * original and a recorded replacement. Nothing here is read from or written to
 * a repository, and mock mode only ever previews pull requests.
 */
import type { FixTest, FrictionCategory } from "@friction/shared";

/** The canned regression test for the golden run's dead "Add to cart": what prTest.ts would write and prove in live mode. */
export function mockFixTest(category: FrictionCategory): FixTest | null {
  if (category !== "dead_click") return null;
  return {
    title: "Add to cart says a size is needed",
    startPath: "/products/alpine-down-parka",
    steps: [{ action: "click", role: "button", name: "Add to cart" }],
    expect: [{ kind: "text_visible", text: "Please select a size" }],
  };
}

export interface MockSourceFix {
  path: string;
  /** What the file is pretended to hold today; only used to count the preview's changed lines. */
  original: string;
  content: string;
}

const PRODUCT_FORM_ORIGINAL = `import { useState } from "react";
import { addToCart } from "../lib/cart";
import type { Product } from "../lib/products";

export function ProductForm({ product }: { product: Product }) {
  const [size, setSize] = useState<string | null>(null);

  function submit() {
    if (!size) return;
    addToCart(product.slug, size);
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <fieldset>
        <legend>Size</legend>
        {product.sizes.map((option) => (
          <label key={option}>
            <input type="radio" name="size" value={option} onChange={() => setSize(option)} />
            {option}
          </label>
        ))}
      </fieldset>
      <button id="add" className="primary" data-add-to-cart>
        Add to cart
      </button>
    </form>
  );
}
`;

const PRODUCT_FORM_FIXED = `import { useRef, useState } from "react";
import { addToCart } from "../lib/cart";
import type { Product } from "../lib/products";

export function ProductForm({ product }: { product: Product }) {
  const [size, setSize] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sizes = useRef<HTMLFieldSetElement>(null);

  function submit() {
    if (!size) {
      setError("Please select a size.");
      sizes.current?.querySelector("input")?.focus();
      return;
    }
    addToCart(product.slug, size);
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <fieldset ref={sizes} aria-invalid={error !== null} className={error ? "sizes sizes-missing" : "sizes"}>
        <legend>Size</legend>
        {product.sizes.map((option) => (
          <label key={option}>
            <input type="radio" name="size" value={option} onChange={() => { setSize(option); setError(null); }} />
            {option}
          </label>
        ))}
      </fieldset>
      <button id="add" className="primary" data-add-to-cart>
        Add to cart
      </button>
      <div className="err" role="alert">{error}</div>
    </form>
  );
}
`;

const CANNED: Partial<Record<FrictionCategory, MockSourceFix>> = {
  dead_click: { path: "src/components/ProductForm.tsx", original: PRODUCT_FORM_ORIGINAL, content: PRODUCT_FORM_FIXED },
};

/** The canned mapping for a verified golden-run fix, or null: most categories have none, like most live findings. */
export function mockSourceFix(category: FrictionCategory): MockSourceFix | null {
  return CANNED[category] ?? null;
}

/** The pretended current content of a canned file, for a dry run's line counts. */
export function mockOriginalFor(path: string): string | null {
  return Object.values(CANNED).find((canned) => canned.path === path)?.original ?? null;
}
