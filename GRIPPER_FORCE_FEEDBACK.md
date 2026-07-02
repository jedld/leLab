# Gripper force feedback (teleoperation)

Optional haptic feedback for SO-101 leader–follower teleoperation. When enabled, the **leader gripper only** resists squeezing past the point where the **follower** has stopped on a grasped object.

Arm joints stay back-drivable (torque off) at all times; only the leader gripper motor is powered when feedback is active.

## Scope: LeRobot vs LeLab

**[LeRobot](https://github.com/huggingface/lerobot)** supports many robot platforms (Koch, OMX, OpenArm, Unitree G1, Reachy, and more).

**LeLab teleoperation** is currently implemented only for **SO leader/follower arms** (SO-100, SO-101, and SO-10X variants sharing the same `so_leader` / `so_follower` stack). Gripper force feedback is further limited to that family because it relies on STS3215 Feetech `Present_Load` sensing and the leader–follower gripper architecture.

`GET /teleoperation-capabilities` reports whether gripper force feedback is available in this build. The landing-page checkbox is hidden when unsupported. `POST /move-arm` rejects `gripper_force_feedback: true` on unsupported hardware.

## Enabling in the UI

1. On the **Landing** page, select a configured robot.
2. Check **Gripper force feedback** above the **Teleoperation** button.
3. Start teleoperation as usual.

In dev mode, use the Vite UI at `http://localhost:8080` so you see the latest frontend. The production bundle on `:8000` is rebuilt by CI when `frontend/` changes merge to `main`.

## API

`POST /move-arm` accepts two optional fields on `TeleoperateRequest`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `gripper_force_feedback` | `bool` | `false` | Enable gripper-only force feedback |
| `gripper_force_feedback_gain` | `float` | `1.0` | Resistance strength multiplier (0.1–3.0) |

`GET /teleoperation-capabilities` returns:

- `robot_family` — LeLab teleop stack id (currently `so_leader_follower`)
- `robot_family_label` — human-readable hardware family
- `gripper_force_feedback` — whether gripper haptics are supported

`GET /teleoperation-status` includes:

- `gripper_force_feedback` — whether feedback was enabled for the active session
- `stop_reason` — why the session ended (user stop, communication errors, etc.)

## How it works

Each control-loop iteration (when feedback is enabled):

1. Read follower gripper `Present_Load` and `Present_Position`.
2. Read leader gripper `Present_Position`.
3. Decide whether to apply feedback:

| Condition | Feedback |
|-----------|----------|
| Follower load below deadband (~20) | **Off** — no grasp detected |
| Leader within ~2 units of follower position | **Off** — arms in sync |
| Leader squeezed **past** follower position while loaded | **On** — virtual wall at follower position |
| Leader moving back toward follower (releasing) | **Off** — no resistance while opening |

When active, torque is enabled on the **leader gripper only**. The motor goal is set to the follower’s current gripper position (a virtual wall). Resistance torque scales with how far the leader is past that wall and with `gripper_force_feedback_gain`.

When inactive, leader gripper torque is disabled so the trigger stays free to move.

## Teleoperation robustness

Related changes in the same module improve session stability:

- **Transient serial errors** — the loop tolerates up to 50 consecutive bus read/write failures before disconnecting.
- **Unexpected session end** — the teleoperation page polls `/teleoperation-status` every 2s and shows a toast with `stop_reason` if the backend worker exits.
- **bfcache** — `pagehide` no longer stops teleoperation when the page is cached for back-navigation (`event.persisted`).

## Tuning constants

Defined at the top of [`lelab/teleoperate.py`](lelab/teleoperate.py):

| Constant | Default | Effect |
|----------|---------|--------|
| `_GRIPPER_LOAD_DEADBAND` | `20` | Minimum follower load to treat as a grasp |
| `_GRIPPER_POSITION_MARGIN` | `2.0` | Leader–follower gap before resistance starts (RANGE_0_100 units) |
| `_GRIPPER_MAX_OVERSHOOT` | `15.0` | Overshoot at which torque saturates |
| `_GRIPPER_RELEASE_HYSTERESIS` | `1.0` | Leader motion toward follower that counts as releasing |
| `_GRIPPER_TORQUE_LIMIT_MIN` / `MAX` | `150` / `450` | Leader gripper torque cap range |

## Limitations

- **Gripper only** — no arm-joint haptics; the leader arm stays limp by design.
- **Proxy sensing** — uses motor load and position, not a fingertip force sensor.
- **Calibration** — leader and follower gripper positions must be comparable (same RANGE_0_100 normalization after calibration).
- **Feel quality** — depends on leader gripper gearing (1/147 on SO-101); expect approximate feedback, not industrial haptics.

## Tests

Pure logic is covered in `tests/test_teleoperate.py` (`_gripper_feedback_targets`). Run:

```bash
pytest tests/test_teleoperate.py -q
```
