using Microsoft.EntityFrameworkCore;
using CrudVault.Api.Models;

namespace CrudVault.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Item> Items => Set<Item>();
}
