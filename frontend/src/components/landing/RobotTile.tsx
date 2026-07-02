import React, { useState } from "react";
import { Settings, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RobotRecord } from "@/hooks/useRobots";
import { TeleoperationCapabilities } from "@/hooks/useTeleoperationCapabilities";
import RobotSelector from "./RobotSelector";

interface RobotTileProps {
  robot: RobotRecord | null;
  selectedName: string | null;
  availableNames: string[];
  isLoading: boolean;
  teleopCapabilities: TeleoperationCapabilities;
  onSelect: (name: string) => void;
  onCreateNew: (name: string) => Promise<boolean>;
  onConfigure: (name: string) => void;
  onTeleop: (robot: RobotRecord, options: { gripperForceFeedback: boolean }) => void;
  onDelete: (name: string) => void;
}

const RobotTile: React.FC<RobotTileProps> = ({
  robot,
  selectedName,
  availableNames,
  isLoading,
  teleopCapabilities,
  onSelect,
  onCreateNew,
  onConfigure,
  onTeleop,
  onDelete,
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [gripperForceFeedback, setGripperForceFeedback] = useState(false);
  const status = robot ? (robot.is_clean ? "Ready" : "Needs configuration") : null;
  const teleopDisabled = !robot || !robot.is_clean;
  const gripperFeedbackAvailable = teleopCapabilities.gripper_force_feedback;

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-3 flex flex-col gap-2 relative">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <RobotSelector
            selectedName={selectedName}
            availableNames={availableNames}
            onSelect={onSelect}
            onCreateNew={onCreateNew}
            isLoading={isLoading}
          />
        </div>
        {status && (
          <p
            className={`text-xs truncate shrink-0 ${
              robot!.is_clean ? "text-green-400" : "text-amber-400"
            }`}
          >
            {status}
          </p>
        )}
        {robot && (
          <div className="flex items-center gap-1 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-gray-300 hover:text-white"
                  onClick={() => onConfigure(robot.name)}
                  aria-label="Configure"
                >
                  <Settings className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Configure (calibrate)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-900/20"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete robot"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete robot config</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {robot && (
        <>
          {gripperFeedbackAvailable && (
            <div className="flex items-start gap-3">
              <Checkbox
                id={`gripper-force-feedback-${robot.name}`}
                checked={gripperForceFeedback}
                onCheckedChange={(value) => setGripperForceFeedback(value === true)}
                disabled={teleopDisabled}
                className="mt-0.5 border-gray-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:border-yellow-500"
              />
              <div className="space-y-1">
                <Label
                  htmlFor={`gripper-force-feedback-${robot.name}`}
                  className={`text-sm font-medium cursor-pointer ${
                    teleopDisabled ? "text-gray-500" : "text-gray-200"
                  }`}
                >
                  Gripper force feedback
                </Label>
                <p className="text-xs text-gray-500">
                  {teleopCapabilities.robot_family_label}: feel resistance on the
                  leader gripper when the follower grasps something.
                </p>
              </div>
            </div>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="w-full">
                <Button
                  onClick={() => onTeleop(robot, { gripperForceFeedback })}
                  disabled={teleopDisabled}
                  className={`w-full ${
                    teleopDisabled
                      ? "bg-red-500/30 hover:bg-red-500/30 text-red-200 cursor-not-allowed"
                      : "bg-yellow-500 hover:bg-yellow-600 text-white"
                  }`}
                >
                  Teleoperation
                </Button>
              </div>
            </TooltipTrigger>
            {teleopDisabled && (
              <TooltipContent>Configure the robot first.</TooltipContent>
            )}
          </Tooltip>
        </>
      )}

      {robot && (
        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <DialogContent className="bg-gray-900 border-gray-800 text-white">
            <DialogHeader>
              <DialogTitle>Delete robot config?</DialogTitle>
              <DialogDescription className="text-gray-400">
                This deletes the robot config file from disk. Calibration files
                are not removed. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex gap-2 justify-end">
              <Button
                variant="outline"
                className="border-gray-600 text-gray-300"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
              <Button
                className="bg-red-500 hover:bg-red-600 text-white"
                onClick={async () => {
                  setConfirmDelete(false);
                  await onDelete(robot.name);
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default RobotTile;
