const requiredFields = ["service", "environment", "schemaVersion", "records"];
const allowedEnvironments = new Set(["dev", "staging", "production"]);

export function validateReleasePayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      errors: ["payload must be a JSON object"],
      metrics: { recordCount: 0, failureCount: 1 }
    };
  }

  for (const field of requiredFields) {
    if (!(field in payload)) {
      errors.push(`missing required field: ${field}`);
    }
  }

  if (payload.environment && !allowedEnvironments.has(payload.environment)) {
    errors.push(`unsupported environment: ${payload.environment}`);
  }

  if (payload.schemaVersion !== "2026-05") {
    errors.push("schemaVersion must be 2026-05");
  }

  if (!Array.isArray(payload.records)) {
    errors.push("records must be an array");
  } else if (payload.records.length === 0) {
    errors.push("records must include at least one item");
  } else {
    payload.records.forEach((record, index) => {
      if (!record.id) errors.push(`records[${index}].id is required`);
      if (typeof record.amount !== "number" || record.amount < 0) {
        errors.push(`records[${index}].amount must be a non-negative number`);
      }
      if (!record.timestamp || Number.isNaN(Date.parse(record.timestamp))) {
        errors.push(`records[${index}].timestamp must be an ISO date`);
      }
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    metrics: {
      recordCount: Array.isArray(payload.records) ? payload.records.length : 0,
      failureCount: errors.length
    }
  };
}
