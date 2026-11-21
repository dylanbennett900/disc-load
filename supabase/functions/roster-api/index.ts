import { createClient } from 'jsr:@supabase/supabase-js@2';

// Passphrase-protected API for the DBSP roster (roster.html): clients + teams + to-dos.
// Auth: header x-roster-key must match the ROSTER_PASSPHRASE secret.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-roster-key, apikey, authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const COACH_UID = 'c0b4da2f-8ee8-4926-8b27-0d095cab8e17';
const CLIENT_FIELDS = ['kind','name','team','offer','status','start_date','app_user_id','team_code','contact','squad_size','programmed_until','block_name','phase','block_start','block_weeks','next_tournament','tournament_date','goals','notes'];
const TODO_FIELDS = ['section','title','detail','status','needs_check','link','due_date','sort'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
async function sha(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return new Uint8Array(b);
}
async function keyOk(given: string) {
  const real = Deno.env.get('ROSTER_PASSPHRASE') || '';
  if (!real || !given) return false;
  const [a, b] = await Promise.all([sha(given), sha(real)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function pick(row: Record<string, unknown>, fields = CLIENT_FIELDS) {
  const out: Record<string, unknown> = {};
  for (const k of fields) if (k in row) out[k] = row[k] === '' ? null : row[k];
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await keyOk(req.headers.get('x-roster-key') || ''))) {
    await new Promise((r) => setTimeout(r, 1200)); // slow down guessing
    return json({ error: 'Wrong passphrase' }, 401);
  }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = body.action;
  try {
    if (action === 'list') {
      const [c, n, pc, td] = await Promise.all([
        db.from('coach_clients').select('*').order('name'),
        db.from('coach_client_notes').select('*').order('created_at', { ascending: false }),
        db.from('promo_codes').select('id,code,label').not('code', 'like', 'DBSP-%').order('code'),
        db.from('coach_todos').select('*').order('sort').order('created_at'),
      ]);
      if (c.error) throw c.error;
      const list = await db.auth.admin.listUsers({ perPage: 1000 });
      const users = (list.data?.users || []).filter((x) => x.id !== COACH_UID).map((x) => ({ user_id: x.id, email: x.email, name: (x.user_metadata as any)?.full_name || (x.user_metadata as any)?.name || null }));
      const rows = c.data || [];
      // Team members = users who redeemed the team's code
      const codes = pc.data || [];
      const usedCodes = rows.filter((x: any) => x.kind === 'team' && x.team_code).map((x: any) => String(x.team_code).toUpperCase());
      const teamMembers: Record<string, string[]> = {};
      const codeIds = codes.filter((k: any) => usedCodes.includes(String(k.code).toUpperCase()));
      if (codeIds.length) {
        const r = await db.from('promo_redemptions').select('code_id,user_id').in('code_id', codeIds.map((k: any) => k.id));
        for (const k of codeIds) teamMembers[String(k.code).toUpperCase()] = (r.data || []).filter((x: any) => x.code_id === k.id).map((x: any) => x.user_id);
      }
      const ids = new Set<string>();
      rows.forEach((x: any) => { if (x.app_user_id) ids.add(x.app_user_id); });
      Object.values(teamMembers).forEach((arr) => arr.forEach((id) => ids.add(id)));
      let sessions: unknown[] = [];
      if (ids.size) {
        const since = new Date(Date.now() - 75 * 864e5).toISOString();
        const s = await db.from('sessions').select('user_id,data').in('user_id', [...ids]).gte('created_at', since);
        if (s.error) throw s.error;
        sessions = s.data || [];
      }
      // Per-athlete Frisbee Track context: competition level + upcoming tournament
      const athletes: Record<string, { context?: string; tournament?: { name: string; date: string } | null }> = {};
      if (ids.size) {
        const idl = [...ids];
        const today = new Date().toISOString().slice(0, 10);
        const [kv, us, tr] = await Promise.all([
          db.from('user_kv').select('user_id,value').eq('key', 'context').in('user_id', idl),
          db.from('user_settings').select('user_id,tournament_date,tournament_name').in('user_id', idl),
          db.from('tournaments').select('user_id,name,date').in('user_id', idl).gte('date', today).order('date'),
        ]);
        for (const id of idl) athletes[id] = { context: undefined, tournament: null };
        (kv.data || []).forEach((r: any) => { athletes[r.user_id].context = r.value; });
        (tr.data || []).forEach((r: any) => { if (!athletes[r.user_id].tournament) athletes[r.user_id].tournament = { name: r.name, date: r.date }; });
        (us.data || []).forEach((r: any) => {
          if (!athletes[r.user_id].tournament && r.tournament_date && r.tournament_date >= today)
            athletes[r.user_id].tournament = { name: r.tournament_name || 'Tournament', date: r.tournament_date };
        });
      }
      return json({ clients: rows, notes: n.data || [], users, sessions, teamMembers, teamCodes: codes.map((k: any) => ({ code: k.code, label: k.label })), todos: td.data || [], athletes });
    }
    if (action === 'save') {
      const row = pick(body.client || {});
      if (typeof row.team_code === 'string') row.team_code = (row.team_code as string).toUpperCase();
      if (!body.id && !row.name) return json({ error: 'Name required' }, 400);
      const r = body.id
        ? await db.from('coach_clients').update(row).eq('id', body.id)
        : await db.from('coach_clients').insert({ offer: 'coaching', status: 'active', kind: 'client', ...row });
      if (r.error) throw r.error;
      return json({ ok: true });
    }
    if (action === 'delete') {
      const r = await db.from('coach_clients').delete().eq('id', body.id);
      if (r.error) throw r.error;
      return json({ ok: true });
    }
    if (action === 'note') {
      const note = String(body.note || '').trim().slice(0, 500);
      if (!body.id || !note) return json({ error: 'Note required' }, 400);
      const r = await db.from('coach_client_notes').insert({ client_id: body.id, note });
      if (r.error) throw r.error;
      return json({ ok: true });
    }
    if (action === 'todo_save') {
      const row = pick(body.todo || {}, TODO_FIELDS);
      if (!body.id && !row.title) return json({ error: 'Title required' }, 400);
      row.updated_at = new Date().toISOString();
      let r;
      if (body.id) r = await db.from('coach_todos').update(row).eq('id', body.id);
      else {
        if (row.sort == null) {
          const m = await db.from('coach_todos').select('sort').order('sort', { ascending: false }).limit(1);
          row.sort = ((m.data?.[0] as any)?.sort || 0) + 10;
        }
        r = await db.from('coach_todos').insert(row);
      }
      if (r.error) throw r.error;
      return json({ ok: true });
    }
    if (action === 'todo_delete') {
      const r = await db.from('coach_todos').delete().eq('id', body.id);
      if (r.error) throw r.error;
      return json({ ok: true });
    }
    if (action === 'ping') return json({ ok: true });
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || 'Server error' }, 500);
  }
});
