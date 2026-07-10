import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BodyPart, SetEntry } from '../lib/types';

export interface DraftState {
  active: boolean;
  parts: BodyPart[];
  items: { exerciseId: string; sets: SetEntry[] }[];
  start: () => void;
  togglePart: (part: BodyPart) => void;
  addItem: (exerciseId: string) => void;
  updateSets: (index: number, sets: SetEntry[]) => void;
  removeItem: (index: number) => void;
  removeItemByExercise: (exerciseId: string) => void;
  reset: () => void;
}

/** 记录流草稿：persist 到 localStorage，退出/刷新不丢（产品铁律 2） */
export const useLogDraft = create<DraftState>()(
  persist(
    (set, get) => ({
      active: false,
      parts: [],
      items: [],
      start: () => {
        if (!get().active) set({ active: true, parts: [], items: [] });
      },
      togglePart: (part) =>
        set((s) => ({
          parts: s.parts.includes(part) ? s.parts.filter((p) => p !== part) : [...s.parts, part],
        })),
      addItem: (exerciseId) =>
        set((s) =>
          s.items.some((i) => i.exerciseId === exerciseId)
            ? s
            : { items: [...s.items, { exerciseId, sets: [{}, {}, {}] }] },
        ),
      updateSets: (index, sets) =>
        set((s) => ({
          items: s.items.map((item, i) => (i === index ? { ...item, sets } : item)),
        })),
      removeItem: (index) =>
        set((s) => ({ items: s.items.filter((_, i) => i !== index) })),
      removeItemByExercise: (exerciseId) =>
        set((s) => ({ items: s.items.filter((i) => i.exerciseId !== exerciseId) })),
      reset: () => set({ active: false, parts: [], items: [] }),
    }),
    { name: 'tiezheng-draft' },
  ),
);
