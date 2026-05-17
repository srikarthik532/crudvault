import axios from 'axios';
import type { Item, ItemForm } from './types';

const http = axios.create({ baseURL: '/api' });

export const getItems = () => http.get<Item[]>('/items').then(r => r.data);
export const getItem = (id: number) => http.get<Item>(`/items/${id}`).then(r => r.data);
export const createItem = (data: ItemForm) => http.post<Item>('/items', data).then(r => r.data);
export const updateItem = (id: number, data: ItemForm) => http.put<Item>(`/items/${id}`, data).then(r => r.data);
export const deleteItem = (id: number) => http.delete(`/items/${id}`);
