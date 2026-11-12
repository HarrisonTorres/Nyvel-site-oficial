// Lê a planilha do Google (exportação CSV pública). Quem interpreta o CSV é o C# (PlanilhaService).
import { erro } from '../../_lib/http.js';

export async function onRequestGet({ env, request }) {
  if (!env.SHEET_ID) return erro('O ID da planilha não está configurado (SHEET_ID).', 500);

  const forcar = new URL(request.url).searchParams.has('forcar');
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(env.SHEET_ID)}/export?format=csv&gid=${encodeURIComponent(env.SHEET_GID ?? '0')}`;

  let resp;
  try {
    resp = await fetch(url, { cf: forcar ? { cacheTtl: 0 } : { cacheTtl: 30, cacheEverything: true } });
  } catch {
    return erro('Sem conexão com o Google. Tente de novo.', 502);
  }

  const csv = await resp.text();
  // Se a planilha não estiver compartilhada, o Google devolve a página de login em HTML.
  if (!resp.ok || csv.trimStart().startsWith('<')) {
    return erro('Não foi possível ler a planilha. Verifique se ela está compartilhada como "Qualquer pessoa com o link".', 502);
  }
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store' } });
}
