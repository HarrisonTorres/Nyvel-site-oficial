using System.Net.Http.Headers;
using Microsoft.JSInterop;

namespace Nyvel.Services;

/// <summary>
/// Guarda a senha do painel (no localStorage do navegador) e a coloca nas chamadas protegidas da API.
/// </summary>
public class AdminSessao(HttpClient http, IJSRuntime js)
{
    private const string ChaveStorage = "nyvel.admin";
    private string? _senha;
    private bool _carregado;

    public bool Autenticado => !string.IsNullOrEmpty(_senha);

    public event Action? Mudou;

    public async Task CarregarAsync()
    {
        if (_carregado) return;
        _carregado = true;
        try { _senha = await js.InvokeAsync<string?>("localStorage.getItem", ChaveStorage); }
        catch (JSException) { _senha = null; }
        if (Autenticado) Mudou?.Invoke();
    }

    /// <summary>Confere a senha no servidor. Devolve null se deu certo, ou a mensagem de erro.</summary>
    public async Task<string?> EntrarAsync(string senha)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "api/admin/login");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", senha);
        HttpResponseMessage resp;
        try { resp = await http.SendAsync(req); }
        catch (HttpRequestException) { return "Sem conexão. Tente de novo."; }

        if (!resp.IsSuccessStatusCode)
            return await ApiErro.LerAsync(resp, "Senha incorreta.");

        _senha = senha;
        try { await js.InvokeVoidAsync("localStorage.setItem", ChaveStorage, senha); } catch (JSException) { }
        Mudou?.Invoke();
        return null;
    }

    public async Task SairAsync()
    {
        _senha = null;
        try { await js.InvokeVoidAsync("localStorage.removeItem", ChaveStorage); } catch (JSException) { }
        Mudou?.Invoke();
    }

    /// <summary>Monta uma requisição já com a senha do painel.</summary>
    public HttpRequestMessage Requisicao(HttpMethod metodo, string url, object? corpo = null)
    {
        var req = new HttpRequestMessage(metodo, url);
        if (_senha is not null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _senha);
        if (corpo is not null) req.Content = System.Net.Http.Json.JsonContent.Create(corpo);
        return req;
    }

    /// <summary>Chamado quando a API responde 401: a senha mudou ou expirou.</summary>
    public async Task SenhaRecusadaAsync() => await SairAsync();
}

internal static class ApiErro
{
    private sealed record Corpo(string? Erro);

    public static async Task<string> LerAsync(HttpResponseMessage resp, string padrao)
    {
        try
        {
            var c = await System.Net.Http.Json.HttpContentJsonExtensions.ReadFromJsonAsync<Corpo>(resp.Content);
            return string.IsNullOrWhiteSpace(c?.Erro) ? padrao : c.Erro;
        }
        catch { return padrao; }
    }
}
