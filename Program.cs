using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using Nyvel.Components;
using Nyvel.Services;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<Routes>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

// Todas as chamadas vão para as funções da Cloudflare no mesmo endereço do site (/api/...).
builder.Services.AddScoped(_ => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });
builder.Services.AddScoped<AdminSessao>();
builder.Services.AddScoped<PlanilhaService>();
builder.Services.AddScoped<PixService>();

await builder.Build().RunAsync();
