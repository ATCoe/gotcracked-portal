import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const PORTAL_ORIGIN = "https://portal.gotcracked.co";
const BUCKET = "mobilesentrix-product-images";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_HOST = "static.mobilesentrix.com";
const MIME_EXT = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

const cors = {
  "Access-Control-Allow-Origin": PORTAL_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const clean = (value: unknown, max = 1000) => String(value ?? "").trim().slice(0, max);
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

function supplierImageUrl(value: unknown) {
  const raw = clean(value, 3000);
  if (!raw) throw new Error("MobileSentrix image URL is missing.");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== ALLOWED_HOST) {
    throw new Error("MobileSentrix image host is not approved for caching.");
  }
  return url;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return clean(error.message, 500) || fallback;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return clean(record.message ?? record.details ?? record.code, 500) || fallback;
  }
  return clean(error, 500) || fallback;
}

async function fetchSupplierImage(initialUrl: URL) {
  let url = initialUrl;
  for (let redirects = 0; redirects <= 2; redirects += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1",
        "User-Agent": "GotCracked-MobileSentrix-Image-Cache/1.0",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 2) throw new Error("MobileSentrix image redirect could not be validated.");
      url = supplierImageUrl(new URL(location, url).toString());
      continue;
    }
    return response;
  }
  throw new Error("MobileSentrix image redirect limit exceeded.");
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ ok: false, error: "Method not allowed." }, 405);
  if (!SERVICE_KEY) return reply({ ok: false, error: "Image cache is not configured." }, 500);

  let body: any = {};
  try { body = await request.json(); } catch { return reply({ ok: false, error: "Invalid request." }, 400); }
  const listingId = clean(body.listing_id, 80);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(listingId)) {
    return reply({ ok: false, error: "A valid listing ID is required." }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const listingResult = await admin.from("part_source_listings")
      .select("id,part_id,source_name,source_metadata,active")
      .eq("id", listingId).eq("source_name", "mobilesentrix").eq("active", true).maybeSingle();
    if (listingResult.error) throw listingResult.error;
    const listing = listingResult.data;
    if (!listing) return reply({ ok: false, error: "Active MobileSentrix listing not found." }, 404);

    const metadata = listing.source_metadata && typeof listing.source_metadata === "object" ? listing.source_metadata : {};
    const sourceUrl = supplierImageUrl((metadata as any).image_url).toString();
    const cachedUrl = clean((metadata as any).cached_image_url, 3000);
    const cachedPath = clean((metadata as any).cached_image_path, 1000);
    const cachedSourceUrl = clean((metadata as any).cached_image_source_url, 3000);
    if (cachedUrl && cachedPath && cachedSourceUrl === sourceUrl) {
      return reply({ ok: true, cached: true, url: cachedUrl, path: cachedPath });
    }

    const supplierResponse = await fetchSupplierImage(new URL(sourceUrl));
    if (!supplierResponse.ok) throw new Error(`MobileSentrix image returned HTTP ${supplierResponse.status}.`);
    const contentType = clean(supplierResponse.headers.get("content-type")?.split(";")[0].toLowerCase(), 100);
    const extension = MIME_EXT.get(contentType);
    if (!extension) throw new Error("MobileSentrix returned an unsupported image type.");
    const declaredBytes = Number(supplierResponse.headers.get("content-length") || 0);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_IMAGE_BYTES) throw new Error("MobileSentrix image exceeds the 8 MB cache limit.");

    const bytes = new Uint8Array(await supplierResponse.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("MobileSentrix image is empty or exceeds the 8 MB cache limit.");
    const hash = await sha256Hex(sourceUrl);
    const objectPath = `catalog/${listingId}/${hash.slice(0, 32)}.${extension}`;
    const upload = await admin.storage.from(BUCKET).upload(objectPath, bytes, { contentType, cacheControl: "31536000", upsert: true });
    if (upload.error) throw upload.error;
    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
    const cachedAt = new Date().toISOString();
    const nextMetadata = {
      ...metadata,
      cached_image_source_url: sourceUrl,
      cached_image_url: publicUrl,
      cached_image_path: objectPath,
      cached_image_content_type: contentType,
      cached_image_bytes: bytes.byteLength,
      cached_image_at: cachedAt,
    };
    const update = await admin.from("part_source_listings").update({ source_metadata: nextMetadata }).eq("id", listingId);
    if (update.error) throw update.error;
    if (cachedPath && cachedPath !== objectPath) await admin.storage.from(BUCKET).remove([cachedPath]).catch(() => undefined);
    return reply({ ok: true, cached: true, url: publicUrl, path: objectPath, bytes: bytes.byteLength, cachedAt });
  } catch (error) {
    return reply({ ok: false, error: errorMessage(error, "Unable to cache MobileSentrix image.") }, 502);
  }
});
