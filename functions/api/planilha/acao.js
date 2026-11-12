// Grava na planilha através do Apps Script. Exige a senha do painel; o token do Apps Script
// fica só na Cloudflare (segredo SHEETS_TOKEN) e nunca chega ao navegador.
import { json, erro, lerJson, exigirAdmin } from '../../_lib/http.js';

export async function onRequestPost({ request, env }) {
  const negado = await exigirAdmin(request, env);
  if (negado) return negado;

  if (!env.APPS_SCRIPT_URL || !env.SHEETS_TOKEN) {
    return json({ ok: false, erro: 'A gravação na planilha ainda não está configurada.' });
  }

  const corpo = await lerJson(request);
  if (!corpo || typeof corpo !== 'object') return erro('Dados inválidos.');

  let resp;
  try {
    resp = await fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...corpo, token: env.SHEETS_TOKEN }),
      redirect: 'follow',
    });
  } catch {
    return json({ ok: false, erro: 'Não foi possível falar com a planilha. Tente de novo.' });
  }

  const texto = await resp.text();
  try {
    return json(JSON.parse(texto));
  } catch {
    return json({ ok: false, erro: 'O Apps Script não respondeu como esperado. Confira se ele foi publicado com acesso "Qualquer pessoa".' });
  }
}
