import type { PlanTransform } from '../../shared/editing.js';

export type StageEditing = {
  venueEditable?: boolean;
  selectedIds?: string[];
  pivot?: { x: number; y: number };
  snapEnabled?: boolean;
  onSelect?: (id: string, additive: boolean) => void;
  onClearSelection?: () => void;
  onTransform?: (phase: 'begin' | 'preview' | 'commit' | 'cancel', delta: PlanTransform, bypass: boolean) => void;
};
