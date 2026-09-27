export function ruleStatusVariant(lifecycle: string): "status" | "info" | "review" | "success" | "retired" {
  switch (lifecycle) {
    case "VALIDATED": return "info";
    case "APPROVED": return "review";
    case "ACTIVE": return "success";
    case "RETIRED": return "retired";
    default: return "status";
  }
}
