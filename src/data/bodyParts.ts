import type { BodyPart } from '../lib/types';

export interface BodyPartInfo {
  id: BodyPart;
  name: string;
  color: string;
}

export const BODY_PARTS: BodyPartInfo[] = [
  { id: 'chest', name: '胸', color: '#E8483F' },
  { id: 'shoulder', name: '肩', color: '#D9A521' },
  { id: 'back', name: '背', color: '#4F8EF7' },
  { id: 'leg', name: '腿', color: '#A06BFF' },
  { id: 'arm', name: '手臂', color: '#2FD6C3' },
  { id: 'core', name: '核心', color: '#FF5C8A' },
  { id: 'cardio', name: '有氧', color: '#8FAE9B' },
];

export function bodyPartInfo(id: BodyPart): BodyPartInfo {
  return BODY_PARTS.find((p) => p.id === id)!;
}
