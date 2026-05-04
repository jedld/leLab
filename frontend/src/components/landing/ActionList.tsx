import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, AlertTriangle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Action } from "./types";

interface ActionListProps {
  actions: Action[];
}

const ActionList: React.FC<ActionListProps> = ({ actions }) => {
  return (
    <TooltipProvider>
      <div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {actions.map((action, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 bg-gray-800 rounded-lg border border-gray-700"
            >
              <div className="flex items-center gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-lg text-left">
                      {action.title}
                    </h3>
                    {action.isWorkInProgress && (
                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger>
                            <AlertTriangle className="w-4 h-4 text-yellow-500" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Work in progress</p>
                          </TooltipContent>
                        </Tooltip>
                        <span className="text-yellow-500 text-xs font-medium">
                          Work in Progress
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm text-left">
                    {action.description}
                  </p>
                </div>
              </div>
              <Button
                onClick={action.handler}
                size="icon"
                className={`${action.color} text-white`}
              >
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
};

export default ActionList;
