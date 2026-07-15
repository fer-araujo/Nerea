import { resolveLocalized, toAvailability, type Localized } from "./transforms";
import type {
  Availability,
  CommerceReadApi,
  Locale,
  Money,
  Product,
  ProductSummary,
} from "./types";

interface FixtureProduct {
  handle: string;
  title: Localized;
  description: Localized;
  images: string[];
  price: Money;
  /**
   * Loosely typed (not `Availability`) on purpose: it mirrors an arbitrary
   * raw CMS status field and is always routed through `toAvailability`, the
   * single derivation point, instead of being trusted directly.
   */
  status: string;
}

// Local, credential-free stand-ins for the Sanity-backed catalog so the
// storefront is demoable (COMMERCE_SOURCE=fixtures, the default) before the
// artisan's Sanity project has any real products. The shape mirrors the
// Sanity schema (bilingual {es,en} fields, minor-unit price) so flipping
// COMMERCE_SOURCE to "sanity" later needs zero downstream changes.
const FIXTURE_PRODUCTS: FixtureProduct[] = [
  {
    handle: "anillo-plata-cera-perdida",
    title: {
      es: "Anillo de plata fundido a la cera perdida",
      en: "Lost-wax cast silver ring",
    },
    description: {
      es: "Pieza única labrada a mano en plata .925 mediante fundición a la cera perdida. Cada anillo conserva las marcas irrepetibles del proceso artesanal.",
      en: "One-of-a-kind piece hand-carved in .925 silver using the lost-wax casting technique. Every ring keeps the unrepeatable marks of the handmade process.",
    },
    images: [
      "/products/anillo-plata-cera-perdida-1.jpg",
      "/products/anillo-plata-cera-perdida-2.jpg",
    ],
    price: { amount: 185000, currency: "MXN" }, // $1,850.00 MXN
    status: "available",
  },
  {
    handle: "dije-oro-amatista",
    title: {
      es: "Dije de oro con amatista",
      en: "Gold pendant with amethyst",
    },
    description: {
      es: "Dije en oro de 14k engastado a mano con una amatista natural. Pieza única, ya vendida.",
      en: "14k gold pendant hand-set with a natural amethyst. One-of-a-kind piece, already sold.",
    },
    images: ["/products/dije-oro-amatista-1.jpg"],
    price: { amount: 420000, currency: "MXN" }, // $4,200.00 MXN
    status: "sold",
  },
  {
    handle: "aretes-plata-luna",
    title: {
      es: 'Aretes de plata "fase lunar"',
      en: 'Silver "moon phase" earrings',
    },
    description: {
      es: "Aretes colgantes de plata .925 inspirados en las fases de la luna, terminados a mano con textura martillada.",
      en: "Dangling .925 silver earrings inspired by the phases of the moon, hand-finished with a hammered texture.",
    },
    images: ["/products/aretes-plata-luna-1.jpg"],
    price: { amount: 95000, currency: "MXN" }, // $950.00 MXN
    status: "available",
  },
];

function findFixture(handle: string): FixtureProduct | undefined {
  return FIXTURE_PRODUCTS.find((product) => product.handle === handle);
}

function toSummary(product: FixtureProduct, locale: Locale): ProductSummary {
  return {
    handle: product.handle,
    title: resolveLocalized(product.title, locale),
    price: product.price,
    availability: toAvailability(product.status),
    image: product.images[0] ?? "",
  };
}

function toProduct(product: FixtureProduct, locale: Locale): Product {
  return {
    ...toSummary(product, locale),
    description: resolveLocalized(product.description, locale),
    images: product.images,
  };
}

export const fixturesApi: CommerceReadApi = {
  async getProducts(locale) {
    return FIXTURE_PRODUCTS.map((product) => toSummary(product, locale));
  },

  async getProductByHandle(handle, locale) {
    const product = findFixture(handle);
    return product ? toProduct(product, locale) : null;
  },

  async getAvailability(handles) {
    const result: Record<string, Availability> = {};
    for (const handle of handles) {
      const product = findFixture(handle);
      // An unrecognized handle is treated the same as "sold": never imply a
      // piece is buyable when we don't even recognize it, mirroring the
      // fail-safe default in toAvailability.
      result[handle] = product ? toAvailability(product.status) : "sold";
    }
    return result;
  },
};
