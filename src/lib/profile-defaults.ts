import type { MemoryWorkflowDescriptor } from "@/lib/types";
import { normalizeProfileId } from "@/lib/workflows";

/** Outcome of resolving the default workflow profile for new beat creation. */
export interface ProfileDefaultResolution {
  /**
   * Workflow id to pre-select when creating a beat. Derived from
   * the live workflow list and never contains a hardcoded profile name.
   * `undefined` when no workflows are available.
   */
  selectedProfileId: string | undefined;
  /**
   * Normalized id of the profile saved in settings, or `null` when no
   * default is configured.
   */
  savedProfileId: string | null;
  /**
   * `true` when a default is saved in settings but no live workflow with
   * that id is present. Callers should surface a visible error and avoid
   * silently substituting another profile.
   */
  savedProfileStale: boolean;
}

function descriptorProfileKey(
  workflow: MemoryWorkflowDescriptor,
): string {
  return (workflow.profileId ?? workflow.id).trim().toLowerCase();
}

/**
 * Resolve which profile id to pre-select for new beat creation given
 * the live workflow descriptors and the saved default from settings.
 *
 * Matching uses canonical profile ids from the descriptors returned by
 * `listWorkflows()` / `kno profile list`; no hardcoded profile names are
 * introduced. When the saved default does not match any live workflow,
 * the resolver reports the situation as stale rather than silently
 * substituting another profile — callers decide what to render.
 *
 * When no default is configured, the fallback is the first descriptor in
 * the live workflow list. This preserves the historical behaviour of
 * "use whatever the backend exposes first" without naming a profile.
 */
export function resolveDefaultProfile(
  workflows: ReadonlyArray<MemoryWorkflowDescriptor>,
  savedProfileId: string | null | undefined,
): ProfileDefaultResolution {
  const normalizedSaved = normalizeProfileId(savedProfileId);
  const liveFallback = workflows[0]?.id;

  if (!normalizedSaved) {
    return {
      selectedProfileId: liveFallback,
      savedProfileId: null,
      savedProfileStale: false,
    };
  }

  const matched = workflows.find(
    (w) => descriptorProfileKey(w) === normalizedSaved,
  );
  if (matched) {
    return {
      selectedProfileId: matched.id,
      savedProfileId: normalizedSaved,
      savedProfileStale: false,
    };
  }
  return {
    selectedProfileId: liveFallback,
    savedProfileId: normalizedSaved,
    savedProfileStale: true,
  };
}
