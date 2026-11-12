// Painel: devolve o HTML da página de pagamento para a pré-visualização ao vivo (sem salvar nada).
import { json, lerJson, exigirAdmin } from '../_lib/http.js';
import { validarPagina } from '../_lib/pix.js';
import { paginaPagamento } from '../_lib/pagina-html.js';

export async function onRequestPost({ request, env }) {
  const negado = await exigirAdmin(request, env);
  if (negado) return negado;

  const r = validarPagina(await lerJson(request));
  // Mostra a página mesmo com campos incompletos; os erros vão junto para o formulário.
  let html = null;
  if (!r.erros?.chave) {
    try {
      html = paginaPagamento({ ...r.dados, ativo: true });
    } catch {
      html = null;
    }
  }
  return json({ ok: true, html, erros: r.erros ?? {} });
}
