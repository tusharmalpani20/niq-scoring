export type FaceScanStart = {
  organizationId: string;
  assessmentReference: string;
};

export interface FaceScanAdapter {
  readonly name: string;
  readonly configured: boolean;
  createSession(input: FaceScanStart): Promise<{ state: "REQUESTED"; providerSessionReference?: string }>;
}

/** Contract-safe development adapter. It never captures or invents measurements. */
export class StubFaceScanAdapter implements FaceScanAdapter {
  readonly name = "stub";
  readonly configured = false;
  async createSession(): Promise<{ state: "REQUESTED"; providerSessionReference?: string }> { return { state: "REQUESTED" }; }
}

/** Fail-closed placeholder until CarePlix contracts, credentials and callbacks are approved. */
export class UnconfiguredCarePlixAdapter implements FaceScanAdapter {
  readonly name = "careplix";
  readonly configured = false;
  async createSession(): Promise<never> { throw new Error("CAREPLIX_NOT_CONFIGURED"); }
}

export function createFaceScanAdapter(provider: "stub" | "careplix"): FaceScanAdapter {
  return provider === "careplix" ? new UnconfiguredCarePlixAdapter() : new StubFaceScanAdapter();
}
