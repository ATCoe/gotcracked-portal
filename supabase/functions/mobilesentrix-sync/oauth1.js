const OAUTH_SIGNATURE_METHOD = 'HMAC-SHA1';

export function percentEncode(value) {
  return encodeURIComponent(String(value ?? ''))
    .replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function base64(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function nonceValue(size = 18) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function normalizedParameters(url, oauthParameters) {
  const parameters = [
    ...Array.from(url.searchParams.entries()),
    ...Object.entries(oauthParameters),
  ];

  return parameters
    .map(([key, value]) => [percentEncode(key), percentEncode(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) return leftValue.localeCompare(rightValue);
      return leftKey.localeCompare(rightKey);
    })
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

async function hmacSha1(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, encoder.encode(value));
}

export async function buildOAuth1Authorization({
  url,
  method = 'GET',
  consumerKey,
  consumerSecret,
  token = '',
  tokenSecret = '',
  realm = '',
  extraOAuthParameters = {},
  nonce = nonceValue(),
  timestamp = Math.floor(Date.now() / 1000).toString(),
}) {
  const requestUrl = url instanceof URL ? new URL(url.toString()) : new URL(String(url));
  const oauthParameters = {
    oauth_consumer_key: String(consumerKey ?? ''),
    oauth_nonce: String(nonce),
    oauth_signature_method: OAUTH_SIGNATURE_METHOD,
    oauth_timestamp: String(timestamp),
    oauth_version: '1.0',
  };
  for (const [key, value] of Object.entries(extraOAuthParameters || {})) {
    if (!key.startsWith('oauth_') || value == null || value === '') continue;
    oauthParameters[key] = String(value);
  }

  if (!oauthParameters.oauth_consumer_key) throw new Error('OAuth consumer key is required.');
  if (!String(consumerSecret ?? '')) throw new Error('OAuth consumer secret is required.');
  if (token) oauthParameters.oauth_token = String(token);

  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}${requestUrl.pathname}`;
  const normalized = normalizedParameters(requestUrl, oauthParameters);
  const signatureBase = [
    String(method).toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(normalized),
  ].join('&');
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  const signature = base64(await hmacSha1(signingKey, signatureBase));

  const headerParameters = {
    ...oauthParameters,
    oauth_signature: signature,
  };
  const values = Object.entries(headerParameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`);

  if (realm) values.unshift(`realm="${percentEncode(realm)}"`);
  return `OAuth ${values.join(', ')}`;
}
