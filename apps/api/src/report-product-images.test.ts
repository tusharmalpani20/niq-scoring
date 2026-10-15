import { expect, test } from "bun:test";
import type { Product } from "./product-catalog";
import { withReportProductImages } from "./report-product-images";

test("visual metadata enriches only selected catalogue IDs without mutating agent guidance", () => {
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const guidance = {carePlan:{products:{catalog:[{id:"selected",name:"Selected product"},{id:"without-image",name:"No image"}]}}};
  const master = [{id:"selected",imageDataUrl:image},{id:"unselected",imageDataUrl:image}] as Product[];
  const response = withReportProductImages(guidance,master);
  expect(response.carePlan.products.catalog).toEqual([{id:"selected",name:"Selected product",imageDataUrl:image},{id:"without-image",name:"No image"}]);
  expect(JSON.stringify(guidance)).not.toContain("imageDataUrl");
  expect(response.carePlan.products.catalog).not.toContainEqual({id:"unselected",imageDataUrl:image});
});
