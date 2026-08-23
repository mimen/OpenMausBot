import {
  openMausChecklistBinding,
  openMausMetricsBinding,
  openMausQuoteBinding,
  openMausRecordBinding,
  type OpenMausBinding,
} from "@mimen/generative-ui-pack/openmaus";

export type ComponentVersion = {
  componentId: string;
  viewVersion: number;
};

export const SHARED_READ_ONLY_BINDINGS: readonly OpenMausBinding[] = [
  openMausRecordBinding,
  openMausMetricsBinding,
  openMausChecklistBinding,
  openMausQuoteBinding,
];

export const LEGACY_COMPONENT_ALIASES = {
  [openMausRecordBinding.legacyToolNames[0]]: {
    componentId: openMausRecordBinding.componentId,
    viewVersion: openMausRecordBinding.viewVersion,
  },
  [openMausMetricsBinding.legacyToolNames[0]]: {
    componentId: openMausMetricsBinding.componentId,
    viewVersion: openMausMetricsBinding.viewVersion,
  },
  [openMausChecklistBinding.legacyToolNames[0]]: {
    componentId: openMausChecklistBinding.componentId,
    viewVersion: openMausChecklistBinding.viewVersion,
  },
  [openMausQuoteBinding.legacyToolNames[0]]: {
    componentId: openMausQuoteBinding.componentId,
    viewVersion: openMausQuoteBinding.viewVersion,
  },
} as const satisfies Record<string, ComponentVersion>;

export function componentVersionForToolName(name: string): ComponentVersion | undefined {
  return Object.prototype.hasOwnProperty.call(LEGACY_COMPONENT_ALIASES, name)
    ? LEGACY_COMPONENT_ALIASES[name as keyof typeof LEGACY_COMPONENT_ALIASES]
    : undefined;
}
