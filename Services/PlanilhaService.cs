using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.RegularExpressions;

namespace Nyvel.Services;

public class PlanoPlanilha
{
    /// <summary>Texto do plano como está na planilha, ex.: "PLANO BASICO".</summary>
    public string Titulo { get; set; } = "";

    /// <summary>Nome para exibir, ex.: "Basico".</summary>
    public string Nome { get; set; } = "";

    public decimal Preco { get; set; }

    public List<string> Servicos { get; init; } = new();
}

public record ResultadoEscrita(bool Ok, string Mensagem);

/// <summary>
/// Lê os planos da planilha do Google e grava alterações, sempre através da API do próprio site
/// (funções da Cloudflare em /api/planilha). O token do Apps Script fica só no servidor.
/// Formato esperado: linha 1 com "NOME DO PLANO: preço" em cada coluna de plano
/// e os serviços listados abaixo, na mesma coluna.
/// </summary>
public class PlanilhaService(HttpClient http, AdminSessao admin)
{
    private static readonly CultureInfo PtBr = CultureInfo.GetCultureInfo("pt-BR");
    private static readonly Regex Cabecalho = new(@"^(?<nome>[^:]+):\s*(?:R\$\s*)?(?<preco>[\d.,]+)\s*$", RegexOptions.Compiled);
    private static readonly TimeSpan Validade = TimeSpan.FromSeconds(30);
    public const int TamanhoMaximoServico = 150;

    private readonly SemaphoreSlim _trava = new(1, 1);
    private List<PlanoPlanilha>? _cache;
    private DateTime _cacheAte;
    private bool _configurado;
    private string _link = "";

    /// <summary>A gravação está configurada na Cloudflare (Apps Script + token).</summary>
    public bool Configurado => _configurado;

    /// <summary>Pode gravar agora: configurado e com a senha do painel informada.</summary>
    public bool PodeGravar => _configurado && admin.Autenticado;

    public string LinkPlanilha => _link;

    private sealed record Config(bool Configurado, string Link);

    public async Task<List<PlanoPlanilha>> CarregarAsync(bool forcar = false, CancellationToken ct = default)
    {
        await _trava.WaitAsync(ct);
        try
        {
            if (!forcar && _cache is not null && DateTime.UtcNow < _cacheAte)
                return _cache;

            if (_link.Length == 0)
            {
                var cfg = await http.GetFromJsonAsync<Config>("api/planilha/config", ct);
                _configurado = cfg?.Configurado ?? false;
                _link = cfg?.Link ?? "";
            }

            var resp = await http.GetAsync(forcar ? "api/planilha/csv?forcar=1" : "api/planilha/csv", ct);
            if (!resp.IsSuccessStatusCode)
                throw new InvalidOperationException(await ApiErro.LerAsync(resp, "Não foi possível ler a planilha."));

            var csv = await resp.Content.ReadAsStringAsync(ct);
            _cache = Interpretar(csv);
            _cacheAte = DateTime.UtcNow + Validade;
            return _cache;
        }
        finally
        {
            _trava.Release();
        }
    }

    public async Task<ResultadoEscrita> AdicionarServicoAsync(string servico, IReadOnlyCollection<string> titulosPlanos, CancellationToken ct = default)
    {
        servico = (servico ?? "").Trim();

        if (servico.Length == 0)
            return new(false, "Digite o nome do serviço.");
        if (servico.Length > TamanhoMaximoServico)
            return new(false, $"O serviço pode ter no máximo {TamanhoMaximoServico} caracteres.");
        if (titulosPlanos.Count == 0)
            return new(false, "Escolha pelo menos um plano.");

        return await EnviarAsync(new { servico, planos = titulosPlanos }, ct, r =>
        {
            if (_cache is null) return;
            var adicionados = new HashSet<string>(r.Adicionados ?? new(), StringComparer.OrdinalIgnoreCase);
            foreach (var p in _cache.Where(p => adicionados.Contains(p.Titulo)))
                p.Servicos.Add(servico);
        }, $"\"{servico}\" foi adicionado na planilha.");
    }

    /// <summary>Define o preço (por ano) de um plano, reescrevendo o cabeçalho "NOME: preço".</summary>
    public async Task<ResultadoEscrita> DefinirPrecoAsync(string titulo, decimal preco, CancellationToken ct = default)
    {
        titulo = (titulo ?? "").Trim();
        if (titulo.Length == 0) return new(false, "Plano inválido.");
        if (preco < 0) return new(false, "O preço não pode ser negativo.");

        var precoTexto = preco.ToString("0.00", PtBr);
        return await EnviarAsync(new { acao = "definirPreco", titulo, preco = precoTexto }, ct, _ =>
        {
            if (_cache is null) return;
            var p = _cache.FirstOrDefault(x => string.Equals(x.Titulo, titulo, StringComparison.OrdinalIgnoreCase));
            if (p is not null) p.Preco = preco;
        }, $"Preço do plano \"{titulo}\" atualizado.");
    }

    /// <summary>Remove um serviço de um ou mais planos.</summary>
    public async Task<ResultadoEscrita> RemoverServicoAsync(string servico, IReadOnlyCollection<string> titulosPlanos, CancellationToken ct = default)
    {
        servico = (servico ?? "").Trim();
        if (servico.Length == 0) return new(false, "Serviço inválido.");
        if (titulosPlanos.Count == 0) return new(false, "Escolha pelo menos um plano.");

        return await EnviarAsync(new { acao = "removerServico", servico, planos = titulosPlanos }, ct, _ =>
        {
            if (_cache is null) return;
            foreach (var p in _cache.Where(p => titulosPlanos.Contains(p.Titulo, StringComparer.OrdinalIgnoreCase)))
                p.Servicos.RemoveAll(s => string.Equals(s, servico, StringComparison.OrdinalIgnoreCase));
        }, $"\"{servico}\" removido dos planos selecionados.");
    }

    /// <summary>Renomeia um serviço nos planos onde ele aparece.</summary>
    public async Task<ResultadoEscrita> RenomearServicoAsync(string antigo, string novo, IReadOnlyCollection<string> titulosPlanos, CancellationToken ct = default)
    {
        antigo = (antigo ?? "").Trim();
        novo = (novo ?? "").Trim();
        if (antigo.Length == 0 || novo.Length == 0) return new(false, "Serviço inválido.");
        if (novo.Length > TamanhoMaximoServico) return new(false, $"O serviço pode ter no máximo {TamanhoMaximoServico} caracteres.");
        if (titulosPlanos.Count == 0) return new(false, "Escolha pelo menos um plano.");

        return await EnviarAsync(new { acao = "renomearServico", servico = antigo, novo, planos = titulosPlanos }, ct, _ =>
        {
            if (_cache is null) return;
            foreach (var p in _cache.Where(p => titulosPlanos.Contains(p.Titulo, StringComparer.OrdinalIgnoreCase)))
                for (int i = 0; i < p.Servicos.Count; i++)
                    if (string.Equals(p.Servicos[i], antigo, StringComparison.OrdinalIgnoreCase))
                        p.Servicos[i] = novo;
        }, $"Serviço renomeado para \"{novo}\".");
    }

    /// <summary>Cria um plano novo (nova coluna) com nome e preço.</summary>
    public async Task<ResultadoEscrita> CriarPlanoAsync(string nome, decimal preco, CancellationToken ct = default)
    {
        nome = (nome ?? "").Trim();
        if (nome.Length == 0) return new(false, "Digite o nome do plano.");
        if (preco < 0) return new(false, "O preço não pode ser negativo.");

        var precoTexto = preco.ToString("0.00", PtBr);
        return await EnviarAsync(new { acao = "criarPlano", nome, preco = precoTexto }, ct, _ =>
        {
            _cache = null; // força releitura: a nova coluna muda a estrutura
            _cacheAte = DateTime.MinValue;
        }, $"Plano \"{nome}\" criado na planilha.");
    }

    /// <summary>Envia uma ação para /api/planilha/acao e, em caso de sucesso, aplica a atualização local.</summary>
    private async Task<ResultadoEscrita> EnviarAsync(object payload, CancellationToken ct, Action<RespostaScript> aplicarCache, string mensagemOk)
    {
        if (!_configurado)
            return new(false, "A gravação na planilha ainda não está configurada.");
        if (!admin.Autenticado)
            return new(false, "Entre com a senha do painel para editar a planilha.");

        try
        {
            using var req = admin.Requisicao(HttpMethod.Post, "api/planilha/acao", payload);
            using var resp = await http.SendAsync(req, ct);

            if (resp.StatusCode == HttpStatusCode.Unauthorized)
            {
                await admin.SenhaRecusadaAsync();
                return new(false, "A senha do painel não é mais válida. Entre de novo.");
            }

            RespostaScript? r = null;
            try { r = await resp.Content.ReadFromJsonAsync<RespostaScript>(ct); }
            catch (System.Text.Json.JsonException) { /* tratado abaixo */ }

            if (r is null)
                return new(false, "O servidor não respondeu como esperado. Tente de novo.");
            if (!r.Ok)
                return new(false, string.IsNullOrWhiteSpace(r.Erro) ? "A planilha recusou a gravação." : r.Erro);

            // Atualiza a lista em memória na hora (a exportação do Google pode demorar a refletir).
            await _trava.WaitAsync(ct);
            try
            {
                aplicarCache(r);
                if (_cache is not null) _cacheAte = DateTime.UtcNow + TimeSpan.FromMinutes(2);
            }
            finally { _trava.Release(); }

            return new(true, mensagemOk);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return new(false, "Não foi possível falar com a planilha. Verifique a internet e tente de novo.");
        }
    }

    private sealed class RespostaScript
    {
        public bool Ok { get; set; }
        public string? Erro { get; set; }
        public List<string>? Adicionados { get; set; }
    }

    // ---------------- Leitura do CSV ----------------

    private static List<PlanoPlanilha> Interpretar(string csv)
    {
        var linhas = LerCsv(csv);
        var planos = new List<PlanoPlanilha>();
        if (linhas.Count == 0) return planos;

        var cabecalho = linhas[0];
        for (int c = 0; c < cabecalho.Count; c++)
        {
            var m = Cabecalho.Match(cabecalho[c].Trim());
            if (!m.Success) continue;

            var titulo = m.Groups["nome"].Value.Trim();
            decimal.TryParse(m.Groups["preco"].Value, NumberStyles.Number, PtBr, out var preco);

            var servicos = new List<string>();
            for (int r = 1; r < linhas.Count; r++)
            {
                var valor = c < linhas[r].Count ? linhas[r][c].Trim() : "";
                if (valor.Length == 0 || EhTituloServicos(valor)) continue;
                servicos.Add(valor);
            }

            planos.Add(new PlanoPlanilha
            {
                Titulo = titulo,
                Nome = NomeExibicao(titulo),
                Preco = preco,
                Servicos = servicos
            });
        }

        return planos;
    }

    private static bool EhTituloServicos(string valor) =>
        string.Equals(SemAcentos(valor), "servicos", StringComparison.OrdinalIgnoreCase);

    private static string NomeExibicao(string titulo)
    {
        var nome = Regex.Replace(titulo, @"^\s*plano\s+", "", RegexOptions.IgnoreCase).Trim();
        if (nome.Length == 0) nome = titulo;
        return PtBr.TextInfo.ToTitleCase(nome.ToLower(PtBr));
    }

    private static string SemAcentos(string s)
    {
        var sb = new StringBuilder();
        foreach (var ch in s.Normalize(NormalizationForm.FormD))
            if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark)
                sb.Append(ch);
        return sb.ToString();
    }

    private static List<List<string>> LerCsv(string s)
    {
        var linhas = new List<List<string>>();
        var linha = new List<string>();
        var campo = new StringBuilder();
        bool aspas = false;

        for (int i = 0; i < s.Length; i++)
        {
            char ch = s[i];
            if (aspas)
            {
                if (ch == '"')
                {
                    if (i + 1 < s.Length && s[i + 1] == '"') { campo.Append('"'); i++; }
                    else aspas = false;
                }
                else campo.Append(ch);
            }
            else if (ch == '"') aspas = true;
            else if (ch == ',') { linha.Add(campo.ToString()); campo.Clear(); }
            else if (ch == '\n') { linha.Add(campo.ToString()); campo.Clear(); linhas.Add(linha); linha = new(); }
            else if (ch != '\r') campo.Append(ch);
        }

        if (campo.Length > 0 || linha.Count > 0)
        {
            linha.Add(campo.ToString());
            linhas.Add(linha);
        }

        return linhas;
    }
}
