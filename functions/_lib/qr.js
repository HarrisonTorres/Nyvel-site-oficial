import qrcode from 'qrcode-generator';

/** Gera um QR Code em SVG (preto no branco, que é o que os leitores de banco leem melhor). */
export function qrSvg(texto, { margem = 2, titulo = 'QR Code' } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  const total = n + margem * 2;

  let path = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.isDark(y, x)) path += `M${x + margem} ${y + margem}h1v1h-1z`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="${titulo}">` +
    `<rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
  );
}
