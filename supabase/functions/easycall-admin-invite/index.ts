import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

// Only the existing highest-admin session may invite a manager for a known camp.
// The service key stays in the Supabase runtime and is never returned to clients.
const allowedOrigins = new Set([
  'https://easycall-frontend.vercel.app',
  'https://mplan8007-dev.github.io',
]);
Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin') || '';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://easycall-frontend.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST' || !allowedOrigins.has(origin)) return reply({ error: '허용되지 않은 요청입니다.' }, 403);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authorization = request.headers.get('authorization') || '';
    const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: identity, error: identityError } = await caller.auth.getUser();
    if (identityError || identity.user?.app_metadata?.easycall_role !== 'super') return reply({ error: '최고관리자 인증이 필요합니다.' }, 403);
    const { campId, email, requestId, redirectTo } = await request.json();
    if (!/^[a-z0-9_-]{1,64}$/.test(campId || '') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '') || String(email).length > 254 || !/^[a-f0-9-]{36}$/i.test(requestId || '')) return reply({ error: '캠프 ID와 이메일을 확인하세요.' }, 400);
    const redirect = new URL(redirectTo);
    if (!allowedOrigins.has(redirect.origin) || redirect.origin !== origin || redirect.search || redirect.hash || (origin === 'https://mplan8007-dev.github.io' && redirect.pathname !== '/easycall-frontend/')) return reply({ error: '허용되지 않은 로그인 복귀 주소입니다.' }, 400);
    const { data: overview, error: overviewError } = await caller.rpc('easycall_admin_overview');
    if (overviewError) throw overviewError;
    const camp = overview?.camps?.find((c: { campId: string }) => c.campId === campId);
    if (!camp) return reply({ error: '등록된 캠프가 아닙니다.' }, 404);
    if (camp.adminEmail) return reply({ error: '이미 관리자 계정이 연결되어 있습니다. 기존 계정 상태를 확인하세요.' }, 409);
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(String(email).trim().toLowerCase(), { redirectTo: redirect.href, data: { camp_reference: campId } });
    if (inviteError) return reply({ error: '초대를 보내지 못했습니다. 이미 등록된 이메일이면 기존 계정 연결을 사용하고, 발송 제한 또는 SMTP 설정을 확인하세요.' }, 400);
    if (!invited.user) throw new Error('Invitation result missing');
    const { data, error: linkError } = await caller.rpc('easycall_admin_link_account', { p_camp_id: campId, p_email: String(email).trim().toLowerCase(), p_request_id: requestId });
    if (linkError) return reply({ error: '초대 메일은 발송했지만 계정 연결을 완료하지 못했습니다. 같은 이메일로 기존 계정 연결을 다시 진행하세요.', invitationSent: true }, 409);
    return reply({ success: true, account: data });
  } catch (error) {
    console.error('EasyCall invitation failed', error instanceof Error ? error.message : 'unknown');
    return reply({ error: '초대 처리에 실패했습니다. 서버 연결과 인증 설정을 확인하세요.' }, 500);
  }
});
