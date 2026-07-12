/**
 * Catalog endpoints (read-only pickers, backend `catalog` slice, 0036).
 * The diagnosis chips, brand dropdown, and parts picker fetch the seeded
 * W5/W6 vocabulary here — ids are the slugs/UUIDs the completion form and
 * intake write back. Offline callers fall back to whatever the screen keeps
 * locally; ids that didn't come from this API are never sent to the server.
 */

import { request } from "./api";

export interface CatalogCategory {
  id: string;
  name_en: string | null;
  name_ur: string | null;
  icon: string | null;
  sort: number;
}

export interface CatalogBrand {
  id: string;
  name: string;
  aliases: string[];
}

export interface CatalogActionCode {
  id: string;
  category_id: string;
  label_en: string | null;
  label_ur: string | null;
  icon: string | null;
  sort: number;
}

export interface CatalogFaultCode extends CatalogActionCode {
  is_surge_related: boolean;
}

export interface CatalogPart {
  id: string;
  name_canonical: string;
  category_id: string | null;
  quality: string | null;
}

function withCategory(path: string, categoryId?: string | null): string {
  return categoryId ? `${path}?category_id=${encodeURIComponent(categoryId)}` : path;
}

export const catalogApi = {
  categories: () => request<CatalogCategory[]>("/api/catalog/categories"),
  brands: () => request<CatalogBrand[]>("/api/catalog/brands"),
  faultCodes: (categoryId?: string | null) =>
    request<CatalogFaultCode[]>(withCategory("/api/catalog/fault-codes", categoryId)),
  actionCodes: (categoryId?: string | null) =>
    request<CatalogActionCode[]>(withCategory("/api/catalog/action-codes", categoryId)),
  parts: (categoryId?: string | null) =>
    request<CatalogPart[]>(withCategory("/api/catalog/parts", categoryId)),
};
