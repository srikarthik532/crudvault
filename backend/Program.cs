using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using CrudVault.Api.Data;

var builder = WebApplication.CreateBuilder(args);

var csb = new SqlConnectionStringBuilder
{
    DataSource = $"{Environment.GetEnvironmentVariable("DB_HOST") ?? "localhost"},1433",
    InitialCatalog = Environment.GetEnvironmentVariable("DB_NAME") ?? "CrudVaultDb",
    UserID = Environment.GetEnvironmentVariable("DB_USER") ?? "sa",
    TrustServerCertificate = true
};
csb["Password"] = Environment.GetEnvironmentVariable("DB_PASS") ?? "";

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(csb.ConnectionString));

builder.Services.AddControllers();
builder.Services.AddCors(options =>
    options.AddPolicy("AllowFrontend", policy =>
        policy.WithOrigins("http://localhost:5173", "http://localhost:3000", "http://frontend:80")
              .AllowAnyHeader()
              .AllowAnyMethod()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();
}

app.UseCors("AllowFrontend");
app.MapControllers();
app.Run();
