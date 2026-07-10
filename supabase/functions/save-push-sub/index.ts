import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  try {
    const { slug, subscription } = await req.json();
    const endpoint = subscription?.endpoint;
    const p256dh = subscription?.keys?.p256dh;
    const auth = subscription?.keys?.auth;
    if (
      typeof slug !== 'string' || slug.length > 60 ||
      typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 1000 ||
      typeof p256dh !== 'string' || p256dh.length > 300 ||
      typeof auth !== 'string' || auth.length > 100
    ) return json({ error: 'bad_request' }, 400);

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: rest } = await sb.from('restaurants').select('id').eq('slug', slug).single();
    if (!rest) return json({ error: 'restaurant_not_found' }, 404);

    const { error } = await sb.from('push_subscriptions')
      .upsert({ restaurant_id: rest.id, endpoint, p256dh, auth }, { onConflict: 'endpoint' });
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
