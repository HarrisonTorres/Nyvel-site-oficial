// Armazenamento das páginas de pagamento no Cloudflare KV (binding "PIX").
// Cada página fica na chave "pix:<id>" como JSON.
// Quando uma página é apagada, fica uma marca "apagado:<id>" para sempre: o código
// nunca é reaproveitado, então uma plaquinha antiga jamais cobra para outro comerciante.

const chave = (id) => `pix:${id}`;
const chaveApagado = (id) => `apagado:${id}`;

// Sem letras/números parecidos (0/o, 1/l/i), para o link poder ser lido e digitado sem erro.
const ALFABETO = '23456789abcdefghjkmnpqrstuvwxyz';
export const TAMANHO_ID = 10; // 31^10 ≈ 8 × 10^14 combinações

/** Código aleatório criptograficamente seguro, ex.: "k7mx2q9tha". */
export function gerarId() {
  const limite = 256 - (256 % ALFABETO.length); // evita viés do módulo
  let id = '';
  while (id.length < TAMANHO_ID) {
    const bytes = crypto.getRandomValues(new Uint8Array(TAMANHO_ID * 2));
    for (const b of bytes) {
      if (b < limite && id.length < TAMANHO_ID) id += ALFABETO[b % ALFABETO.length];
    }
  }
  return id;
}

export async function obterPagina(env, id, { cacheSegundos } = {}) {
  const opcoes = { type: 'json' };
  if (cacheSegundos) opcoes.cacheTtl = cacheSegundos;
  return env.PIX.get(chave(id), opcoes);
}

export async function foiApagada(env, id) {
  return (await env.PIX.get(chaveApagado(id))) !== null;
}

/** Gera um código que nunca foi usado (nem por página ativa, nem por apagada). */
export async function novoIdLivre(env) {
  for (let i = 0; i < 5; i++) {
    const id = gerarId();
    const [existe, apagada] = await Promise.all([obterPagina(env, id), foiApagada(env, id)]);
    if (!existe && !apagada) return id;
  }
  throw new Error('Não foi possível gerar um código livre.');
}

export async function salvarPagina(env, pagina) {
  // O resumo vai nos metadados, assim a lista do painel sai numa chamada só.
  const metadata = {
    titulo: pagina.titulo,
    valorCentavos: pagina.valorCentavos,
    ativo: pagina.ativo,
    atualizadoEm: pagina.atualizadoEm,
  };
  await env.PIX.put(chave(pagina.slug), JSON.stringify(pagina), { metadata });
}

export async function excluirPagina(env, pagina) {
  await env.PIX.put(
    chaveApagado(pagina.slug),
    JSON.stringify({ titulo: pagina.titulo, apagadoEm: new Date().toISOString() }),
  );
  await env.PIX.delete(chave(pagina.slug));
}

export async function listarPaginas(env) {
  const itens = [];
  let cursor;
  do {
    const r = await env.PIX.list({ prefix: 'pix:', cursor });
    for (const k of r.keys) itens.push({ slug: k.name.slice(4), ...(k.metadata ?? {}) });
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return itens.sort((a, b) => String(b.atualizadoEm ?? '').localeCompare(String(a.atualizadoEm ?? '')));
}
