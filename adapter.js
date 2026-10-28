/* 보람 ON — Vercel/Supabase 연결부
   기존 페이지가 쓰던 window.claude.use("db"|"user"|"assets"|"downloads") 형태를 그대로 제공해서,
   화면 코드는 거의 바꾸지 않고 Supabase(로그인·데이터베이스·파일)로 동작하게 해요. */
(function(){
  "use strict";
  window.__BORAM_VERCEL = true;
  let sb = null, cfg = null, session = null, readyP = null, ownerP = null;
  const LS = { get(k){ try{ return localStorage.getItem(k); }catch{ return null; } }, set(k,v){ try{ localStorage.setItem(k,v); }catch{} }, del(k){ try{ localStorage.removeItem(k); }catch{} } };

  async function init(){
    if (readyP) return readyP;
    readyP = (async () => {
      const r = await fetch("/api/config"); cfg = await r.json();
      if (!cfg.url || !cfg.anon || !window.supabase) throw new Error("config");
      sb = window.supabase.createClient(cfg.url, cfg.anon, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } });
      const { data } = await sb.auth.getSession(); session = data.session || null;
      sb.auth.onAuthStateChange((ev, s) => { const had = !!session; session = s || null; if (had !== !!session && ev !== "INITIAL_SESSION" && ev !== "TOKEN_REFRESHED") location.reload(); });
      window.__BORAM_CFG = cfg;
      return true;
    })();
    return readyP;
  }
  const uid = () => session?.user?.id || null;

  /* ---------- 문서 저장소 (Firestore 비슷한 모양) ---------- */
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  const split = p => { const i = p.lastIndexOf("/"); return { coll: p.slice(0, i), id: p.slice(i + 1) }; };
  const freeze = (path, row) => ({ id: split(path).id, exists: !!row, data: () => row ? JSON.parse(JSON.stringify(row.data)) : undefined, metadata: { fromCache: false, hasPendingWrites: false } });
  const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 20) : Math.random().toString(36).slice(2) + Date.now().toString(36));

  // 실시간: 컬렉션 경로마다 구독 하나를 두고, 변경이 오면 그 컬렉션 구독자들에게 다시 읽게 함
  const watchers = new Map(); // coll -> {chan, fns:Set}
  function watch(coll, fn){
    let w = watchers.get(coll);
    if (!w){
      w = { fns: new Set(), chan: null, timer: null };
      try{
        w.chan = sb.channel("c:" + coll + ":" + newId()).on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "coll=eq." + coll }, () => {
          clearTimeout(w.timer); w.timer = setTimeout(() => w.fns.forEach(f => f()), 120);
        }).subscribe();
      }catch{}
      // 실시간이 끊겨도 30초마다 새로 읽기
      w.poll = setInterval(() => w.fns.forEach(f => f()), 30000);
      watchers.set(coll, w);
    }
    w.fns.add(fn);
    return () => { w.fns.delete(fn); };
  }
  const bump = coll => { const w = watchers.get(coll); if (w) setTimeout(() => w.fns.forEach(f => f()), 30); };

  async function readColl(coll){
    const out = []; let from = 0;
    for (;;){
      const { data, error } = await sb.from("docs").select("path,data,updated_at").eq("coll", coll).order("doc_id").range(from, from + 999);
      if (error) throw err("unavailable", error.message);
      out.push(...data); if (data.length < 1000) break; from += 1000;
    }
    return out;
  }
  function docRef(path){
    const { coll, id } = split(path);
    const ref = {
      id, path,
      async get(){ const { data, error } = await sb.from("docs").select("data").eq("path", path).maybeSingle(); if (error) throw err("unavailable", error.message); return freeze(path, data); },
      async set(d){
        if (!uid()) throw err("invalid_argument", "로그인이 필요해요");
        const row = { path, coll, doc_id: id, owner: uid(), data: JSON.parse(JSON.stringify(d)), updated_at: new Date().toISOString() };
        const { error } = await sb.from("docs").upsert(row, { onConflict: "path" });
        if (error) throw err(/row-level|permission|violates/i.test(error.message) ? "invalid_argument" : "unavailable", error.message);
        bump(coll);
      },
      async update(d){ const cur = await ref.get(); if (!cur.exists) throw err("invalid_argument", "없는 문서"); await ref.set({ ...cur.data(), ...d }); },
      async delete(){ if (!uid()) throw err("invalid_argument", "로그인이 필요해요"); const { error } = await sb.from("docs").delete().eq("path", path); if (error) throw err("invalid_argument", error.message); bump(coll); },
      onSnapshot(next, onErr){
        let alive = true;
        const run = async () => { try{ const s = await ref.get(); if (alive) next(s); }catch(e){ if (alive && onErr && e.code !== "unavailable") onErr(e); } };
        run(); const off = watch(coll, run);
        return () => { alive = false; off(); };
      },
      collection(sub){ return collRef(path + "/" + sub); }
    };
    return ref;
  }
  function collRef(coll, filters = []){
    const apply = rows => rows.filter(r => filters.every(([f, op, v]) => { const a = r.data?.[f]; switch(op){ case ">=": return a >= v; case ">": return a > v; case "<=": return a <= v; case "<": return a < v; case "==": return a === v; case "!=": return a !== v; default: return true; } }));
    const snap = rows => { const docs = apply(rows).map(r => freeze(r.path, r)); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }; };
    const q = {
      path: coll,
      where(f, op, v){ return collRef(coll, [...filters, [f, op, v]]); },
      orderBy(){ return q; }, limit(){ return q; },
      async get(){ return snap(await readColl(coll)); },
      onSnapshot(next, onErr){
        let alive = true;
        const run = async () => { try{ const rows = await readColl(coll); if (alive) next(snap(rows)); }catch(e){ if (alive && onErr && e.code !== "unavailable") onErr(e); } };
        run(); const off = watch(coll, run);
        return () => { alive = false; off(); };
      },
      doc(id){ return docRef(coll + "/" + (id || newId())); },
      async add(d){ const r = docRef(coll + "/" + newId()); await r.set(d); return r; }
    };
    return q;
  }
  const db = { doc: docRef, collection: p => collRef(p) };

  /* ---------- 사용자 ---------- */
  const user = {
    async id(){ return uid(); },
    async me(){ const u = session?.user; return { id: uid(), name: "", email: u?.email || null, avatarUrl: "", color: "#0a7fc2", isOwner: await user.isOwner(), canEdit: false }; },
    async isOwner(){
      if (!uid()) return false;
      if (ownerP) return ownerP;
      ownerP = sb.rpc("am_i_owner").then(({ data, error }) => !error && data === true, () => false);
      return ownerP;
    },
    async canEdit(){ return false; },
    async can(){ return null; },
    async profiles(ids){ const o = {}; (Array.isArray(ids) ? ids : [ids]).forEach(i => o[i] = { id: i, name: "", avatarUrl: "", color: "#0a7fc2", email: null, isMe: i === uid(), guest: false }); return o; },
    provider(){ return session?.user?.app_metadata?.provider || null; },
    email(){ return session?.user?.email || null; }
  };

  /* ---------- 파일 ---------- */
  const assets = {
    async upload(blob, opts = {}){
      if (!uid()) throw err("not_granted", "로그인이 필요해요");
      if (blob.size > 20 * 1024 * 1024) throw err("too_large");
      const name = (blob.name || "file").replace(/[^\w.\-\uAC00-\uD7A3]/g, "_").slice(-80);
      const path = uid() + "/" + newId() + "-" + encodeURIComponent(name).replace(/%/g, "").slice(-60);
      const { error } = await sb.storage.from("files").upload(path, blob, { contentType: opts.type || blob.type || "application/octet-stream", upsert: false });
      if (error) throw err(/size/i.test(error.message) ? "too_large" : "upstream_error", error.message);
      const url = sb.storage.from("files").getPublicUrl(path).data.publicUrl;
      return { id: path, url, sizeBytes: blob.size, contentType: opts.type || blob.type };
    },
    async list(){ return { assets: [], usage: { files: 0, bytes: 0, maxFiles: 0, maxBytes: 0 } }; },
    async delete(ref){ const { error } = await sb.storage.from("files").remove([String(ref)]); if (error) throw err("upstream_error", error.message); return { deleted: true }; }
  };
  window.__boramFileUrl = id => cfg ? `${cfg.url}/storage/v1/object/public/files/${String(id).split("/").map(encodeURIComponent).join("/")}` : "#";

  /* ---------- 내려받기 ---------- */
  const downloads = {
    async save({ filename, data }){
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      return { status: "saved" };
    }
  };

  /* ---------- 로그인 동작 (페이지에서 호출) ---------- */
  window.__boramAuth = {
    async google(){ await init(); LS.set("boram.pendingRole", "student"); const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: "select_account" } } }); if (error) throw error; },
    async emailLink(email){ await init(); LS.set("boram.pendingRole", "teacher"); const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } }); if (error) throw error; },
    async signOut(){ await init(); LS.del("boram.pendingRole"); await sb.auth.signOut(); },
    pendingRole(){ const r = LS.get("boram.pendingRole"); LS.del("boram.pendingRole"); return r; },
    provider(){ return session?.user?.app_metadata?.provider || null; },
    email(){ return session?.user?.email || null; },
    signedIn(){ return !!uid(); },
    async token(){ await init(); const { data } = await sb.auth.getSession(); return data.session?.access_token || ""; }
  };

  window.claude = {
    async use(name){
      try{ await init(); }catch{ return null; }
      if (name === "db") return db;
      if (name === "user") return user;
      if (name === "assets") return uid() ? assets : null;
      if (name === "downloads") return downloads;
      return null;
    }
  };
})();
