# 보람 ON

보람고등학교 학사일정·급식·시간표·담임 도구 사이트.

- 화면: `index.html` (원본 `on.html`에서 `build.py`로 생성)
- 로그인·데이터: Supabase (학생 = 구글, 선생님 = 이메일 링크)
- 학교 자료: `api/sync.js`가 매일 새벽 나이스(NEIS)에서 받아옴 (Vercel Cron, Claude 사용량 없음)

## Vercel 환경 변수
| 이름 | 내용 |
|---|---|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_ANON_KEY` | Supabase anon public 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role 키 (비밀, Vercel에만 저장) |
| `OWNER_EMAIL` | 최고관리자 로그인 이메일 |
| `CRON_SECRET` | 자동 업데이트 보호용 임의 문자열 |
| `NEIS_KEY` | (선택) 나이스 인증키 — 넣으면 6·7교시까지 전부 받음 |

## 처음 한 번
1. Supabase SQL Editor에서 `supabase/schema.sql` 실행 (최고관리자 이메일 확인)
2. Supabase → Authentication → URL Configuration → Site URL을 Vercel 주소로
3. 배포 후 `/api/sync?part=school&key=CRON_SECRET`, `/api/sync?part=tt&key=CRON_SECRET` 한 번씩 열기
