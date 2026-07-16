// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import esMessages from "../messages/es.json";

// `next-intl/server` resolves to its client-only stub outside a real Next.js
// request (see the probe in apply-progress notes), so it must be mocked to
// render this Server Component directly in Vitest. The mock reads real
// message content instead of echoing keys, so the assertions below prove
// the actual localized copy renders, not a placeholder string.
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async (namespace: string) => {
    const scoped = (esMessages as Record<string, Record<string, string>>)[
      namespace
    ];
    return (key: string) => scoped[key];
  },
}));

vi.mock("@/lib/commerce", () => ({
  commerce: {
    getProducts: vi.fn().mockResolvedValue([]),
  },
}));

// Importing after the mocks above (vi.mock calls are hoisted by Vitest, so
// declaration order here doesn't matter, but this keeps the file readable).
import ShopPage from "../app/[locale]/shop/page";

// A Next.js App Router Server Component is just an async function that
// returns a React element tree — calling it directly (instead of `<ShopPage
// />`) and passing the result to `render()` is the standard way to test one
// with React Testing Library outside Next's own render pipeline.
describe("shop catalog — empty state", () => {
  it("renders the localized empty-state message when getProducts returns zero products", async () => {
    const jsx = await ShopPage({
      params: Promise.resolve({ locale: "es" }),
    });
    render(jsx);

    expect(screen.getByText(esMessages.Shop.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(esMessages.Shop.emptyBody)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
