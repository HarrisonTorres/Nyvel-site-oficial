// QR Code de um texto qualquer (usado no painel para gerar o QR do link da página).
import { qrSvg } from '../_lib/qr.js';

export function onRequestGet({ request }) {
  const url = new URL(request.url);
  const texto = url.searchParams.get('t') ?? '';
  if (!texto || texto.length > 500) return new Response('Texto inválido', { status: 400 });

  const headers = { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' };
  const nome = url.searchParams.get('baixar');
  if (nome) headers['content-disposition'] = `attachment; filename="${nome.replace(/[^a-z0-9-]/gi, '') || 'qrcode'}.svg"`;
  return new Response(qrSvg(texto, { margem: 4 }), { headers });
}
