# Prometheus Test Datasets

These datasets let you test all 3 Prometheus modules end-to-end.

## Pain Point 1: Bad Data Entering Production (Release Gatekeeper)

| File | What It Tests | Expected Result |
|------|---------------|-----------------|
| `release-valid-multi.json` | Valid payload with 5 records, all fields correct | ✅ PASS — all records accepted |
| `release-bad-fields.json` | Missing `id`, negative amounts, invalid timestamps | ❌ BLOCKED — 6 validation errors |
| `release-wrong-schema.json` | Wrong schema version, unknown environment | ❌ BLOCKED — schema + env errors |
| `release-empty-records.json` | Payload with empty records array | ❌ BLOCKED — at least one record required |

## Pain Point 2: API Integration Chaos (Integration Normalizer)

| File | What It Tests | Expected Result |
|------|---------------|-----------------|
| `vendor-stripe-valid.json` | Stripe payload with all expected fields | ✅ PASS — normalized to canonical contract |
| `vendor-salesforce-valid.json` | Salesforce payload with SF-specific field names | ✅ PASS — normalized to canonical contract |
| `vendor-stripe-drift.json` | Stripe payload missing `created_at` field | ❌ DRIFT — contract drift detected |
| `vendor-unknown.json` | Payload from unsupported vendor "shopify" | ❌ UNSUPPORTED — unknown vendor error |

## Pain Point 3: Production Debugging Nightmares (Incident Analyst)

| File | What It Tests | Expected Result |
|------|---------------|-----------------|
| `incident-timeout.json` | Gateway timeout cascade with retry exhaustion | 🔴 Root cause: Upstream dependency timeout |
| `incident-auth-failure.json` | Unauthorized access with expired token references | 🔴 Root cause: Identity/secret config failure |
| `incident-schema-break.json` | Schema validation errors in production | 🟡 Root cause: Schema/API contract regression |
| `incident-mixed-noise.json` | Noisy logs with no matching pattern | 🟠 Root cause: Unknown operational anomaly |

## Quick Test Commands

```bash
# Pain Point 1: Data Validation
node scripts/validate-data.mjs tests/fixtures/datasets/release-valid-multi.json
node scripts/validate-data.mjs tests/fixtures/datasets/release-bad-fields.json

# Pain Point 2: API Normalization
node scripts/validate-contract.mjs tests/fixtures/datasets/vendor-stripe-valid.json
node scripts/validate-contract.mjs tests/fixtures/datasets/vendor-unknown.json

# Pain Point 3: Log Analysis
node scripts/analyze-logs.mjs tests/fixtures/datasets/incident-timeout.json
node scripts/analyze-logs.mjs tests/fixtures/datasets/incident-auth-failure.json
```
