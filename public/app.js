/* ═══════════════════════════════════════════════════════
   PROMETHEUS LAB  |  Engine Logic
   Imports the real Prometheus modules and runs them
   against user-selected datasets with visual results.
   ═══════════════════════════════════════════════════════ */

// ── Inline copies of the 3 Prometheus engines ──
// (We inline them so the browser can run them without Node.js)

const requiredFields = ["service", "environment", "schemaVersion", "records"];
const allowedEnvironments = new Set(["dev", "staging", "production"]);

function validateReleasePayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, errors: ["payload must be a JSON object"], metrics: { recordCount: 0, failureCount: 1 } };
  }
  for (const field of requiredFields) {
    if (!(field in payload)) errors.push(`missing required field: ${field}`);
  }
  if (payload.environment && !allowedEnvironments.has(payload.environment)) {
    errors.push(`unsupported environment: ${payload.environment}`);
  }
  if (payload.schemaVersion !== "2026-05") errors.push("schemaVersion must be 2026-05");
  if (!Array.isArray(payload.records)) {
    errors.push("records must be an array");
  } else if (payload.records.length === 0) {
    errors.push("records must include at least one item");
  } else {
    payload.records.forEach((record, index) => {
      if (!record.id) errors.push(`records[${index}].id is required`);
      if (typeof record.amount !== "number" || record.amount < 0) errors.push(`records[${index}].amount must be a non-negative number`);
      if (!record.timestamp || Number.isNaN(Date.parse(record.timestamp))) errors.push(`records[${index}].timestamp must be an ISO date`);
    });
  }
  return { ok: errors.length === 0, errors, metrics: { recordCount: Array.isArray(payload.records) ? payload.records.length : 0, failureCount: errors.length } };
}

const vendorMappings = {
  stripe: { id: "payment_id", amount: "amount_total", status: "payment_status", timestamp: "created_at" },
  salesforce: { id: "Id", amount: "AnnualRevenue", status: "Status__c", timestamp: "LastModifiedDate" },
  bitstamp: { id: "tid", amount: "amount", price: "price", type: "type", timestamp: "date" }
};

// Liquid template engine (Azure API Management style)
function applyLiquidTemplate(template, payload) {
  const errors = [];
  let output = template;
  output = output.replace(/\{\{\s*body\.(\w+)\s*\}\}/g, (match, field) => {
    if (!(field in payload)) { errors.push(`Liquid reference error: body.${field} not found in payload`); return match; }
    return payload[field];
  });
  output = output.replace(
    /\{%\s*for\s+(\w+)\s+in\s+body\.(\w+)\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/g,
    (match, itemName, arrayField, loopBody) => {
      if (!(arrayField in payload) || !Array.isArray(payload[arrayField])) { errors.push(`Liquid loop error: body.${arrayField} is not an array`); return "[]"; }
      const items = payload[arrayField].map((item, index) => {
        let rendered = loopBody;
        rendered = rendered.replace(new RegExp(`\\{\\{\\s*${itemName}\\.(\\w+)\\s*\\}\\}`, "g"), (m, prop) => {
          if (!(prop in item)) { errors.push(`Liquid loop error: ${itemName}.${prop} not found at index ${index}`); return m; }
          return item[prop];
        });
        return rendered.trim();
      });
      return items.join(",\n        ");
    }
  );
  let normalized = null;
  try { normalized = JSON.parse(output); } catch (e) { errors.push(`Liquid output is not valid JSON: ${e.message}`); }
  return { ok: errors.length === 0, errors, normalized, transformMode: "liquid" };
}

// XSLT/XML transform engine (Azure Logic Apps style)
function applyXsltTransform(xmlString, fieldMap) {
  const errors = [];
  const xmlFields = {};
  const leafRegex = /<(\w+)([^>]*)>([^<]*)<\/\1>/g;
  let match;
  while ((match = leafRegex.exec(xmlString)) !== null) {
    const tagName = match[1];
    const attributes = match[2];
    const value = match[3].trim();
    xmlFields[tagName] = value;
    const attrRegex = /(\w+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attributes)) !== null) {
      xmlFields[`${tagName}@${attrMatch[1]}`] = attrMatch[2];
    }
  }
  if (Object.keys(xmlFields).length === 0) {
    errors.push("XSLT parse error: no XML elements found in input");
    return { ok: false, errors, normalized: null, transformMode: "xslt" };
  }
  const normalized = {};
  for (const [canonicalKey, xmlKey] of Object.entries(fieldMap)) {
    if (!(xmlKey in xmlFields)) { errors.push(`XSLT mapping error: XML element <${xmlKey}> not found`); continue; }
    normalized[canonicalKey] = xmlFields[xmlKey];
  }
  return { ok: errors.length === 0, errors, normalized: errors.length === 0 ? normalized : null, transformMode: "xslt", parsedFields: xmlFields };
}

function normalizeVendorPayload(vendor, payload, options = {}) {
  const { mode, template, xml, xslt } = options;
  if (mode === "liquid" && template) return applyLiquidTemplate(template, payload);
  if (mode === "xslt" && xml && xslt) return applyXsltTransform(xml, xslt);
  const mapping = vendorMappings[vendor];
  if (!mapping) return { ok: false, errors: [`unsupported vendor: ${vendor}`], normalized: null, transformMode: "json" };
  const normalized = {};
  const errors = [];
  for (const [canonicalKey, vendorKey] of Object.entries(mapping)) {
    if (!(vendorKey in payload)) { errors.push(`missing vendor field: ${vendorKey}`); continue; }
    normalized[canonicalKey] = payload[vendorKey];
  }
  return { ok: errors.length === 0, errors, normalized: errors.length === 0 ? { vendor, ...normalized } : null, transformMode: "json" };
}

const rootCauseRules = [
  { match: /timeout|ETIMEDOUT|gateway/i, cause: "Upstream dependency timeout", remediation: "Check upstream latency, retry policy, and circuit breaker thresholds." },
  { match: /schema|contract|validation/i, cause: "Schema or API contract regression", remediation: "Compare the deployed contract with the latest CI contract test output." },
  { match: /unauthorized|forbidden|secret|token/i, cause: "Identity or secret configuration failure", remediation: "Verify Key Vault references, managed identity permissions, and token expiry." }
];

function analyzeIncidentLogs(payload) {
  const events = Array.isArray(payload) ? payload : (payload.hits?.hits || []);
  if (!Array.isArray(events) || events.length === 0) return { ok: false, rootCause: "Invalid log input", severity: "unknown", remediation: "Provide an Elasticsearch hits payload or array of logs.", eventCount: 0 };
  
  const joined = events.map((e) => {
    const source = e._source || e;
    return `${source.level || ""} ${source.message || ""}`;
  }).join("\n");
  
  const severity = events.some((e) => {
    const source = e._source || e;
    return source.level === "critical";
  }) ? "critical" : events.some((e) => {
    const source = e._source || e;
    return source.level === "error";
  }) ? "error" : "warning";
  
  const rule = rootCauseRules.find((r) => r.match.test(joined));
  return { ok: true, rootCause: rule?.cause || "Unknown operational anomaly", severity, remediation: rule?.remediation || "Inspect correlated traces, recent deployments, and dependency health.", eventCount: events.length };
}

// ── Fix Suggestion Engine ──
// Maps error patterns to concrete fix steps

function getGatekeeperFixes(errors) {
  const fixes = [];
  for (const err of errors) {
    if (err.includes("missing required field")) {
      const field = err.match(/field: (.+)/)?.[1] || "field";
      fixes.push(`Add the missing <code>${field}</code> property to your payload root object`);
    } else if (err.includes("unsupported environment")) {
      const env = err.match(/environment: (.+)/)?.[1] || "env";
      fixes.push(`Change environment from <code>"${env}"</code> to one of: <code>"dev"</code>, <code>"staging"</code>, or <code>"production"</code>`);
    } else if (err.includes("schemaVersion must be")) {
      fixes.push(`Update <code>schemaVersion</code> to <code>"2026-05"</code>  |  the current contract version`);
    } else if (err.includes(".id is required")) {
      const idx = err.match(/records\[(\d+)\]/)?.[1] || "?";
      fixes.push(`Add a non-empty <code>id</code> string to <code>records[${idx}]</code> (e.g. <code>"txn_${Date.now()}"</code>)`);
    } else if (err.includes(".amount must be")) {
      const idx = err.match(/records\[(\d+)\]/)?.[1] || "?";
      fixes.push(`Set <code>records[${idx}].amount</code> to a non-negative number (currently negative or not a number)`);
    } else if (err.includes(".timestamp must be")) {
      const idx = err.match(/records\[(\d+)\]/)?.[1] || "?";
      fixes.push(`Replace <code>records[${idx}].timestamp</code> with a valid ISO 8601 date (e.g. <code>"2026-05-10T12:00:00Z"</code>)`);
    } else if (err.includes("at least one item")) {
      fixes.push(`Add at least one record object to the <code>records</code> array  |  empty deployments are not allowed`);
    } else if (err.includes("records must be an array")) {
      fixes.push(`Change <code>records</code> to an array of objects: <code>"records": [{ ... }]</code>`);
    }
  }
  return fixes;
}

function getNormalizerFixes(errors, vendor) {
  const fixes = [];
  for (const err of errors) {
    if (err.includes("unsupported vendor")) {
      const v = err.match(/vendor: (.+)/)?.[1] || vendor;
      fixes.push(`Vendor <code>"${v}"</code> is not in the mapping registry. Add a mapping in <code>src/integration-normalizer.mjs</code>`);
      fixes.push(`Supported vendors: <code>stripe</code>, <code>salesforce</code>, <code>bitstamp</code>. Change the <code>vendor</code> field to a supported value`);
      fixes.push(`To add support for <code>${v}</code>, define a field mapping: <code>{ id: "order_id", amount: "total_price", ... }</code>`);
    } else if (err.includes("missing vendor field")) {
      const field = err.match(/field: (.+)/)?.[1] || "field";
      fixes.push(`Add the missing <code>${field}</code> property to the vendor payload  |  the API contract expects it`);
      if (field === "created_at") {
        fixes.push(`This is likely a contract drift issue  |  the upstream API may have renamed or removed <code>${field}</code>. Check the vendor's latest changelog.`);
      }
    } else if (err.includes("Liquid")) {
      fixes.push(`Review the Liquid template syntax. Ensure properties like <code>{{body.field}}</code> match the input payload.`);
      fixes.push(`For array loops, verify the syntax: <code>{% for item in body.array %}...{% endfor %}</code>`);
    } else if (err.includes("XSLT")) {
      fixes.push(`Review the XML input and ensure the elements exist.`);
      fixes.push(`Check the XSLT field map to verify it correctly references the XML tags or attributes.`);
    }
  }
  return fixes;
}

function getAnalystFixes(rootCause) {
  const fixMap = {
    "Upstream dependency timeout": [
      "Check the upstream service health dashboard for degraded performance",
      "Review circuit breaker config  |  consider lowering the failure threshold or increasing timeout",
      "Implement retry with exponential backoff if not already present",
      "Add a fallback path (cached response or degraded mode) for the affected dependency",
      "Run <code>kubectl describe pod</code> on upstream pods to check for resource limits"
    ],
    "Schema or API contract regression": [
      "Compare the current API spec with the contract from the last passing CI build",
      "Check recent deployments  |  the breaking change likely happened in the most recent deploy",
      "Run <code>npm run validate:contract</code> against the new endpoint to identify exact field mismatches",
      "Coordinate with the owning team to either fix the contract or update consumers",
      "Add a contract test to the CI pipeline to catch this automatically in the future"
    ],
    "Identity or secret configuration failure": [
      "Check Azure Key Vault for expired secrets  |  rotate any token older than 30 days",
      "Verify the managed identity RBAC assignment on the target resource",
      "Run <code>az keyvault secret show</code> to confirm the secret reference is accessible",
      "Check if a recent deployment changed environment variables or removed Key Vault references",
      "Enable fallback credentials for graceful degradation in auth failures"
    ],
    "Unknown operational anomaly": [
      "No clear root cause pattern detected  |  this requires manual investigation",
      "Check correlated APM traces from the incident window for cross-service dependencies",
      "Review recent deployment history for any changes that coincide with the anomaly",
      "Check infrastructure metrics: CPU, memory, disk I/O, and network for resource exhaustion",
      "Consider adding more structured logging with correlation IDs for better incident resolution"
    ]
  };
  return fixMap[rootCause] || fixMap["Unknown operational anomaly"];
}

function renderFixSuggestion(fixes) {
  if (!fixes || fixes.length === 0) return "";
  return `
    <div class="fix-suggestion">
      <div class="fix-suggestion-title">How to Fix This</div>
      <ol class="fix-steps">
        ${fixes.map((f, i) => `<li style="animation-delay: ${i * 80}ms">${f}</li>`).join("")}
      </ol>
    </div>
  `;
}

// ── Dataset Definitions ──
const datasets = {
  "release-valid-multi": {
    service: "payments-api", environment: "staging", schemaVersion: "2026-05",
    records: [
      { id: "txn_90001", amount: 2499.99, timestamp: "2026-05-10T08:12:00Z" },
      { id: "txn_90002", amount: 89.50, timestamp: "2026-05-10T08:14:22Z" },
      { id: "txn_90003", amount: 0, timestamp: "2026-05-10T08:15:01Z" },
      { id: "txn_90004", amount: 15750.00, timestamp: "2026-05-10T09:00:00Z" },
      { id: "txn_90005", amount: 3.99, timestamp: "2026-05-10T09:22:45Z" }
    ]
  },
  "release-bad-fields": {
    service: "inventory-api", environment: "production", schemaVersion: "2026-05",
    records: [
      { id: "", amount: -250.00, timestamp: "not-a-date" },
      { id: "inv_2002", amount: -1, timestamp: "2026-05-10T10:00:00Z" },
      { id: "", amount: 100, timestamp: "yesterday" },
      { id: "inv_2004", amount: 50.00, timestamp: "2026-05-10T11:30:00Z" }
    ]
  },
  "release-wrong-schema": {
    service: "billing-api", environment: "canary", schemaVersion: "2025-11",
    records: [{ id: "bill_3001", amount: 599.99, timestamp: "2026-05-10T07:00:00Z" }]
  },
  "release-empty-records": {
    service: "analytics-api", environment: "dev", schemaVersion: "2026-05", records: []
  },

  "vendor-stripe-valid": {
    vendor: "stripe",
    payload: { payment_id: "pay_8801", amount_total: 4250.00, payment_status: "succeeded", created_at: "2026-05-10T14:22:00Z" }
  },
  "vendor-bitstamp-valid": {
    vendor: "bitstamp",
    payload: { tid: "298746523", date: "1715360000", type: "0", price: "62000.75", amount: "0.50000000" }
  },
  "vendor-salesforce-valid": {
    vendor: "salesforce",
    payload: { Id: "0015g00000ABCDE", AnnualRevenue: 1200000, Status__c: "Active", LastModifiedDate: "2026-05-09T18:30:00Z" }
  },
  "vendor-liquid-template": {
    vendor: "stripe",
    mode: "liquid",
    template: '{\n  "order_id": "{{body.payment_id}}",\n  "total": {{body.amount_total}},\n  "status": "{{body.payment_status}}",\n  "processed_at": "{{body.created_at}}"\n}',
    payload: { payment_id: "pay_1001", amount_total: 4250.00, payment_status: "succeeded", created_at: "2026-05-10T14:22:00Z" }
  },
  "vendor-xslt-transform": {
    vendor: "legacy-soap",
    mode: "xslt",
    xml: '<invoice><invoiceId>INV-2026-0847</invoiceId><customer>Contoso Ltd</customer><total currency="USD">12500.00</total><issued>2026-05-10</issued></invoice>',
    xslt: { id: "invoiceId", customer: "customer", amount: "total", currency: "total@currency", timestamp: "issued" },
    payload: {}
  },

  "incident-timeout": {
    "took": 12, "timed_out": false, "_shards": { "total": 3, "successful": 3, "skipped": 0, "failed": 0 },
    "hits": {
      "total": { "value": 6, "relation": "eq" },
      "hits": [
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T14:21:58Z", "level": "warning", "service": "inventory-service", "message": "Elevated latency on inventory-service: p99 = 4200ms" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T14:21:59Z", "level": "error", "service": "checkout-api", "message": "ETIMEDOUT connecting to inventory-service.internal:8443" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T14:22:00Z", "level": "critical", "service": "api-gateway", "message": "Gateway timeout: upstream inventory-service did not respond within 5000ms" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T14:22:01Z", "level": "error", "service": "inventory-service", "message": "Circuit breaker tripped for inventory-service after 12 consecutive failures" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T14:22:02Z", "level": "warning", "service": "order-worker", "message": "Retry budget exhausted for order-processing pipeline" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T14:22:03Z", "level": "error", "service": "checkout-api", "message": "Cascading timeout: checkout-api blocked waiting on inventory-service dependency" } }
      ]
    }
  },
  "incident-auth-failure": {
    "took": 8, "timed_out": false, "_shards": { "total": 3, "successful": 3, "skipped": 0, "failed": 0 },
    "hits": {
      "total": { "value": 5, "relation": "eq" },
      "hits": [
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T09:14:01Z", "level": "warning", "service": "payments-worker", "message": "Token refresh failed for managed identity on payments-worker" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T09:14:02Z", "level": "error", "service": "payments-worker", "message": "401 Unauthorized: Bearer token expired for Key Vault reference payments-db-connstr" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T09:14:03Z", "level": "critical", "service": "auth-service", "message": "Secret rotation detected stale token: last rotation was 47 days ago" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T09:14:04Z", "level": "error", "service": "payments-worker", "message": "Forbidden: RBAC assignment missing for payments-worker on keyvault-prod-eu" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T09:14:05Z", "level": "warning", "service": "payments-worker", "message": "Fallback credentials not configured; service entering degraded mode" } }
      ]
    }
  },
  "incident-schema-break": {
    "took": 15, "timed_out": false, "_shards": { "total": 3, "successful": 3, "skipped": 0, "failed": 0 },
    "hits": {
      "total": { "value": 4, "relation": "eq" },
      "hits": [
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T11:30:12Z", "level": "error", "service": "orders-api", "message": "Schema validation failed: field 'customer_id' is required but missing in /orders/create" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T11:30:13Z", "level": "warning", "service": "contract-testing", "message": "API contract test divergence: expected 'amount' (number), received 'amount' (string)" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T11:30:14Z", "level": "error", "service": "payments-v2", "message": "Breaking contract change detected on payments-v2 endpoint after deploy #142" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T11:30:15Z", "level": "warning", "service": "api-gateway", "message": "Consumer 'mobile-app' reporting 422 errors on /orders/create since 14:22 UTC" } }
      ]
    }
  },
  "incident-mixed-noise": {
    "took": 22, "timed_out": false, "_shards": { "total": 3, "successful": 3, "skipped": 0, "failed": 0 },
    "hits": {
      "total": { "value": 7, "relation": "eq" },
      "hits": [
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T16:45:01Z", "level": "warning", "service": "worker-pool-3", "message": "CPU utilization at 78% on worker-pool-3" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T16:45:05Z", "level": "error", "service": "checkout-api", "message": "Memory pressure: OOM killer invoked on pod checkout-7f4b2" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T16:45:09Z", "level": "warning", "service": "storage-node-eu", "message": "Disk I/O latency spike: 340ms average on storage-node-eu-west" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T16:45:12Z", "level": "error", "service": "db-primary", "message": "Connection pool saturated: 200/200 connections in use on db-primary" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T16:45:15Z", "level": "warning", "service": "analytics", "message": "GC pause exceeded 800ms on analytics-aggregator" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T16:45:18Z", "level": "warning", "service": "kube-dns", "message": "DNS resolution intermittently slow for internal service mesh" } },
        { "_index": "prod-logs-2026.05.10", "_source": { "@timestamp": "2026-05-10T16:45:21Z", "level": "error", "service": "api-router", "message": "Request queue depth growing: 1,247 pending requests on api-router" } }
      ]
    }
  }
};

// ── JSON Syntax Highlighting ──
function highlightJSON(obj) {
  const raw = JSON.stringify(obj, null, 2);
  return raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
    .replace(/: (-?\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
    .replace(/: (true|false)/g, ': <span class="json-bool">$1</span>')
    .replace(/: (null)/g, ': <span class="json-null">$1</span>');
}

// ── Tab Switching ──
const tabs = [...document.querySelectorAll(".tab")];
const panels = [...document.querySelectorAll(".test-panel")];

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    tabs.forEach((t) => { t.classList.toggle("is-active", t === tab); t.setAttribute("aria-selected", String(t === tab)); });
    panels.forEach((p) => { p.classList.toggle("is-visible", p.id === `panel-${target}`); p.hidden = p.id !== `panel-${target}`; });
  });
});

// ── Dataset Selection ──
function initDatasetPickers(panelId, defaultDataset) {
  const panel = document.getElementById(panelId);
  const buttons = [...panel.querySelectorAll(".dataset-btn")];
  const editor = panel.querySelector(".code-editor");

  function loadDataset(key) {
    const data = datasets[key];
    editor.value = JSON.stringify(data, null, 2);
    buttons.forEach((b) => b.classList.toggle("is-selected", b.dataset.dataset === key));
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => loadDataset(btn.dataset.dataset));
  });

  loadDataset(defaultDataset);
}

initDatasetPickers("panel-gatekeeper", "release-valid-multi");
initDatasetPickers("panel-normalizer", "vendor-stripe-valid");
initDatasetPickers("panel-analyst", "incident-timeout");

// ── Result Rendering: Gatekeeper ──
function renderGatekeeperResult(result) {
  const body = document.querySelector("#result-gatekeeper .result-body");

  const statusHTML = `
    <div class="result-status ${result.ok ? "status-pass" : "status-fail"}">
      <span class="status-icon">${result.ok ? "✅" : "🛑"}</span>
      <div class="result-status-text">
        <strong>${result.ok ? "RELEASE APPROVED: Safe to Deploy" : "RELEASE BLOCKED: Bad Data Detected"}</strong>
        <small>${result.ok ? "All validation gates passed successfully" : `${result.errors.length} validation error${result.errors.length > 1 ? "s" : ""} found`}</small>
      </div>
    </div>
  `;

  const metricsHTML = `
    <div class="result-metrics">
      <div class="result-metric"><strong>${result.metrics.recordCount}</strong><span>Records</span></div>
      <div class="result-metric"><strong>${result.metrics.failureCount}</strong><span>Failures</span></div>
      <div class="result-metric"><strong>${result.ok ? "100%" : Math.max(0, Math.round((1 - result.metrics.failureCount / Math.max(1, result.metrics.recordCount * 3)) * 100)) + "%"}</strong><span>Gate Score</span></div>
      <div class="result-metric"><strong>${result.processTimeMs ? (result.processTimeMs).toFixed(0) + "ms" : "<1ms"}</strong><span>Validation Time</span></div>
    </div>
  `;

  let errorsHTML = "";
  if (result.errors.length > 0) {
    errorsHTML = `<div class="result-errors">${result.errors.map((err, i) =>
      `<div class="result-error-item" style="animation-delay: ${i * 80}ms"><span class="err-num">${i + 1}</span><span>${err}</span></div>`
    ).join("")}</div>`;
  }

  // Fix suggestions
  const fixHTML = !result.ok ? renderFixSuggestion(getGatekeeperFixes(result.errors)) : "";

  const jsonHTML = `<div class="result-json">${highlightJSON(result)}</div>`;

  body.innerHTML = statusHTML + metricsHTML + errorsHTML + fixHTML + jsonHTML;
}

// ── Result Rendering: Normalizer ──
function renderNormalizerResult(result, vendor) {
  const body = document.querySelector("#result-normalizer .result-body");

  const statusHTML = `
    <div class="result-status ${result.ok ? "status-pass" : "status-fail"}">
      <span class="status-icon">${result.ok ? "✅" : "⚠️"}</span>
      <div class="result-status-text">
        <strong>${result.ok ? "API CONTRACT NORMALIZED" : "NORMALIZATION FAILED"}</strong>
        <small>${result.ok ? "Vendor payload mapped to canonical contract" : result.errors.join("; ")}</small>
      </div>
    </div>
  `;

  const modeLabel = result.transformMode === "liquid" ? "Liquid" : result.transformMode === "xslt" ? "XSLT" : "JSON";
  const metricsHTML = `
    <div class="result-metrics">
      <div class="result-metric"><strong>${result.normalized ? Object.keys(result.normalized).length : 0}</strong><span>Fields Mapped</span></div>
      <div class="result-metric"><strong>${result.errors.length}</strong><span>Errors</span></div>
      <div class="result-metric"><strong>${modeLabel}</strong><span>Transform Mode</span></div>
      <div class="result-metric"><strong>${result.processTimeMs ? (result.processTimeMs).toFixed(0) + "ms" : "<1ms"}</strong><span>Transform Time</span></div>
    </div>
  `;

  let normalizedHTML = "";
  if (result.normalized) {
    normalizedHTML = `
      <div style="margin-bottom: 14px;">
        <div class="analyst-field-label" style="margin-bottom: 8px;">Canonical Contract Output</div>
        <div class="result-json">${highlightJSON(result.normalized)}</div>
      </div>
    `;
  }

  let errorsHTML = "";
  if (result.errors.length > 0) {
    errorsHTML = `<div class="result-errors">${result.errors.map((err, i) =>
      `<div class="result-error-item" style="animation-delay: ${i * 80}ms"><span class="err-num">${i + 1}</span><span>${err}</span></div>`
    ).join("")}</div>`;
  }

  // Fix suggestions
  const fixHTML = !result.ok ? renderFixSuggestion(getNormalizerFixes(result.errors, vendor)) : "";

  const jsonHTML = `<div class="result-json" style="margin-top: 14px;">${highlightJSON(result)}</div>`;

  body.innerHTML = statusHTML + metricsHTML + normalizedHTML + errorsHTML + fixHTML + jsonHTML;
}

// ── Result Rendering: AI Agent ──
function renderAnalystResult(result) {
  const body = document.querySelector("#result-analyst .result-body");

  const severityClass = result.severity === "critical" ? "severity-critical" : result.severity === "error" ? "severity-error" : "severity-warning";

  // Calculate agent confidence based on pattern match strength
  const confidence = result.rootCause === "Unknown operational anomaly" ? 42 : result.severity === "critical" ? 97 : result.severity === "error" ? 89 : 74;

  // Agent actions log
  const agentActions = [
    `Ingested ${result.eventCount} log events from Elasticsearch cluster`,
    `Scanned against ${rootCauseRules.length} root cause pattern rules`,
    `Identified pattern match: ${result.rootCause}`,
    `Severity classified as ${result.severity.toUpperCase()} (${result.severity === "critical" ? "P0" : result.severity === "error" ? "P1" : "P2"})`,
    `Generated remediation recommendation`
  ];

  // Fix suggestions based on root cause
  const fixHTML = renderFixSuggestion(getAnalystFixes(result.rootCause));

  body.innerHTML = `
    <div class="analyst-result">
      <div class="result-status ${result.severity === "critical" ? "status-fail" : "status-pass"}">
        <span class="status-icon">${result.severity === "critical" ? "🚨" : result.severity === "error" ? "⚠️" : "ℹ️"}</span>
        <div class="result-status-text">
          <strong>AGENT DIAGNOSIS COMPLETE</strong>
          <small>Autonomous analysis finished  |  ${result.eventCount} log events processed</small>
        </div>
      </div>

      <div style="margin: 14px 0;">
        <span class="analyst-severity ${severityClass}">● ${result.severity.toUpperCase()}</span>
      </div>

      <div class="analyst-field">
        <span class="analyst-field-label">Root Cause</span>
        <span class="analyst-field-value">${result.rootCause}</span>
      </div>

      <div class="analyst-field">
        <span class="analyst-field-label">Recommended Remediation</span>
        <span class="analyst-field-value">${result.remediation}</span>
      </div>

      <div class="result-metrics" style="margin-top: 14px;">
        <div class="result-metric"><strong>${result.eventCount}</strong><span>Events Parsed</span></div>
        <div class="result-metric"><strong>${result.severity === "critical" ? "P0" : result.severity === "error" ? "P1" : "P2"}</strong><span>Priority</span></div>
        <div class="result-metric"><strong>${confidence}%</strong><span>Confidence</span></div>
        <div class="result-metric"><strong>${result.processTimeMs ? (result.processTimeMs).toFixed(0) + "ms" : "<1ms"}</strong><span>Agent Time</span></div>
      </div>

      <div class="fix-suggestion" style="margin-top: 14px;">
        <div class="fix-suggestion-title">Agent Actions</div>
        <ol class="fix-steps">
          ${agentActions.map((a, i) => `<li style="animation-delay: ${i * 80}ms">${a}</li>`).join("")}
        </ol>
      </div>

      ${fixHTML}

      <div class="result-json" style="margin-top: 14px;">${highlightJSON(result)}</div>
    </div>
  `;
}

// ── Run Buttons ──
const counters = { blocked: 0, normalized: 0, diagnosed: 0 };

function bumpCounter(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = String(counters[id.replace("impact-", "")]);
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "count-up 300ms ease";
}

document.querySelectorAll(".run-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const engine = btn.dataset.engine;
    const editor = document.getElementById(`input-${engine}`);
    const startTime = performance.now();

    btn.classList.add("is-running");
    btn.textContent = "⏳ Processing...";

    // Simulate a brief processing delay for visual effect
    setTimeout(() => {
      try {
        const input = JSON.parse(editor.value);

        if (engine === "gatekeeper") {
          const result = validateReleasePayload(input);
          result.processTimeMs = performance.now() - startTime;
          renderGatekeeperResult(result);
          if (!result.ok) { counters.blocked++; bumpCounter("impact-blocked"); }
        } else if (engine === "normalizer") {
          const result = normalizeVendorPayload(input.vendor, input.payload, { mode: input.mode, template: input.template, xml: input.xml, xslt: input.xslt });
          result.processTimeMs = performance.now() - startTime;
          renderNormalizerResult(result, input.vendor);
          counters.normalized++; bumpCounter("impact-normalized");
        } else if (engine === "analyst") {
          const result = analyzeIncidentLogs(input);
          result.processTimeMs = performance.now() - startTime;
          renderAnalystResult(result);
          counters.diagnosed++; bumpCounter("impact-diagnosed");
        }
      } catch (err) {
        const body = document.querySelector(`#result-${engine} .result-body`);
        body.innerHTML = `
          <div class="result-status status-fail">
            <span class="status-icon">❌</span>
            <div class="result-status-text">
              <strong>PARSE ERROR</strong>
              <small>${err.message}</small>
            </div>
          </div>
          ${renderFixSuggestion([
            "Check the JSON syntax  |  look for missing commas, brackets, or quotes",
            "Use a JSON validator like <code>jsonlint.com</code> to find the exact issue",
            "Make sure the input is valid JSON, not a JavaScript object literal"
          ])}
        `;
      } finally {
        btn.classList.remove("is-running");
        btn.textContent = `▶ Run ${engine.charAt(0).toUpperCase() + engine.slice(1)}`;
      }
    }, 450);
  });
});
