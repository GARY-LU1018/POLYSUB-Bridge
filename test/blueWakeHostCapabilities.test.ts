import { describe, expect, it } from "vitest";
import { BlueWakeHostCapabilitiesState, snapshotFromHostCapabilityReport } from "../src/blueWakeHostCapabilities.js";

describe("Blue-Wake host capability diagnostic", () => {
  it("returns explicit unknown/not_observed before ui/initialize capture", () => {
    const state = new BlueWakeHostCapabilitiesState();

    expect(state.read()).toEqual({
      observation: "not_observed",
      message: { text: "unknown", structuredContent: "unknown" },
      updateModelContext: { text: "unknown", structuredContent: "unknown" }
    });
  });

  it("captures only the four allowlisted declaration facts", () => {
    const state = new BlueWakeHostCapabilitiesState();
    state.capture({
      message: { text: true },
      updateModelContext: { structuredContent: true }
    });

    expect(state.read()).toEqual({
      observation: "observed",
      message: { text: "yes", structuredContent: "no" },
      updateModelContext: { text: "no", structuredContent: "yes" }
    });
  });

  it("does not retain unrelated host payload fields", () => {
    const snapshot = snapshotFromHostCapabilityReport({
      message: { text: true },
      updateModelContext: { structuredContent: false },
      unrelated: "must not be returned"
    } as never);

    expect(snapshot).toEqual({
      observation: "observed",
      message: { text: "yes", structuredContent: "no" },
      updateModelContext: { text: "no", structuredContent: "no" }
    });
    expect(JSON.stringify(snapshot)).not.toContain("must not be returned");
  });
});
