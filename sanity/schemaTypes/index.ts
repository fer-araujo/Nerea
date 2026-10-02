import type { SchemaTypeDefinition } from "sanity";
import { product } from "./product";
import { category } from "./category";
import { siteSettings } from "./siteSettings";
import { contactMessage } from "./contactMessage";
import { chainLengthOption } from "./chainLengthOption";

export const schemaTypes: SchemaTypeDefinition[] = [
  product,
  category,
  siteSettings,
  contactMessage,
  chainLengthOption,
];
