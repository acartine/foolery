#!/usr/bin/env bash

# Shared bundled dispatch target metadata for setup and install wizards.

DISPATCH_WORKFLOW_BUNDLE_ID="work_sdlc"

DISPATCH_LEGACY_SETTINGS_TARGET_IDS=(
  orchestration
  planning
  plan_review
  implementation
  implementation_review
  shipment
  shipment_review
  scope_refinement
)

DISPATCH_WORKFLOW_TARGET_IDS=(
  work_sdlc__autopilot__planning
  work_sdlc__autopilot__plan_review
  work_sdlc__autopilot__implementation
  work_sdlc__autopilot__implementation_review
  work_sdlc__autopilot__shipment
  work_sdlc__autopilot__shipment_review
  work_sdlc__autopilot_with_pr__planning
  work_sdlc__autopilot_with_pr__plan_review
  work_sdlc__autopilot_with_pr__implementation
  work_sdlc__autopilot_with_pr__implementation_review
  work_sdlc__autopilot_with_pr__shipment
  work_sdlc__autopilot_with_pr__shipment_review
  work_sdlc__semiauto__planning
  work_sdlc__semiauto__plan_review
  work_sdlc__semiauto__implementation
  work_sdlc__semiauto__implementation_review
  work_sdlc__semiauto__shipment
  work_sdlc__semiauto__shipment_review
  work_sdlc__autopilot_no_planning__implementation
  work_sdlc__autopilot_no_planning__implementation_review
  work_sdlc__autopilot_no_planning__shipment
  work_sdlc__autopilot_no_planning__shipment_review
  work_sdlc__autopilot_with_pr_no_planning__implementation
  work_sdlc__autopilot_with_pr_no_planning__implementation_review
  work_sdlc__autopilot_with_pr_no_planning__shipment
  work_sdlc__autopilot_with_pr_no_planning__shipment_review
  work_sdlc__semiauto_no_planning__implementation
  work_sdlc__semiauto_no_planning__implementation_review
  work_sdlc__semiauto_no_planning__shipment
  work_sdlc__semiauto_no_planning__shipment_review
)

DISPATCH_GROUP_IDS=(
  shared__orchestration
  shared__scope_refinement
  work_sdlc__autopilot
  work_sdlc__autopilot_with_pr
  work_sdlc__semiauto
  work_sdlc__autopilot_no_planning
  work_sdlc__autopilot_with_pr_no_planning
  work_sdlc__semiauto_no_planning
)

_dispatch_group_label() {
  case "$1" in
    shared__orchestration) printf '%s' "Execution Planning" ;;
    shared__scope_refinement) printf '%s' "Scope Refinement" ;;
    work_sdlc__autopilot) printf '%s' "Autopilot" ;;
    work_sdlc__autopilot_with_pr) printf '%s' "Autopilot (PR)" ;;
    work_sdlc__semiauto) printf '%s' "Semiauto" ;;
    work_sdlc__autopilot_no_planning) printf '%s' "Autopilot (no planning)" ;;
    work_sdlc__autopilot_with_pr_no_planning) printf '%s' "Autopilot (PR, no planning)" ;;
    work_sdlc__semiauto_no_planning) printf '%s' "Semiauto (no planning)" ;;
    *) printf '%s' "$1" ;;
  esac
}

_dispatch_group_description() {
  case "$1" in
    shared__orchestration)
      printf '%s' "Shared bundled orchestration targets used before beat-level take execution"
      ;;
    shared__scope_refinement)
      printf '%s' "Shared bundled refinement targets used after beat creation"
      ;;
    work_sdlc__*)
      printf '%s bundled workflow targets' "$(_dispatch_group_label "$1")"
      ;;
    *)
      printf '%s' ""
      ;;
  esac
}

_dispatch_group_target_ids() {
  case "$1" in
    shared__orchestration)
      printf '%s\n' orchestration
      ;;
    shared__scope_refinement)
      printf '%s\n' scope_refinement
      ;;
    work_sdlc__autopilot)
      printf '%s\n' \
        work_sdlc__autopilot__planning \
        work_sdlc__autopilot__plan_review \
        work_sdlc__autopilot__implementation \
        work_sdlc__autopilot__implementation_review \
        work_sdlc__autopilot__shipment \
        work_sdlc__autopilot__shipment_review
      ;;
    work_sdlc__autopilot_with_pr)
      printf '%s\n' \
        work_sdlc__autopilot_with_pr__planning \
        work_sdlc__autopilot_with_pr__plan_review \
        work_sdlc__autopilot_with_pr__implementation \
        work_sdlc__autopilot_with_pr__implementation_review \
        work_sdlc__autopilot_with_pr__shipment \
        work_sdlc__autopilot_with_pr__shipment_review
      ;;
    work_sdlc__semiauto)
      printf '%s\n' \
        work_sdlc__semiauto__planning \
        work_sdlc__semiauto__plan_review \
        work_sdlc__semiauto__implementation \
        work_sdlc__semiauto__implementation_review \
        work_sdlc__semiauto__shipment \
        work_sdlc__semiauto__shipment_review
      ;;
    work_sdlc__autopilot_no_planning)
      printf '%s\n' \
        work_sdlc__autopilot_no_planning__implementation \
        work_sdlc__autopilot_no_planning__implementation_review \
        work_sdlc__autopilot_no_planning__shipment \
        work_sdlc__autopilot_no_planning__shipment_review
      ;;
    work_sdlc__autopilot_with_pr_no_planning)
      printf '%s\n' \
        work_sdlc__autopilot_with_pr_no_planning__implementation \
        work_sdlc__autopilot_with_pr_no_planning__implementation_review \
        work_sdlc__autopilot_with_pr_no_planning__shipment \
        work_sdlc__autopilot_with_pr_no_planning__shipment_review
      ;;
    work_sdlc__semiauto_no_planning)
      printf '%s\n' \
        work_sdlc__semiauto_no_planning__implementation \
        work_sdlc__semiauto_no_planning__implementation_review \
        work_sdlc__semiauto_no_planning__shipment \
        work_sdlc__semiauto_no_planning__shipment_review
      ;;
  esac
}

_dispatch_target_group_id() {
  case "$1" in
    orchestration) printf '%s' "shared__orchestration" ;;
    scope_refinement) printf '%s' "shared__scope_refinement" ;;
    work_sdlc__*__*)
      printf '%s' "${1%__*}"
      ;;
    planning|plan_review|implementation|implementation_review|shipment|shipment_review)
      printf '%s' "shared__legacy"
      ;;
    *)
      printf '%s' ""
      ;;
  esac
}

_dispatch_target_legacy_id() {
  case "$1" in
    orchestration|scope_refinement)
      printf '%s' "$1"
      ;;
    work_sdlc__*__planning)
      printf '%s' "planning"
      ;;
    work_sdlc__*__plan_review)
      printf '%s' "plan_review"
      ;;
    work_sdlc__*__implementation)
      printf '%s' "implementation"
      ;;
    work_sdlc__*__implementation_review)
      printf '%s' "implementation_review"
      ;;
    work_sdlc__*__shipment)
      printf '%s' "shipment"
      ;;
    work_sdlc__*__shipment_review)
      printf '%s' "shipment_review"
      ;;
    *)
      printf '%s' "$1"
      ;;
  esac
}

_dispatch_target_label() {
  case "$(_dispatch_target_legacy_id "$1")" in
    orchestration) printf '%s' "Orchestration" ;;
    planning) printf '%s' "Planning" ;;
    plan_review) printf '%s' "Plan Review" ;;
    implementation) printf '%s' "Implementation" ;;
    implementation_review) printf '%s' "Implementation Review" ;;
    shipment) printf '%s' "Shipment" ;;
    shipment_review) printf '%s' "Shipment Review" ;;
    scope_refinement) printf '%s' "Scope Refinement" ;;
    *) printf '%s' "$1" ;;
  esac
}

_dispatch_target_description() {
  case "$(_dispatch_target_legacy_id "$1")" in
    orchestration)
      printf '%s' "Execution plans, scenes, and other bundled orchestration runs"
      ;;
    planning)
      printf '%s' "Agent writes the implementation plan"
      ;;
    plan_review)
      printf '%s' "Agent reviews the plan for quality"
      ;;
    implementation)
      printf '%s' "Agent writes the code"
      ;;
    implementation_review)
      printf '%s' "Agent reviews the implementation"
      ;;
    shipment)
      printf '%s' "Agent handles shipping and deployment"
      ;;
    shipment_review)
      printf '%s' "Agent reviews the shipment"
      ;;
    scope_refinement)
      printf '%s' "Agent refines newly created beats after creation"
      ;;
    *)
      printf '%s' ""
      ;;
  esac
}
