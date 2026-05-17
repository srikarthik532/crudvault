using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using CrudVault.Api.Data;
using CrudVault.Api.Models;

namespace CrudVault.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ItemsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetAll() =>
        Ok(await db.Items.OrderByDescending(i => i.CreatedAt).ToListAsync());

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(int id)
    {
        var item = await db.Items.FindAsync(id);
        return item is null ? NotFound() : Ok(item);
    }

    [HttpPost]
    public async Task<IActionResult> Create(Item item)
    {
        item.CreatedAt = DateTime.UtcNow;
        db.Items.Add(item);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id = item.Id }, item);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(int id, Item updated)
    {
        var item = await db.Items.FindAsync(id);
        if (item is null) return NotFound();
        item.Title = updated.Title;
        item.Description = updated.Description;
        item.Status = updated.Status;
        item.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(item);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var item = await db.Items.FindAsync(id);
        if (item is null) return NotFound();
        db.Items.Remove(item);
        await db.SaveChangesAsync();
        return NoContent();
    }
}
