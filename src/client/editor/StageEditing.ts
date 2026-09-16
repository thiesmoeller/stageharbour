import type { PlanTransform } from '../../shared/editing.js';
import type { VenueGeometry } from '../../shared/layout.js';

export type StageEditing = {
  venueEditable?: boolean;
  selectedIds?: string[];
  pivot?: { x: number; y: number };
  snapEnabled?: boolean;
  resizeDocument?: VenueGeometry;
  resizeScope?: 'venue' | 'scene';
  onSelect?: (id: string, additive: boolean) => void;
  onClearSelection?: () => void;
  onTransform?: (phase: 'begin' | 'preview' | 'commit' | 'cancel', delta: PlanTransform, bypass: boolean, operation?: 'translate' | 'rotate') => void;
  onPushPull?: (phase: 'begin' | 'preview' | 'commit' | 'cancel', next: VenueGeometry, bypass: boolean) => void;
};
