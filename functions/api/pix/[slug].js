// Painel: ver, editar e excluir uma página. O código do link nunca muda e nunca é
// reaproveitado, para o link gravado na plaquinha NFC continuar sendo só daquele cliente.
import { json, erro, lerJson, exigirAdmin } from '../../_lib/http.js';
import { excluirPagina, obterPagina, salvarPagina } from '../../_lib/paginas.js';
import { validarPagina } from '../../_lib/pix.js';

export async function onRequest({ request, env, params }) {
  const negado = await exigirAdmin(request, env);
  if (negado) return negado;

  const slug = String(params.slug ?? '').toLowerCase();
  const atual = await obterPagina(env, slug);
  if (!atual) return erro('Página não encontrada.', 404);

  switch (request.method) {
    case 'GET':
      return json({ ok: true, pagina: atual });

    case 'PUT': {
      const r = validarPagina(await lerJson(request));
      if (r.erros) return erro('Confira os campos destacados.', 422, { erros: r.erros });
      const pagina = { ...r.dados, slug, criadoEm: atual.criadoEm, atualizadoEm: new Date().toISOString() };
      await salvarPagina(env, pagina);
      return json({ ok: true, pagina });
    }

    case 'DELETE':
      await excluirPagina(env, atual);
      return json({ ok: true });

    default:
      return erro('Método não permitido.', 405);
  }
}
