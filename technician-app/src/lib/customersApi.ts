/**
 * Customers endpoints (mirrors the backend `customers` slice). v1 is a thin
 * repeat-customer lookup by phone for intake: the server returns the single
 * matching customer, or null for unknown/ambiguous/unrecognizable numbers
 * (never a 404), so the caller can poll it as the tech types.
 */

import { request } from "./api";

export interface CustomerLookup {
  id: string;
  full_name: string;
}

export const customersApi = {
  /** The one customer that owns this phone, or null. Never throws on "no match"
   * — a null body IS the not-found answer. */
  lookup(phone: string): Promise<CustomerLookup | null> {
    return request<CustomerLookup | null>(
      `/api/customers/lookup?phone=${encodeURIComponent(phone)}`,
    );
  },
};
