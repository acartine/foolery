import type {
  SessionRuntimeLifecycleEvent,
} from "@/lib/agent-session-runtime";
import type {
  PromptDispatchHooks,
  PromptDeliveryTransport,
} from "@/lib/session-prompt-delivery";
import type {
  TakeLoopContext,
} from "@/lib/terminal-manager-take-loop";
import {
  recordTakeLoopLifecycle,
  runtimePreview,
} from "@/lib/terminal-manager-take-lifecycle";

export function createPromptDispatchHooks(
  transport: PromptDeliveryTransport,
  emit: (event: SessionRuntimeLifecycleEvent) => void,
): PromptDispatchHooks {
  return {
    onDeferred: (reason) => {
      emit({
        type: "prompt_delivery_deferred",
        transport,
        reason,
      });
    },
    onAttempted: () => {
      emit({
        type: "prompt_delivery_attempted",
        transport,
      });
    },
    onSucceeded: () => {
      emit({
        type: "prompt_delivery_succeeded",
        transport,
      });
    },
    onFailed: (reason) => {
      emit({
        type: "prompt_delivery_failed",
        transport,
        reason,
      });
    },
  };
}

export function createTakeLoopRuntimeLifecycleHandler(
  ctx: TakeLoopContext,
  beatState?: string,
): (event: SessionRuntimeLifecycleEvent) => void {
  return (event) => {
    if (handlePromptDispatchEvent(ctx, beatState, event)) {
      return;
    }
    handleRuntimeObservationEvent(
      ctx,
      beatState,
      event,
    );
  };
}

function handlePromptDispatchEvent(
  ctx: TakeLoopContext,
  beatState: string | undefined,
  event: SessionRuntimeLifecycleEvent,
): boolean {
  if (!isPromptDeliveryEvent(event)) {
    return false;
  }
  const details = {
    claimedState: beatState,
    promptDeliveryTransport:
      event.transport,
  };
  if (event.type === "prompt_delivery_deferred") {
    recordTakeLoopLifecycle(
      ctx,
      "prompt_delivery_deferred",
      {
        ...details,
        promptDeliveryDeferredReason:
          event.reason,
      },
    );
    return true;
  }
  if (event.type === "prompt_delivery_failed") {
    recordTakeLoopLifecycle(
      ctx,
      "prompt_delivery_failed",
      {
        ...details,
        promptDeliveryFailure: event.reason,
      },
    );
    return true;
  }
  recordTakeLoopLifecycle(
    ctx,
    event.type,
    details,
  );
  return true;
}

function isPromptDeliveryEvent(
  event: SessionRuntimeLifecycleEvent,
): event is Extract<
  SessionRuntimeLifecycleEvent,
  { transport: PromptDeliveryTransport }
> {
  return event.type.startsWith("prompt_delivery_");
}

function handleRuntimeObservationEvent(
  ctx: TakeLoopContext,
  beatState: string | undefined,
  event: SessionRuntimeLifecycleEvent,
): void {
  switch (event.type) {
    case "stdout_observed":
      recordTakeLoopLifecycle(
        ctx,
        "stdout_observed",
        {
          claimedState: beatState,
          firstStdoutPreview: runtimePreview(
            event.preview ?? "",
          ),
        },
      );
      break;
    case "stderr_observed":
      recordTakeLoopLifecycle(
        ctx,
        "stderr_observed",
        {
          claimedState: beatState,
          firstStderrPreview: runtimePreview(
            event.preview ?? "",
          ),
        },
      );
      break;
    case "response_logged":
      recordTakeLoopLifecycle(
        ctx,
        "response_logged",
        {
          claimedState: beatState,
          firstResponsePreview: runtimePreview(
            event.rawLine,
          ),
        },
      );
      break;
    case "normalized_event_observed":
      recordTakeLoopLifecycle(
        ctx,
        "normalized_event_observed",
        {
          claimedState: beatState,
          firstNormalizedEventType:
            event.eventType,
        },
      );
      break;
    case "result_observed":
      recordTakeLoopLifecycle(
        ctx,
        "result_observed",
        {
          claimedState: beatState,
          resultIsError: event.isError,
        },
      );
      break;
    case "prompt_delivery_deferred":
    case "prompt_delivery_attempted":
    case "prompt_delivery_succeeded":
    case "prompt_delivery_failed":
      break;
  }
}
