import type { Product } from "./product-catalog";

/** Attach visual assets only after agents finish. They are not model context. */
export function withReportProductImages<T extends { carePlan: { products: { catalog?: Array<{ id: string }> } } }>(guidance: T, products: Product[]) {
  const images = new Map(products.filter(product => product.imageDataUrl).map(product => [product.id, product.imageDataUrl]));
  return { ...guidance, carePlan: { ...guidance.carePlan, products: { ...guidance.carePlan.products,
    catalog: guidance.carePlan.products.catalog?.map(product => ({ ...product,
      ...(images.has(product.id) ? { imageDataUrl: images.get(product.id)! } : {}),
    })),
  } } };
}
