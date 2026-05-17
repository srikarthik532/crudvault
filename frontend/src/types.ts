export interface Item {
  id: number;
  title: string;
  description?: string;
  status: 'Active' | 'Inactive' | 'Archived';
  createdAt: string;
  updatedAt?: string;
}

export type ItemForm = Omit<Item, 'id' | 'createdAt' | 'updatedAt'>;
