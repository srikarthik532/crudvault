import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getItems, createItem, updateItem, deleteItem } from './api';
import type { Item, ItemForm } from './types';

const STATUS_COLORS: Record<string, string> = {
  Active: 'bg-emerald-100 text-emerald-700',
  Inactive: 'bg-amber-100 text-amber-700',
  Archived: 'bg-slate-100 text-slate-600',
};

const empty: ItemForm = { title: '', description: '', status: 'Active' };

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState<ItemForm>(empty);
  const [editing, setEditing] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    getItems()
      .then(setItems)
      .catch(() => setError('Failed to load items. Is the API running?'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setForm(empty); setEditing(null); setShowForm(true); };
  const openEdit = (item: Item) => {
    setForm({ title: item.title, description: item.description ?? '', status: item.status });
    setEditing(item.id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editing !== null) {
      const updated = await updateItem(editing, form);
      setItems(prev => prev.map(i => i.id === editing ? updated : i));
    } else {
      const created = await createItem(form);
      setItems(prev => [created, ...prev]);
    }
    setShowForm(false);
    setEditing(null);
    setForm(empty);
  };

  const handleDelete = async (id: number) => {
    setDeleting(id);
    await deleteItem(id);
    setItems(prev => prev.filter(i => i.id !== id));
    setDeleting(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white">
      <header className="border-b border-white/10 backdrop-blur-sm sticky top-0 z-10 bg-slate-950/60">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center text-sm font-bold">CV</div>
            <h1 className="text-lg font-semibold tracking-tight">CrudVault</h1>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-400 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            <span className="text-lg leading-none">+</span> New Item
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-4 mb-8"
        >
          {(['Active', 'Inactive', 'Archived'] as const).map(s => (
            <div key={s} className="flex-1 bg-white/5 rounded-xl p-4 border border-white/10">
              <p className="text-2xl font-bold">{items.filter(i => i.status === s).length}</p>
              <p className="text-xs text-slate-400 mt-1">{s}</p>
            </div>
          ))}
        </motion.div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-sm">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full"
            />
          </div>
        ) : items.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20 text-slate-500"
          >
            <p className="text-4xl mb-3">📭</p>
            <p className="text-lg font-medium text-slate-400">No items yet</p>
            <p className="text-sm mt-1">Create your first item to get started</p>
          </motion.div>
        ) : (
          <motion.ul layout className="space-y-3">
            <AnimatePresence>
              {items.map(item => (
                <motion.li
                  key={item.id}
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20, height: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  className="bg-white/5 hover:bg-white/[0.08] border border-white/10 rounded-xl p-5 flex items-start gap-4 group transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="font-semibold text-white truncate">{item.title}</h2>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[item.status]}`}>
                        {item.status}
                      </span>
                    </div>
                    {item.description && (
                      <p className="text-sm text-slate-400 mt-1 line-clamp-2">{item.description}</p>
                    )}
                    <p className="text-xs text-slate-600 mt-2">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={() => openEdit(item)}
                      className="px-3 py-1.5 text-xs bg-white/10 hover:bg-white/20 rounded-lg transition-colors cursor-pointer"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      disabled={deleting === item.id}
                      className="px-3 py-1.5 text-xs bg-red-500/20 hover:bg-red-500/40 text-red-300 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {deleting === item.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </main>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setShowForm(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl"
            >
              <h2 className="text-lg font-semibold mb-5">{editing !== null ? 'Edit Item' : 'New Item'}</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Title *</label>
                  <input
                    required
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                    placeholder="Item title"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Description</label>
                  <textarea
                    rows={3}
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 transition-colors resize-none"
                    placeholder="Optional description"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Status</label>
                  <select
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value as Item['status'] }))}
                    className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                  >
                    <option>Active</option>
                    <option>Inactive</option>
                    <option>Archived</option>
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="flex-1 py-2 text-sm bg-white/5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2 text-sm bg-indigo-500 hover:bg-indigo-400 rounded-lg font-medium transition-colors cursor-pointer"
                  >
                    {editing !== null ? 'Save Changes' : 'Create'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
