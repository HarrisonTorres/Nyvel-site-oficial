// Geração do "Pix Copia e Cola" (BR Code estático, padrão EMV do Banco Central)
// e validação dos dados de uma página de pagamento.

export const TIPOS_CHAVE = {
  cpf_cnpj: 'CPF/CNPJ',
  telefone: 'Celular',
  email: 'E-mail',
  aleatoria: 'Chave aleatória',
};

export const LIMITES = {
  titulo: 60,
  nome: 25, // limite do BR Code
  cidade: 15, // limite do BR Code
  txid: 25,
  descricao: 280,
  mensagem: 400,
  logoUrl: 500,
  logoArquivo: 120_000, // ~90 KB de imagem; uma logo 200×200 em WebP fica bem abaixo disso
  valorMaxCentavos: 100_000_000, // R$ 1.000.000,00
};

// ---------------- BR Code ----------------

function campo(id, valor) {
  const v = String(valor);
  if (v.length > 99) throw new Error(`Campo ${id} longo demais para o BR Code`);
  return id + String(v.length).padStart(2, '0') + v;
}

/** CRC16/CCITT-FALSE (polinômio 0x1021, valor inicial 0xFFFF), exigido pelo BR Code. */
export function crc16(texto) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(texto)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Remove acentos e caracteres que os bancos costumam recusar no BR Code. */
export function textoBrCode(s, max) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,\-&]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/**
 * Monta o código Pix Copia e Cola.
 * @param {{chave:string, nome:string, cidade:string, txid?:string, valorCentavos?:number|null}} d
 */
export function montarCodigoPix({ chave, nome, cidade, txid, valorCentavos }) {
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave);
  let s =
    campo('00', '01') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986');
  if (valorCentavos != null && valorCentavos > 0) s += campo('54', (valorCentavos / 100).toFixed(2));
  s +=
    campo('58', 'BR') +
    campo('59', textoBrCode(nome, LIMITES.nome) || 'RECEBEDOR') +
    campo('60', textoBrCode(cidade, LIMITES.cidade) || 'BRASIL') +
    campo('62', campo('05', limparTxid(txid)));
  s += '6304';
  return s + crc16(s);
}

export function limparTxid(txid) {
  const t = String(txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, LIMITES.txid);
  return t || '***';
}

// ---------------- Chaves ----------------

const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');

export function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(cpf[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

export function cnpjValido(cnpj) {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, p, i) => acc + Number(cnpj[i]) * p, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(cnpj[12]) && dv(13) === Number(cnpj[13]);
}

/** Normaliza a chave para o formato que vai no BR Code. Devolve { valor } ou { erro }. */
export function normalizarChave(tipo, chave) {
  const bruto = String(chave ?? '').trim();
  if (!bruto) return { erro: 'Informe a chave Pix.' };

  switch (tipo) {
    case 'cpf_cnpj': {
      const d = soDigitos(bruto);
      if (d.length === 11) return cpfValido(d) ? { valor: d } : { erro: 'CPF inválido. Confira os números.' };
      if (d.length === 14) return cnpjValido(d) ? { valor: d } : { erro: 'CNPJ inválido. Confira os números.' };
      return { erro: 'CPF tem 11 dígitos e CNPJ tem 14.' };
    }
    case 'telefone': {
      let d = soDigitos(bruto);
      if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
      if (d.length !== 10 && d.length !== 11) return { erro: 'Use DDD + número, ex.: (11) 98765-4321.' };
      return { valor: '+55' + d };
    }
    case 'email': {
      const e = bruto.toLowerCase();
      if (e.length > 77 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { erro: 'E-mail inválido.' };
      return { valor: e };
    }
    case 'aleatoria': {
      const a = bruto.toLowerCase();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(a))
        return { erro: 'A chave aleatória tem o formato 123e4567-e89b-12d3-a456-426614174000.' };
      return { valor: a };
    }
    default:
      return { erro: 'Escolha o tipo da chave.' };
  }
}

// ---------------- Página de pagamento ----------------

// Só formatos de imagem "comuns" (sem SVG, que pode carregar script).
const LOGO_DATA_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export const SLUG_RE =/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

const texto = (v, max) => String(v ?? '').trim().slice(0, max);

/**
 * Valida o que veio do painel e devolve { dados } (pronto para salvar) ou { erros: {campo: mensagem} }.
 * O código do link (slug) não vem do painel: é gerado no servidor na criação e nunca muda.
 */
export function validarPagina(entrada) {
  const e = entrada ?? {};
  const erros = {};
  const dados = {};

  dados.titulo = texto(e.titulo, LIMITES.titulo);
  if (!dados.titulo) erros.titulo = 'Informe o nome que aparece na página.';

  dados.nome = texto(e.nome, 60);
  if (!textoBrCode(dados.nome, LIMITES.nome)) erros.nome = 'Informe o nome do recebedor.';

  dados.cidade = texto(e.cidade, 40);
  if (!textoBrCode(dados.cidade, LIMITES.cidade)) erros.cidade = 'Informe a cidade.';

  dados.tipoChave = e.tipoChave in TIPOS_CHAVE ? e.tipoChave : '';
  const chave = normalizarChave(dados.tipoChave, e.chave);
  if (chave.erro) erros.chave = chave.erro;
  dados.chave = chave.valor ?? texto(e.chave, 80);

  const v = e.valorCentavos;
  if (v === null || v === undefined || v === '' || v === 0) {
    dados.valorCentavos = null;
  } else if (!Number.isInteger(v) || v < 1 || v > LIMITES.valorMaxCentavos) {
    erros.valorCentavos = 'Valor inválido.';
  } else {
    dados.valorCentavos = v;
  }
  dados.clienteDefineValor = dados.valorCentavos == null && e.clienteDefineValor !== false;

  dados.descricao = texto(e.descricao, LIMITES.descricao);
  dados.mensagem = texto(e.mensagem, LIMITES.mensagem);
  dados.txid = String(e.txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, LIMITES.txid);

  dados.cor = /^#[0-9a-fA-F]{6}$/.test(e.cor ?? '') ? e.cor.toLowerCase() : '#2b8bff';

  // Logo: link https:// ou imagem enviada pelo painel (já reduzida no navegador e embutida em base64).
  const logo = String(e.logoUrl ?? '').trim();
  dados.logoUrl = '';
  if (logo.startsWith('data:')) {
    if (!LOGO_DATA_RE.test(logo)) erros.logoUrl = 'Formato de imagem não aceito. Use PNG, JPG ou WebP.';
    else if (logo.length > LIMITES.logoArquivo) erros.logoUrl = 'Imagem grande demais. Tente outra imagem.';
    else dados.logoUrl = logo;
  } else if (logo) {
    dados.logoUrl = logo.slice(0, LIMITES.logoUrl);
    try {
      const u = new URL(dados.logoUrl);
      if (u.protocol !== 'https:') throw new Error();
    } catch {
      erros.logoUrl = 'Use um endereço de imagem começando com https://';
    }
  }

  dados.whatsapp = soDigitos(e.whatsapp);
  if (dados.whatsapp) {
    if (dados.whatsapp.length === 10 || dados.whatsapp.length === 11) dados.whatsapp = '55' + dados.whatsapp;
    if (dados.whatsapp.length < 12 || dados.whatsapp.length > 13) erros.whatsapp = 'Use DDD + número, ex.: (11) 98765-4321.';
  }

  dados.ativo = e.ativo !== false;

  return Object.keys(erros).length ? { erros, dados } : { dados };
}

/** Código Pix de uma página salva, opcionalmente com um valor escolhido pelo cliente. */
export function codigoDaPagina(p, valorCentavos = p.valorCentavos) {
  return montarCodigoPix({
    chave: p.chave,
    nome: p.nome,
    cidade: p.cidade,
    txid: p.txid,
    valorCentavos,
  });
}

/** Converte "25,50", "25.50", "1.234,56" ou 25.5 em centavos. Devolve null se vazio/inválido. */
export function paraCentavos(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
  let s = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const c = Math.round(Number(s) * 100);
  return c > 0 && c <= LIMITES.valorMaxCentavos ? c : null;
}

export function formatarReais(centavos) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
