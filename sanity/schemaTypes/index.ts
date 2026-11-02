import type { SchemaTypeDefinition } from "sanity";
import { product } from "./product";
import { category } from "./category";
import { collection } from "./collection";
import { siteSettings } from "./siteSettings";
import { chainLengthOption } from "./chainLengthOption";

export const schemaTypes: SchemaTypeDefinition[] = [
  product,
  category,
  collection,
  siteSettings,
  chainLengthOption,
];
