export function ruleStatusVariant(lifecycle: string): "status" | "info" | "review" | "success" {
  switch (lifecycle) {
    case "VALIDATED": return "info";
    case "APPROVED": return "review";
    case "ACTIVE": return "success";
    default: return "status";
  }
}
