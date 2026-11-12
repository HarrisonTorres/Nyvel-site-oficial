using System.Net;
using System.Net.Http.Json;

namespace Nyvel.Services;

public class PixPagina
{
    public string Slug { get; set; } = "";
    public string Titulo { get; set; } = "";
    public string Nome { get; set; } = "";
    public string Cidade { get; set; } = "";
    public string TipoChave { get; set; } = "telefone";
    public string Chave { get; set; } = "";
    public long? ValorCentavos { get; set; }
    public bool ClienteDefineValor { get; set; } = true;
    public string Descricao { get; set; } = "";
    public string Mensagem { get; set; } = "";
    public string Txid { get; set; } = "";
    public string Cor { get; set; } = "#2b8bff";
    public string LogoUrl { get; set; } = "";
    public string Whatsapp { get; set; } = "";
    public bool Ativo { get; set; } = true;
    public string? CriadoEm { get; set; }
    public string? AtualizadoEm { get; set; }

    public PixPagina Copia() => (PixPagina)MemberwiseClone();
}

public class PixResumo
{
    public string Slug { get; set; } = "";
    public string? Titulo { get; set; }
    public long? ValorCentavos { get; set; }
    public bool Ativo { get; set; } = true;
    public string? AtualizadoEm { get; set; }
}

public record PixResultado(bool Ok, string? Erro, Dictionary<string, string> Erros, PixPagina? Pagina)
{
    public static PixResultado Falha(string erro) => new(false, erro, new(), null);
}

/// <summary>Fala com a API das páginas de pagamento Pix (/api/pix, /api/preview).</summary>
public class PixService(HttpClient http, AdminSessao admin)
{
    private sealed class Resposta
    {
        public bool Ok { get; set; }
        public string? Erro { get; set; }
        public Dictionary<string, string>? Erros { get; set; }
        public PixPagina? Pagina { get; set; }
        public List<PixResumo>? Paginas { get; set; }
        public string? Html { get; set; }
    }

    private async Task<(Resposta? r, string? erro)> EnviarAsync(HttpMethod metodo, string url, object? corpo = null, CancellationToken ct = default)
    {
        try
        {
            using var req = admin.Requisicao(metodo, url, corpo);
            using var resp = await http.SendAsync(req, ct);
            if (resp.StatusCode == HttpStatusCode.Unauthorized)
            {
                await admin.SenhaRecusadaAsync();
                return (null, "A senha do painel não é mais válida. Entre de novo.");
            }

            Resposta? r = null;
            try { r = await resp.Content.ReadFromJsonAsync<Resposta>(ct); }
            catch (System.Text.Json.JsonException) { }
            return r is null ? (null, "O servidor não respondeu como esperado.") : (r, null);
        }
        catch (Exception ex) when (ex is HttpRequestException)
        {
            return (null, "Sem conexão. Verifique a internet e tente de novo.");
        }
    }

    public async Task<(List<PixResumo> paginas, string? erro)> ListarAsync()
    {
        var (r, erro) = await EnviarAsync(HttpMethod.Get, "api/pix");
        if (r is null) return (new(), erro);
        return r.Ok ? (r.Paginas ?? new(), null) : (new(), r.Erro);
    }

    public async Task<PixResultado> ObterAsync(string slug)
    {
        var (r, erro) = await EnviarAsync(HttpMethod.Get, $"api/pix/{Uri.EscapeDataString(slug)}");
        return Resultado(r, erro);
    }

    public async Task<PixResultado> SalvarAsync(PixPagina p, bool nova)
    {
        var (r, erro) = nova
            ? await EnviarAsync(HttpMethod.Post, "api/pix", p)
            : await EnviarAsync(HttpMethod.Put, $"api/pix/{Uri.EscapeDataString(p.Slug)}", p);
        return Resultado(r, erro);
    }

    public async Task<PixResultado> ExcluirAsync(string slug)
    {
        var (r, erro) = await EnviarAsync(HttpMethod.Delete, $"api/pix/{Uri.EscapeDataString(slug)}");
        return Resultado(r, erro);
    }

    /// <summary>HTML da página como ficaria (sem salvar) e os erros de cada campo.</summary>
    public async Task<(string? html, Dictionary<string, string> erros)> PreviaAsync(PixPagina p, CancellationToken ct)
    {
        var (r, _) = await EnviarAsync(HttpMethod.Post, "api/preview", p, ct);
        return (r?.Html, r?.Erros ?? new());
    }

    private static PixResultado Resultado(Resposta? r, string? erro) =>
        r is null ? PixResultado.Falha(erro ?? "Erro desconhecido.")
                  : new(r.Ok, r.Erro, r.Erros ?? new(), r.Pagina);
}
