export type HostCapabilityDeclaration = "yes" | "no" | "unknown";

export type BlueWakeHostCapabilityReport = {
  message?: {
    text?: boolean;
    structuredContent?: boolean;
  };
  updateModelContext?: {
    text?: boolean;
    structuredContent?: boolean;
  };
};

export type BlueWakeHostCapabilitySnapshot = {
  observation: "not_observed" | "observed";
  message: {
    text: HostCapabilityDeclaration;
    structuredContent: HostCapabilityDeclaration;
  };
  updateModelContext: {
    text: HostCapabilityDeclaration;
    structuredContent: HostCapabilityDeclaration;
  };
};

const UNKNOWN_SNAPSHOT: BlueWakeHostCapabilitySnapshot = {
  observation: "not_observed",
  message: { text: "unknown", structuredContent: "unknown" },
  updateModelContext: { text: "unknown", structuredContent: "unknown" }
};

function declaration(value: boolean | undefined, observed: boolean): HostCapabilityDeclaration {
  if (!observed) return "unknown";
  return value === true ? "yes" : "no";
}

export function snapshotFromHostCapabilityReport(
  report: BlueWakeHostCapabilityReport | undefined
): BlueWakeHostCapabilitySnapshot {
  return {
    observation: "observed",
    message: {
      text: declaration(report?.message?.text, true),
      structuredContent: declaration(report?.message?.structuredContent, true)
    },
    updateModelContext: {
      text: declaration(report?.updateModelContext?.text, true),
      structuredContent: declaration(report?.updateModelContext?.structuredContent, true)
    }
  };
}

export class BlueWakeHostCapabilitiesState {
  private snapshot: BlueWakeHostCapabilitySnapshot = UNKNOWN_SNAPSHOT;

  capture(report: BlueWakeHostCapabilityReport | undefined): BlueWakeHostCapabilitySnapshot {
    this.snapshot = snapshotFromHostCapabilityReport(report);
    return this.read();
  }

  read(): BlueWakeHostCapabilitySnapshot {
    return {
      observation: this.snapshot.observation,
      message: { ...this.snapshot.message },
      updateModelContext: { ...this.snapshot.updateModelContext }
    };
  }
}
