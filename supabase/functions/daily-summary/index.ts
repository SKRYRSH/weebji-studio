import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const PUSH_OPTS = { TTL: 86400, urgency: 'high' as const };
const fmt = (n: number) => n.toFixed(3);

// Muscat (UTC+4) local-day start, expressed in UTC
function muscatDayStartUTC(): string {
  const now = new Date(Date.now() + 4 * 3600_000);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 4 * 3600_000;
  return new Date(start).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: cfg } = await sb.from('app_config').select('key,value');
    const conf = Object.fromEntries((cfg ?? []).map((r) => [r.key, r.value]));
    if (req.headers.get('x-cron-key') !== conf.cron_key) return json({ error: 'unauthorized' }, 401);

    webpush.setVapidDetails('mailto:sahil.kumar.chindalia@gmail.com', conf.vapid_public, conf.vapid_private);

    let onlySlug: string | null = null;
    try { onlySlug = (await req.json())?.slug ?? null; } catch { /* empty body = all restaurants */ }

    const { data: subs } = await sb.from('push_subscriptions')
      .select('endpoint,p256dh,auth,restaurant_id,restaurants(slug,name_en,currency)');
    if (!subs?.length) return json({ ok: true, sent: 0, reason: 'no_subscriptions' });

    const since = muscatDayStartUTC();
    const byRest = new Map<string, typeof subs>();
    for (const s of subs) {
      const slug = (s.restaurants as { slug?: string })?.slug;
      if (onlySlug && slug !== onlySlug) continue;
      const arr = byRest.get(s.restaurant_id) ?? [];
      arr.push(s);
      byRest.set(s.restaurant_id, arr);
    }

    let sent = 0, failed = 0;
    for (const [restId, restSubs] of byRest) {
      const rest = restSubs[0].restaurants as { name_en: string; currency: string };

      const { data: orders } = await sb.from('orders')
        .select('id,total').eq('restaurant_id', restId).gte('created_at', since);
      const count = orders?.length ?? 0;
      const revenue = (orders ?? []).reduce((s, o) => s + Number(o.total), 0);

      let top = '';
      if (count > 0) {
        const ids = orders!.map((o) => o.id);
        const { data: items } = await sb.from('order_items').select('name_en,qty').in('order_id', ids);
        const agg: Record<string, number> = {};
        for (const it of items ?? []) agg[it.name_en] = (agg[it.name_en] ?? 0) + it.qty;
        top = Object.entries(agg).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      }

      const body = count === 0
        ? 'No orders today. Tap to open your dashboard.'
        : `${count} orders · ${fmt(revenue)} ${rest.currency}${top ? ` · Top: ${top}` : ''}. Tap for the full day.`;
      const payload = JSON.stringify({
        title: `📊 ${rest.name_en} — today's summary`,
        body,
        url: './dashboard.html?view=summary',
      });

      for (const sub of restSubs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload, PUSH_OPTS,
          );
          sent++;
        } catch (e) {
          failed++;
          if ((e as { statusCode?: number }).statusCode === 410) {
            try { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); } catch { /* ignore */ }
          }
        }
      }
    }

    return json({ ok: true, sent, failed, restaurants: byRest.size });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
