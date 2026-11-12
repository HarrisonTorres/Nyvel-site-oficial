import { foiApagada, obterPagina } from '../_lib/paginas.js';
import { paginaAviso, paginaPagamento } from '../_lib/pagina-html.js';
import { SLUG_RE } from '../_lib/pix.js';

const html = (corpo, status = 200) =>
  new Response(corpo, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Curto: se você editar o Pix no painel, a página reflete em poucos instantes.
      'cache-control': 'public, max-age=30',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });

export async function onRequestGet({ params, env, request }) {
  const id = String(params.slug ?? '').toLowerCase();
  const valido = SLUG_RE.test(id);
  const pagina = valido ? await obterPagina(env, id, { cacheSegundos: 60 }) : null;

  if (!pagina) {
    if (valido && (await foiApagada(env, id))) {
      return html(paginaAviso('Link desativado', 'Este link de pagamento foi desativado. Peça ao estabelecimento a forma de pagamento atual.'), 410);
    }
    return html(paginaAviso('Página não encontrada', 'Este link de pagamento não existe. Confira o endereço com o estabelecimento.'), 404);
  }

  const url = new URL(request.url);
  return html(paginaPagamento(pagina, { url: `${url.origin}/p/${id}` }));
}
