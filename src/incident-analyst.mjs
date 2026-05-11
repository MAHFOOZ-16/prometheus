const rootCauseRules = [
  {
    match: /timeout|ETIMEDOUT|gateway/i,
    cause: "Upstream dependency timeout",
    remediation: "Check upstream latency, retry policy, and circuit breaker thresholds."
  },
  {
    match: /schema|contract|validation/i,
    cause: "Schema or API contract regression",
    remediation: "Compare the deployed contract with the latest CI contract test output."
  },
  {
    match: /unauthorized|forbidden|secret|token/i,
    cause: "Identity or secret configuration failure",
    remediation: "Verify Key Vault references, managed identity permissions, and token expiry."
  }
];

export function analyzeIncidentLogs(events) {
  if (!Array.isArray(events)) {
    return {
      ok: false,
      rootCause: "Invalid log input",
      severity: "unknown",
      remediation: "Provide an array of log events."
    };
  }

  const joined = events.map((event) => `${event.level || ""} ${event.message || ""}`).join("\n");
  const severity = events.some((event) => event.level === "critical")
    ? "critical"
    : events.some((event) => event.level === "error")
      ? "error"
      : "warning";

  const rule = rootCauseRules.find((candidate) => candidate.match.test(joined));

  return {
    ok: true,
    rootCause: rule?.cause || "Unknown operational anomaly",
    severity,
    remediation: rule?.remediation || "Inspect correlated traces, recent deployments, and dependency health.",
    eventCount: events.length
  };
}
