// Monta o HTML da página pública de pagamento (/p/<slug>).
// Página leve, sem framework: precisa abrir rápido no celular de quem encostou na plaquinha NFC.

import { TIPOS_CHAVE, codigoDaPagina, formatarReais } from './pix.js';
import { qrSvg } from './qr.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const jsonSeguro = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

/** Cor de texto legível (preto ou branco) sobre a cor de destaque. */
function corTexto(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? '#0b1220' : '#ffffff';
}

function chaveExibicao(p) {
  const c = p.chave;
  if (p.tipoChave === 'telefone') {
    const d = c.replace('+55', '');
    return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  if (p.tipoChave === 'cpf_cnpj' && c.length === 11) return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
  if (p.tipoChave === 'cpf_cnpj' && c.length === 14)
    return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
  return c;
}

function iniciais(t) {
  return String(t)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

const CSS = `
*{box-sizing:border-box}
:root{--c:#2b8bff;--ct:#fff;--bg:#eef2f7;--card:#fff;--tx:#0f172a;--dim:#5b6476;--ln:#e3e8ef;--soft:#f5f7fb}
@media (prefers-color-scheme:dark){:root{--bg:#0a1020;--card:#121b2e;--tx:#eef2f9;--dim:#9fb0c9;--ln:#22304a;--soft:#0e1628}}
html,body{margin:0}
body{background:var(--bg);color:var(--tx);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh}
.topo{height:150px;background:linear-gradient(135deg,var(--c),color-mix(in srgb,var(--c) 55%,#000))}
.wrap{max-width:460px;margin:-110px auto 0;padding:0 16px 32px}
.card{background:var(--card);border-radius:22px;box-shadow:0 12px 40px rgba(15,23,42,.14);padding:24px 20px;border:1px solid var(--ln)}
.cab{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.logo{width:56px;height:56px;border-radius:16px;object-fit:cover;flex:none;background:var(--soft)}
.ini{width:56px;height:56px;border-radius:16px;flex:none;display:grid;place-items:center;font-weight:700;font-size:1.3rem;background:var(--c);color:var(--ct)}
.cab h1{font-size:1.25rem;line-height:1.2;margin:0}
.cab p{margin:2px 0 0;color:var(--dim);font-size:.9rem}
.valor{text-align:center;padding:14px;border-radius:16px;background:var(--soft);margin-bottom:18px}
.valor small{display:block;color:var(--dim);font-size:.82rem;text-transform:uppercase;letter-spacing:.08em}
.valor strong{display:block;font-size:2.1rem;line-height:1.15;letter-spacing:-.02em}
.valor label{display:block;color:var(--dim);font-size:.85rem;margin-bottom:6px}
.campo-valor{display:flex;align-items:center;justify-content:center;gap:6px;font-size:1.8rem;font-weight:700}
.campo-valor input{width:9ch;font:inherit;color:inherit;background:transparent;border:0;border-bottom:2px solid var(--ln);text-align:center;padding:2px 0;outline:none}
.campo-valor input:focus{border-color:var(--c)}
.valor .dica{margin:8px 0 0;font-size:.82rem;color:var(--dim)}
.qr{background:#fff;border-radius:18px;padding:12px;width:min(260px,72vw);margin:0 auto;border:1px solid var(--ln);position:relative}
.qr svg{display:block;width:100%;height:auto}
.qr.carregando{opacity:.4}
.legenda{text-align:center;color:var(--dim);font-size:.85rem;margin:10px 0 18px}
.btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;border:0;border-radius:16px;padding:17px 18px;font-family:inherit;font-weight:600;font-size:1.08rem;line-height:1.2;cursor:pointer;text-decoration:none;-webkit-tap-highlight-color:transparent;transition:transform .1s ease,filter .2s ease}
.btn:active{transform:scale(.98)}
.btn-pri{background:var(--c);color:var(--ct);font-size:1.15rem;padding:20px 18px;box-shadow:0 8px 24px color-mix(in srgb,var(--c) 35%,transparent)}
.btn-pri.ok{background:#16a34a;color:#fff}
.btn-sec{background:var(--soft);color:var(--tx);border:1px solid var(--ln);font-size:.98rem;padding:14px}
.btn-wa{background:#25d366;color:#08310f}
.linha{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.msg{margin:20px 0 0;padding:14px 16px;border-radius:14px;border-left:4px solid var(--c);background:var(--soft);font-size:1rem;white-space:pre-line}
.desc{margin:16px 0 0;color:var(--dim);white-space:pre-line}
.dados{margin:20px 0 0;border-top:1px solid var(--ln);padding-top:14px}
.dados div{display:flex;justify-content:space-between;gap:12px;padding:7px 0;font-size:.92rem}
.dados dt{color:var(--dim);margin:0}
.dados dd{margin:0;text-align:right;font-weight:600;word-break:break-all}
.copiar-chave{background:none;border:0;color:var(--c);font-family:inherit;font-weight:600;font-size:.85rem;cursor:pointer;padding:0 0 0 6px}
details{margin-top:16px;border:1px solid var(--ln);border-radius:14px;padding:12px 16px}
summary{cursor:pointer;font-weight:600}
details ol{margin:10px 0 2px;padding-left:20px;color:var(--dim);font-size:.92rem}
.rodape{text-align:center;color:var(--dim);font-size:.78rem;margin-top:20px}
.rodape a{color:inherit}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,120px);background:#0f172a;color:#fff;padding:12px 18px;border-radius:12px;font-size:.92rem;max-width:calc(100% - 32px);box-shadow:0 10px 30px rgba(0,0,0,.25);transition:transform .25s ease;z-index:9}
.toast.on{transform:translate(-50%,0)}
.aviso{text-align:center;padding:30px 10px}
.aviso h1{font-size:1.3rem}
.aviso p{color:var(--dim)}
.erro-valor{color:#dc2626;font-size:.82rem;margin:6px 0 0;min-height:1em}
`;

function documento({ titulo, descricao, cor, corpo, script = '' }) {
  const ct = corTexto(cor);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descricao)}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descricao)}">
<meta name="theme-color" content="${esc(cor)}">
<meta name="robots" content="noindex">
<style>${CSS}:root{--c:${cor};--ct:${ct}}</style>
</head>
<body>
<div class="topo"></div>
<main class="wrap">${corpo}
<p class="rodape">Página de pagamento criada por <a href="/" target="_blank" rel="noopener">NYVEL</a></p>
</main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
${script}
</body>
</html>`;
}

/** Página de "não encontrada" ou "desativada". */
export function paginaAviso(titulo, texto, cor = '#2b8bff') {
  return documento({
    titulo,
    descricao: texto,
    cor,
    corpo: `<div class="card aviso"><h1>${esc(titulo)}</h1><p>${esc(texto)}</p></div>`,
  });
}

/** Página de pagamento completa. */
export function paginaPagamento(p, { url } = {}) {
  if (!p.ativo) {
    return paginaAviso(
      'Pagamento indisponível',
      `A página de pagamento de ${p.titulo} está desativada no momento. Fale com o estabelecimento.`,
      p.cor,
    );
  }

  const codigo = codigoDaPagina(p);
  const valorFixo = p.valorCentavos != null;
  const titulo = valorFixo ? `Pagar ${formatarReais(p.valorCentavos)} para ${p.titulo}` : `Pagar ${p.titulo} com Pix`;
  const descricao = p.descricao || `Pague ${p.titulo} com Pix: escaneie o QR Code ou copie o código.`;

  const avatar = p.logoUrl
    ? `<img class="logo" src="${esc(p.logoUrl)}" alt="" referrerpolicy="no-referrer">`
    : `<div class="ini" aria-hidden="true">${esc(iniciais(p.titulo))}</div>`;

  let blocoValor;
  if (valorFixo) {
    blocoValor = `<div class="valor"><small>Valor</small><strong>${esc(formatarReais(p.valorCentavos))}</strong></div>`;
  } else if (p.clienteDefineValor) {
    blocoValor = `<div class="valor">
<label for="valor">Quanto você vai pagar?</label>
<div class="campo-valor"><span>R$</span><input id="valor" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="0,00" aria-describedby="dica-valor"></div>
<p class="erro-valor" id="erro-valor"></p>
<p class="dica" id="dica-valor">Opcional: se deixar em branco, você digita o valor no app do banco.</p>
</div>`;
  } else {
    blocoValor = `<div class="valor"><small>Valor</small><p class="dica" style="margin:4px 0 0">Você digita o valor no app do seu banco.</p></div>`;
  }

  const txidVisivel = p.txid && p.txid !== '***';
  const whatsapp = p.whatsapp
    ? `<a class="btn btn-wa" style="margin-top:10px" id="wa" target="_blank" rel="noopener" href="https://wa.me/${esc(p.whatsapp)}?text=${encodeURIComponent(`Olá! Acabei de fazer um Pix para ${p.titulo}. Segue o comprovante.`)}">Enviar comprovante no WhatsApp</a>`
    : '';

  const corpo = `
<section class="card">
  <header class="cab">${avatar}<div><h1>${esc(p.titulo)}</h1><p>Pagamento via Pix</p></div></header>
  ${blocoValor}
  <div class="qr" id="qr">${qrSvg(codigo, { titulo: 'QR Code Pix' })}</div>
  <p class="legenda">Abra o app do seu banco, escolha <b>Pix</b> e escaneie o QR Code</p>

  <button class="btn btn-pri" id="copiar" type="button">Copiar código Pix</button>
  <div class="linha">
    <button class="btn btn-sec" id="banco" type="button">Pagar no app do banco</button>
    <button class="btn btn-sec" id="compartilhar" type="button">Compartilhar</button>
  </div>
  ${whatsapp}

  ${p.mensagem ? `<p class="msg">${esc(p.mensagem)}</p>` : ''}
  ${p.descricao ? `<p class="desc">${esc(p.descricao)}</p>` : ''}

  <dl class="dados">
    <div><dt>Recebedor</dt><dd>${esc(p.nome)}</dd></div>
    <div><dt>${esc(TIPOS_CHAVE[p.tipoChave] ?? 'Chave')}</dt><dd>${esc(chaveExibicao(p))}<button class="copiar-chave" id="copiar-chave" type="button">copiar</button></dd></div>
    ${txidVisivel ? `<div><dt>Identificador</dt><dd>${esc(p.txid)}</dd></div>` : ''}
  </dl>

  <details>
    <summary>Como pagar</summary>
    <ol>
      <li>Toque em <b>Copiar código Pix</b>.</li>
      <li>Abra o app do seu banco e entre em <b>Pix</b> &rarr; <b>Pix Copia e Cola</b>.</li>
      <li>Cole o código, confira o nome do recebedor e confirme.</li>
    </ol>
  </details>
</section>`;

  const dados = {
    codigo,
    chave: p.chave,
    nome: p.nome,
    cidade: p.cidade,
    txid: p.txid,
    titulo: p.titulo,
    url: url ?? null,
    valorLivre: !valorFixo && p.clienteDefineValor,
  };

  const script = `<script>
(function(){
var D=${jsonSeguro(dados)};
var codigo=D.codigo, timer, seq=0;
var $=function(id){return document.getElementById(id)};
function toast(t){var el=$('toast');el.textContent=t;el.classList.add('on');clearTimeout(el._t);el._t=setTimeout(function(){el.classList.remove('on')},2600)}
function copiarTexto(t){
  if(navigator.clipboard&&window.isSecureContext){return navigator.clipboard.writeText(t)}
  return new Promise(function(ok,falha){var a=document.createElement('textarea');a.value=t;a.setAttribute('readonly','');a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();try{document.execCommand('copy')?ok():falha()}catch(e){falha(e)}document.body.removeChild(a)});
}
var bc=$('copiar');
bc.onclick=function(){copiarTexto(codigo).then(function(){bc.textContent='Código copiado ✓';bc.classList.add('ok');toast('Agora abra o app do banco em Pix Copia e Cola');setTimeout(function(){bc.textContent='Copiar código Pix';bc.classList.remove('ok')},3500)},function(){toast('Não consegui copiar. Segure o dedo no QR ou tente de novo.')})};
$('copiar-chave').onclick=function(){copiarTexto(D.chave).then(function(){toast('Chave Pix copiada')})};
$('banco').onclick=function(){
  copiarTexto(codigo).then(function(){},function(){});
  if(navigator.share){navigator.share({text:codigo}).catch(function(){toast('Código copiado. Abra o app do banco em Pix Copia e Cola.')})}
  else{toast('Código copiado. Abra o app do banco em Pix Copia e Cola.')}
};
$('compartilhar').onclick=function(){
  var url=D.url||location.href;
  if(navigator.share){navigator.share({title:document.title,text:'Pague '+D.titulo+' com Pix:',url:url}).catch(function(){})}
  else{copiarTexto(url).then(function(){toast('Link copiado')})}
};
// Campo de valor no estilo maquininha: os dígitos entram pela direita como centavos.
// "1" = 0,01 · "12" = 0,12 · "2340" = 23,40. A vírgula é colocada sozinha.
var inp=$('valor'), digitos='', MAX_DIGITOS=9, MAX_CENTAVOS=100000000; // limite de R$ 1.000.000,00
function formatar(d){
  if(!d)return '';
  return (parseInt(d,10)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function mostrar(){
  inp.value=formatar(digitos);
  var fim=inp.value.length;try{inp.setSelectionRange(fim,fim)}catch(e){}
  clearTimeout(timer);timer=setTimeout(atualizar,350);
}
// Troca o valor inteiro, respeitando o limite (passou de R$ 1.000.000,00, ignora como uma maquininha).
function definir(d){
  d=String(d).replace(/^0+/,'');
  if(d.length<=MAX_DIGITOS&&parseInt(d||'0',10)<=MAX_CENTAVOS)digitos=d;
  mostrar();
}
// Texto colado é lido como valor em reais: "23,40" ou "23.40" = 23,40 · "5,5" = 5,50 · "23" = 23,00.
function deColado(t){
  t=String(t||'').replace(/[^0-9.,]/g,'');
  var m=t.match(/^(.*?)[.,](\\d{1,2})$/);
  if(m)return m[1].replace(/\\D/g,'')+(m[2].length===1?m[2]+'0':m[2]);
  return t.replace(/\\D/g,'')?t.replace(/\\D/g,'')+'00':'';
}
if(inp){
  // Intercepta cada tecla ANTES de chegar ao campo: o dígito sempre entra pela direita
  // e apagar sempre tira o último, não importa onde esteja o cursor.
  inp.addEventListener('beforeinput',function(e){
    var t=e.inputType||'';
    if(t==='insertText'||t==='insertReplacementText'||t==='insertCompositionText'){
      e.preventDefault();definir(digitos+String(e.data||'').replace(/\\D/g,''));
    }else if(t==='insertFromPaste'||t==='insertFromDrop'){
      e.preventDefault();
      var txt=e.dataTransfer?e.dataTransfer.getData('text'):(e.data||'');
      definir(deColado(txt));
    }else if(t.indexOf('delete')===0){
      e.preventDefault();definir(digitos.slice(0,-1));
    }
  });
  // Plano B para navegadores sem "beforeinput": reconstrói a partir do que ficou no campo.
  inp.addEventListener('input',function(){
    var d=inp.value.replace(/\\D/g,'');
    if(d!==digitos)definir(d.length<digitos.length?digitos.slice(0,-1):d);
  });
  // O cursor fica sempre no fim, como numa maquininha.
  ['focus','click'].forEach(function(ev){inp.addEventListener(ev,function(){var f=inp.value.length;setTimeout(function(){try{inp.setSelectionRange(f,f)}catch(e){}},0)})});
}
function atualizar(){
  var c=digitos?parseInt(digitos,10):null, err=$('erro-valor');
  err.textContent='';
  var meu=++seq, qr=$('qr');qr.classList.add('carregando');
  fetch('/api/codigo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chave:D.chave,nome:D.nome,cidade:D.cidade,txid:D.txid,valorCentavos:c})})
   .then(function(r){return r.json()})
   .then(function(r){if(meu!==seq)return;if(!r.ok)throw 0;codigo=r.codigo;qr.innerHTML=r.svg})
   .catch(function(){if(meu===seq)err.textContent='Não consegui atualizar o QR. Verifique a internet.'})
   .then(function(){if(meu===seq)qr.classList.remove('carregando')});
}
})();
</script>`;

  return documento({ titulo, descricao, cor: p.cor, corpo, script });
}
