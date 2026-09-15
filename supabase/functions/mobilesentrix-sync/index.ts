import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SECRET_KEY") ||
  "";
const PORTAL_ORIGIN = "https://portal.gotcracked.co";
const SOURCE_NAME = "mobilesentrix";
const DEFAULT_API_BASE = "https://www.mobilesentrix.com";
const DEFAULT_CATALOG_PATH = "/api/rest/products";
const AURORA_RELAY = "https://auroraserver.tail317407.ts.net/internal/mobilesentrix-relay";
const MAX_CSV_BYTES = 8_000_000;
const MAX_CSV_ROWS = 25_000;

const cors = {
  "Access-Control-Allow-Origin": PORTAL_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

const clean = (value: unknown) => String(value ?? "").trim();

const slug = (value: unknown) =>
  clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 150);

const cents = (value: unknown) => {
  const number = Number(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(number) && number >= 0
    ? Math.round(number * 100)
    : null;
};

function textValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["label", "name", "title", "value"]) {
      const found = textValue(record[key]);
      if (found) return found;
    }
    return "";
  }
  return clean(value);
}

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (
      (character === "\n" || character === "\r") &&
      !quoted
    ) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else {
      cell += character;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function objectRows(text: string) {
  const rows = csvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => slug(header).replace(/-/g, "_"));
  return rows.slice(1).map((columns) =>
    Object.fromEntries(headers.map((header, index) => [header, columns[index] ?? ""]))
  );
}

function attr(record: any, ...names: string[]) {
  const wanted = names.map((name) => name.toLowerCase());

  for (const name of names) {
    if (record?.[name] != null && textValue(record[name])) return record[name];
  }

  const attributes = Array.isArray(record?.custom_attributes)
    ? record.custom_attributes
    : Array.isArray(record?.attributes)
    ? record.attributes
    : record?.attributes && typeof record.attributes === "object"
    ? Object.entries(record.attributes).map(([code, value]) => ({ code, value }))
    : [];

  for (const item of attributes) {
    const key = clean(
      item?.attribute_code ?? item?.code ?? item?.name,
    ).toLowerCase();
    if (wanted.includes(key) && textValue(item?.value ?? item?.label)) {
      return item?.value ?? item?.label;
    }
  }
  return null;
}

function numericValue(value: unknown) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = clean(value).toLowerCase();
  if (["1", "true", "yes", "y", "in stock", "available"].includes(normalized)) {
    return true;
  }
  if (
    ["0", "false", "no", "n", "out of stock", "unavailable"].includes(
      normalized,
    )
  ) {
    return false;
  }
  return null;
}

function quantityOf(record: any) {
  const direct = attr(
    record,
    "qty",
    "quantity",
    "stock",
    "inventory",
    "available_qty",
    "available_quantity",
  );
  const directNumber = numericValue(direct);
  if (directNumber != null) return directNumber;

  const stock =
    record?.extension_attributes?.stock_item ??
    record?.stock_item ??
    record?.stockItem;
  return numericValue(stock?.qty);
}

function stockOf(record: any, quantity: number | null) {
  const explicit = attr(
    record,
    "stock_status",
    "availability",
    "is_in_stock",
    "in_stock",
    "is_saleable",
    "saleable",
  );
  const explicitBoolean = booleanValue(explicit);
  if (explicitBoolean != null) {
    return explicitBoolean
      ? quantity != null
        ? `In stock (${quantity})`
        : "In stock"
      : "Out of stock";
  }

  const stock =
    record?.extension_attributes?.stock_item ??
    record?.stock_item ??
    record?.stockItem;
  const stockBoolean = booleanValue(stock?.is_in_stock);
  if (stockBoolean != null) {
    return stockBoolean
      ? quantity != null
        ? `In stock (${quantity})`
        : "In stock"
      : "Out of stock";
  }

  const text = textValue(explicit);
  if (text) return text;
  if (quantity == null) return "Unknown";
  return quantity > 0 ? `In stock (${quantity})` : "Out of stock";
}

function absoluteMobileSentrixUrl(value: unknown) {
  const candidate = clean(value);
  if (!candidate) return "";
  try {
    return new URL(candidate, DEFAULT_API_BASE).toString();
  } catch {
    return "";
  }
}

function normalize(record: any) {
  const sku = clean(
    attr(
      record,
      "sku",
      "product_sku",
      "item_sku",
      "code",
      "vendor_sku",
      "ms_sku",
    ),
  );
  const name =
    textValue(
      attr(record, "name", "product_name", "title", "item_name", "description"),
    ) ||
    sku ||
    "MobileSentrix Part";
  const brand =
    textValue(
      attr(record, "brand", "manufacturer", "make", "device_brand"),
    ) || null;
  const model =
    textValue(
      attr(
        record,
        "model",
        "device_model",
        "device",
        "model_name",
        "compatible_model",
        "compatibility",
      ),
    ) ||
    (brand && name.toLowerCase().startsWith(brand.toLowerCase())
      ? name.slice(brand.length).trim().slice(0, 160)
      : name.slice(0, 160));
  const category =
    textValue(
      attr(record, "category", "product_category", "type", "category_name"),
    ) || "Repair Part";
  const subcategory =
    textValue(
      attr(record, "subcategory", "sub_category", "part_type", "product_type"),
    ) || null;
  const priceRaw = attr(
    record,
    "cost",
    "unit_cost",
    "cost_price",
    "price",
    "unit_price",
    "wholesale_price",
    "final_price",
  );
  const priceCents = cents(priceRaw);
  const quantity = quantityOf(record);
  const availability = stockOf(record, quantity);
  const directUrl = absoluteMobileSentrixUrl(
    attr(record, "url", "product_url", "web_url"),
  );
  const urlKey = clean(attr(record, "url_key"));
  let sourceUrl = directUrl;
  if (!sourceUrl && urlKey) {
    sourceUrl = absoluteMobileSentrixUrl(`/${urlKey.replace(/^\/+/, "")}`);
  }
  if (!sourceUrl) {
    sourceUrl =
      `${DEFAULT_API_BASE}/catalogsearch/result/?q=` +
      encodeURIComponent(sku || name);
  }
  const image =
    absoluteMobileSentrixUrl(
      attr(record, "image", "image_url", "thumbnail", "small_image"),
    ) || null;
  const upc = clean(attr(record, "upc", "barcode", "gtin")) || null;
  const mpn =
    clean(
      attr(record, "manufacturer_part_number", "mpn", "part_number"),
    ) || null;
  const entityId =
    clean(attr(record, "entity_id", "product_id", "id")) || null;
  const canonicalKey = `mobilesentrix:${slug(
    sku || entityId || `${brand || ""}-${model}-${name}`,
  )}`;

  return {
    sku,
    name,
    brand,
    model: model || name,
    category,
    subcategory,
    priceCents,
    quantity,
    availability,
    sourceUrl,
    image,
    upc,
    mpn,
    entityId,
    canonicalKey,
    raw: record,
  };
}

function looksLikeProduct(record: any) {
  return Boolean(
    clean(record?.sku) ||
      clean(record?.entity_id) ||
      clean(record?.product_id) ||
      clean(record?.id) ||
      clean(record?.name) ||
      clean(record?.product_name),
  );
}

function apiItems(json: any) {
  if (Array.isArray(json)) return json;
  for (const key of ["items", "products", "data", "results"]) {
    if (Array.isArray(json?.[key])) return json[key];
  }
  if (Array.isArray(json?.data?.items)) return json.data.items;

  if (json && typeof json === "object") {
    for (const key of ["products", "data", "results"]) {
      const collection = json[key];
      if (collection && typeof collection === "object" && !Array.isArray(collection)) {
        const values = Object.values(collection).filter(looksLikeProduct);
        if (values.length) return values;
      }
    }
    const values = Object.values(json).filter(looksLikeProduct);
    if (values.length) return values;
  }
  return [];
}

function totalCount(json: any, headers: Headers, fallback: number | null) {
  const candidates = [
    json?.total_count,
    json?.totalCount,
    json?.total,
    json?.count,
    json?.meta?.total,
    headers.get("x-pagination-total-count"),
    headers.get("x-total-count"),
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return fallback;
}

function percentEncode(value: unknown) {
  return encodeURIComponent(String(value ?? "")).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function oauthNonce() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha1Base64(key: string, data: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(data),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function oauth1Authorization(
  method: string,
  url: URL,
  secret: any,
  extraOAuth: Record<string,string> = {},
  tokenOverride: string | null = null,
  tokenSecretOverride: string | null = null,
) {
  const consumerKey = clean(secret?.consumer_key ?? secret?.consumerKey);
  const consumerSecret = clean(
    secret?.consumer_secret ?? secret?.consumerSecret,
  );
  const accessToken = clean(tokenOverride ?? secret?.access_token ?? secret?.token ?? secret?.accessToken);
  const tokenSecret = clean(tokenSecretOverride ?? secret?.access_token_secret ?? secret?.token_secret ?? secret?.tokenSecret);

  if (!consumerKey || !consumerSecret) {
    throw new Error(
      "MobileSentrix OAuth consumer key and consumer secret are not configured.",
    );
  }
  if ((accessToken && !tokenSecret) || (!accessToken && tokenSecret)) {
    throw new Error(
      "Enter both the MobileSentrix access token and token secret, or leave both blank when only consumer credentials were issued.",
    );
  }

  const oauth: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: oauthNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
  };
  if (accessToken) oauth.oauth_token = accessToken;
  for (const [key,value] of Object.entries(extraOAuth || {})) { if (key.startsWith("oauth_") && value) oauth[key]=String(value); }

  const parameters = [
    ...Array.from(url.searchParams.entries()),
    ...Object.entries(oauth),
  ]
    .map(([key, value]) => [percentEncode(key), percentEncode(value)] as const)
    .sort(([keyA, valueA], [keyB, valueB]) =>
      keyA === keyB ? valueA.localeCompare(valueB) : keyA.localeCompare(keyB)
    );

  const normalized = parameters
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const baseUrl = `${url.origin}${url.pathname}`;
  const signatureBase = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(normalized),
  ].join("&");
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(
    tokenSecret,
  )}`;
  oauth.oauth_signature = await hmacSha1Base64(signingKey, signatureBase);

  return (
    "OAuth " +
    Object.entries(oauth)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
      .join(", ")
  );
}

function safeApiBase(value: unknown) {
  const url = new URL(clean(value) || DEFAULT_API_BASE);
  if (
    url.protocol !== "https:" ||
    !/(^|\.)mobilesentrix\.(com|ca|co\.uk)$/i.test(url.hostname)
  ) {
    throw new Error("API base URL must be a MobileSentrix HTTPS domain.");
  }
  return url.origin;
}

function safeCatalogPath(value: unknown) {
  const path = clean(value) || DEFAULT_CATALOG_PATH;
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Catalog API path must begin with one /.");
  }
  return path;
}

function normalizedAuthScheme(value: unknown) {
  const scheme = clean(value || "oauth1").toLowerCase();
  if (scheme === "oauth" || scheme === "oauth_1") return "oauth1";
  return scheme;
}

function hasConsumerCredentials(secret: any) {
  return Boolean(clean(secret?.consumer_key ?? secret?.consumerKey) && clean(secret?.consumer_secret ?? secret?.consumerSecret));
}

function credentialReady(scheme: string, secret: any) {
  if (!secret || typeof secret !== "object") return false;
  if (scheme === "oauth1") {
    return Boolean(hasConsumerCredentials(secret) && clean(secret.access_token ?? secret.token ?? secret.accessToken) && clean(secret.access_token_secret ?? secret.token_secret ?? secret.tokenSecret));
  }
  if (scheme === "basic") {
    return Boolean(clean(secret.username) && clean(secret.password));
  }
  return Boolean(clean(secret.token ?? secret.access_token ?? secret.api_key));
}

async function authHeaders(
  config: any,
  secret: any,
  method: string,
  url: URL,
) {
  const scheme = normalizedAuthScheme(config?.auth_scheme);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "GotCracked-MobileSentrix-Sync/1.2",
  };

  if (scheme === "oauth1") {
    headers.Authorization = await oauth1Authorization(method, url, secret);
  } else if (scheme === "basic") {
    const username = clean(secret?.username);
    const password = clean(secret?.password);
    if (!username || !password) {
      throw new Error(
        "MobileSentrix API username and password are not configured.",
      );
    }
    headers.Authorization = `Basic ${btoa(`${username}:${password}`)}`;
  } else if (scheme === "api_key") {
    const token = clean(secret?.token ?? secret?.api_key);
    if (!token) throw new Error("MobileSentrix API key is not configured.");
    headers[clean(config?.header_name) || "X-API-Key"] = token;
  } else if (scheme === "bearer") {
    const token = clean(
      secret?.token ?? secret?.access_token ?? secret?.api_key,
    );
    if (!token) {
      throw new Error("MobileSentrix bearer token is not configured.");
    }
    headers.Authorization = `Bearer ${token}`;
  } else {
    throw new Error("Unsupported MobileSentrix authentication scheme.");
  }

  return headers;
}

async function relayVendorRequest(
  portalAuthorization: string,
  url: URL,
  vendorHeaders: Record<string, string>,
) {
  const relay = await fetch(AURORA_RELAY, {
    method: "POST",
    headers: {
      Authorization: portalAuthorization,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      method: "GET",
      path: `${url.pathname}${url.search}`,
      vendorHeaders,
      body: "",
    }),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await relay.json().catch(() => null);
  if (!payload || !Number.isFinite(Number(payload.status))) {
    throw new Error(payload?.error || `AuroraServer MobileSentrix relay failed (HTTP ${relay.status}).`);
  }
  return new Response(String(payload.text || ""), {
    status: Number(payload.status),
    headers: { "Content-Type": String(payload.contentType || "") },
  });
}

function apiUrl(
  base: string,
  path: string,
  config: any,
  page: number,
  pageSize: number,
) {
  const url = new URL(path, `${base}/`);
  const pagination = clean(config?.pagination_mode || "magento1").toLowerCase();
  if (pagination === "magento2") {
    url.searchParams.set("searchCriteria[pageSize]", String(pageSize));
    url.searchParams.set("searchCriteria[currentPage]", String(page));
  } else {
    url.searchParams.set(clean(config?.page_param) || "page", String(page));
    url.searchParams.set(clean(config?.limit_param) || "limit", String(pageSize));
  }
  return url;
}

function safeApiError(status: number, contentType: string, text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (/html/i.test(contentType) || /^<!doctype html|^<html/i.test(compact)) {
    return `MobileSentrix API returned ${status} HTML instead of JSON. Check the catalog API path.`;
  }
  const redacted = compact
    .replace(/(authorization|token|secret|key)\s*[:=]\s*["']?[^"',\s}]+/gi, "$1=[REDACTED]")
    .slice(0, 350);
  return `MobileSentrix API returned ${status}${redacted ? `: ${redacted}` : ""}`;
}

async function readSavedSecret(admin: any, secretId: string | null) {
  if (!secretId) return null;
  const result = await admin.rpc("server_read_vendor_secret", {
    p_secret_id: secretId,
  });
  if (result.error || !result.data) return null;
  try {
    const parsed = JSON.parse(result.data);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function incomingSecret(body: any, scheme: string) {
  const values: Record<string, string> = {};
  if (scheme === "oauth1") {
    values.consumer_key = clean(body.consumer_key);
    values.consumer_secret = clean(body.consumer_secret);
    values.access_token = clean(body.access_token);
    values.access_token_secret = clean(body.access_token_secret ?? body.token_secret);
  } else if (scheme === "basic") {
    values.username = clean(body.username);
    values.password = clean(body.password);
  } else {
    values.token = clean(body.token);
  }
  return values;
}

function mergeSecret(existing: any, incoming: Record<string, string>) {
  const merged = { ...(existing || {}) };
  let changed = false;
  for (const [key, value] of Object.entries(incoming)) {
    if (!value) continue;
    merged[key] = value;
    changed = true;
  }
  return { merged, changed };
}

function withoutSyncRun(config: any) {
  const next = { ...(config || {}) };
  delete next.sync_run_started_at;
  delete next.sync_run_items_seen;
  delete next.sync_run_new_parts;
  delete next.sync_run_changed_listings;
  return next;
}

async function persistBatch(
  admin: any,
  normalized: any[],
  syncStarted: string,
) {
  const deduped = [
    ...new Map(
      normalized
        .filter((item) => item.canonicalKey && item.name && item.sourceUrl)
        .map((item) => [item.canonicalKey, item]),
    ).values(),
  ];
  if (!deduped.length) {
    return { seen: 0, newParts: 0, changed: 0, priceObservations: 0 };
  }

  const keys = deduped.map((item) => item.canonicalKey);
  const existingResult = await admin
    .from("parts_registry")
    .select("id,canonical_key")
    .in("canonical_key", keys);
  if (existingResult.error) throw existingResult.error;

  const existing = new Map(
    (existingResult.data || []).map((row: any) => [row.canonical_key, row.id]),
  );
  const partRows = deduped.map((item) => ({
    canonical_key: item.canonicalKey,
    category: item.category,
    subcategory: item.subcategory,
    brand: item.brand,
    manufacturer_part_number: item.mpn,
    model: item.model,
    display_name: item.name,
    description: item.sku
      ? `MobileSentrix supplier catalog part · SKU ${item.sku}`
      : "MobileSentrix supplier catalog part",
    lifecycle: "current",
    specs: {
      supplier: "MobileSentrix",
      supplier_sku: item.sku || null,
      supplier_entity_id: item.entityId,
      upc: item.upc,
      image_url: item.image,
      quantity_available: item.quantity,
    },
    compatibility: {
      supplier_name: "MobileSentrix",
      source: "supplier_catalog",
    },
    last_seen_at: syncStarted,
    updated_at: new Date().toISOString(),
  }));

  const partUpsert = await admin
    .from("parts_registry")
    .upsert(partRows, { onConflict: "canonical_key" })
    .select("id,canonical_key");
  if (partUpsert.error) throw partUpsert.error;

  const partIds = new Map(
    (partUpsert.data || []).map((row: any) => [row.canonical_key, row.id]),
  );
  const listingRows = deduped.map((item) => ({
    part_id: partIds.get(item.canonicalKey),
    source_name: SOURCE_NAME,
    source_type: "supplier",
    supplier_sku: item.sku || null,
    source_url: item.sourceUrl,
    price_cents: item.priceCents,
    currency_code: "USD",
    availability: item.availability,
    compatibility_evidence: { supplier_catalog: true },
    source_metadata: {
      quantity_available: item.quantity,
      image_url: item.image,
      upc: item.upc,
      manufacturer_part_number: item.mpn,
      supplier_entity_id: item.entityId,
      synced_at: syncStarted,
    },
    last_seen_at: syncStarted,
    active: true,
  }));

  const sourceUrls = listingRows.map((row) => row.source_url);
  const priorResult = await admin
    .from("part_source_listings")
    .select("id,source_url,price_cents,availability")
    .eq("source_name", SOURCE_NAME)
    .in("source_url", sourceUrls);
  if (priorResult.error) throw priorResult.error;

  const priorMap = new Map<string, any>(
    (priorResult.data || []).map((row: any) => [row.source_url, row]),
  );
  let changed = 0;
  for (const row of listingRows) {
    const previous = priorMap.get(row.source_url);
    if (
      previous &&
      (previous.price_cents !== row.price_cents ||
        previous.availability !== row.availability)
    ) {
      changed += 1;
    }
  }

  const listingUpsert = await admin
    .from("part_source_listings")
    .upsert(listingRows, { onConflict: "source_name,source_url" })
    .select("id,source_url,price_cents,availability");
  if (listingUpsert.error) throw listingUpsert.error;

  const observations = (listingUpsert.data || [])
    .filter((row: any) => {
      if (row.price_cents == null) return false;
      const previous = priorMap.get(row.source_url);
      return (
        !previous ||
        previous.price_cents !== row.price_cents ||
        previous.availability !== row.availability
      );
    })
    .map((row: any) => ({
      listing_id: row.id,
      price_cents: row.price_cents,
      availability: row.availability,
      observed_at: new Date().toISOString(),
    }));

  if (observations.length) {
    const history = await admin.from("part_price_history").insert(observations);
    if (history.error) throw history.error;
  }

  return {
    seen: deduped.length,
    newParts: deduped.filter((item) => !existing.has(item.canonicalKey)).length,
    changed,
    priceObservations: observations.length,
  };
}

async function markSource(admin: any, patch: Record<string, unknown>) {
  const result = await admin
    .from("part_registry_sync_sources")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("source_name", SOURCE_NAME);
  if (result.error) throw result.error;
}

async function catalogRunSeenCount(admin: any, runStarted: string) {
  const result = await admin
    .from("part_source_listings")
    .select("id", { count: "exact", head: true })
    .eq("source_name", SOURCE_NAME)
    .eq("last_seen_at", runStarted);
  if (result.error) throw result.error;
  return Number(result.count || 0);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") {
    return response({ ok: false, error: "Method not allowed" }, 405);
  }
  if (!SERVICE_KEY) {
    return response(
      { ok: false, error: "MobileSentrix sync is not configured on the server." },
      500,
    );
  }

  const authorization = request.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    return response({ ok: false, error: "Invalid Portal session" }, 401);
  }

  const profileResult = await admin
    .from("profiles")
    .select("id,location_id,role,active")
    .eq("id", user.id)
    .maybeSingle();
  const profile = profileResult.data;
  if (!profile?.active) {
    return response({ ok: false, error: "Active staff profile required" }, 403);
  }

  const [inventoryPermission, settingsPermission] = await Promise.all([
    userClient.rpc("has_permission", { permission_key: "inventory.manage" }),
    userClient.rpc("has_permission", { permission_key: "settings.manage" }),
  ]);
  if (
    inventoryPermission.data !== true &&
    settingsPermission.data !== true &&
    profile.role !== "owner"
  ) {
    return response(
      { ok: false, error: "Inventory management permission required" },
      403,
    );
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return response({ ok: false, error: "Invalid request" }, 400);
  }

  const action = clean(body.action || "status");
  const sourceResult = await admin
    .from("part_registry_sync_sources")
    .select("*")
    .eq("source_name", SOURCE_NAME)
    .maybeSingle();
  if (sourceResult.error || !sourceResult.data) {
    return response(
      { ok: false, error: "MobileSentrix sync source is missing" },
      500,
    );
  }
  const source = sourceResult.data;
  const config = source.config || {};
  const scheme = normalizedAuthScheme(config.auth_scheme || "oauth1");

  if (action === "status") {
    const savedSecret = await readSavedSecret(admin, source.secret_id);
    const [listingsCount, registryCount, inventoryCount] = await Promise.all([
      admin.from("part_source_listings").select("id", { count: "exact", head: true }).eq("source_name", SOURCE_NAME).eq("active", true),
      admin.from("parts_registry").select("id", { count: "exact", head: true }),
      admin.from("inventory_items").select("id", { count: "exact", head: true }).eq("active", true),
    ]);
    const hasCredentials = credentialReady(scheme, savedSecret);
    return response({
      ok: true,
      status: {
        enabled: source.enabled,
        mode: source.mode,
        lastStatus: source.last_status,
        lastStartedAt: source.last_started_at,
        lastSuccessAt: source.last_success_at,
        lastError: source.last_error,
        itemsSeen: source.items_seen,
        newPartsFound: source.new_parts_found,
        changedListings: source.changed_listings,
        hasCredentials,
        apiReady: hasCredentials,
        hasConsumerCredentials: scheme === "oauth1" && hasConsumerCredentials(savedSecret),
        authScheme: scheme,
        nextPage: source.last_cursor,
        counts: { activeSupplierListings: listingsCount.count || 0, registryParts: registryCount.count || 0, activeInventoryItems: inventoryCount.count || 0 },
        config,
      },
    });
  }

  if (action === "configure") {
    const current = source.config || {};
    const requestedScheme = normalizedAuthScheme(
      body.auth_scheme || current.auth_scheme || "oauth1",
    );
    if (
      !["oauth1", "bearer", "basic", "api_key"].includes(requestedScheme)
    ) {
      return response(
        {
          ok: false,
          error:
            "Choose OAuth 1.0, bearer token, basic, or API key authentication.",
        },
        400,
      );
    }

    const nextConfig = {
      ...current,
      api_base_url: safeApiBase(
        body.api_base_url || current.api_base_url || DEFAULT_API_BASE,
      ),
      catalog_path: safeCatalogPath(
        body.catalog_path || current.catalog_path || DEFAULT_CATALOG_PATH,
      ),
      auth_scheme: requestedScheme,
      pagination_mode: clean(
        body.pagination_mode || current.pagination_mode || "magento1",
      ).toLowerCase(),
      header_name: clean(
        body.header_name || current.header_name || "X-API-Key",
      ),
      page_size: Math.min(
        250,
        Math.max(10, Number(body.page_size || current.page_size || 100)),
      ),
      page_param: clean(body.page_param || current.page_param || "page"),
      limit_param: clean(body.limit_param || current.limit_param || "limit"),
    };

    const existingSecret = await readSavedSecret(admin, source.secret_id);
    const incoming = incomingSecret(body, requestedScheme);
    const merged = mergeSecret(existingSecret, incoming);
    let secretId = source.secret_id;
    if (merged.changed) {
      const stored = await admin.rpc("server_store_vendor_secret", {
        p_source_name: SOURCE_NAME,
        p_secret: JSON.stringify(merged.merged),
      });
      if (stored.error) throw stored.error;
      secretId = stored.data;
    }

    const ready = credentialReady(requestedScheme, merged.merged);
    await markSource(admin, {
      enabled: true,
      mode: "api",
      config: nextConfig,
      secret_id: secretId,
      last_status: ready ? "idle" : "not_configured",
      last_error: null,
    });
    const consumerReady = requestedScheme === "oauth1" && hasConsumerCredentials(merged.merged);
    return response({ ok: true, hasCredentials: ready, apiReady: ready, hasConsumerCredentials: consumerReady, oauthAuthorizationRequired: consumerReady && !ready, config: nextConfig });
  }

  if (action === "oauth_start") {
    const savedSecret = await readSavedSecret(admin, source.secret_id);
    if (!hasConsumerCredentials(savedSecret)) return response({ok:false,error:"Save the MobileSentrix consumer key and secret first."},400);
    const base=safeApiBase(config.api_base_url||DEFAULT_API_BASE);
    const callback=clean(config.oauth_callback_url||PORTAL_ORIGIN+"/?mobilesentrix_oauth=callback");
    const initiateUrl=new URL(clean(config.oauth_initiate_path||"/oauth/initiate"), base+"/");
    const authorization=await oauth1Authorization("POST",initiateUrl,savedSecret,{oauth_callback:callback},"","");
    const vendor=await fetch(initiateUrl,{method:"POST",headers:{Authorization:authorization,Accept:"application/x-www-form-urlencoded"}});
    const text=await vendor.text();
    if(!vendor.ok) return response({ok:false,error:safeApiError(vendor.status,vendor.headers.get("content-type")||"",text)},502);
    const params=new URLSearchParams(text);
    const requestToken=clean(params.get("oauth_token"));
    const requestSecret=clean(params.get("oauth_token_secret"));
    if(!requestToken||!requestSecret) return response({ok:false,error:"MobileSentrix did not return an OAuth request token."},502);
    const staged={...savedSecret,request_token:requestToken,request_token_secret:requestSecret};
    const stored=await admin.rpc("server_store_vendor_secret",{p_source_name:SOURCE_NAME,p_secret:JSON.stringify(staged)});
    if(stored.error) throw stored.error;
    await markSource(admin,{secret_id:stored.data,last_status:"authorizing",last_error:null});
    const authorizeUrl=new URL(clean(config.oauth_authorize_path||"/oauth/authorize"),base+"/");
    authorizeUrl.searchParams.set("oauth_token",requestToken);
    return response({ok:true,authorizeUrl:authorizeUrl.toString()});
  }

  if (action === "oauth_complete") {
    const savedSecret=await readSavedSecret(admin,source.secret_id);
    const requestToken=clean(savedSecret?.request_token);
    const requestSecret=clean(savedSecret?.request_token_secret);
    const returnedToken=clean(body.oauth_token);
    const verifier=clean(body.oauth_verifier);
    if(!requestToken||!requestSecret||returnedToken!==requestToken||!verifier) return response({ok:false,error:"MobileSentrix OAuth callback could not be verified."},400);
    const base=safeApiBase(config.api_base_url||DEFAULT_API_BASE);
    const tokenUrl=new URL(clean(config.oauth_token_path||"/oauth/token"),base+"/");
    const authorization=await oauth1Authorization("POST",tokenUrl,savedSecret,{oauth_verifier:verifier},requestToken,requestSecret);
    const vendor=await fetch(tokenUrl,{method:"POST",headers:{Authorization:authorization,Accept:"application/x-www-form-urlencoded"}});
    const text=await vendor.text();
    if(!vendor.ok) return response({ok:false,error:safeApiError(vendor.status,vendor.headers.get("content-type")||"",text)},502);
    const params=new URLSearchParams(text);
    const accessToken=clean(params.get("oauth_token"));
    const accessSecret=clean(params.get("oauth_token_secret"));
    if(!accessToken||!accessSecret) return response({ok:false,error:"MobileSentrix did not return an OAuth access token."},502);
    const finalized={...savedSecret,access_token:accessToken,access_token_secret:accessSecret};
    delete finalized.request_token; delete finalized.request_token_secret;
    const stored=await admin.rpc("server_store_vendor_secret",{p_source_name:SOURCE_NAME,p_secret:JSON.stringify(finalized)});
    if(stored.error) throw stored.error;
    await markSource(admin,{secret_id:stored.data,last_status:"idle",last_error:null});
    return response({ok:true,apiReady:true});
  }

  if (action === "oauth_cancel") {
    const savedSecret=await readSavedSecret(admin,source.secret_id);
    if(savedSecret){
      delete savedSecret.request_token;
      delete savedSecret.request_token_secret;
      const stored=await admin.rpc("server_store_vendor_secret",{p_source_name:SOURCE_NAME,p_secret:JSON.stringify(savedSecret)});
      if(stored.error) throw stored.error;
      await markSource(admin,{secret_id:stored.data,last_status:"not_configured",last_error:null});
    }
    return response({ok:true});
  }

  if (action === "reset_sync") {
    await markSource(admin, { last_cursor: null, config: withoutSyncRun(config), last_status: "idle", last_error: null });
    return response({ ok: true });
  }

  if (action === "import_csv") {
    const csv = String(body.csv || "");
    if (!csv.trim()) {
      return response(
        { ok: false, error: "Choose a MobileSentrix CSV file first." },
        400,
      );
    }
    if (csv.length > MAX_CSV_BYTES) {
      return response(
        {
          ok: false,
          error: "CSV is too large for one import. Keep the file under 8 MB.",
        },
        413,
      );
    }

    const records = objectRows(csv);
    if (!records.length) {
      return response(
        { ok: false, error: "The CSV did not contain any product rows." },
        400,
      );
    }
    if (records.length > MAX_CSV_ROWS) {
      return response(
        {
          ok: false,
          error:
            "The CSV has more than 25,000 rows. Use the API sync or split it into smaller files.",
        },
        413,
      );
    }

    const authoritative = body.authoritative === true;
    const started = new Date().toISOString();
    await markSource(admin, {
      mode: "csv",
      enabled: true,
      last_status: "running",
      last_started_at: started,
      last_error: null,
    });

    let seen = 0;
    let newParts = 0;
    let changed = 0;
    let priceObservations = 0;
    try {
      for (let index = 0; index < records.length; index += 300) {
        const result = await persistBatch(
          admin,
          records.slice(index, index + 300).map(normalize),
          started,
        );
        seen += result.seen;
        newParts += result.newParts;
        changed += result.changed;
        priceObservations += result.priceObservations;
      }

      if (authoritative && seen > 0) {
        const deactivate = await admin
          .from("part_source_listings")
          .update({ active: false })
          .eq("source_name", SOURCE_NAME)
          .lt("last_seen_at", started);
        if (deactivate.error) throw deactivate.error;
      }

      const completed = new Date().toISOString();
      await markSource(admin, {
        mode: "csv",
        last_status: "success",
        last_completed_at: completed,
        last_success_at: completed,
        last_error: null,
        items_seen: seen,
        new_parts_found: newParts,
        changed_listings: changed,
        last_cursor: null,
      });
      return response({
        ok: true,
        mode: "csv",
        itemsSeen: seen,
        newPartsFound: newParts,
        changedListings: changed,
        priceObservations,
        authoritative,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "CSV import failed";
      await markSource(admin, {
        last_status: "error",
        last_completed_at: new Date().toISOString(),
        last_error: message,
      });
      return response({ ok: false, error: message }, 500);
    }
  }

  if (action === "test" || action === "sync") {
    const savedSecret = await readSavedSecret(admin, source.secret_id);
    if (!credentialReady(scheme, savedSecret)) {
      return response(
        {
          ok: false,
          error:
            "MobileSentrix API credentials are not configured. Save the issued OAuth or bearer credential, or import a supplier CSV.",
        },
        400,
      );
    }

    const base = safeApiBase(config.api_base_url || DEFAULT_API_BASE);
    const path = safeCatalogPath(
      config.catalog_path || DEFAULT_CATALOG_PATH,
    );
    const pageSize = Math.min(
      250,
      Math.max(10, Number(config.page_size || 100)),
    );

    if (action === "test") {
      const started = new Date().toISOString();
      await markSource(admin, {
        mode: "api",
        enabled: true,
        last_status: "running",
        last_started_at: started,
        last_error: null,
      });
      try {
        const url = apiUrl(base, path, config, 1, pageSize);
        const headers = await authHeaders(config, savedSecret, "GET", url);
        const vendorResponse = await relayVendorRequest(
          authorization,
          url,
          headers,
        );
        const text = await vendorResponse.text();
        if (!vendorResponse.ok) {
          throw new Error(
            safeApiError(
              vendorResponse.status,
              vendorResponse.headers.get("content-type") || "",
              text,
            ),
          );
        }

        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(
            "MobileSentrix API did not return JSON. Check the API URL and credential type.",
          );
        }
        const items = apiItems(json);
        const total = totalCount(json, vendorResponse.headers, items.length);
        await markSource(admin, {
          last_status: "idle",
          last_completed_at: new Date().toISOString(),
          last_error: null,
        });
        return response({
          ok: true,
          tested: true,
          itemsReturned: items.length,
          totalCount: total,
          sample: items
            .slice(0, 3)
            .map(normalize)
            .map(({ raw, ...rest }: any) => rest),
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "MobileSentrix API test failed";
        await markSource(admin, {
          last_status: "error",
          last_completed_at: new Date().toISOString(),
          last_error: message,
        });
        return response({ ok: false, error: message }, 502);
      }
    }

    const resetCursor = body.reset_cursor === true;
    const continuing =
      !resetCursor &&
      Boolean(source.last_cursor) &&
      Boolean(config.sync_run_started_at);
    const startPage = continuing
      ? Math.max(1, Number(source.last_cursor || 1))
      : 1;
    const runStarted = continuing
      ? clean(config.sync_run_started_at)
      : new Date().toISOString();
    const maxPages = Math.min(
      15,
      Math.max(1, Number(body.max_pages || 8)),
    );

    let runItemsSeen = continuing
      ? Number(config.sync_run_items_seen || 0)
      : 0;
    let runNewParts = continuing
      ? Number(config.sync_run_new_parts || 0)
      : 0;
    let runChanged = continuing
      ? Number(config.sync_run_changed_listings || 0)
      : 0;
    let seen = 0;
    let newParts = 0;
    let changed = 0;
    let priceObservations = 0;
    let page = startPage;
    let total: number | null = null;
    let hasMore = true;
    const pageFingerprints = new Set<string>();

    const runningConfig = {
      ...config,
      sync_run_started_at: runStarted,
      sync_run_items_seen: runItemsSeen,
      sync_run_new_parts: runNewParts,
      sync_run_changed_listings: runChanged,
    };
    await markSource(admin, {
      mode: "api",
      enabled: true,
      last_status: "running",
      last_started_at: new Date().toISOString(),
      last_error: null,
      last_cursor: String(startPage),
      config: runningConfig,
    });

    try {
      for (
        let processed = 0;
        processed < maxPages && hasMore;
        processed += 1
      ) {
        const url = apiUrl(base, path, config, page, pageSize);
        const headers = await authHeaders(config, savedSecret, "GET", url);
        const vendorResponse = await relayVendorRequest(
          authorization,
          url,
          headers,
        );
        const text = await vendorResponse.text();
        if (!vendorResponse.ok) {
          throw new Error(
            safeApiError(
              vendorResponse.status,
              vendorResponse.headers.get("content-type") || "",
              text,
            ),
          );
        }

        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(
            "MobileSentrix API did not return JSON. Check the API URL and credential type.",
          );
        }

        const items = apiItems(json);
        total = totalCount(json, vendorResponse.headers, total);
        if (!items.length) {
          hasMore = false;
          break;
        }

        const fingerprint = items
          .slice(0, 5)
          .map((item: any) =>
            clean(
              item?.sku ??
                item?.entity_id ??
                item?.product_id ??
                item?.id ??
                item?.name,
            )
          )
          .join("|");
        if (fingerprint && pageFingerprints.has(fingerprint)) {
          throw new Error(
            "MobileSentrix repeated the same catalog page. Check the pagination settings before continuing.",
          );
        }
        if (fingerprint) pageFingerprints.add(fingerprint);

        const batch = await persistBatch(
          admin,
          items.map(normalize),
          runStarted,
        );
        seen += batch.seen;
        newParts += batch.newParts;
        changed += batch.changed;
        priceObservations += batch.priceObservations;
        runItemsSeen += batch.seen;
        runNewParts += batch.newParts;
        runChanged += batch.changed;

        hasMore =
          total != null
            ? page * pageSize < total
            : items.length >= pageSize;
        page += 1;
      }

      const completedRun = !hasMore;
      const nextConfig = completedRun
        ? withoutSyncRun(config)
        : {
            ...config,
            sync_run_started_at: runStarted,
            sync_run_items_seen: runItemsSeen,
            sync_run_new_parts: runNewParts,
            sync_run_changed_listings: runChanged,
          };

      let missingListingsDeactivated = false;
      let emptyCatalogProtected = false;
      if (completedRun) {
        const runCount = await catalogRunSeenCount(admin, runStarted);
        if (runCount > 0) {
          const deactivate = await admin
            .from("part_source_listings")
            .update({ active: false })
            .eq("source_name", SOURCE_NAME)
            .lt("last_seen_at", runStarted);
          if (deactivate.error) throw deactivate.error;
          missingListingsDeactivated = true;
        } else {
          emptyCatalogProtected = true;
        }
      }

      const completed = new Date().toISOString();
      await markSource(admin, {
        mode: "api",
        last_status: "success",
        last_completed_at: completed,
        last_success_at: completedRun ? completed : source.last_success_at,
        last_error: null,
        items_seen: completedRun ? runItemsSeen : seen,
        new_parts_found: completedRun ? runNewParts : newParts,
        changed_listings: completedRun ? runChanged : changed,
        last_cursor: completedRun ? null : String(page),
        config: nextConfig,
      });

      return response({
        ok: true,
        mode: "api",
        itemsSeen: seen,
        newPartsFound: newParts,
        changedListings: changed,
        priceObservations,
        runItemsSeen,
        runNewParts,
        runChangedListings: runChanged,
        hasMore: !completedRun,
        nextPage: completedRun ? null : String(page),
        totalCount: total,
        missingListingsDeactivated,
        emptyCatalogProtected,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "MobileSentrix API sync failed";
      const errorConfig = {
        ...config,
        sync_run_started_at: runStarted,
        sync_run_items_seen: runItemsSeen,
        sync_run_new_parts: runNewParts,
        sync_run_changed_listings: runChanged,
      };
      await markSource(admin, {
        last_status: "error",
        last_completed_at: new Date().toISOString(),
        last_error: message,
        last_cursor: String(page),
        config: errorConfig,
      });
      return response({ ok: false, error: message }, 502);
    }
  }

  return response({ ok: false, error: "Unknown MobileSentrix action" }, 400);
});
