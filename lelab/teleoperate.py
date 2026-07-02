# Copyright 2025 The HuggingFace Inc. team. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import logging
import math
import threading
import time
from typing import Any

from pydantic import BaseModel, Field

from lerobot.robots.so_follower import SO101Follower, SO101FollowerConfig
from lerobot.teleoperators.so_leader import SO101Leader, SO101LeaderConfig

from .utils.config import setup_calibration_files
from .utils.devices import safe_disconnect_device

logger = logging.getLogger(__name__)

# LeLab teleoperation is implemented for SO leader/follower arms only (SO-100/101/10X).
# LeRobot itself supports many other robot platforms; this constant gates SO-specific
# features until LeLab grows a per-robot hardware model.
LELAB_TELEOP_ROBOT_FAMILY = "so_leader_follower"

# sts3215 motor resolution; lerobot's _normalize uses (resolution - 1).
_STS3215_MAX_RES = 4095

# SO-101 URDF (so101_new_calib.urdf) is authored with the all-zeros pose at the
# arm's sleep position, not the "middle of range" pose where calibration's
# set_half_turn_homings is performed. To make the URDF track the real arm:
#   URDF_value = sign * (motor_normalized_deg - motor_at_urdf_zero_deg)
# where motor_at_urdf_zero_deg = (urdf_zero_ticks - mid) * 360 / max_res, and
# `urdf_zero_ticks` is the raw Present_Position when the robot is at sleep.
# That tick value is a property of the SO-101 mechanics + URDF design, so it's
# constant across calibrations as long as the user pressed ENTER at the "middle
# of range" pose during set_half_turn_homings.
# Joints not listed here use lerobot's default convention (URDF = motor).
_SO101_URDF_CORRECTIONS = {
    # motor_name: (sign, urdf_zero_present_position_ticks)
    "shoulder_lift": (+1, 3252),
    "elbow_flex": (+1, 1029),
}

_GRIPPER_MOTOR = "gripper"
# Present_Load magnitude (after bus decode) below which we assume no grasp.
_GRIPPER_LOAD_DEADBAND = 20.0
# Leader must be this far past the follower (RANGE_0_100) before resistance kicks in.
_GRIPPER_POSITION_MARGIN = 2.0
# Overshoot at which resistance reaches full strength.
_GRIPPER_MAX_OVERSHOOT = 15.0
# Leader moving back toward the follower by this much is treated as releasing.
_GRIPPER_RELEASE_HYSTERESIS = 1.0
_GRIPPER_TORQUE_LIMIT_MIN = 150
_GRIPPER_TORQUE_LIMIT_MAX = 450
# Serial glitches are common; only tear down after sustained failures.
_MAX_CONSECUTIVE_LOOP_ERRORS = 50
_LOOP_ERROR_BACKOFF_S = 0.01

# Global variables for teleoperation state
teleoperation_active = False
teleoperation_thread: threading.Thread | None = None
current_robot = None
current_teleop = None
gripper_force_feedback_active = False
teleoperation_stop_reason: str | None = None
_last_leader_gripper_pos: float | None = None
# Guards the start path; the worker owns disconnect so stop() does not race.
_state_lock = threading.Lock()


class TeleoperateRequest(BaseModel):
    leader_port: str
    follower_port: str
    leader_config: str
    follower_config: str
    gripper_force_feedback: bool = False
    gripper_force_feedback_gain: float = Field(default=1.0, ge=0.1, le=3.0)


def gripper_force_feedback_supported() -> bool:
    """Whether the current LeLab teleop stack supports gripper haptics."""
    return LELAB_TELEOP_ROBOT_FAMILY == "so_leader_follower"


def handle_teleoperation_capabilities() -> dict[str, Any]:
    """Report which teleoperation features apply to LeLab's configured hardware."""
    return {
        "robot_family": LELAB_TELEOP_ROBOT_FAMILY,
        "robot_family_label": "SO-100 / SO-101 leader–follower",
        "gripper_force_feedback": gripper_force_feedback_supported(),
        "message": "Teleoperation capabilities retrieved successfully",
    }


def get_joint_positions_from_robot(robot) -> dict[str, float]:
    """
    Extract current joint positions from the robot and convert to URDF joint format.

    Args:
        robot: The robot instance (SO101Follower)

    Returns:
        Dictionary mapping URDF joint names to radian values
    """
    motor_to_urdf_mapping = {
        "shoulder_pan": "Rotation",
        "shoulder_lift": "Pitch",
        "elbow_flex": "Elbow",
        "wrist_flex": "Wrist_Pitch",
        "wrist_roll": "Wrist_Roll",
        "gripper": "Jaw",
    }

    try:
        observation = robot.get_observation()
        calibration = robot.calibration or {}

        joint_positions: dict[str, float] = {}
        debug_rows = []
        for motor_name, urdf_joint_name in motor_to_urdf_mapping.items():
            motor_key = f"{motor_name}.pos"
            if motor_key not in observation:
                logger.warning(f"Motor {motor_key} not found in observation")
                joint_positions[urdf_joint_name] = 0.0
                continue

            raw_deg = observation[motor_key]
            angle_degrees = raw_deg
            correction = _SO101_URDF_CORRECTIONS.get(motor_name)
            if correction is not None and motor_name in calibration:
                sign, urdf_zero_ticks = correction
                cal = calibration[motor_name]
                mid = (cal.range_min + cal.range_max) / 2
                motor_at_urdf_zero = (urdf_zero_ticks - mid) * 360 / _STS3215_MAX_RES
                angle_degrees = sign * (raw_deg - motor_at_urdf_zero)

            joint_positions[urdf_joint_name] = angle_degrees * math.pi / 180.0
            debug_rows.append(
                f"{motor_name:14s} raw={raw_deg:+8.2f}° → {urdf_joint_name:11s} = {angle_degrees:+8.2f}°"
            )

        # Throttled debug print (~once per second at 20 Hz broadcast).
        now = time.time()
        if now - getattr(get_joint_positions_from_robot, "_last_log", 0) > 1.0:
            get_joint_positions_from_robot._last_log = now
            logger.info("[joint-debug]\n  " + "\n  ".join(debug_rows))

        return joint_positions

    except Exception as e:
        logger.error(f"Error getting joint positions: {e}")
        return dict.fromkeys(motor_to_urdf_mapping.values(), 0.0)


def _gripper_feedback_targets(
    follower_pos: float,
    leader_pos: float,
    follower_load: float,
    gain: float,
    prev_leader_pos: float | None,
) -> tuple[float, int, bool]:
    """Map follower grasp state to a leader goal and torque limit.

    Resistance only applies when the follower is loaded (grasping something) and
    the leader is being squeezed *past* the follower's current gripper position.
    Releasing — leader moving back toward the follower — disables feedback.
    """
    load = abs(follower_load)
    diff = leader_pos - follower_pos

    if prev_leader_pos is not None:
        prev_diff = prev_leader_pos - follower_pos
        if abs(diff) < abs(prev_diff) - _GRIPPER_RELEASE_HYSTERESIS:
            return leader_pos, _GRIPPER_TORQUE_LIMIT_MIN, False

    if load < _GRIPPER_LOAD_DEADBAND:
        return leader_pos, _GRIPPER_TORQUE_LIMIT_MIN, False

    overshoot = abs(diff)
    if overshoot <= _GRIPPER_POSITION_MARGIN:
        return leader_pos, _GRIPPER_TORQUE_LIMIT_MIN, False

    span = max(_GRIPPER_MAX_OVERSHOOT - _GRIPPER_POSITION_MARGIN, 1.0)
    overshoot_frac = min(1.0, (overshoot - _GRIPPER_POSITION_MARGIN) / span)
    # Virtual wall at the follower's achieved grip position.
    goal = min(100.0, max(0.0, follower_pos))
    torque_limit = int(
        _GRIPPER_TORQUE_LIMIT_MIN
        + overshoot_frac * gain * (_GRIPPER_TORQUE_LIMIT_MAX - _GRIPPER_TORQUE_LIMIT_MIN)
    )
    torque_limit = min(_GRIPPER_TORQUE_LIMIT_MAX, max(_GRIPPER_TORQUE_LIMIT_MIN, torque_limit))
    return goal, torque_limit, True


def _reset_gripper_force_feedback_state() -> None:
    global _last_leader_gripper_pos
    _last_leader_gripper_pos = None


def _setup_leader_gripper_force_feedback(teleop_device) -> None:
    """Tune the leader gripper for compliant resistance while arm joints stay limp."""
    bus = teleop_device.bus
    bus.write("P_Coefficient", _GRIPPER_MOTOR, 8)
    bus.write("I_Coefficient", _GRIPPER_MOTOR, 0)
    bus.write("D_Coefficient", _GRIPPER_MOTOR, 20)
    bus.disable_torque(motors=[_GRIPPER_MOTOR])


def _apply_gripper_force_feedback(robot, teleop_device, gain: float) -> None:
    """Resist closing the leader gripper past the follower's grasp position."""
    global _last_leader_gripper_pos

    bus_leader = teleop_device.bus
    bus_follower = robot.bus
    try:
        follower_load = bus_follower.sync_read("Present_Load", [_GRIPPER_MOTOR])[_GRIPPER_MOTOR]
        follower_pos = bus_follower.sync_read("Present_Position", [_GRIPPER_MOTOR])[_GRIPPER_MOTOR]
        leader_present = bus_leader.sync_read("Present_Position", [_GRIPPER_MOTOR])[_GRIPPER_MOTOR]
    except Exception as e:
        logger.debug("Gripper force feedback read failed: %s", e)
        return

    goal, torque_limit, active = _gripper_feedback_targets(
        follower_pos,
        leader_present,
        follower_load,
        gain,
        _last_leader_gripper_pos,
    )
    _last_leader_gripper_pos = leader_present
    try:
        if not active:
            bus_leader.disable_torque(motors=[_GRIPPER_MOTOR])
            return

        bus_leader.enable_torque(motors=[_GRIPPER_MOTOR])
        bus_leader.write("Torque_Limit", _GRIPPER_MOTOR, torque_limit)
        bus_leader.sync_write("Goal_Position", {_GRIPPER_MOTOR: goal})
    except Exception as e:
        logger.debug("Gripper force feedback write failed: %s", e)


def _teardown_leader_gripper_force_feedback(teleop_device) -> None:
    """Release leader gripper torque before disconnect."""
    _reset_gripper_force_feedback_state()
    try:
        teleop_device.bus.disable_torque(motors=[_GRIPPER_MOTOR])
    except Exception as e:
        logger.debug("Gripper force feedback teardown failed: %s", e)


def _safe_disconnect(device) -> None:
    """Disconnect a robot/teleop device, swallowing (but logging) any error.

    Used on the connection-failure cleanup path so one device's failure can't
    leave the other holding its serial port open.
    """
    safe_disconnect_device(device, logger)


def handle_start_teleoperation(request: TeleoperateRequest, websocket_manager=None) -> dict[str, Any]:
    """Handle start teleoperation request.

    Connects to both arms *synchronously* so that a connection failure (arm
    unplugged, port busy, power off) is reported back to the caller, rather than
    dying silently in the worker thread while the API has already claimed
    success. Only the teleoperation loop runs in the background thread.
    """
    global \
        teleoperation_active, \
        teleoperation_thread, \
        current_robot, \
        current_teleop, \
        gripper_force_feedback_active, \
        teleoperation_stop_reason

    from . import record as _record, rollout as _rollout

    if request.gripper_force_feedback and not gripper_force_feedback_supported():
        return {
            "success": False,
            "message": (
                "Gripper force feedback is only available for SO-100 / SO-101 "
                "leader–follower arms."
            ),
        }

    with _state_lock:
        if teleoperation_active:
            return {"success": False, "message": "Teleoperation is already active"}
        if _record.recording_active:
            return {"success": False, "message": "Recording is currently active. Stop it first."}
        if _rollout.inference_active:
            return {"success": False, "message": "Inference is currently active. Stop it first."}
        teleoperation_active = True
        teleoperation_stop_reason = None

    robot = None
    teleop_device = None
    try:
        logger.info(
            f"Starting teleoperation with leader port: {request.leader_port}, follower port: {request.follower_port}"
        )

        # Setup calibration files
        leader_config_name, follower_config_name = setup_calibration_files(
            request.leader_config, request.follower_config
        )

        # Create robot and teleop configs
        robot_config = SO101FollowerConfig(
            port=request.follower_port,
            id=follower_config_name,
        )

        teleop_config = SO101LeaderConfig(
            port=request.leader_port,
            id=leader_config_name,
        )

        # Connect synchronously. If either device fails to connect, clean up the
        # other (so its serial port is released) and report the error — do NOT
        # leave the caller thinking teleoperation started.
        logger.info("Initializing robot and teleop device...")
        robot = SO101Follower(robot_config)
        teleop_device = SO101Leader(teleop_config)

        # Connect each arm separately so the error names which one failed and
        # tells the user what to do, instead of a generic "failed to start".
        logger.info("Connecting to follower arm...")
        try:
            robot.bus.connect()
        except Exception as e:
            raise RuntimeError(
                f"Could not connect to the follower arm on {request.follower_port}. "
                "Make sure it's plugged in and powered on, then try again."
            ) from e

        logger.info("Connecting to leader arm...")
        try:
            teleop_device.bus.connect()
        except Exception as e:
            raise RuntimeError(
                f"Could not connect to the leader arm on {request.leader_port}. "
                "Make sure it's plugged in and powered on, then try again."
            ) from e

        # Write calibration to motors' memory
        logger.info("Writing calibration to motors...")
        robot.bus.write_calibration(robot.calibration)
        teleop_device.bus.write_calibration(teleop_device.calibration)

        # Connect cameras and configure motors
        logger.info("Connecting cameras and configuring motors...")
        for cam in robot.cameras.values():
            cam.connect()
        robot.configure()
        teleop_device.configure()
        if request.gripper_force_feedback:
            _setup_leader_gripper_force_feedback(teleop_device)
            _reset_gripper_force_feedback_state()
        logger.info("Successfully connected to both devices")

        current_robot = robot
        current_teleop = teleop_device
        gripper_force_feedback_active = request.gripper_force_feedback
        feedback_gain = request.gripper_force_feedback_gain

        # Stream the arms in the background; the worker owns disconnect so stop()
        # does not race the serial bus from the request thread.
        def teleoperation_worker():
            global \
                teleoperation_active, \
                current_robot, \
                current_teleop, \
                gripper_force_feedback_active, \
                teleoperation_stop_reason

            logger.info("Starting teleoperation loop...")
            consecutive_errors = 0
            try:
                last_broadcast_time = 0
                broadcast_interval = 0.05  # 20 FPS

                while teleoperation_active:
                    try:
                        action = teleop_device.get_action()
                        robot.send_action(action)
                        if request.gripper_force_feedback:
                            _apply_gripper_force_feedback(robot, teleop_device, feedback_gain)
                        consecutive_errors = 0
                    except Exception as e:
                        consecutive_errors += 1
                        logger.warning(
                            "Teleoperation loop error (%d/%d): %s",
                            consecutive_errors,
                            _MAX_CONSECUTIVE_LOOP_ERRORS,
                            e,
                        )
                        if consecutive_errors >= _MAX_CONSECUTIVE_LOOP_ERRORS:
                            teleoperation_stop_reason = (
                                f"Stopped after {_MAX_CONSECUTIVE_LOOP_ERRORS} consecutive "
                                f"communication errors: {e}"
                            )
                            logger.error(teleoperation_stop_reason, exc_info=True)
                            break
                        time.sleep(_LOOP_ERROR_BACKOFF_S)
                        continue

                    current_time = time.time()
                    if current_time - last_broadcast_time >= broadcast_interval:
                        try:
                            joint_positions = get_joint_positions_from_robot(robot)
                            joint_data = {
                                "type": "joint_update",
                                "joints": joint_positions,
                                "timestamp": current_time,
                            }
                            if websocket_manager and websocket_manager.active_connections:
                                websocket_manager.broadcast_joint_data_sync(joint_data)
                            last_broadcast_time = current_time
                        except Exception as e:
                            logger.error(f"Error broadcasting joint data: {e}")

                    time.sleep(0.001)
            except Exception as e:
                teleoperation_stop_reason = f"Unexpected teleoperation error: {e}"
                logger.error(teleoperation_stop_reason, exc_info=True)
            finally:
                if request.gripper_force_feedback:
                    _teardown_leader_gripper_force_feedback(teleop_device)
                _safe_disconnect(robot)
                _safe_disconnect(teleop_device)
                logger.info("Teleoperation stopped")
                teleoperation_active = False
                current_robot = None
                current_teleop = None
                gripper_force_feedback_active = False

        teleoperation_thread = threading.Thread(
            target=teleoperation_worker, name="teleoperation-worker", daemon=True
        )
        teleoperation_thread.start()

        return {
            "success": True,
            "message": "Teleoperation started successfully",
            "leader_port": request.leader_port,
            "follower_port": request.follower_port,
            "gripper_force_feedback": request.gripper_force_feedback,
        }

    except Exception as e:
        # Connection (or setup) failed before the loop started: release any
        # device that did open, reset state, and surface the error.
        _safe_disconnect(robot)
        _safe_disconnect(teleop_device)
        teleoperation_active = False
        current_robot = None
        current_teleop = None
        gripper_force_feedback_active = False
        logger.error(f"Failed to start teleoperation: {e}")
        # str(e) is already a user-facing message for the connection failures
        # raised above; the toast title supplies the "error starting" context.
        return {"success": False, "message": str(e)}


def handle_stop_teleoperation() -> dict[str, Any]:
    """Handle stop teleoperation request.

    Signals the worker via `teleoperation_active = False` and waits for it to
    exit. The worker owns the disconnect call, so this avoids racing the
    serial bus from the request thread.
    """
    global teleoperation_active, teleoperation_thread, teleoperation_stop_reason

    if not teleoperation_active:
        return {"success": False, "message": "No teleoperation session is active"}

    logger.info("Stop teleoperation triggered from web interface")
    teleoperation_stop_reason = "Stopped by user"
    teleoperation_active = False

    worker = teleoperation_thread
    if worker is not None and worker.is_alive():
        worker.join(timeout=5.0)
        if worker.is_alive():
            logger.warning("Teleoperation worker did not exit within 5s")
    teleoperation_thread = None

    return {"success": True, "message": "Teleoperation stopped successfully"}


def handle_teleoperation_status() -> dict[str, Any]:
    """Handle teleoperation status request"""
    return {
        "teleoperation_active": teleoperation_active,
        "gripper_force_feedback": gripper_force_feedback_active,
        "stop_reason": teleoperation_stop_reason,
        "available_controls": {
            "stop_teleoperation": teleoperation_active,
        },
        "message": "Teleoperation status retrieved successfully",
    }


def handle_get_joint_positions() -> dict[str, Any]:
    """Handle get current robot joint positions request"""
    global current_robot

    if not teleoperation_active or current_robot is None:
        return {"success": False, "message": "No active teleoperation session"}

    try:
        joint_positions = get_joint_positions_from_robot(current_robot)
        return {"success": True, "joint_positions": joint_positions, "timestamp": time.time()}
    except Exception as e:
        logger.error(f"Error getting joint positions: {e}")
        return {"success": False, "message": f"Failed to get joint positions: {str(e)}"}
