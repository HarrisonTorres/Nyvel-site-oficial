// Gera o código Pix + QR para um valor escolhido pelo cliente na página de pagamento.
import { json, erro, lerJson } from '../_lib/http.js';
import { montarCodigoPix, LIMITES } from '../_lib/pix.js';
import { qrSvg } from '../_lib/qr.js';

export async function onRequestPost({ request }) {
  const e = await lerJson(request);
  if (!e || typeof e.chave !== 'string' || !e.chave.trim() || e.chave.length > 80) return erro('Dados inválidos.');

  const v = e.valorCentavos;
  if (v != null && (!Number.isInteger(v) || v < 1 || v > LIMITES.valorMaxCentavos)) return erro('Valor inválido.');

  const codigo = montarCodigoPix({
    chave: e.chave.trim(),
    nome: String(e.nome ?? '').slice(0, 60),
    cidade: String(e.cidade ?? '').slice(0, 40),
    txid: String(e.txid ?? ''),
    valorCentavos: v ?? null,
  });
  return json({ ok: true, codigo, svg: qrSvg(codigo, { titulo: 'QR Code Pix' }) });
}
