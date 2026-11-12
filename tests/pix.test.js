import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crc16, montarCodigoPix, normalizarChave, validarPagina, paraCentavos, textoBrCode,
} from '../functions/_lib/pix.js';

test('CRC16/CCITT-FALSE do vetor de verificação padrão', () => {
  assert.equal(crc16('123456789'), '29B1');
});

test('reproduz o exemplo do manual do BR Code do Banco Central', () => {
  const codigo = montarCodigoPix({
    chave: '123e4567-e12b-12d1-a456-426655440000',
    nome: 'Fulano de Tal',
    cidade: 'BRASILIA',
  });
  assert.equal(
    codigo,
    '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D',
  );
});

test('inclui o valor com duas casas decimais', () => {
  const c = montarCodigoPix({ chave: 'a@b.com', nome: 'Loja', cidade: 'SP', valorCentavos: 2550 });
  assert.match(c, /540525\.50/);
  assert.equal(c.slice(-4), crc16(c.slice(0, -4)));
});

test('sem valor não tem o campo 54', () => {
  const c = montarCodigoPix({ chave: 'a@b.com', nome: 'Loja', cidade: 'SP' });
  assert.ok(!/5802BR/.test(c.split('5303986')[0]) && !c.includes('5303986' + '54'));
});

test('remove acentos e corta nome e cidade nos limites', () => {
  assert.equal(textoBrCode('João Padaria & Café', 25), 'Joao Padaria & Cafe');
  const c = montarCodigoPix({ chave: 'a@b.com', nome: 'Um nome muito comprido demais para caber', cidade: 'São José dos Campos' });
  assert.match(c, /5925Um nome muito comprido de/);
  assert.match(c, /6015Sao Jose dos Ca/);
});

test('normaliza e valida chaves', () => {
  assert.deepEqual(normalizarChave('cpf_cnpj', '529.982.247-25'), { valor: '52998224725' });
  assert.ok(normalizarChave('cpf_cnpj', '529.982.247-26').erro);
  assert.deepEqual(normalizarChave('cpf_cnpj', '11.222.333/0001-81'), { valor: '11222333000181' });
  assert.ok(normalizarChave('cpf_cnpj', '11.222.333/0001-80').erro);
  assert.deepEqual(normalizarChave('telefone', '(11) 98765-4321'), { valor: '+5511987654321' });
  assert.deepEqual(normalizarChave('telefone', '+55 11 98765-4321'), { valor: '+5511987654321' });
  assert.deepEqual(normalizarChave('email', ' Loja@Exemplo.com '), { valor: 'loja@exemplo.com' });
  assert.ok(normalizarChave('aleatoria', 'abc').erro);
});

test('converte valores digitados em centavos', () => {
  assert.equal(paraCentavos('25,50'), 2550);
  assert.equal(paraCentavos('1.234,56'), 123456);
  assert.equal(paraCentavos('R$ 10'), 1000);
  assert.equal(paraCentavos('10.5'), 1050);
  assert.equal(paraCentavos(''), null);
  assert.equal(paraCentavos('abc'), null);
  assert.equal(paraCentavos('0'), null);
});

test('logo aceita link https ou imagem PNG/JPEG/WebP embutida, e recusa o resto', () => {
  const base = { titulo: 'A', nome: 'A', cidade: 'A', tipoChave: 'email', chave: 'a@b.co' };
  const logo = (l) => validarPagina({ ...base, logoUrl: l });
  assert.equal(logo('https://ex.com/a.png').erros, undefined);
  assert.equal(logo('data:image/webp;base64,UklGRg==').erros, undefined);
  assert.equal(logo('data:image/webp;base64,UklGRg==').dados.logoUrl, 'data:image/webp;base64,UklGRg==');
  assert.ok(logo('http://ex.com/a.png').erros.logoUrl);
  assert.ok(logo('data:image/svg+xml;base64,PHN2Zz4=').erros.logoUrl);
  assert.ok(logo('data:text/html;base64,PGI+').erros.logoUrl);
  assert.ok(logo('data:image/png;base64,' + 'A'.repeat(130_000)).erros.logoUrl);
  assert.equal(logo('').dados.logoUrl, '');
});

test('validarPagina aponta os campos com problema e ignora slug vindo do painel', () => {
  const r = validarPagina({ slug: 'padaria-joao', titulo: '', tipoChave: 'email', chave: 'x' });
  assert.ok(r.erros.titulo && r.erros.chave && r.erros.nome && r.erros.cidade);
  assert.equal(r.dados.slug, undefined);

  const ok = validarPagina({
    titulo: 'Padaria do João', nome: 'João Silva', cidade: 'Campinas',
    tipoChave: 'telefone', chave: '19 99999-0000', valorCentavos: null, whatsapp: '(19) 99999-0000',
  });
  assert.equal(ok.erros, undefined);
  assert.equal(ok.dados.chave, '+5519999990000');
  assert.equal(ok.dados.whatsapp, '5519999990000');
  assert.equal(ok.dados.clienteDefineValor, true);
  assert.equal(ok.dados.ativo, true);
});
