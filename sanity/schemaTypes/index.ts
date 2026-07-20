import type { SchemaTypeDefinition } from "sanity";
import { product } from "./product";
import { category } from "./category";

export const schemaTypes: SchemaTypeDefinition[] = [product, category];
