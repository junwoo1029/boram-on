// 브라우저에 공개해도 되는 값만 내려줘요 (service_role 키는 절대 포함하지 않음)
module.exports = (req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=60");
  res.end(JSON.stringify({
    url: process.env.SUPABASE_URL || "",
    anon: process.env.SUPABASE_ANON_KEY || "",
    ownerEmail: process.env.OWNER_EMAIL || ""
  }));
};
