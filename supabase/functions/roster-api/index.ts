import { createClient } from 'jsr:@supabase/supabase-js@2';
import ICAL from 'npm:ical.js@1.5.0';

// Passphrase-protected API for the DBSP roster (roster.html): clients + teams + to-dos.
// Auth: header x-roster-key must match the ROSTER_PASSPHRASE secret.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-roster-key, apikey, authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const COACH_UID = 'c0b4da2f-8ee8-4926-8b27-0d095cab8e17';
const CLIENT_FIELDS = ['kind','name','team','offer','status','start_date','app_user_id','team_code','contact','squad_size','programmed_until','block_name','phase','block_start','block_weeks','next_tournament','tournament_date','goals','notes'];
const TODO_FIELDS = ['section','stream','title','detail','status','needs_check','link','due_date','sort','star','client_id'];

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
      const [c, n, pc, td, dm] = await Promise.all([
        db.from('coach_clients').select('*').order('name'),
        db.from('coach_client_notes').select('*').order('created_at', { ascending: false }),
        db.from('promo_codes').select('id,code,label,team_key').not('code', 'like', 'DBSP-%').order('code'),
        db.from('coach_todos').select('*').order('sort').order('created_at'),
        db.from('coach_dismissals').select('key,cleared_at'),
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
        const since = new Date(Date.now() - 182 * 864e5).toISOString();
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
      // F&C phase: per team (team_settings) and per 1-on-1 client (user_kv fc_phase)
      const ts = await db.from('team_settings').select('team_key,fc_phase');
      const teamSettings: Record<string, string | null> = {};
      (ts.data || []).forEach((r: any) => { teamSettings[r.team_key] = r.fc_phase; });
      const clientPhases: Record<string, string> = {};
      const clientIds = rows.filter((x: any) => x.app_user_id).map((x: any) => x.app_user_id);
      if (clientIds.length) {
        const cp = await db.from('user_kv').select('user_id,value').eq('key', 'fc_phase').in('user_id', clientIds);
        (cp.data || []).forEach((r: any) => { clientPhases[r.user_id] = r.value; });
      }
      // Player profiles (athlete's own, with coach overrides winning) + recent daily check-ins
      const profiles: Record<string, { display_name?: string | null; jersey?: string | null; position?: string | null; own?: unknown; coach?: unknown }> = {};
      let checkins: unknown[] = [];
      if (ids.size) {
        const idl = [...ids];
        const since = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
        const [ap, ov, ci] = await Promise.all([
          db.from('athlete_profiles').select('user_id,display_name,jersey,position').in('user_id', idl),
          db.from('coach_athlete_overrides').select('user_id,display_name,jersey,position').in('user_id', idl),
          db.from('athlete_checkins').select('user_id,date,feeling,sleep_hrs,niggles,note').in('user_id', idl).gte('date', since).order('date', { ascending: false }),
        ]);
        (ap.data || []).forEach((r: any) => { profiles[r.user_id] = { own: r }; });
        (ov.data || []).forEach((r: any) => { profiles[r.user_id] = { ...(profiles[r.user_id] || {}), coach: r }; });
        for (const id of Object.keys(profiles)) {
          const o: any = profiles[id].own || {}, c: any = profiles[id].coach || {};
          profiles[id].display_name = c.display_name || o.display_name || null;
          profiles[id].jersey = c.jersey || o.jersey || null;
          profiles[id].position = c.position || o.position || null;
        }
        checkins = ci.data || [];
      }
      return json({ clients: rows, notes: n.data || [], users, sessions, teamMembers, teamCodes: codes.map((k: any) => ({ code: k.code, label: k.label, team_key: k.team_key })), todos: td.data || [], dismissals: (dm.data || []).map((x: any) => x.key), athletes, profiles, checkins, teamSettings, clientPhases });
    }
    if (action === 'save') {
      const row = pick(body.client || {});
      if (typeof row.team_code === 'string') row.team_code = (row.team_code as string).toUpperCase();
      if (!body.id && !row.name) return json({ error: 'Name required' }, 400);
      const r = body.id
        ? await db.from('coach_clients').update(row).eq('id', body.id).select().single()
        : await db.from('coach_clients').insert({ offer: 'coaching', status: 'active', kind: 'client', ...row }).select().single();
      if (r.error) throw r.error;
      // Team cards push their tournament to every player on that team (drives the taper week in the app)
      const saved: any = r.data;
      if (saved && saved.kind === 'team' && saved.team_code) {
        const pcode = await db.from('promo_codes').select('team_key').eq('code', String(saved.team_code).toUpperCase()).maybeSingle();
        const tk = pcode.data?.team_key;
        if (tk) {
          const u = await db.from('team_settings').upsert({ team_key: tk, tourn_date: saved.tournament_date || null, tourn_name: saved.next_tournament || null, updated_at: new Date().toISOString() }, { onConflict: 'team_key' });
          if (u.error) throw u.error;
        }
      }
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
    if (action === 'player_save') {
      const uid = String(body.user_id || '');
      if (!/^[0-9a-f-]{36}$/.test(uid)) return json({ error: 'Bad player' }, 400);
      const p = body.player || {};
      const pos = ['handler', 'cutter', 'hybrid'].includes(p.position) ? p.position : null;
      const row = {
        user_id: uid,
        display_name: p.display_name ? String(p.display_name).trim().slice(0, 60) || null : null,
        jersey: p.jersey ? String(p.jersey).replace(/[^0-9]/g, '').slice(0, 3) || null : null,
        position: pos,
        updated_at: new Date().toISOString(),
      };
      const r = await db.from('coach_athlete_overrides').upsert(row, { onConflict: 'user_id' });
      if (r.error) throw r.error;
      return json({ ok: true });
    }
    if (action === 'fc_phase') {
      const ph = ['p1', 'p2', 'p3'].includes(body.fc_phase) ? body.fc_phase : null;
      if (!ph) return json({ error: 'Bad phase' }, 400);
      if (body.team_key) {
        const tk = String(body.team_key).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
        const r = await db.from('team_settings').upsert({ team_key: tk, fc_phase: ph, updated_at: new Date().toISOString() }, { onConflict: 'team_key' });
        if (r.error) throw r.error;
      } else {
        const uid = String(body.user_id || '');
        if (!/^[0-9a-f-]{36}$/.test(uid)) return json({ error: 'Bad player' }, 400);
        const r = await db.from('user_kv').upsert({ user_id: uid, key: 'fc_phase', value: ph, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' });
        if (r.error) throw r.error;
      }
      return json({ ok: true });
    }
    if (action === 'dismiss' || action === 'undismiss') {
      const key = String(body.key || '').slice(0, 200);
      if (!key) return json({ error: 'Key required' }, 400);
      const r = action === 'dismiss'
        ? await db.from('coach_dismissals').upsert({ key, cleared_at: new Date().toISOString() }, { onConflict: 'key' })
        : await db.from('coach_dismissals').delete().eq('key', key);
      if (r.error) throw r.error;
      // keep the table small: forget dismissals older than 60 days
      await db.from('coach_dismissals').delete().lt('cleared_at', new Date(Date.now() - 60 * 864e5).toISOString());
      return json({ ok: true });
    }
    if (action === 'calendar') {
      const url = Deno.env.get('GCAL_ICS_URL');
      if (!url) return json({ events: [], setup: true });
      const days = Math.min(7, Math.max(1, +body.days || 2));
      const res = await fetch(url);
      if (!res.ok) return json({ error: 'Calendar feed returned ' + res.status }, 502);
      const comp = new ICAL.Component(ICAL.parse(await res.text()));
      comp.getAllSubcomponents('vtimezone').forEach((tz: any) => ICAL.TimezoneService.register(tz));
      // window: start of today to +days, Sydney time
      const tzName = 'Australia/Sydney';
      const nowSyd = new Date(new Date().toLocaleString('en-US', { timeZone: tzName }));
      const offMs = nowSyd.getTime() - Date.now();
      const startSyd = new Date(nowSyd); startSyd.setHours(0, 0, 0, 0);
      const from = new Date(startSyd.getTime() - offMs), to = new Date(from.getTime() + days * 864e5);
      const masters: Record<string, any> = {}, exceptions: any[] = [];
      for (const ve of comp.getAllSubcomponents('vevent')) {
        const ev = new ICAL.Event(ve);
        if (ve.getFirstPropertyValue('recurrence-id')) exceptions.push(ev); else masters[ev.uid] = ev;
      }
      exceptions.forEach((ex) => { const m = masters[ex.uid]; if (m) m.relateException(ex); });
      const out: any[] = [];
      const push = (title: string, s: any, e: any, allDay: boolean, loc?: string) => {
        const sd = s.toJSDate(), ed = e ? e.toJSDate() : sd;
        if (ed <= from || sd >= to) return;
        out.push({ title: title || '(busy)', start: sd.toISOString(), end: ed.toISOString(), allDay, location: loc || null, date: allDay ? s.toString().slice(0, 10) : null });
      };
      for (const ev of Object.values(masters)) {
        const status = ev.component.getFirstPropertyValue('status');
        if (status === 'CANCELLED') continue;
        const allDay = ev.startDate.isDate;
        if (!ev.isRecurring()) { push(ev.summary, ev.startDate, ev.endDate, allDay, ev.location); continue; }
        const it = ev.iterator(); let next: any, guard = 0;
        while ((next = it.next()) && guard++ < 20000) {
          const nd = next.toJSDate();
          if (nd >= to) break;
          const occ = ev.getOccurrenceDetails(next);
          if (nd < new Date(from.getTime() - 3 * 864e5)) continue;
          const st = occ.item.component.getFirstPropertyValue('status');
          if (st === 'CANCELLED') continue;
          push(occ.item.summary, occ.startDate, occ.endDate, allDay, occ.item.location);
        }
      }
      out.sort((a, b) => (a.start < b.start ? -1 : 1));
      return json({ events: out.slice(0, 60), tz: tzName });
    }
    if (action === 'ping') return json({ ok: true });
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || 'Server error' }, 500);
  }
});
