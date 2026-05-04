# Training Page Simplification — Design

**Date:** 2026-05-04
**Status:** Approved
**Scope:** Frontend only (no backend changes)

## Problem

The Training page currently shows 8 configuration cards in a 2-column grid (~30 input fields), giving every field equal visual weight. The single required input — Dataset Repo ID — is one card among many, and large sections (Env & Eval, simulator-specific) don't apply to LeLab's SO-101 leader/follower hardware target. Many other fields are power-user knobs whose defaults are correct for typical use.

## Goal

- Remove configuration that doesn't apply to SO-101 or that's never used in practice.
- Demote power-user knobs into a single collapsible "Advanced" section so the page is small and focused on first load.
- Strengthen the visual hierarchy so the required dataset input is clearly the primary control.
- Keep the change frontend-only — backend Pydantic defaults already cover removed fields.

## Field disposition

### Essentials (always visible)

| Field | Notes |
|---|---|
| `dataset_repo_id` | Required. Hero input, full-width row at top of card. |
| `policy_type` | Select (ACT, Diffusion, PI0, SmolVLA, TD-MPC, VQ-BeT, PI0 Fast, SAC, Reward Classifier). |
| `steps` | Number input. |
| `batch_size` | Number input. |
| `wandb_enable` | Toggle. When on, a `wandb_project` text input appears below the essentials grid. |

### Advanced (collapsible, hidden by default)

Grouped within a single card by subheading + divider — no nested sub-cards, no icon squares.

- **Policy** — `policy_device`, `policy_use_amp`
- **Training** — `seed`, `num_workers`
- **Optimizer** — `optimizer_type`, `optimizer_lr`, `optimizer_weight_decay`, `optimizer_grad_clip_norm`
- **Logging** — `log_freq`, `save_freq`, `output_dir`, `job_name`, `save_checkpoint`, `resume`
- **W&B** (only when `wandb_enable=true`) — `wandb_entity`, `wandb_notes`, `wandb_mode`, `wandb_disable_artifact`
- **Misc** — `use_policy_training_preset`

### Removed entirely

These come off the UI. The backend's Pydantic model already has correct defaults, so omitting them from the request body is a no-op on the server.

| Field | Why |
|---|---|
| `dataset_revision` | Rarely used; users overwhelmingly want HEAD. |
| `dataset_root` | Rarely used; default cache path is right. |
| `dataset_episodes` | No UI ever set it; dead. |
| `env_type` | Simulator-only (Aloha, PushT, XArm, Gym, HIL) — irrelevant to SO-101 real hardware. |
| `env_task` | Simulator-only. |
| `eval_freq` | Defaults to `0` → eval never runs. |
| `eval_n_episodes` | Eval is off; dead UI. |
| `eval_batch_size` | Same. |
| `eval_use_async_envs` | Same. |
| `wandb_run_id` | Used for resuming a specific W&B run; out of scope for typical use. |
| `config_path` | Power-user escape hatch that conflicts with the rest of the form; rarely correct. |

## Architecture

### File changes

**Edited**
- [`frontend/src/pages/Training.tsx`](frontend/src/pages/Training.tsx) — strip removed-field initialisers from `useState<TrainingConfig>(...)`. The JSON body sent to `POST /start-training` no longer includes removed fields; backend defaults apply.
- [`frontend/src/components/training/ConfigurationTab.tsx`](frontend/src/components/training/ConfigurationTab.tsx) — replace the 8-card grid with a vertical stack: one `EssentialsCard`, one `AdvancedCard`.
- [`frontend/src/components/training/types.ts`](frontend/src/components/training/types.ts) — remove deleted fields from the `TrainingConfig` interface.

**New**
- `frontend/src/components/training/config/EssentialsCard.tsx`
- `frontend/src/components/training/config/AdvancedCard.tsx`

**Deleted**
- `frontend/src/components/training/config/DatasetConfig.tsx`
- `frontend/src/components/training/config/PolicyConfig.tsx`
- `frontend/src/components/training/config/TrainingParams.tsx`
- `frontend/src/components/training/config/OptimizerConfig.tsx`
- `frontend/src/components/training/config/LoggingConfig.tsx`
- `frontend/src/components/training/config/WandbConfig.tsx`
- `frontend/src/components/training/config/EnvEvalConfig.tsx`
- `frontend/src/components/training/config/AdvancedConfig.tsx`

**Untouched**
- `app/training.py` and all other backend code.
- `TrainingHeader.tsx`, `TrainingTabs.tsx`, `TrainingControls.tsx`, `MonitoringTab.tsx`, `monitoring/*`.

### Component responsibilities

**`EssentialsCard`** — `{ config, updateConfig }` props (same `ConfigComponentProps` shape as today's cards). Renders the Run Configuration card:
- Dataset row (full-width input + helper text).
- 2-column grid: Policy select, Steps input, Batch Size input, W&B enable toggle.
- When `config.wandb_enable === true`, render a full-width `wandb_project` input below the grid.

**`AdvancedCard`** — same props. Manages its own `expanded: boolean` local state. Header shows "Advanced" + a chevron button. When expanded, body renders the six grouped subsections separated by `<Separator />` (or equivalent) + a small `<h3>`-style subheading. The W&B subsection is only mounted when `config.wandb_enable === true`.

### Visual conventions

Both cards use the existing `Card` / `CardHeader` / `CardTitle` / `CardContent` primitives and the `bg-slate-800/50 border-slate-700 rounded-xl` styling from current cards, so the page stays visually consistent with Recording / Calibration. The icon-in-rounded-square decoration that today's cards carry is dropped — the goal is fewer visual blocks, not more.

## Data flow

Unchanged from today:
1. `Training.tsx` owns `trainingConfig` in `useState`.
2. `updateConfig` passed down to both cards (and grandchild fields).
3. `handleStartTraining` POSTs `trainingConfig` to `/start-training`.
4. Polling, logs, controls, and the Monitoring tab are untouched.

## Error handling

- Required-field validation is unchanged: Start Training is disabled while `dataset_repo_id` is empty; toast on submit failure.
- `AdvancedCard.expanded` is local-only and resets on tab change/navigation. This is intentional — no need to persist.

## Out of scope

- Backend cleanup (e.g. dropping the now-unused fields from `TrainingRequest`). The Pydantic model can keep them with their defaults; touching it would force a separate compatibility check and isn't needed to satisfy the user-facing goal.
- Changes to the Monitoring tab, header, or floating Start/Stop button.
- Persisting Advanced expansion state across navigations.
- Adding new fields or new policy types.

## Acceptance

- Page on first load shows two cards: Run Configuration (with 5 essentials visible, W&B project conditional) and Advanced (collapsed).
- Expanding Advanced reveals the listed groups, each with the listed fields.
- Starting training with only essentials filled in succeeds and produces the same backend behaviour as today's defaults for the removed fields.
- W&B entity/notes/mode/disable-artifact only appear under Advanced when `wandb_enable=true`.
- All eight old config files are deleted; no dangling imports.
