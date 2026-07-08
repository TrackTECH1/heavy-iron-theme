import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * One-shot bootstrap: create Shopify fitment metaobject definition + custom.fitments metafield.
 * POST {} — uses SHOPIFY_STORE_DOMAIN + SHOPIFY_ADMIN_TOKEN secrets.
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isThrottled(data: unknown): boolean {
  const errors = (data as { errors?: unknown })?.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((e) => {
    const code = (e as { extensions?: { code?: string } })?.extensions?.code;
    const msg = (e as { message?: string })?.message || "";
    return code === "THROTTLED" || /throttl/i.test(msg);
  });
}

async function shopifyGql(
  shop: string,
  token: string,
  apiVersion: string,
  query: string,
  variables: Record<string, unknown> = {},
  attempt = 0,
) {
  const r = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  let data: { data?: Record<string, unknown>; errors?: unknown };
  try {
    data = await r.json();
  } catch {
    data = {};
  }
  if ((r.status === 429 || r.status >= 500 || isThrottled(data)) && attempt < 3) {
    await sleep(500 * 2 ** attempt);
    return shopifyGql(shop, token, apiVersion, query, variables, attempt + 1);
  }
  if (!r.ok) throw new Error(`Shopify HTTP ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // If a SYNC_API_KEY is configured, require it — this endpoint mutates the Shopify
    // schema (metaobject/metafield definitions). Idempotent, but not public by default.
    const syncKey = Deno.env.get("SYNC_API_KEY");
    if (syncKey) {
      const got = req.headers.get("x-sync-key") || new URL(req.url).searchParams.get("key");
      if (got !== syncKey) return json({ error: "unauthorized" }, 401);
    }

    const shop = Deno.env.get("SHOPIFY_STORE_DOMAIN");
    const token = Deno.env.get("SHOPIFY_ADMIN_TOKEN");
    const apiVersion = Deno.env.get("SHOPIFY_API_VERSION") || "2025-10";
    if (!shop || !token) {
      return json({ error: "Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN secrets" }, 400);
    }

    const makeDefQuery = await shopifyGql(
      shop,
      token,
      apiVersion,
      `query {
        makeDef: metaobjectDefinitionByType(type: "make") { id type }
        modelDef: metaobjectDefinitionByType(type: "model") { id type }
      }`,
    );
    const makeDefId = makeDefQuery?.data?.makeDef?.id as string | undefined;
    const modelDefId = makeDefQuery?.data?.modelDef?.id as string | undefined;
    if (!makeDefId || !modelDefId) {
      return json({
        error: "Could not resolve make/model metaobject definition IDs",
        makeDefId,
        modelDefId,
        raw: makeDefQuery,
      }, 422);
    }

    const existing = await shopifyGql(
      shop,
      token,
      apiVersion,
      `query { def: metaobjectDefinitionByType(type: "fitment") { id type name } }`,
    );
    const fitmentDef = existing?.data?.def;

    let fitmentDefResult = fitmentDef;
    if (!fitmentDef) {
      const create = await shopifyGql(
        shop,
        token,
        apiVersion,
        `mutation CreateFitmentDef($definition: MetaobjectDefinitionCreateInput!) {
          metaobjectDefinitionCreate(definition: $definition) {
            metaobjectDefinition { id type name fieldDefinitions { key type { name } } }
            userErrors { field message code }
          }
        }`,
        {
          definition: {
            name: "Fitment",
            type: "fitment",
            description: "Equipment make + model fitment for a product",
            fieldDefinitions: [
              {
                name: "Make",
                key: "make",
                type: "metaobject_reference",
                validations: [{ name: "metaobject_definition_id", value: makeDefId }],
              },
              {
                name: "Model",
                key: "model",
                type: "metaobject_reference",
                validations: [{ name: "metaobject_definition_id", value: modelDefId }],
              },
            ],
          },
        },
      );
      const payload = create?.data?.metaobjectDefinitionCreate;
      const errs = payload?.userErrors || [];
      if (errs.length) {
        return json({ step: "metaobjectDefinitionCreate", userErrors: errs, raw: create }, 422);
      }
      fitmentDefResult = payload?.metaobjectDefinition;
    }

    const mfExisting = await shopifyGql(
      shop,
      token,
      apiVersion,
      `query {
        metafieldDefinitions(first: 1, ownerType: PRODUCT, namespace: "custom", key: "fitments") {
          nodes { id key name }
        }
      }`,
    );
    const fitmentsMf = mfExisting?.data?.metafieldDefinitions?.nodes?.[0];

    let fitmentsMfResult = fitmentsMf;
    const fitmentDefId = fitmentDefResult?.id as string | undefined;
    if (!fitmentDefId) {
      return json({ error: "Fitment definition missing after create", fitmentDefResult }, 422);
    }

    if (!fitmentsMf) {
      const createMf = await shopifyGql(
        shop,
        token,
        apiVersion,
        `mutation CreateFitmentsMetafield($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition { id name namespace key }
            userErrors { field message code }
          }
        }`,
        {
          definition: {
            name: "Fitments",
            namespace: "custom",
            key: "fitments",
            description: "Equipment make/model fitments for this product",
            type: "list.metaobject_reference",
            ownerType: "PRODUCT",
            validations: [{ name: "metaobject_definition_id", value: fitmentDefId }],
          },
        },
      );
      const payload = createMf?.data?.metafieldDefinitionCreate;
      const errs = payload?.userErrors || [];
      if (errs.length) {
        return json({
          step: "metafieldDefinitionCreate",
          fitment_definition: fitmentDefResult,
          userErrors: errs,
          raw: createMf,
        }, 422);
      }
      fitmentsMfResult = payload?.createdDefinition;
    }

    // Render-ready grouped fitment JSON (make -> models), written by sync-product-fitments so
    // the storefront can render fitments without dereferencing metaobjects per request.
    const displayExisting = await shopifyGql(
      shop,
      token,
      apiVersion,
      `query {
        metafieldDefinitions(first: 1, ownerType: PRODUCT, namespace: "custom", key: "fitments_display") {
          nodes { id key name }
        }
      }`,
    );
    const fitmentsDisplayMf = displayExisting?.data?.metafieldDefinitions?.nodes?.[0];
    let fitmentsDisplayResult = fitmentsDisplayMf;
    if (!fitmentsDisplayMf) {
      const createDisplayMf = await shopifyGql(
        shop,
        token,
        apiVersion,
        `mutation CreateFitmentsDisplayMetafield($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition { id name namespace key }
            userErrors { field message code }
          }
        }`,
        {
          definition: {
            name: "Fitments Display",
            namespace: "custom",
            key: "fitments_display",
            description: "Render-ready grouped fitment JSON (make → models) for the storefront.",
            type: "json",
            ownerType: "PRODUCT",
          },
        },
      );
      const displayPayload = createDisplayMf?.data?.metafieldDefinitionCreate;
      const displayErrs = displayPayload?.userErrors || [];
      if (displayErrs.length) {
        return json({
          step: "metafieldDefinitionCreate:fitments_display",
          userErrors: displayErrs,
          raw: createDisplayMf,
        }, 422);
      }
      fitmentsDisplayResult = displayPayload?.createdDefinition;
    }

    return json({
      ok: true,
      fitment_definition: fitmentDefResult,
      fitments_metafield_definition: fitmentsMfResult,
      fitments_display_metafield_definition: fitmentsDisplayResult,
      created_fitment_def: !fitmentDef,
      created_fitments_mf: !fitmentsMf,
      created_fitments_display_mf: !fitmentsDisplayMf,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
