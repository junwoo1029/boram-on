#!/usr/bin/env python3
"""claude.ai용 원본(on.html)으로 Vercel용 index.html을 만들어요.
같은 화면 코드를 두 곳에서 쓰고, 로그인·파일·내려받기 부분만 Vercel/Supabase용으로 바꿔요."""
import sys, pathlib
SRC = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/home/claude/boram/on.html")
OUT = pathlib.Path(__file__).with_name("index.html")
s = SRC.read_text(encoding="utf8")

def rep(a, b, cnt=1):
    global s
    n = s.count(a)
    assert n == cnt, (n, a[:90])
    s = s.replace(a, b)

# 로고는 파일로
s = s.replace("data:image/webp;base64,__LOGO__", "/logo.webp")
# Supabase + 연결부
rep('<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>',
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>\n'
    '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>\n'
    '<script src="/adapter.js"></script>\n'
    '<link rel="icon" href="/logo.webp">\n'
    '<meta name="description" content="보람고등학교 학사일정·급식·시간표·담임 도구">')
# 파일 주소
rep('function blobUrl(id){ return "/_blob/"+encodeURIComponent(id); }',
    'function blobUrl(id){ return window.__BORAM_VERCEL?window.__boramFileUrl(id):"/_blob/"+encodeURIComponent(id); }')
# 파일은 원본 그대로 올리기
rep('  if(NATIVE[mime]) r=await S.assets.upload(file,{type:mime});',
    '  if(NATIVE[mime]||window.__BORAM_VERCEL) r=await S.assets.upload(file,{type:mime});')
# 로그아웃 = 실제 로그아웃
rep('function doLogout(close){ S.teacherOn=false;',
    'function doLogout(close){ if(window.__BORAM_VERCEL&&window.__boramAuth){ window.__boramAuth.signOut(); } S.teacherOn=false;')
# 로그인 안 된 상태: 학생=구글, 선생님=이메일 링크
rep('  if(!S.online||!S.uid){ openModal("로그인",`<p style="margin:0">학교 이메일 계정으로 로그인된 상태에서 이 페이지를 열어 주세요. 로그인하면 계정이 자동으로 확인돼요.</p>${LOCK_NOTE}`); return; }',
    r'''  if(window.__BORAM_VERCEL&&!S.uid){ openSignIn(); return; }
  if(!S.online||!S.uid){ openModal("로그인",`<p style="margin:0">학교 이메일 계정으로 로그인된 상태에서 이 페이지를 열어 주세요. 로그인하면 계정이 자동으로 확인돼요.</p>${LOCK_NOTE}`); return; }''')
rep('function doLogout(close){', r'''function openSignIn(){
  openModal("로그인",`<div class="choices">
      <button class="choice" id="gStu" type="button"><b><i class="dot"></i>학생 로그인</b><span>학교 구글 계정으로 한 번에 로그인해요.</span></button>
      <button class="choice t" id="eTch" type="button"><b><i class="dot"></i>선생님 로그인</b><span>이메일로 받은 로그인 링크를 눌러 들어와요.</span></button>
    </div>
    <form class="form" id="emF" hidden novalidate><label>선생님 이메일<input class="field" id="emI" type="email" autocomplete="email" placeholder="example@school.kr"></label>
      <div class="frow" style="justify-content:flex-end"><button class="btn go" type="submit">로그인 링크 받기</button></div><div class="err" id="emE" role="alert"></div></form>
    <div class="lock-note"><svg><use href="#i-lock"/></svg><span>비밀번호는 이 사이트에 저장되지 않아요. 선생님 기능은 관리자 승인 후에 열리고, 내 개인 자료는 서버 규칙으로 본인만 볼 수 있어요.</span></div>`,(body,close)=>{
    body.querySelector("#gStu").onclick=async()=>{ try{ await window.__boramAuth.google(); }catch(e){ toast("구글 로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요"); } };
    body.querySelector("#eTch").onclick=()=>{ body.querySelector("#emF").hidden=false; body.querySelector("#emI").focus(); };
    body.querySelector("#emF").addEventListener("submit",async e=>{ e.preventDefault(); const em=body.querySelector("#emI").value.trim(), er=body.querySelector("#emE");
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){ er.textContent="이메일 주소를 확인해 주세요."; return; }
      const b=e.submitter; if(b){ b.disabled=true; b.textContent="보내는 중…"; }
      try{ await window.__boramAuth.emailLink(em); body.innerHTML=`<div class="lock-note" style="border-left-color:var(--green)"><svg><use href="#i-mail"/></svg><span><b style="color:var(--fg)">${esc(em)}</b>(으)로 로그인 링크를 보냈어요. 메일함에서 링크를 누르면 이 화면으로 돌아와 로그인돼요. 몇 분 안에 안 오면 스팸함도 확인해 주세요.</span></div>`; }
      catch(x){ er.textContent=/rate|limit|seconds/i.test(String(x?.message||x))?"잠시 후 다시 시도해 주세요. (메일 발송 횟수 제한)":"링크를 보내지 못했어요. 이메일을 확인하고 다시 시도해 주세요."; if(b){ b.disabled=false; b.textContent="로그인 링크 받기"; } }
    });
  });
}
function doLogout(close){''')
# 로그인하고 돌아왔을 때 역할 자동 적용
rep('  S.studentOn=!!(S.uid&&store.get("boram.student",false));',
    r'''  S.studentOn=!!(S.uid&&store.get("boram.student",false));
  if(window.__BORAM_VERCEL&&S.uid&&window.__boramAuth){ const pr=window.__boramAuth.pendingRole();
    if(pr==="student"){ S.studentOn=true; store.set("boram.student",true); store.set("boram.teacher",false); setTimeout(()=>toast("학생으로 로그인했어요"),400); }
    if(pr==="teacher"){ S.studentOn=false; store.set("boram.student",false); S.pendingTeacher=true; } }''')
rep('S.ownerApproved=strs(v?.ids); S.ownerBlocked=strs(v?.blocked); recompute();',
    'S.ownerApproved=strs(v?.ids); S.ownerBlocked=strs(v?.blocked); S.cfgLoaded=true; recompute();')
rep('S.teachersAll=o; recompute(); },()=>{});', 'S.teachersAll=o; S.teachersLoaded=true; recompute(); },()=>{});')
rep('function recompute(){', r'''function recompute(){
  if(S.pendingTeacher&&S.teachersLoaded&&S.cfgLoaded){ S.pendingTeacher=false; setTimeout(()=>{ if(S.isTeacher&&S.profile) teacherIn(); else openProfile(true); },60); }''')
# 계정 삭제: 서버에서 로그인 계정까지 완전히 삭제
rep('        close(); doLogout(); toast(fail.length?"일부 항목을 지우지 못했어요. 다시 시도해 주세요":"사이트 계정을 삭제했어요");',
    r'''        if(window.__BORAM_VERCEL&&window.__boramAuth){ try{ const tk=await window.__boramAuth.token(); const r=await fetch("/api/delete-account",{method:"POST",headers:{Authorization:"Bearer "+tk}}); if(!r.ok) fail.push("server"); }catch{ fail.push("server"); } }
        close(); doLogout(); toast(fail.length?"일부 항목을 지우지 못했어요. 다시 시도해 주세요":"사이트 계정을 삭제했어요");''')
rep('<li>급식 별점</li>', '<li>급식 별점</li>${window.__BORAM_VERCEL?"<li>로그인 계정(구글·이메일 연결)</li>":""}')
rep('학교 이메일 계정 자체는 지워지지 않아요. 다시 로그인하면 새 계정처럼 시작돼요.',
    '${window.__BORAM_VERCEL?"구글·이메일 계정 자체는 그대로예요. 다시 로그인하면 새 계정처럼 시작돼요.":"학교 이메일 계정 자체는 지워지지 않아요. 다시 로그인하면 새 계정처럼 시작돼요."}')

# 문서 뼈대 (claude.ai가 자동으로 붙여 주던 부분)
head = '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>\n'
i = s.index("<svg width=\"0\"")
s = head + s[:i] + "</head>\n<body>\n" + s[i:] + "\n</body>\n</html>\n"
s = s.replace('<script src="/adapter.js"></script>', '<script src="/adapter.js" charset="utf-8"></script>')
OUT.write_text(s, encoding="utf8")
print("built", OUT, len(s))
