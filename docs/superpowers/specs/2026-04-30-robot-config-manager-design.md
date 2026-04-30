# Robot Config Manager — Design

**Date:** 2026-04-30
**Status:** Approved (pending implementation)

## Goal

Replace the current "Select Robot Model" radio on the Landing page with a robot configuration manager. Users currently re-enter ports and pick calibration files in every modal (Teleoperation, Recording, Calibration page) — repeated friction across steps. The new manager lets users configure a robot once and reuse it.

## Non-goals (this round)

- Recording, Replay, Training, and Inference flows are unchanged. They keep their existing modals and use the existing single-value `saved_configs/{leader,follower}_config.txt` and `ports/{leader,follower}_port.txt`. A follow-up will migrate them to the new pattern.
- Multi-model support (LeKiwi, etc.). The data model stays SO101-only; we'll add a `model` field when a second model actually ships.
- Concurrent multi-robot operation. The backend's "one active feature at a time" constraint is unchanged.
- Versioning, multi-tab conflict resolution beyond last-write-wins.

## Data model

### On disk

One JSON file per robot at `~/.cache/huggingface/lerobot/robots/<name>.json`:

```json
{
  "name": "left-arm",
  "leader_port": "/dev/tty.usbmodem5A460816421",
  "follower_port": "/dev/tty.usbmodem5A460816621",
  "leader_config": "left-arm-leader.json",
  "follower_config": "left-arm-follower.json"
}
```

- All four operational fields are optional. Missing values are persisted as empty strings, not absent — keeps reads simple.
- `name` is the source of truth for the filename. Filesystem enforces uniqueness.
- Names containing `/`, `\`, `..`, or empty strings are rejected at the API layer.

### "Clean" / Ready check

A robot is **clean** (Teleop button enabled, status text "Ready") when all of the following hold:

1. All four operational fields are non-empty strings.
2. `<LEADER_CONFIG_PATH>/<leader_config>` exists on disk.
3. `<FOLLOWER_CONFIG_PATH>/<follower_config>` exists on disk.

Any other state → status text "Needs configuration" and Teleop button rendered red and disabled.

### In browser localStorage

`lelab.visibleRobots` — a string array of robot names currently shown as tiles on the Landing page.

- Refresh restores the same set of tiles.
- The X (session remove) drops a name from this list; the JSON file is untouched.
- The trash icon deletes the JSON file *and* drops the name from this list.
- On Landing mount, after `GET /robots` resolves, names in `visibleRobots` whose files no longer exist are pruned from the list. Prevents ghost tiles after deletion in another tab.

### What does *not* change

- Existing `~/.cache/huggingface/lerobot/saved_configs/{leader,follower}_config.txt` and `ports/{leader,follower}_port.txt` are untouched. They keep serving the Record/Replay/Inference modals.
- Existing `LEADER_CONFIG_PATH` / `FOLLOWER_CONFIG_PATH` and the `setup_calibration_files` flow are untouched.
- The current `RobotModelSelector` radio is removed from Landing entirely. SO101 is implicit. The `robotModel` state in `Landing.tsx` and the `robotModel` prop on `ActionList` are removed.

## Backend

### `app/config.py` — new helpers

Mirror the existing port helpers' pattern (`save_robot_port`, `get_saved_robot_port`):

```python
ROBOTS_PATH = os.path.expanduser("~/.cache/huggingface/lerobot/robots")

def save_robot_record(name: str, data: dict) -> None
def get_robot_record(name: str) -> dict | None
def list_robot_records() -> list[dict]
def delete_robot_record(name: str) -> bool
def is_robot_record_clean(record: dict) -> bool
```

- `save_robot_record` performs an upsert with **merge semantics**: it loads the existing record (if any), merges the provided partial dict on top, and writes the result. This lets the Calibration page patch a single field (e.g. just `leader_config` and `leader_port`) without clobbering the other side. Creates `ROBOTS_PATH` directory on first write.
- If `save_robot_record` is called for a name that no longer exists on disk and is being recreated **as a side effect** of a calibration write-back (see below), it logs and silently no-ops. Concretely: `save_robot_record(name, data, allow_create=True)` for the explicit POST endpoint, `allow_create=False` for the calibration write-back path.
- `is_robot_record_clean` checks all four fields plus existence at `LEADER_CONFIG_PATH/<leader_config>` and `FOLLOWER_CONFIG_PATH/<follower_config>`.

### `app/main.py` — new endpoints

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/robots` | — | `{ robots: [{name, leader_port, follower_port, leader_config, follower_config, is_clean}] }` |
| GET | `/robots/{name}` | — | full record + `is_clean`; 404 if missing |
| POST | `/robots/{name}` | partial record `{leader_port?, follower_port?, leader_config?, follower_config?}` | upsert with merge; 400 on invalid name; 409 if creating a name that already exists *and* the request is the "create empty" path (see below) |
| DELETE | `/robots/{name}` | — | `{ status: "success" }`; 404 if missing |

The POST endpoint serves two callers:

1. **"Create empty"** (frontend Add Robot button): body is `{}`. If a record with that name exists, return 409 so the frontend can prompt to pick from the dropdown instead.
2. **"Patch existing"** (calibration write-back): body has populated fields. Always merge; if no record exists with that name, no-op (logged) and return success — see "Edge case: deletion-during-calibration" below.

These two behaviors are distinguished by a `?create=true` query parameter (frontend sets it for the Add flow; calibration write-back omits it).

### Calibration round-trip integration

The only change to the calibration flow:

- `CalibrationRequest` (in `app/calibrating.py`) gets an optional field: `robot_name: str | None = None`.
- The frontend Calibration page passes `robot_name` when arriving via the gear button on a tile.
- When a calibration session completes successfully **and** `robot_name` is set, the calibration completion handler calls `save_robot_record(robot_name, {...}, allow_create=False)` with the just-completed side's port and config filename. Specifically:
  - For `device_type == "teleop"` (leader): `{leader_port: <port>, leader_config: <new_filename>}`
  - For `device_type == "robot"` (follower): `{follower_port: <port>, follower_config: <new_filename>}`

No changes to teleop, recording, replay, or training endpoints.

## Frontend

### New components (under `frontend/src/components/landing/`)

- **`RobotConfigManager.tsx`** — replaces `RobotModelSelector` on Landing. Mirrors `CameraConfiguration`'s structure: section header, `AddRobotPicker` row, grid of `RobotTile`s, empty-state hint when no tiles are visible.
- **`RobotTile.tsx`** — one tile per robot. Renders:
  - Name (top-left).
  - Status text below the name: "Ready" or "Needs configuration".
  - Gear icon (top-right corner) → navigates to `/calibration` with `robot_name` in route state.
  - Large Teleop button. Enabled (yellow, like today's Teleop action) when clean; disabled with red styling when not clean. Tooltip on disabled state: "Configure the robot first."
  - X button (small, top-right next to gear) → session remove.
  - Trash button (small, top-right next to X, red) → confirm modal → DELETE.
- **`AddRobotPicker.tsx`** — dropdown + free-text input + `+ Add Robot` button. Same UX shape as the camera picker (`CameraConfiguration` lines 411–474). Dropdown lists robots that exist on disk but are not currently in `visibleRobots` (so users can re-add hidden robots without retyping). Free-text input creates a new robot.

### New hook `useRobots.ts`

- Internal state:
  - `records: Record<string, RobotRecord>` — all known robots, keyed by name. Hydrated from `GET /robots` in a `useEffect` keyed on `useLocation().key`, so each navigation back to Landing re-fetches.
  - `visibleNames: string[]` — bound to `localStorage.lelab.visibleRobots`.
- Actions:
  - `addToSession(name)` — append to `visibleNames` if not already present.
  - `removeFromSession(name)` — drop from `visibleNames`. File untouched.
  - `createRobot(name)` — `POST /robots/<name>?create=true` with empty body, then `addToSession`. Surfaces 409 as a toast.
  - `deleteRobot(name)` — `DELETE /robots/<name>`, then drop from `visibleNames` and from `records`.
- Persists `visibleNames` to localStorage on every change via a small effect.

### Landing page changes (`pages/Landing.tsx`)

- Replace `<RobotModelSelector>` with `<RobotConfigManager>`.
- Drop the `robotModel` state. `ActionList` no longer gates on a model — change its disabled prop to `false` (or remove the gate entirely).
- Remove the `TeleoperationModal` mount and its associated state: `leaderPort`, `followerPort`, `leaderConfig`, `followerConfig`, `leaderConfigs`, `followerConfigs`, `isLoadingConfigs`, `showTeleoperationModal`, `handleTeleoperationClick`, `handleStartTeleoperation`, the `loadConfigs()` function (still needed for `RecordingModal`, so keep it but only call it from the recording handler).
- Remove the "Teleoperation" entry from the `actions` array passed to `ActionList`. Teleop now lives on each tile.
- Refresh robot records when Landing is navigated back to. `useRobots` runs `GET /robots` in a `useEffect` keyed on `useLocation().key`, so any return to `/` (back button or programmatic `navigate`) re-hydrates every record. This is reliable regardless of whether the SPA unmounted Landing during the side trip. One `GET /robots` on each visit is cheap.

### Calibration page changes (`pages/Calibration.tsx`)

- Read `robot_name` from `useLocation().state` on mount. If present:
  - `GET /robots/<robot_name>` to fetch the record.
  - Pre-fill `port` from leader_port or follower_port depending on the default `deviceType` choice.
  - Pre-fill `configFile` similarly.
  - Default `deviceType`: if `leader_config` is empty and `follower_config` is not → "robot" (follower); otherwise "teleop" (leader). Falls back to "teleop" if both are empty.
  - When the user toggles `deviceType`, swap the pre-filled port and config to the appropriate side.
  - Pass `robot_name` in the body of `CalibrationRequest`.
- If absent: page works exactly as today.

### Tile interactions (summary)

| Action | Behavior |
|---|---|
| Click gear | `navigate("/calibration", { state: { robot_name: name } })` |
| Click Teleop (clean) | POST `/move-arm` with stored fields → `navigate("/teleoperation")` (existing flow) |
| Click Teleop (not clean) | Disabled, tooltip "Configure the robot first." |
| Click X | `removeFromSession(name)` |
| Click trash | confirm modal → `deleteRobot(name)` |

## Edge cases

- **Name collision on Add Robot:** POST returns 409 → toast: "A robot named `<x>` already exists — pick it from the dropdown or choose a different name."
- **Stale localStorage:** prune `visibleNames` against `GET /robots` response on mount.
- **Calibration file deleted manually:** `is_clean` returns false even when the record's filename field is populated. Tile shows "Needs configuration"; gear → `/calibration` re-creates the file.
- **Calibration page entered without `robot_name`:** UX identical to today; no write-back occurs.
- **Robot deleted from another tab while user is on Calibration page for it:** write-back's `allow_create=False` makes it a logged no-op. The calibration JSON is still produced (lives in `LEADER_CONFIG_PATH` / `FOLLOWER_CONFIG_PATH`); only the robot-record linkage is dropped. Tile is gone.
- **Concurrent edits across tabs:** last write wins. No versioning.
- **Teleop click race (one feature already active):** existing backend returns its existing error; surface as toast.
- **Empty robot list on first ever launch:** `RobotConfigManager` shows the picker plus an empty-state hint: "No robots configured. Add one to get started."
- **Existing users:** no automatic migration. Their `saved_configs/*_config.txt` and `ports/*_port.txt` keep serving Record/Replay/Inference. They add their first robot via the new flow when they want Calibration or Teleop.

## File-level change list

**New files:**
- `frontend/src/components/landing/RobotConfigManager.tsx`
- `frontend/src/components/landing/RobotTile.tsx`
- `frontend/src/components/landing/AddRobotPicker.tsx`
- `frontend/src/hooks/useRobots.ts`

**Modified:**
- `app/config.py` — add `ROBOTS_PATH`, `save_robot_record`, `get_robot_record`, `list_robot_records`, `delete_robot_record`, `is_robot_record_clean`.
- `app/main.py` — add four `/robots` endpoints.
- `app/calibrating.py` — add `robot_name` to `CalibrationRequest`; call `save_robot_record(..., allow_create=False)` on successful completion when `robot_name` is set.
- `frontend/src/pages/Landing.tsx` — replace `RobotModelSelector` use, drop teleop modal/state, drop "Teleoperation" action, add visibility-change refresh.
- `frontend/src/pages/Calibration.tsx` — accept `robot_name` from route state, pre-fill from record, pass through to API.

**Deleted:**
- `frontend/src/components/landing/RobotModelSelector.tsx` (no longer used).
- `frontend/src/components/landing/TeleoperationModal.tsx` (no longer used; teleop now goes through the tile).

## Out of scope (follow-up work)

- Migrate Recording, Replay, Training, Inference modals to a "Robot" dropdown that selects a saved robot. Tracking item to be opened after this lands.
- Multi-model support (`model` field in the record).
