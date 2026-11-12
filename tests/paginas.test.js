import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarId, novoIdLivre, excluirPagina, foiApagada, salvarPagina, TAMANHO_ID } from '../functions/_lib/paginas.js';
import { SLUG_RE } from '../functions/_lib/pix.js';

// KV de mentira, em memória.
function kvFalso() {
  const m = new Map();
  return {
    m,
    async get(k, o) { const v = m.get(k); return v === undefined ? null : o?.type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}

test('gerarId: tamanho fixo, só caracteres sem ambiguidade, aceito pela rota pública', () => {
  const ids = new Set();
  for (let i = 0; i < 2000; i++) {
    const id = gerarId();
    assert.equal(id.length, TAMANHO_ID);
    assert.match(id, /^[2-9a-hjkmnp-z]+$/);
    assert.ok(SLUG_RE.test(id));
    ids.add(id);
  }
  assert.equal(ids.size, 2000);
});

test('código de página apagada nunca é reaproveitado', async () => {
  const env = { PIX: kvFalso() };
  const id = await novoIdLivre(env);
  await salvarPagina(env, { slug: id, titulo: 'Loja A' });
  await excluirPagina(env, { slug: id, titulo: 'Loja A' });

  assert.equal(await foiApagada(env, id), true);
  assert.equal(env.PIX.m.has(`pix:${id}`), false);

  // Força o gerador a "sortear" o código apagado primeiro: ele precisa pular para outro.
  const original = crypto.getRandomValues.bind(crypto);
  let primeira = true;
  crypto.getRandomValues = (arr) => {
    if (primeira) {
      primeira = false;
      const alfabeto = '23456789abcdefghjkmnpqrstuvwxyz';
      [...id].forEach((c, i) => { arr[i] = alfabeto.indexOf(c); });
      for (let i = id.length; i < arr.length; i++) arr[i] = 255; // descartados
      return arr;
    }
    return original(arr);
  };
  try {
    const novo = await novoIdLivre(env);
    assert.notEqual(novo, id);
  } finally {
    crypto.getRandomValues = original;
  }
});
