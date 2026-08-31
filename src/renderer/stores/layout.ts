// Lightweight layout signal store — lets any component react to chrome
// state (e.g. the notifications/activity panel) without prop drilling.
import { create } from 'zustand';

interface LayoutState {
  activityPanelOpen: boolean;
  setActivityPanelOpen: (open: boolean) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  activityPanelOpen: false,
  setActivityPanelOpen: (open) => set({ activityPanelOpen: open }),
}));
