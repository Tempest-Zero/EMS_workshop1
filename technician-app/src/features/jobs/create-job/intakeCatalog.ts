/**
 * Intake's appliance/brand vocabulary. Online it comes from the catalog API
 * (so the chips match the seeded categories the analytics run on and intake can
 * send a resolved category_id); the last good copy is cached so a later offline
 * intake still shows real chips. When neither is available the wizard falls
 * back to its hardcoded constants (raw appliance text, no category_id — the
 * server text-matches).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { catalogApi, type CatalogBrand, type CatalogCategory } from "../../../lib/catalogApi";

export interface IntakeCatalog {
  categories: CatalogCategory[];
  brands: CatalogBrand[];
}

const CACHE_KEY = "catalog.cache.v1";

/** Network-first with an AsyncStorage fallback. Null only when we have never
 * cached the catalog and the network is away — the caller then uses its
 * hardcoded lists. */
export async function loadIntakeCatalog(): Promise<IntakeCatalog | null> {
  try {
    const [categories, brands] = await Promise.all([catalogApi.categories(), catalogApi.brands()]);
    const data: IntakeCatalog = { categories, brands };
    void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
    return data;
  } catch {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      return raw ? (JSON.parse(raw) as IntakeCatalog) : null;
    } catch {
      return null;
    }
  }
}
