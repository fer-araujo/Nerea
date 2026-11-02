// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import esMessages from "../messages/es.json";
import enMessages from "../messages/en.json";
import { AvailabilityBadge } from "../components/product/AvailabilityBadge";

function renderBadge(
  props: React.ComponentProps<typeof AvailabilityBadge>,
  {
    locale,
    messages,
  }: { locale: "es" | "en"; messages: typeof esMessages | typeof enMessages } = {
    locale: "es",
    messages: esMessages,
  },
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <AvailabilityBadge {...props} />
    </NextIntlClientProvider>,
  );
}

// The spec-plate: the brand mark "01 / 01" is only true while a single unit is
// left, so it goes with "Pieza única"; a series says how many remain instead.
describe("AvailabilityBadge — stock labels", () => {
  it("one piece left: keeps the 01 / 01 mark and says 'Pieza única'", () => {
    const { container } = renderBadge({ availability: "available", stock: 1 });

    expect(container).toHaveTextContent("01 / 01");
    expect(container).toHaveTextContent("Pieza única");
    expect(container).not.toHaveTextContent("disponible");
    expect(container.querySelector(".line-through")).toBeNull();
  });

  it("several left: says 'Quedan N' and drops the 01 / 01 mark, which would be false", () => {
    const { container } = renderBadge({ availability: "available", stock: 3 });

    expect(container).toHaveTextContent("Quedan 3");
    expect(container).not.toHaveTextContent("01 / 01");
    expect(container).not.toHaveTextContent("Pieza única");
    expect(container.querySelector(".line-through")).toBeNull();
  });

  it("keeps the specs (the category) beside 'Quedan N', without a stray separator first", () => {
    const { container } = renderBadge({
      availability: "available",
      stock: 4,
      specs: ["Anillos"],
    });

    expect(container).toHaveTextContent("Anillos");
    expect(container).toHaveTextContent("Quedan 4");
    // Nothing before the first spec: it starts the plate.
    expect(container.textContent?.trimStart().startsWith("·")).toBe(false);
  });

  it("keeps the specs after 01 / 01 for a single piece", () => {
    const { container } = renderBadge({
      availability: "available",
      stock: 1,
      specs: ["Anillos"],
    });

    expect(container.textContent).toMatch(
      /01 \/ 01\s*·\s*Anillos\s*·\s*Pieza única/,
    );
  });

  it("zero left: the existing sold styling, struck through, labelled 'agotada'", () => {
    const { container } = renderBadge({ availability: "sold", stock: 0 });

    expect(container).toHaveTextContent("01 / 01");
    expect(container).toHaveTextContent("agotada");
    expect(container).not.toHaveTextContent("Quedan");
    expect(container.querySelectorAll(".line-through").length).toBeGreaterThan(0);
    // State is text AND a non-color signal (the strike), never color alone.
    expect(container.firstElementChild).toHaveClass("text-graphite");
  });

  it("reads zero stock as sold even if availability disagrees (the safer reading wins)", () => {
    const { container } = renderBadge({ availability: "available", stock: 0 });

    expect(container).toHaveTextContent("agotada");
    expect(container.querySelectorAll(".line-through").length).toBeGreaterThan(0);
  });

  it("is sold when availability says so, whatever stock claims", () => {
    const { container } = renderBadge({ availability: "sold", stock: 5 });

    expect(container).toHaveTextContent("agotada");
    expect(container).not.toHaveTextContent("Quedan");
  });

  it("without a stock keeps the legacy one-of-one reading ('disponible')", () => {
    const { container } = renderBadge({ availability: "available" });

    expect(container).toHaveTextContent("01 / 01");
    expect(container).toHaveTextContent("disponible");
  });

  it("localizes the labels in English", () => {
    const options = { locale: "en" as const, messages: enMessages };

    expect(
      renderBadge({ availability: "available", stock: 1 }, options).container,
    ).toHaveTextContent("Unique piece");
    expect(
      renderBadge({ availability: "available", stock: 3 }, options).container,
    ).toHaveTextContent("3 left");
    expect(
      renderBadge({ availability: "sold", stock: 0 }, options).container,
    ).toHaveTextContent("sold out");
  });

  it("has a Spanish and an English message for every new label", () => {
    for (const messages of [esMessages, enMessages]) {
      expect(messages.Product.uniquePiece).toBeTruthy();
      expect(messages.Product.remaining).toContain("{count}");
      expect(messages.Product.sold).toBeTruthy();
      expect(messages.Product.soldOut).toBeTruthy();
    }
    expect(esMessages.Product.soldOut).toBe("Agotada");
  });

  it("renders one paragraph, so a screen reader reads the plate as a single sentence", () => {
    renderBadge({ availability: "available", stock: 2, specs: ["Anillos"] });

    expect(screen.getAllByText(/Quedan 2/)).toHaveLength(1);
  });
});
