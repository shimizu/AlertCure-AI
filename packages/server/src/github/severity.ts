import type { Severity } from "../types.js";

/** GraphQL (LOW/MODERATE/HIGH/CRITICAL) と REST (low/medium/high/critical) の表記を揃える */
export function normalizeSeverity(value: string): Severity {
  switch (value.toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "moderate":
    case "medium":
      return "medium";
    default:
      return "low";
  }
}
