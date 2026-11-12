export function json(dados, status = 200, cabecalhos = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cabecalhos },
  });
}

export const erro = (mensagem, status = 400, extra = {}) => json({ ok: false, erro: mensagem, ...extra }, status);

export async function lerJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function sha256(texto) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
}

/**
 * Confere a senha do painel (cabeçalho "Authorization: Bearer <senha>").
 * Devolve null se estiver tudo certo, ou a Response de erro.
 */
export async function exigirAdmin(request, env) {
  const senhaCerta = env.ADMIN_PASSWORD;
  if (!senhaCerta) return erro('A senha do painel ainda não foi configurada (ADMIN_PASSWORD).', 503);

  const auth = request.headers.get('authorization') ?? '';
  const senha = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const [a, b] = await Promise.all([sha256(senha), sha256(senhaCerta)]);
  const igual = crypto.subtle.timingSafeEqual ? crypto.subtle.timingSafeEqual(a, b) : a.every((x, i) => x === b[i]);
  return igual ? null : erro('Senha incorreta.', 401);
}
