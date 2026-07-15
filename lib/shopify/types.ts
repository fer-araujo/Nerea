export interface StorefrontError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: Array<string | number>;
}

export interface StorefrontResponse<T> {
  data?: T;
  errors?: StorefrontError[];
}

export type ShopifyFetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface Money {
  amount: string;
  currencyCode: string;
}
