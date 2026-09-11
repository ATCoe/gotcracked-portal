export const SOURCE_NAME = 'mobilesentrix';
export const DEFAULT_API_BASE = 'https://www.mobilesentrix.com';
export const DEFAULT_CATALOG_PATH = '/api/rest/products';

export const clean = value => {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
};

export function safeSupplierPath(value, fallback = DEFAULT_CATALOG_PATH) {
  const path = clean(value) || fallback;
  if (
    !path.startsWith('/')
    || path.startsWith('//')
    || path.includes('\\')
    || path.includes('#')
    || /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new Error('MobileSentrix API paths must be same-origin absolute paths.');
  }

  const sentinel = new URL(path, 'https://path-validation.invalid');
  if (sentinel.origin !== 'https://path-validation.invalid') {
    throw new Error('MobileSentrix API paths must remain on the configured supplier host.');
  }
  return `${sentinel.pathname}${sentinel.search}`;
}

export const slug = value => clean(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 150);

export function cents(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).replace(/[$,\s]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : null;
}

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function directAttribute(record, names) {
  if (!isObject(record)) return null;
  const keyMap = new Map(Object.keys(record).map(key => [key.toLowerCase(), key]));
  for (const name of names) {
    const key = keyMap.get(name.toLowerCase());
    if (key && record[key] != null && clean(record[key])) return record[key];
  }
  return null;
}

export function attr(record, ...names) {
  const direct = directAttribute(record, names);
  if (direct != null) return direct;

  const containers = [
    record?.custom_attributes,
    record?.attributes,
    record?.extension_attributes?.custom_attributes,
  ];
  const accepted = new Set(names.map(name => name.toLowerCase()));
  for (const container of containers) {
    if (Array.isArray(container)) {
      for (const item of container) {
        const key = clean(item?.attribute_code ?? item?.code ?? item?.name).toLowerCase();
        const value = item?.value ?? item?.label ?? item?.text;
        if (accepted.has(key) && clean(value)) return value;
      }
    } else if (isObject(container)) {
      const nested = directAttribute(container, names);
      if (nested != null) return nested;
    }
  }
  return null;
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  const text = clean(value).toLowerCase();
  if (['1', 'true', 'yes', 'y', 'in stock', 'available', 'saleable', 'salable'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'out of stock', 'unavailable', 'not saleable', 'not salable'].includes(text)) return false;
  return null;
}

function plainText(value, maxLength = 800) {
  const text = clean(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxLength);
}

function inferredBrand(name) {
  const text = clean(name).toLowerCase();
  const rules = [
    ['Apple', /\b(iphone|ipad|ipod|macbook|imac|apple watch|airpods)\b/],
    ['Samsung', /\b(samsung|galaxy)\b/],
    ['Google', /\b(pixel)\b/],
    ['Motorola', /\b(motorola|moto [a-z0-9])/],
    ['OnePlus', /\b(oneplus)\b/],
    ['LG', /\b(lg)\b/],
    ['Sony', /\b(sony|playstation|ps[345])\b/],
    ['Microsoft', /\b(xbox|surface)\b/],
    ['Nintendo', /\b(nintendo|switch|joy-?con)\b/],
    ['Dell', /\b(dell|alienware)\b/],
    ['HP', /\b(hp|hewlett[- ]packard|omen)\b/],
    ['Lenovo', /\b(lenovo|thinkpad|legion)\b/],
    ['ASUS', /\b(asus|rog ally)\b/],
    ['Acer', /\b(acer|predator|nitro)\b/],
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

function inferredCategory(name, explicit) {
  const category = clean(explicit);
  if (category) return category.slice(0, 160);
  const text = clean(name).toLowerCase();
  const rules = [
    ['Screens & Displays', /\b(screen|display|lcd|oled|digitizer|touch panel)\b/],
    ['Batteries', /\b(battery|batteries)\b/],
    ['Charging & Ports', /\b(charging|charger|charge port|dock connector|usb[- ]?[cba]?\s*port)\b/],
    ['Cameras', /\b(camera|camera lens)\b/],
    ['Housings & Frames', /\b(back glass|rear glass|housing|frame|midframe|bezel)\b/],
    ['Cables & Flex Assemblies', /\b(flex|ribbon cable|interconnect|antenna cable)\b/],
    ['Audio & Speakers', /\b(speaker|earpiece|microphone|audio jack)\b/],
    ['Buttons & Controls', /\b(power button|volume button|home button|button flex)\b/],
    ['Adhesives & Seals', /\b(adhesive|seal|waterproof tape|gasket)\b/],
    ['Game Console Parts', /\b(playstation|ps[345]|xbox|nintendo|switch|joy-?con|console)\b/],
    ['Computer Parts', /\b(macbook|laptop|notebook|desktop|motherboard|ssd|ram|keyboard|trackpad)\b/],
    ['Tools & Supplies', /\b(tool|screwdriver|solder|flux|tweezer|mat|cleaner|glue)\b/],
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? 'Repair Part';
}

function quantityOf(record) {
  const value = attr(
    record,
    'qty',
    'quantity',
    'stock',
    'inventory',
    'available_qty',
    'available_quantity',
    'quantity_available',
  );
  if (value != null && Number.isFinite(Number(value))) return Number(value);

  const stock = record?.extension_attributes?.stock_item ?? record?.stock_item ?? record?.stockItem;
  if (stock?.qty != null && Number.isFinite(Number(stock.qty))) return Number(stock.qty);
  return null;
}

function availabilityOf(record, quantity) {
  const explicitText = clean(attr(record, 'stock_status', 'availability'));
  if (explicitText) return explicitText.slice(0, 120);

  const explicitFlag = attr(record, 'is_saleable', 'is_salable', 'is_in_stock', 'in_stock');
  const flag = booleanValue(explicitFlag);
  if (flag != null) {
    if (!flag) return 'Out of stock';
    return quantity == null ? 'In stock' : `In stock (${quantity})`;
  }

  const stock = record?.extension_attributes?.stock_item ?? record?.stock_item ?? record?.stockItem;
  const nestedFlag = booleanValue(stock?.is_in_stock);
  if (nestedFlag != null) {
    if (!nestedFlag) return 'Out of stock';
    return quantity == null ? 'In stock' : `In stock (${quantity})`;
  }

  if (quantity != null) return quantity > 0 ? `In stock (${quantity})` : 'Out of stock';
  return 'Unknown';
}

function firstPrice(record) {
  return attr(
    record,
    'account_price',
    'cost',
    'unit_cost',
    'cost_price',
    'wholesale_price',
    'final_price_without_tax',
    'final_price_with_tax',
    'special_price',
    'regular_price_without_tax',
    'regular_price_with_tax',
    'price',
    'unit_price',
  );
}

function productUrl(record, sku, name, entityId) {
  const direct = clean(attr(record, 'url', 'product_url', 'web_url', 'product_link'));
  if (direct) {
    try {
      const parsed = new URL(direct, DEFAULT_API_BASE);
      if (parsed.protocol === 'https:' && /(^|\.)mobilesentrix\.(com|ca|co\.uk)$/i.test(parsed.hostname)) {
        return parsed.toString();
      }
    } catch {
      // A safe search URL is used below.
    }
  }

  const urlKey = clean(attr(record, 'url_key'));
  if (urlKey) return `${DEFAULT_API_BASE}/${urlKey.replace(/^\/+/, '')}`;
  const query = sku || entityId || name;
  return `${DEFAULT_API_BASE}/catalogsearch/result/?q=${encodeURIComponent(query)}`;
}

function imageUrl(record) {
  const value = clean(attr(record, 'image_url', 'image', 'thumbnail', 'small_image'));
  if (!value || ['no_selection', 'none', 'null'].includes(value.toLowerCase())) return null;
  try {
    if (/^https?:\/\//i.test(value) || value.startsWith('//')) {
      const parsed = new URL(value, DEFAULT_API_BASE);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
    }
    const path = value.startsWith('/media/')
      ? value
      : `/media/catalog/product/${value.replace(/^\/+/, '')}`;
    return new URL(path, DEFAULT_API_BASE).toString();
  } catch {
    return null;
  }
}

export function normalizeProduct(record, sourceName = SOURCE_NAME) {
  const entityId = clean(attr(record, 'entity_id', 'product_id', 'id', 'item_id'));
  const sku = clean(attr(record, 'sku', 'product_sku', 'item_sku', 'code', 'vendor_sku', 'ms_sku'));
  const name = plainText(attr(record, 'name', 'product_name', 'title', 'item_name', 'description'), 300)
    || sku
    || (entityId ? `MobileSentrix Part ${entityId}` : 'MobileSentrix Part');
  const brand = plainText(attr(record, 'brand', 'manufacturer', 'make', 'device_brand'), 120) || inferredBrand(name);
  const declaredModel = plainText(
    attr(record, 'model', 'device_model', 'device', 'model_name', 'compatible_model', 'compatibility'),
    180,
  );
  const model = declaredModel
    || (brand && name.toLowerCase().startsWith(brand.toLowerCase())
      ? name.slice(brand.length).trim().slice(0, 180)
      : name.slice(0, 180));
  const category = inferredCategory(name, attr(record, 'category', 'product_category', 'category_name'));
  const subcategory = plainText(attr(record, 'subcategory', 'sub_category', 'part_type', 'product_type', 'type_id'), 160) || null;
  const priceCents = cents(firstPrice(record));
  const quantity = quantityOf(record);
  const availability = availabilityOf(record, quantity);
  const sourceUrl = productUrl(record, sku, name, entityId);
  const image = imageUrl(record);
  const upc = plainText(attr(record, 'upc', 'barcode', 'gtin', 'ean'), 80) || null;
  const mpn = plainText(attr(record, 'manufacturer_part_number', 'mpn', 'part_number'), 160) || null;
  const qualityGrade = plainText(attr(record, 'quality', 'quality_grade', 'grade', 'part_quality'), 100) || null;
  const color = plainText(attr(record, 'color', 'colour'), 80) || null;
  const status = plainText(attr(record, 'status', 'product_status'), 80) || null;
  const identifier = sku || entityId || `${brand ?? ''}-${model}-${name}`;
  const canonicalKey = `${sourceName}:${slug(identifier) || slug(name) || 'part'}`;

  return {
    entityId: entityId || null,
    sku: sku || null,
    name,
    brand: brand || null,
    model: model || name,
    category,
    subcategory,
    description: plainText(attr(record, 'short_description', 'description'), 800) || null,
    priceCents,
    quantity,
    availability,
    sourceUrl,
    image,
    upc,
    mpn,
    qualityGrade,
    color,
    status,
    canonicalKey,
  };
}

function looksLikeProduct(value) {
  if (!isObject(value)) return false;
  return Boolean(
    clean(attr(value, 'sku', 'name', 'product_name', 'entity_id', 'product_id', 'id'))
  );
}

export function apiItems(json) {
  if (Array.isArray(json)) return json;
  if (!isObject(json)) return [];

  for (const key of ['items', 'products', 'results']) {
    if (Array.isArray(json[key])) return json[key];
    if (isObject(json[key])) {
      const nested = Object.entries(json[key])
        .filter(([, value]) => looksLikeProduct(value))
        .map(([id, value]) => ({ entity_id: value.entity_id ?? id, ...value }));
      if (nested.length) return nested;
    }
  }

  if (Array.isArray(json.data)) return json.data;
  if (isObject(json.data)) {
    if (Array.isArray(json.data.items)) return json.data.items;
    const nested = Object.entries(json.data)
      .filter(([, value]) => looksLikeProduct(value))
      .map(([id, value]) => ({ entity_id: value.entity_id ?? id, ...value }));
    if (nested.length) return nested;
  }

  return Object.entries(json)
    .filter(([, value]) => looksLikeProduct(value))
    .map(([id, value]) => ({ entity_id: value.entity_id ?? id, ...value }));
}

export function apiErrorMessage(json) {
  const errors = json?.messages?.error;
  if (Array.isArray(errors) && errors.length) {
    return errors.map(error => clean(error?.message ?? error)).filter(Boolean).join('; ').slice(0, 400);
  }
  if (isObject(errors)) return clean(errors.message ?? errors).slice(0, 400);
  const error = json?.error ?? json?.message;
  return typeof error === 'string' ? error.slice(0, 400) : '';
}

export function totalCount(json, headers, fallback = null) {
  const candidates = [
    json?.total_count,
    json?.totalCount,
    json?.total,
    json?.count,
    json?.meta?.total,
    headers?.get?.('x-total-count'),
    headers?.get?.('x-pagination-total-count'),
    headers?.get?.('total-count'),
  ];
  for (const candidate of candidates) {
    const number = Number(candidate);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return fallback;
}

export function buildCatalogUrl(config, page, requestedPageSize) {
  const base = clean(config?.api_base_url) || DEFAULT_API_BASE;
  const path = safeSupplierPath(config?.catalog_path, DEFAULT_CATALOG_PATH);
  const url = new URL(path, base);
  const inferredMode = path.includes('/api/rest/') ? 'magento1' : 'magento2';
  const mode = clean(config?.pagination_mode).toLowerCase() || inferredMode;
  const cap = mode === 'magento1' ? 100 : 250;
  const pageSize = Math.min(cap, Math.max(1, Number(requestedPageSize) || 100));
  const currentPage = Math.max(1, Number(page) || 1);

  if (mode === 'magento1') {
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('page', String(currentPage));
    if (!url.searchParams.has('order')) url.searchParams.set('order', 'entity_id');
    if (!url.searchParams.has('dir')) url.searchParams.set('dir', 'asc');
  } else if (mode === 'magento2') {
    url.searchParams.set('searchCriteria[pageSize]', String(pageSize));
    url.searchParams.set('searchCriteria[currentPage]', String(currentPage));
  } else {
    url.searchParams.set(clean(config?.page_parameter) || 'page', String(currentPage));
    url.searchParams.set(clean(config?.limit_parameter) || 'limit', String(pageSize));
  }
  return url;
}

export function safeSupplierError(text, status) {
  const raw = String(text ?? '');
  try {
    const json = JSON.parse(raw);
    const parsed = apiErrorMessage(json)
      .replace(/(bearer|oauth|token|secret|key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 280);
    if (parsed) return `MobileSentrix API returned ${status}: ${parsed}`;
  } catch {
    // HTML and plain-text errors are reduced below.
  }

  const reduced = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/(bearer|oauth|token|secret|key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
  return `MobileSentrix API returned ${status}${reduced ? `: ${reduced}` : ''}`;
}
