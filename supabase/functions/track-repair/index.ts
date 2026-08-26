import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set(['https://gotcracked.co', 'https://www.gotcracked.co']);
const cors = (origin: string | null) => ({ 'Access-Control-Allow-Origin': allowedOrigins.has(origin || '') ? origin! : 'https://gotcracked.co', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json', 'Vary': 'Origin' });
const response = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors(origin) });
const digits = (value: unknown) => String(value || '').replace(/\D/g, '');
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2,'0')).join('');
const hash = async (value: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const clientKey = (request: Request) => request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || `ua:${request.headers.get('user-agent') || 'unknown'}`;

async function allow(admin: ReturnType<typeof createClient>, kind: string, key: string, limit: number, seconds: number) {
  const result = await admin.rpc('consume_public_rate_limit', { p_kind:kind, p_key_hash:await hash(key), p_limit:limit, p_window_seconds:seconds });
  if (result.error) { console.error('Repair tracker rate limiter unavailable:', result.error.message); return true; }
  return result.data === true;
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'POST') return response(origin, { error: 'Method not allowed.' }, 405);
  if (!allowedOrigins.has(origin || '')) return response(origin, { error: 'Origin not allowed.' }, 403);
  try {
    const body = await request.json();
    const ticketNumber = Number(digits(body.ticket));
    const phone = digits(body.phone);
    if (!ticketNumber || phone.length < 7) return response(origin, { error: 'Enter a valid ticket and phone number.' }, 400);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const ipKey = clientKey(request);
    if (!(await allow(admin,'track-repair-ip',ipKey,30,900)) || !(await allow(admin,'track-repair-ticket',`${ipKey}|${ticketNumber}`,8,900))) {
      return response(origin, { error:'Too many tracking attempts. Please wait a few minutes and try again.' }, 429);
    }
    const result = await admin.from('repair_tickets').select('ticket_number,status,public_notes,updated_at,checked_in_at,promised_at,completed_at,warranty_expires_at,intake_method,shipping_status,outbound_carrier,outbound_tracking,shipped_at,delivered_at,customers!inner(phone),devices(model,manufacturer,category),ticket_events(event_type,message,created_at)').eq('ticket_number', ticketNumber).maybeSingle();
    if (result.error) throw result.error;
    const ticket = result.data;
    if (!ticket || digits(ticket.customers?.phone) !== phone) return response(origin, { error: 'We could not match that ticket and phone number.' }, 404);
    return response(origin, { ticket: `GC-${String(ticket.ticket_number).padStart(6, '0')}`, status: ticket.status, publicNotes: ticket.public_notes, updatedAt: ticket.updated_at, checkedInAt: ticket.checked_in_at, promisedAt: ticket.promised_at, completedAt: ticket.completed_at, warrantyExpiresAt: ticket.warranty_expires_at, intakeMethod: ticket.intake_method, shippingStatus: ticket.shipping_status, outboundCarrier: ticket.outbound_carrier, outboundTracking: ticket.outbound_tracking, shippedAt: ticket.shipped_at, deliveredAt: ticket.delivered_at, device: ticket.devices, events: (ticket.ticket_events || []).filter((e: { event_type: string }) => ['created','status_changed','customer_update'].includes(e.event_type)).map((e: { event_type: string; message: string; created_at: string }) => ({ type: e.event_type, message: e.message, createdAt: e.created_at })) });
  } catch (error) { console.error(error); return response(origin, { error: 'Repair tracking is temporarily unavailable.' }, 500); }
});
