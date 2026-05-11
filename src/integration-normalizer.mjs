// ── Vendor Field Mappings ──
// Maps vendor-specific field names to a canonical contract schema.
const vendorMappings = {
  stripe: {
    id: "payment_id",
    amount: "amount_total",
    status: "payment_status",
    timestamp: "created_at"
  },
  salesforce: {
    id: "Id",
    amount: "AnnualRevenue",
    status: "Status__c",
    timestamp: "LastModifiedDate"
  },
  bitstamp: {
    id: "tid",
    amount: "amount",
    price: "price",
    type: "type",
    timestamp: "date"
  }
};

// ── Liquid Template Engine ──
// Lightweight implementation of Liquid-style templates
// as used in Azure API Management <set-body template="liquid">
function applyLiquidTemplate(template, payload) {
  const errors = [];
  let output = template;

  // Replace {{ body.fieldName }} references
  output = output.replace(/\{\{\s*body\.(\w+)\s*\}\}/g, (match, field) => {
    if (!(field in payload)) {
      errors.push(`Liquid reference error: body.${field} not found in payload`);
      return match;
    }
    return payload[field];
  });

  // Handle {% for item in body.arrayField %} ... {% endfor %}
  output = output.replace(
    /\{%\s*for\s+(\w+)\s+in\s+body\.(\w+)\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/g,
    (match, itemName, arrayField, loopBody) => {
      if (!(arrayField in payload) || !Array.isArray(payload[arrayField])) {
        errors.push(`Liquid loop error: body.${arrayField} is not an array`);
        return "[]";
      }
      const items = payload[arrayField].map((item, index) => {
        let rendered = loopBody;
        rendered = rendered.replace(
          new RegExp(`\\{\\{\\s*${itemName}\\.(\\w+)\\s*\\}\\}`, "g"),
          (m, prop) => {
            if (!(prop in item)) {
              errors.push(`Liquid loop error: ${itemName}.${prop} not found at index ${index}`);
              return m;
            }
            return item[prop];
          }
        );
        return rendered.trim();
      });
      return items.join(",\n        ");
    }
  );

  // Validate the output is parseable JSON
  let normalized = null;
  try {
    normalized = JSON.parse(output);
  } catch (e) {
    errors.push(`Liquid output is not valid JSON: ${e.message}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized,
    transformMode: "liquid"
  };
}

// ── XSLT/XML Transform Engine ──
// Lightweight implementation of XML-to-JSON transformation
// as used in Azure Logic Apps with Transform XML action + json() expression
function applyXsltTransform(xmlString, fieldMap) {
  const errors = [];

  // Parse XML string into key-value pairs (leaf elements only)
  const xmlFields = {};
  // Match leaf elements (tags that do NOT contain other tags)
  const leafRegex = /<(\w+)([^>]*)>([^<]*)<\/\1>/g;
  let match;

  while ((match = leafRegex.exec(xmlString)) !== null) {
    const tagName = match[1];
    const attributes = match[2];
    const value = match[3].trim();

    xmlFields[tagName] = value;

    // Also extract attributes (e.g., currency="USD")
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

  // Apply the field map (XSLT stylesheet equivalent)
  const normalized = {};
  for (const [canonicalKey, xmlKey] of Object.entries(fieldMap)) {
    if (!(xmlKey in xmlFields)) {
      errors.push(`XSLT mapping error: XML element <${xmlKey}> not found in source document`);
      continue;
    }
    normalized[canonicalKey] = xmlFields[xmlKey];
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: errors.length === 0 ? normalized : null,
    transformMode: "xslt",
    parsedFields: xmlFields
  };
}

// ── Main Normalizer Function ──
export function normalizeVendorPayload(vendor, payload, options = {}) {
  const { mode, template, xml, xslt } = options;

  // Liquid template mode (Azure API Management style)
  if (mode === "liquid" && template) {
    return applyLiquidTemplate(template, payload);
  }

  // XSLT/XML mode (Azure Logic Apps style)
  if (mode === "xslt" && xml && xslt) {
    return applyXsltTransform(xml, xslt);
  }

  // Standard JSON field mapping
  const mapping = vendorMappings[vendor];
  if (!mapping) {
    return {
      ok: false,
      errors: [`unsupported vendor: ${vendor}`],
      normalized: null,
      transformMode: "json"
    };
  }

  const normalized = {};
  const errors = [];

  for (const [canonicalKey, vendorKey] of Object.entries(mapping)) {
    if (!(vendorKey in payload)) {
      errors.push(`missing vendor field: ${vendorKey}`);
      continue;
    }
    normalized[canonicalKey] = payload[vendorKey];
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: errors.length === 0 ? { vendor, ...normalized } : null,
    transformMode: "json"
  };
}

// ── Named exports for individual transform engines ──
export { applyLiquidTemplate, applyXsltTransform };
