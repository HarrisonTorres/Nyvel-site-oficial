// Gerador de PDF do orçamento NYVEL.
// Desenha o documento com jsPDF a partir dos dados enviados pelo Blazor,
// usando a mesma paleta do site (navy + gradiente azul/verde/laranja/amarelo).
window.nyvelPdf = (function () {
    const C = {
        bg: [10, 16, 32],
        card: [20, 31, 54],
        card2: [14, 22, 40],
        line: [40, 54, 82],
        text: [238, 242, 249],
        dim: [159, 176, 201],
        blue: [43, 139, 255],
        green: [39, 194, 61],
        orange: [255, 138, 30],
        yellow: [255, 193, 7],
        ink: [6, 16, 31]
    };

    const stops = [[0, C.blue], [0.45, C.green], [0.8, C.orange], [1, C.yellow]];

    function mix(t) {
        for (let i = 0; i < stops.length - 1; i++) {
            const [t0, c0] = stops[i];
            const [t1, c1] = stops[i + 1];
            if (t <= t1) {
                const k = (t - t0) / (t1 - t0);
                return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
            }
        }
        return stops[stops.length - 1][1];
    }

    // Retângulo com gradiente horizontal (faixas finas interpoladas).
    function gradRect(doc, x, y, w, h) {
        const n = Math.max(120, Math.round(w * 3));
        const sw = w / n;
        for (let i = 0; i < n; i++) {
            const c = mix(i / (n - 1));
            doc.setFillColor(c[0], c[1], c[2]);
            const xi = x + i * sw;
            // sobreposição maior evita as "costuras" entre as faixas
            doc.rect(xi, y, Math.min(sw * 2, x + w - xi), h, "F");
        }
    }

    async function carregarImagem(url) {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error("Logo não encontrada");
        const blob = await resp.blob();
        return await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(blob);
        });
    }

    // Cria um documento A4 com as funções de desenho comuns (fundo, cabeçalho, rodapé).
    async function novoDocumento() {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

        const W = 210, H = 297, M = 16, CW = W - 2 * M;
        const FOOTER_Y = H - 24;

        let logo = null;
        try { logo = await carregarImagem("img/logo.jpg"); } catch (e) { console.warn(e); }

        const cor = (c) => doc.setTextColor(c[0], c[1], c[2]);
        const fill = (c) => doc.setFillColor(c[0], c[1], c[2]);
        const draw = (c) => doc.setDrawColor(c[0], c[1], c[2]);
        const fonte = (estilo, tam) => { doc.setFont("helvetica", estilo); doc.setFontSize(tam); };

        function label(texto, x, y, align) {
            fonte("bold", 7.5);
            cor(C.blue);
            doc.text(texto.toUpperCase(), x, y, align ? { align } : { charSpace: 0.6 });
        }

        function fundo() {
            fill(C.bg);
            doc.rect(0, 0, W, H, "F");
            // brilho suave no canto superior direito (círculos concêntricos)
            const passos = 45;
            for (let i = 0; i < passos; i++) {
                const k = i / (passos - 1);
                const r = 95 - k * 70;
                const c = C.bg.map((v, j) => Math.round(v + ([18, 38, 76][j] - v) * k));
                fill(c);
                doc.circle(W - 10, -5, r, "F");
            }
            // faixa de gradiente no rodapé da página
            gradRect(doc, 0, H - 2.2, W, 2.2);
        }

        function rodape(aviso) {
            draw(C.line);
            doc.setLineWidth(0.3);
            doc.line(M, FOOTER_Y, W - M, FOOTER_Y);
            fonte("normal", 8);
            cor(C.dim);
            doc.text(aviso, M, FOOTER_Y + 7);
            doc.text("@nyveldigital  ·  instagram.com/nyveldigital", W - M, FOOTER_Y + 7, { align: "right" });
            fonte("bold", 8);
            cor(C.text);
            doc.text("NYVEL · Assessoria Digital", M, FOOTER_Y + 12.5);
        }

        // Logo + marca à esquerda e um bloco de 3 linhas à direita. Retorna o y após a barra.
        function cabecalho(rotulo, linha1, linha2) {
            if (logo) doc.addImage(logo, "JPEG", M, M, 20, 20);
            fonte("bold", 20);
            cor(C.text);
            doc.text("NYVEL", M + 26, M + 10, { charSpace: 1.2 });
            fonte("normal", 9);
            cor(C.dim);
            doc.text("Assessoria Digital", M + 26, M + 16);

            label(rotulo, W - M, M + 5, "right");
            fonte("bold", 12);
            cor(C.text);
            doc.text(linha1, W - M, M + 12, { align: "right" });
            fonte("normal", 9);
            cor(C.dim);
            doc.text(linha2, W - M, M + 18, { align: "right" });

            gradRect(doc, M, M + 28, CW, 1.4);
            return M + 28 + 11;
        }

        // Check verde desenhado (as fontes padrão do PDF não têm o caractere ✓).
        function check(x, y) {
            draw(C.green);
            doc.setLineWidth(0.7);
            doc.line(x, y, x + 1.3, y + 1.3);
            doc.line(x + 1.3, y + 1.3, x + 3.6, y - 1.8);
        }

        return { doc, W, H, M, CW, FOOTER_Y, cor, fill, draw, fonte, label, fundo, rodape, cabecalho, check };
    }

    async function gerar(d, nomeArquivo) {
        const k = await novoDocumento();
        const { doc, W, M, CW, FOOTER_Y, cor, fill, draw, fonte, label, fundo } = k;
        const rodape = () => k.rodape("Proposta válida por 15 dias a partir da data de emissão.");

        let y = 0;
        function garantirEspaco(h) {
            if (y + h > FOOTER_Y - 3) {
                rodape();
                doc.addPage();
                fundo();
                y = M + 6;
            }
        }

        // ---------- Página 1 ----------
        fundo();
        y = k.cabecalho("Orçamento", "Nº " + d.numero, "Emitido em " + d.data);

        // Cliente
        label("Proposta para", M, y);
        y += 9;
        fonte("bold", 22);
        cor(C.text);
        const nomeLinhas = doc.splitTextToSize(d.cliente, CW);
        doc.text(nomeLinhas, M, y);
        y += (nomeLinhas.length - 1) * 9;
        if (d.empresa) {
            y += 7;
            fonte("normal", 11);
            cor(C.dim);
            doc.text(d.empresa, M, y);
        }
        y += 12;

        // ---------- Card do plano ----------
        // Com mais de 5 serviços, a lista vira duas colunas para caber em uma página.
        fonte("normal", 10);
        const itens = d.plano.itens || [];
        const alertas = new Set(d.plano.alertas || []);
        const colunas = itens.length > 5 ? 2 : 1;
        const colW = colunas === 2 ? (CW - 16 - 6) / 2 : CW - 16;
        const itensLinhas = itens.map(i => doc.splitTextToSize(i, colW - 9));
        const porColuna = Math.ceil(itensLinhas.length / colunas);
        const alturaLinha = (l) => l.length * 4.6 + 2;
        let alturaItens = 0;
        for (let r = 0; r < porColuna; r++) {
            let h = 0;
            for (let c = 0; c < colunas; c++) {
                const l = itensLinhas[c * porColuna + r];
                if (l) h = Math.max(h, alturaLinha(l));
            }
            alturaItens += h;
        }
        const planoH = 34 + alturaItens + 2;
        garantirEspaco(planoH);

        fill(C.card);
        draw(C.line);
        doc.setLineWidth(0.3);
        doc.roundedRect(M, y, CW, planoH, 3, 3, "FD");

        label("Plano selecionado", M + 8, y + 10);
        label("Valor do plano", W - M - 8, y + 10, "right");
        fonte("bold", 20);
        cor(C.text);
        doc.text(d.plano.nome, M + 8, y + 19);

        // Parcela em destaque (grande) e valor à vista pequeno, à direita.
        const xr = W - M - 8;
        fonte("bold", 20);
        cor(C.blue);
        doc.text(d.plano.parcelaValor, xr, y + 19, { align: "right" });
        const larguraParcela = doc.getTextWidth(d.plano.parcelaValor);
        fonte("bold", 9);
        cor(C.dim);
        doc.text(d.plano.parcelaQtd + "x de", xr - larguraParcela - 2, y + 19, { align: "right" });
        fonte("normal", 8.5);
        cor(C.dim);
        const avistaTxt = (d.plano.entrada ? "+ entrada de " + d.plano.entrada + "  ·  " : "")
            + "ou " + d.plano.avista + " à vista";
        doc.text(avistaTxt, xr, y + 24.5, { align: "right" });

        if (d.plano.periodo) {
            fonte("normal", 8.5);
            cor(C.dim);
            doc.text(d.plano.periodo, M + 8, y + 24.5);
        }
        gradRect(doc, M + 8, y + 27, 26, 0.9);

        let iy = y + 34;
        for (let r = 0; r < porColuna; r++) {
            let h = 0;
            for (let c = 0; c < colunas; c++) {
                const linhas = itensLinhas[c * porColuna + r];
                if (!linhas) continue;
                const x = M + 8 + c * (colW + 6);
                const idx = c * porColuna + r;
                if (alertas.has(itens[idx])) {
                    // exclamação amarela para serviços com valor a combinar
                    const ex = x + 2.8, ey = iy - 1.2;
                    draw(C.yellow);
                    fill(C.yellow);
                    doc.setLineWidth(0.9);
                    doc.line(ex, ey - 2.4, ex, ey + 0.4);
                    doc.circle(ex, ey + 1.6, 0.5, "F");
                } else {
                    // check verde desenhado
                    draw(C.green);
                    doc.setLineWidth(0.7);
                    const cx = x + 1, cy = iy - 1.2;
                    doc.line(cx, cy, cx + 1.3, cy + 1.3);
                    doc.line(cx + 1.3, cy + 1.3, cx + 3.6, cy - 1.8);
                }
                fonte("normal", 10);
                cor(C.text);
                doc.text(linhas, x + 8, iy);
                h = Math.max(h, alturaLinha(linhas));
            }
            iy += h;
        }
        y += planoH + 6;

        // ---------- Formas de pagamento (duas opções lado a lado) ----------
        const opcoes = d.opcoes || [];
        const GAP = 6;
        const OW = (CW - GAP) / 2;
        const maxLinhas = Math.max(1, ...opcoes.map(o => (o.linhas || []).length));
        const optH = 37 + maxLinhas * 8 + 2 + 13 + 7;
        garantirEspaco(12 + optH);

        fonte("bold", 13);
        cor(C.text);
        doc.text("Formas de pagamento", M, y + 5);
        fonte("normal", 9);
        cor(C.dim);
        doc.text("Escolha a opção que fica melhor para você.", W - M, y + 5, { align: "right" });
        y += 11;

        opcoes.forEach((o, i) => {
            const ox = M + i * (OW + GAP);
            const ix = ox + 7, ir = ox + OW - 7;

            fill(C.card);
            draw(C.line);
            doc.setLineWidth(0.3);
            doc.roundedRect(ox, y, OW, optH, 3, 3, "FD");

            label(o.rotulo, ix, y + 9);
            fonte("bold", 12);
            cor(C.text);
            doc.text(o.titulo, ix, y + 16);

            // "12x de" pequeno antes do valor grande (só na opção parcelada)
            let dx = ix;
            if (o.prefixo) {
                fonte("bold", 9);
                cor(C.dim);
                doc.text(o.prefixo, ix, y + 26);
                dx = ix + doc.getTextWidth(o.prefixo) + 2;
            }
            fonte("bold", 17);
            cor(C.blue);
            doc.text(o.destaque, dx, y + 26);
            fonte("normal", 8.5);
            cor(C.dim);
            doc.text(o.subtitulo || "", ix, y + 31.5);

            let py = y + 40;
            (o.linhas || []).forEach(l => {
                fonte("normal", 9);
                cor(C.dim);
                doc.text(l.rotulo, ix, py);
                fonte("bold", 9.5);
                cor(C.text);
                doc.text(l.valor, ir, py, { align: "right" });
                draw(C.line);
                doc.setLineWidth(0.25);
                doc.setLineDashPattern([1, 1], 0);
                doc.line(ix, py + 3, ir, py + 3);
                doc.setLineDashPattern([], 0);
                py += 8;
            });

            // total com o gradiente do site, alinhado no fim do card
            const ty = y + optH - 7 - 13;
            gradRect(doc, ix, ty, ir - ix, 13);
            fonte("bold", 10);
            cor(C.ink);
            doc.text("Total", ix + 5, ty + 8.3);
            fonte("bold", 13);
            doc.text(o.totalValor, ir - 5, ty + 8.6, { align: "right" });
        });
        y += optH + 6;

        // ---------- Observações ----------
        if (d.observacoes) {
            fonte("normal", 10);
            const obs = doc.splitTextToSize(d.observacoes, CW - 16);
            const obsH = 15 + obs.length * 5;
            garantirEspaco(obsH);
            fill(C.card);
            draw(C.line);
            doc.setLineWidth(0.3);
            doc.roundedRect(M, y, CW, obsH, 3, 3, "FD");
            label("Observações", M + 8, y + 8);
            fonte("normal", 10);
            cor(C.text);
            doc.text(obs, M + 8, y + 14);
            y += obsH + 8;
        }

        rodape();
        doc.save(nomeArquivo || "orcamento-nyvel.pdf");
    }

    // PDF com todos os planos disponíveis, sem dados de cliente.
    async function gerarCatalogo(d, nomeArquivo) {
        const k = await novoDocumento();
        const { doc, W, M, CW, FOOTER_Y, cor, fill, draw, fonte, label, fundo, check } = k;
        const rodape = () => k.rodape("Valores sujeitos a alteração. Peça um orçamento personalizado.");
        const planos = d.planos || [];

        fundo();
        let y = k.cabecalho("Catálogo", "Planos e serviços", "Atualizado em " + d.data);

        label("Nossos planos", M, y);
        y += 9;
        fonte("bold", 22);
        cor(C.text);
        doc.text("Escolha o plano ideal", M, y);
        y += 7;
        fonte("normal", 10.5);
        cor(C.dim);
        doc.text("Tudo o que a sua marca precisa para ser encontrada e lembrada.", M, y);
        y += 10;

        const POR_LINHA = 3, GAP = 5;
        for (let ini = 0; ini < planos.length; ini += POR_LINHA) {
            const linha = planos.slice(ini, ini + POR_LINHA);
            const n = Math.min(POR_LINHA, planos.length);
            const cw = (CW - GAP * (n - 1)) / n;

            // mede os serviços de cada card para igualar as alturas da linha
            fonte("normal", 8.8);
            const medidas = linha.map(p => (p.servicos || []).map(s => doc.splitTextToSize(s, cw - 17)));
            const altura = medidas.map(m => m.reduce((s, l) => s + l.length * 4 + 2.6, 0));
            const cardH = 54 + Math.max(0, ...altura) + 6;

            if (y + cardH > FOOTER_Y - 30) {
                rodape();
                doc.addPage();
                fundo();
                y = M + 6;
            }

            linha.forEach((p, i) => {
                const x = M + i * (cw + GAP);
                const ix = x + 6;

                fill(C.card);
                draw(C.line);
                doc.setLineWidth(0.3);
                doc.roundedRect(x, y, cw, cardH, 3, 3, "FD");
                gradRect(doc, x + 6, y, cw - 12, 1.1);

                label("Plano", ix, y + 10);
                fonte("bold", 15);
                cor(C.text);
                doc.text(doc.splitTextToSize(p.nome, cw - 12)[0], ix, y + 18);

                // ---- Estratégia de marketing: 12x grande, à vista pequeno ----
                // "12x de R$ X,XX" é o apelo principal (parcela baixa).
                fonte("bold", 9);
                cor(C.dim);
                doc.text("12x de", ix, y + 26);
                fonte("bold", 22);
                cor(C.blue);
                doc.text(p.parcela || p.preco, ix, y + 34);
                fonte("normal", 7.5);
                cor(C.dim);
                doc.text("sem juros no cartão", ix, y + 39);
                // à vista menor, como alternativa
                fonte("normal", 8);
                cor(C.dim);
                doc.text("ou " + (p.avista || p.preco) + " à vista", ix, y + 44);

                fonte("normal", 8);
                cor(C.dim);
                const qtd = (p.servicos || []).length;
                doc.text(qtd + (qtd === 1 ? " serviço incluso" : " serviços inclusos"), ix, y + 49);
                draw(C.line);
                doc.setLineWidth(0.25);
                doc.line(ix, y + 51.5, x + cw - 6, y + 51.5);

                let iy = y + 58;
                medidas[i].forEach(l => {
                    check(ix + 0.5, iy - 1.2);
                    fonte("normal", 8.8);
                    cor(C.text);
                    doc.text(l, ix + 7, iy);
                    iy += l.length * 4 + 2.6;
                });
            });
            y += cardH + 7;
        }

        // chamada para orçamento
        const ctaH = 22;
        if (y + ctaH > FOOTER_Y - 3) {
            rodape();
            doc.addPage();
            fundo();
            y = M + 6;
        }
        gradRect(doc, M, y, CW, ctaH);
        fonte("bold", 13);
        cor(C.ink);
        doc.text("Quer uma proposta sob medida?", M + 8, y + 9.5);
        fonte("normal", 9.5);
        doc.text("Fale com a gente e montamos o orçamento ideal para o seu negócio.", M + 8, y + 15.5);
        fonte("bold", 11);
        doc.text("@nyveldigital", W - M - 8, y + 12.8, { align: "right" });

        rodape();
        doc.save(nomeArquivo || "planos-nyvel.pdf");
    }

    return { gerar, gerarCatalogo };
})();

// Utilitários de interface
window.nyvelUi = {
    rolarPara: function (id) {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
};
