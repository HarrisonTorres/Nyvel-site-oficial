using System.Globalization;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace Nyvel.Services;

public class GoogleSheetsOptions
{
    /// <summary>ID da planilha (o trecho entre /d/ e /edit no link).</summary>
    public string SpreadsheetId { get; set; } = "";

    /// <summary>ID da aba (gid). 0 = primeira aba.</summary>
    public string Gid { get; set; } = "0";

    /// <summary>URL do Web App do Google Apps Script (necessária só para gravar).</summary>
    public string AppsScriptUrl { get; set; } = "";

    /// <summary>Token compartilhado com o Apps Script. Guarde em user-secrets, não no código.</summary>
    public string Token { get; set; } = "";
}

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
/// Lê os planos da planilha do Google (exportação CSV pública) e grava novos
/// serviços através de um Web App do Google Apps Script.
/// Formato esperado: linha 1 com "NOME DO PLANO: preço" em cada coluna de plano
/// e os serviços listados abaixo, na mesma coluna.
/// </summary>
public class PlanilhaService
{
    private static readonly CultureInfo PtBr = CultureInfo.GetCultureInfo("pt-BR");
    private static readonly Regex Cabecalho = new(@"^(?<nome>[^:]+):\s*(?:R\$\s*)?(?<preco>[\d.,]+)\s*$", RegexOptions.Compiled);
    private static readonly TimeSpan Validade = TimeSpan.FromSeconds(30);
    public const int TamanhoMaximoServico = 150;

    private readonly IHttpClientFactory _http;
    private readonly GoogleSheetsOptions _opt;
    private readonly ILogger<PlanilhaService> _log;
    private readonly SemaphoreSlim _trava = new(1, 1);

    private List<PlanoPlanilha>? _cache;
    private DateTime _cacheAte;

    public PlanilhaService(IHttpClientFactory http, IOptions<GoogleSheetsOptions> opt, ILogger<PlanilhaService> log)
    {
        _http = http;
        _opt = opt.Value;
        _log = log;
    }

    public bool PodeGravar =>
        !string.IsNullOrWhiteSpace(_opt.AppsScriptUrl) && !string.IsNullOrWhiteSpace(_opt.Token);

    public string LinkPlanilha => $"https://docs.google.com/spreadsheets/d/{_opt.SpreadsheetId}/edit";

    public async Task<List<PlanoPlanilha>> CarregarAsync(bool forcar = false, CancellationToken ct = default)
    {
        await _trava.WaitAsync(ct);
        try
        {
            if (!forcar && _cache is not null && DateTime.UtcNow < _cacheAte)
                return _cache;

            if (string.IsNullOrWhiteSpace(_opt.SpreadsheetId))
                throw new InvalidOperationException("O ID da planilha não está configurado (GoogleSheets:SpreadsheetId).");

            var url = $"https://docs.google.com/spreadsheets/d/{Uri.EscapeDataString(_opt.SpreadsheetId)}" +
                      $"/export?format=csv&gid={Uri.EscapeDataString(_opt.Gid)}";

            var csv = await _http.CreateClient("planilha").GetStringAsync(url, ct);

            // Se a planilha não estiver compartilhada, o Google devolve a página de login em HTML.
            if (csv.TrimStart().StartsWith('<'))
                throw new InvalidOperationException("Não foi possível ler a planilha. Verifique se ela está compartilhada como \"Qualquer pessoa com o link\".");

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

        if (!PodeGravar)
            return new(false, "A gravação na planilha ainda não está configurada. Veja o arquivo planilha/LEIA-ME.md.");
        if (servico.Length == 0)
            return new(false, "Digite o nome do serviço.");
        if (servico.Length > TamanhoMaximoServico)
            return new(false, $"O serviço pode ter no máximo {TamanhoMaximoServico} caracteres.");
        if (titulosPlanos.Count == 0)
            return new(false, "Escolha pelo menos um plano.");

        try
        {
            var resp = await _http.CreateClient("planilha").PostAsJsonAsync(
                _opt.AppsScriptUrl,
                new { token = _opt.Token, servico, planos = titulosPlanos },
                ct);

            var corpo = await resp.Content.ReadAsStringAsync(ct);
            RespostaScript? r = null;
            try { r = JsonSerializer.Deserialize<RespostaScript>(corpo, new JsonSerializerOptions(JsonSerializerDefaults.Web)); }
            catch (JsonException) { /* resposta não é JSON: tratado abaixo */ }

            if (r is null)
            {
                _log.LogWarning("Resposta inesperada do Apps Script ({Status}): {Corpo}", resp.StatusCode, corpo.Length > 300 ? corpo[..300] : corpo);
                return new(false, "O Apps Script não respondeu como esperado. Confira se ele foi publicado com acesso \"Qualquer pessoa\".");
            }

            if (!r.Ok)
                return new(false, string.IsNullOrWhiteSpace(r.Erro) ? "A planilha recusou a gravação." : r.Erro);

            // Atualiza a lista em memória na hora (a exportação do Google pode demorar a refletir).
            await _trava.WaitAsync(ct);
            try
            {
                if (_cache is not null)
                {
                    var adicionados = new HashSet<string>(r.Adicionados ?? new(), StringComparer.OrdinalIgnoreCase);
                    foreach (var p in _cache.Where(p => adicionados.Contains(p.Titulo)))
                        p.Servicos.Add(servico);
                    _cacheAte = DateTime.UtcNow + TimeSpan.FromMinutes(2);
                }
            }
            finally
            {
                _trava.Release();
            }

            return new(true, $"\"{servico}\" foi adicionado na planilha.");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _log.LogWarning(ex, "Falha ao gravar na planilha");
            return new(false, "Não foi possível falar com a planilha. Verifique a internet e tente de novo.");
        }
    }

    /// <summary>Define o preço (por ano) de um plano, reescrevendo o cabeçalho "NOME: preço".</summary>
    public async Task<ResultadoEscrita> DefinirPrecoAsync(string titulo, decimal preco, CancellationToken ct = default)
    {
        titulo = (titulo ?? "").Trim();
        if (titulo.Length == 0) return new(false, "Plano inválido.");
        if (preco < 0) return new(false, "O preço não pode ser negativo.");

        var precoTexto = preco.ToString("0.00", PtBr);
        return await EnviarAsync(new { acao = "definirPreco", titulo, preco = precoTexto }, ct, () =>
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

        return await EnviarAsync(new { acao = "removerServico", servico, planos = titulosPlanos }, ct, () =>
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

        return await EnviarAsync(new { acao = "renomearServico", servico = antigo, novo, planos = titulosPlanos }, ct, () =>
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
        return await EnviarAsync(new { acao = "criarPlano", nome, preco = precoTexto }, ct, () =>
        {
            _cache = null; // força releitura: a nova coluna muda a estrutura
            _cacheAte = DateTime.MinValue;
        }, $"Plano \"{nome}\" criado na planilha.");
    }

    /// <summary>Envia uma ação ao Apps Script e, em caso de sucesso, aplica a atualização local.</summary>
    private async Task<ResultadoEscrita> EnviarAsync(object payload, CancellationToken ct, Action aplicarCache, string mensagemOk)
    {
        if (!PodeGravar)
            return new(false, "A gravação na planilha ainda não está configurada. Veja o arquivo planilha/LEIA-ME.md.");

        try
        {
            // Mescla o token no payload (os objetos anônimos não podem ser estendidos, então usamos um dicionário).
            var corpo = new Dictionary<string, object?> { ["token"] = _opt.Token };
            foreach (var prop in payload.GetType().GetProperties())
                corpo[prop.Name] = prop.GetValue(payload);

            var resp = await _http.CreateClient("planilha").PostAsJsonAsync(_opt.AppsScriptUrl, corpo, ct);
            var texto = await resp.Content.ReadAsStringAsync(ct);

            RespostaScript? r = null;
            try { r = JsonSerializer.Deserialize<RespostaScript>(texto, new JsonSerializerOptions(JsonSerializerDefaults.Web)); }
            catch (JsonException) { /* tratado abaixo */ }

            if (r is null)
            {
                _log.LogWarning("Resposta inesperada do Apps Script ({Status}): {Corpo}", resp.StatusCode, texto.Length > 300 ? texto[..300] : texto);
                return new(false, "O Apps Script não respondeu como esperado. Confira se ele foi publicado e atualizado com a última versão.");
            }

            if (!r.Ok)
                return new(false, string.IsNullOrWhiteSpace(r.Erro) ? "A planilha recusou a gravação." : r.Erro);

            await _trava.WaitAsync(ct);
            try
            {
                aplicarCache();
                if (_cache is not null) _cacheAte = DateTime.UtcNow + TimeSpan.FromMinutes(2);
            }
            finally { _trava.Release(); }

            return new(true, mensagemOk);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _log.LogWarning(ex, "Falha ao gravar na planilha");
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
