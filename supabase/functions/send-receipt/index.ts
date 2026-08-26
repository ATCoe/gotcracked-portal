import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set(['https://portal.gotcracked.co']);
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': allowedOrigins.has(origin || '') ? origin! : 'https://portal.gotcracked.co',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
  'Vary': 'Origin'
});
const json = (origin: string | null, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors(origin) });
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
const money = (cents: unknown) => `$${((Number(cents) || 0) / 100).toFixed(2)}`;

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (request.method !== 'POST') return json(origin, { error:'Method not allowed.' }, 405);
  if (!allowedOrigins.has(origin || '')) return json(origin, { error:'Origin not allowed.' }, 403);

  try {
    const authHeader = request.headers.get('Authorization') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, { global:{ headers:{ Authorization:authHeader } } });
    const admin = createClient(supabaseUrl, serviceKey);
    const { data:{ user } } = await userClient.auth.getUser();
    if (!user) return json(origin, { error:'Sign in required.' }, 401);

    const body = await request.json();
    const receiptId = String(body?.receiptId || '').trim();
    if (!receiptId) return json(origin, { error:'Receipt is required.' }, 400);

    const { data:receipt, error:receiptError } = await userClient.from('receipts').select('*').eq('id',receiptId).single();
    if (receiptError || !receipt) return json(origin, { error:'Receipt not found or access denied.' }, 404);
    if (!receipt.customer_email) return json(origin, { error:'This customer does not have an email address.' }, 400);

    const apiKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('RECEIPT_FROM_EMAIL') || 'GotCracked <receipts@gotcracked.co>';
    if (!apiKey) return json(origin, { error:'Receipt email delivery is not configured yet.', configured:false }, 503);

    const lines = Array.isArray(receipt.line_items) ? receipt.line_items : [];
    const rows = lines.map((line:any) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e6e8ec">${esc(line.description || line.sku || line.item_type)}</td><td style="padding:8px 0;border-bottom:1px solid #e6e8ec;text-align:center">${esc(line.quantity || 1)}</td><td style="padding:8px 0;border-bottom:1px solid #e6e8ec;text-align:right">${money(line.line_total_cents)}</td></tr>`).join('');
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827;background:#f6f8fb;padding:24px"><div style="max-width:680px;margin:auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #e5e7eb"><h1 style="margin:0;color:#0a2342">GotCracked</h1><p style="margin:4px 0 22px;color:#4b5563">Receipt ${esc(receipt.receipt_number)}</p><p>Hi ${esc(receipt.customer_name || 'there')},</p><p>Thank you for choosing GotCracked. Here is your repair receipt.</p><table style="width:100%;border-collapse:collapse;margin:20px 0"><thead><tr><th style="text-align:left">Item</th><th>Qty</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table><table style="margin-left:auto;min-width:250px"><tr><td>Subtotal</td><td style="text-align:right">${money(receipt.subtotal_cents)}</td></tr><tr><td>Tax</td><td style="text-align:right">${money(receipt.tax_cents)}</td></tr><tr><td style="font-weight:bold;padding-top:8px">Total</td><td style="font-weight:bold;text-align:right;padding-top:8px">${money(receipt.total_cents)}</td></tr></table><p style="margin-top:24px;color:#4b5563">Work order GC-${String(receipt.ticket_number).padStart(6,'0')} · ${esc(receipt.device_description || 'Device repair')}<br>Payment recorded through external POS${receipt.payment_reference ? ` · Ref ${esc(receipt.payment_reference)}` : ''}.</p><p style="color:#4b5563">Keep this email for your records.</p></div></body></html>`;

    const response = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{ Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' },
      body:JSON.stringify({ from:fromEmail, to:[receipt.customer_email], subject:`GotCracked receipt ${receipt.receipt_number}`, html })
    });
    const responseText = await response.text();
    if (!response.ok) {
      await admin.from('receipt_deliveries').insert({ receipt_id:receipt.id, delivery_method:'email', destination:receipt.customer_email, status:'failed', detail:responseText.slice(0,500), actor_user_id:user.id });
      return json(origin, { error:'Email provider rejected the receipt.', detail:responseText.slice(0,300) }, 502);
    }

    await admin.from('receipts').update({ emailed_at:new Date().toISOString(), last_delivery_status:'emailed' }).eq('id',receipt.id);
    await admin.from('receipt_deliveries').insert({ receipt_id:receipt.id, delivery_method:'email', destination:receipt.customer_email, status:'completed', actor_user_id:user.id });
    return json(origin, { ok:true, receiptNumber:receipt.receipt_number, email:receipt.customer_email });
  } catch (error) {
    console.error(error);
    return json(origin, { error:'Unable to send the receipt.' }, 500);
  }
});
