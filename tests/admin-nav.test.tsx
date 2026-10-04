// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const pathnameMock = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

import { AdminNav } from "@/components/admin/AdminNav";

beforeEach(() => {
  vi.resetAllMocks();
  pathnameMock.mockReturnValue("/admin");
});

describe("AdminNav", () => {
  it("links every module that exists, in order", () => {
    render(<AdminNav />);

    const links = screen
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]);
    expect(links).toEqual([
      ["Resumen", "/admin"],
      ["Calculadora", "/admin/calculadora"],
      ["Inventario", "/admin/inventario"],
      ["Inversiones", "/admin/inversiones"],
      ["Piezas", "/admin/piezas"],
      ["Ventas", "/admin/ventas"],
      ["Mensajes", "/admin/mensajes"],
    ]);
  });

  it("marks only Resumen as current on /admin, not every nested route", () => {
    render(<AdminNav />);

    expect(screen.getByRole("link", { name: "Resumen" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Inventario" })).not.toHaveAttribute("aria-current");
  });

  it.each([
    ["/admin/calculadora", "Calculadora"],
    ["/admin/inventario", "Inventario"],
    ["/admin/inventario/anything", "Inventario"],
    ["/admin/inversiones", "Inversiones"],
    ["/admin/piezas", "Piezas"],
    ["/admin/piezas/anything", "Piezas"],
    ["/admin/ventas", "Ventas"],
    ["/admin/ventas/anything", "Ventas"],
    ["/admin/mensajes", "Mensajes"],
  ])("marks %s as the current section", (pathname, label) => {
    pathnameMock.mockReturnValue(pathname);
    render(<AdminNav />);

    const current = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual([label]);
  });

  it("scrolls horizontally instead of wrapping, so seven tabs stay one line at 360px", () => {
    render(<AdminNav />);

    expect(screen.getByRole("navigation", { name: "Secciones del panel" })).toHaveClass(
      "overflow-x-auto",
    );
  });

  it("never grows a vertical scrollbar: overflow-y is pinned hidden and the scrollbar itself is hidden", () => {
    render(<AdminNav />);

    // `overflow-x: auto` alone makes `overflow-y` compute to `auto`, so a single
    // pixel of vertical overflow would show the tiny up/down scrollbar.
    expect(screen.getByRole("navigation", { name: "Secciones del panel" })).toHaveClass(
      "overflow-x-auto",
      "overflow-y-hidden",
      "[scrollbar-width:none]",
      "[&::-webkit-scrollbar]:hidden",
    );
  });

  it("keeps each tab's underline and focus ring inside its own box, so nothing sticks out of the row", () => {
    render(<AdminNav />);

    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveClass("border-b-2", "focus-visible:-outline-offset-2!");
      // A negative margin is what pulled the underline out of the row.
      expect(link).not.toHaveClass("-mb-px");
    }
  });
});
