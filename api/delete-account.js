// 사이트 계정 삭제: 로그인한 본인 확인 후, 본인 자료·파일·로그인 계정을 서버에서 완전히 지워요.
const URL_ = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SR, Authorization: "Bearer " + SR, "content-type": "application/json" };

module.exports = async (req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (req.method !== "POST") { res.statusCode = 405; return res.end('{"error":"method"}'); }
  if (!URL_ || !SR) { res.statusCode = 500; return res.end('{"error":"server not configured"}'); }
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) { res.statusCode = 401; return res.end('{"error":"login"}'); }
  try {
    const u = await fetch(URL_ + "/auth/v1/user", { headers: { apikey: SR, Authorization: "Bearer " + token } });
    if (!u.ok) { res.statusCode = 401; return res.end('{"error":"login"}'); }
    const { id } = await u.json();
    if (!/^[0-9a-f-]{36}$/i.test(id)) { res.statusCode = 400; return res.end('{"error":"id"}'); }
    // 본인 문서 삭제 (개인 자료 + 본인 공개 문서)
    await fetch(`${URL_}/rest/v1/docs?coll=eq.data/users/${id}`, { method: "DELETE", headers: H });
    for (const c of ["teachers", "pub", "approvals", "ratings"]) await fetch(`${URL_}/rest/v1/docs?path=eq.${c}/${id}`, { method: "DELETE", headers: H });
    // 본인 파일 삭제
    const l = await fetch(`${URL_}/storage/v1/object/list/files`, { method: "POST", headers: H, body: JSON.stringify({ prefix: id + "/", limit: 1000 }) });
    const files = l.ok ? await l.json() : [];
    if (files.length) await fetch(`${URL_}/storage/v1/object/files`, { method: "DELETE", headers: H, body: JSON.stringify({ prefixes: files.map(f => id + "/" + f.name) }) });
    // 로그인 계정 삭제
    await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: H });
    res.end('{"ok":true}');
  } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e).slice(0, 200) })); }
};
