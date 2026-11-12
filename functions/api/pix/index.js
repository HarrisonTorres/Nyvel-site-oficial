// Painel: listar e criar páginas de pagamento.
// O código do link é sempre gerado aqui no servidor (aleatório e único); o painel não escolhe.
import { json, erro, lerJson, exigirAdmin } from '../../_lib/http.js';
import { listarPaginas, novoIdLivre, salvarPagina } from '../../_lib/paginas.js';
import { validarPagina } from '../../_lib/pix.js';

export async function onRequestGet({ request, env }) {
  const negado = await exigirAdmin(request, env);
  if (negado) return negado;
  return json({ ok: true, paginas: await listarPaginas(env) });
}

export async function onRequestPost({ request, env }) {
  const negado = await exigirAdmin(request, env);
  if (negado) return negado;

  const r = validarPagina(await lerJson(request));
  if (r.erros) return erro('Confira os campos destacados.', 422, { erros: r.erros });

  const agora = new Date().toISOString();
  const pagina = { ...r.dados, slug: await novoIdLivre(env), criadoEm: agora, atualizadoEm: agora };
  await salvarPagina(env, pagina);
  return json({ ok: true, pagina }, 201);
}
