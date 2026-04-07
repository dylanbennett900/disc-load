// supabase-client.js
// Requires config.js to be loaded first (SUPABASE_URL, SUPABASE_ANON_KEY)

var _sb = null;
function getClient() {
  if (!_sb) _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _sb;
}

// ── AUTH ─────────────────────────────────────────────────
async function signInWithGoogle() {
  var { error } = await getClient().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href }
  });
  if (error) console.error('signInWithGoogle:', error.message);
}

async function signOut() {
  var { error } = await getClient().auth.signOut();
  if (error) console.error('signOut:', error.message);
}

function getCurrentUser() {
  var session = getClient().auth.session ? getClient().auth.session() : null;
  return session ? session.user : null;
}

// ── SESSIONS ─────────────────────────────────────────────
async function addSession(sessionData) {
  var user = getCurrentUser();
  if (!user) return null;
  var { data, error } = await getClient()
    .from('sessions')
    .insert({
      user_id:  user.id,
      type:     sessionData.type,
      label:    sessionData.label  || null,
      date:     sessionData.date   || null,
      level:    sessionData.lvl    || null,
      points:   sessionData.pts    || null,
      drills:   sessionData.drills || null,
      metrics: {
        dist: sessionData.dist, hsr:  sessionData.hsr,
        vhsr: sessionData.vhsr, acc:  sessionData.acc,
        hacc: sessionData.hacc, dec:  sessionData.dec,
        hdec: sessionData.hdec, acl:  sessionData.acl,
        dur:  sessionData.dur
      }
    })
    .select()
    .single();
  if (error) { console.error('addSession:', error.message); return null; }
  return data;
}

async function getSessions(dateFrom, dateTo) {
  var user = getCurrentUser();
  if (!user) return [];
  var query = getClient()
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: true });
  if (dateFrom) query = query.gte('date', dateFrom);
  if (dateTo)   query = query.lte('date', dateTo);
  var { data, error } = await query;
  if (error) { console.error('getSessions:', error.message); return []; }
  return data;
}

async function updateSession(sessionId, updates) {
  var { data, error } = await getClient()
    .from('sessions')
    .update({
      label:   updates.label   || null,
      date:    updates.date    || null,
      level:   updates.lvl     || null,
      points:  updates.pts     || null,
      drills:  updates.drills  || null,
      metrics: {
        dist: updates.dist, hsr:  updates.hsr,
        vhsr: updates.vhsr, acc:  updates.acc,
        hacc: updates.hacc, dec:  updates.dec,
        hdec: updates.hdec, acl:  updates.acl,
        dur:  updates.dur
      }
    })
    .eq('id', sessionId)
    .select()
    .single();
  if (error) { console.error('updateSession:', error.message); return null; }
  return data;
}

async function deleteSession(sessionId) {
  var { error } = await getClient()
    .from('sessions')
    .delete()
    .eq('id', sessionId);
  if (error) { console.error('deleteSession:', error.message); return false; }
  return true;
}

// ── TOURNAMENTS ──────────────────────────────────────────
async function saveTournament(name, date) {
  var user = getCurrentUser();
  if (!user || !name || !date) return null;
  var { data, error } = await getClient()
    .from('tournaments')
    .upsert({ user_id: user.id, name, date }, { onConflict: 'user_id,date' })
    .select()
    .single();
  if (error) { console.error('saveTournament:', error.message); return null; }
  return data;
}

async function getTournaments() {
  var user = getCurrentUser();
  if (!user) return [];
  var { data, error } = await getClient()
    .from('tournaments')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false });
  if (error) { console.error('getTournaments:', error.message); return []; }
  return data;
}

async function deleteTournament(tournamentId) {
  var { error } = await getClient()
    .from('tournaments')
    .delete()
    .eq('id', tournamentId);
  if (error) { console.error('deleteTournament:', error.message); return false; }
  return true;
}

// ── USER CONTEXT ─────────────────────────────────────────
async function setUserContext(context) {
  var user = getCurrentUser();
  if (!user) return;
  var { error } = await getClient()
    .from('user_context')
    .upsert({ user_id: user.id, context }, { onConflict: 'user_id' });
  if (error) console.error('setUserContext:', error.message);
}

async function getUserContext() {
  var user = getCurrentUser();
  if (!user) return 'international';
  var { data, error } = await getClient()
    .from('user_context')
    .select('context')
    .eq('user_id', user.id)
    .single();
  if (error || !data) return 'international';
  return data.context;
}
