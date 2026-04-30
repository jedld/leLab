import React, { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AddRobotPickerProps {
  hiddenNames: string[];
  onAddExisting: (name: string) => void;
  onCreateNew: (name: string) => Promise<boolean>;
  isLoading: boolean;
}

const AddRobotPicker: React.FC<AddRobotPickerProps> = ({
  hiddenNames,
  onAddExisting,
  onCreateNew,
  isLoading,
}) => {
  const [selected, setSelected] = useState("");
  const [newName, setNewName] = useState("");

  const handleAdd = async () => {
    const trimmed = newName.trim();
    if (trimmed) {
      const ok = await onCreateNew(trimmed);
      if (ok) {
        setNewName("");
        setSelected("");
      }
      return;
    }
    if (selected) {
      onAddExisting(selected);
      setSelected("");
    }
  };

  const canAdd = newName.trim().length > 0 || selected.length > 0;

  return (
    <div className="bg-gray-800/50 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="space-y-2">
        <Label className="text-sm font-medium text-gray-300">
          Existing Robots
        </Label>
        <Select value={selected} onValueChange={setSelected} disabled={isLoading}>
          <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
            <SelectValue
              placeholder={
                isLoading
                  ? "Loading..."
                  : hiddenNames.length === 0
                  ? "No hidden robots"
                  : "Select a robot"
              }
            />
          </SelectTrigger>
          <SelectContent className="bg-gray-800 border-gray-700">
            {hiddenNames.map((name) => (
              <SelectItem
                key={name}
                value={name}
                className="text-white hover:bg-gray-700"
              >
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium text-gray-300">
          New Robot Name
        </Label>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="e.g., left-arm"
          className="bg-gray-800 border-gray-700 text-white"
        />
      </div>

      <div className="space-y-2 flex flex-col justify-end">
        <Button
          onClick={handleAdd}
          disabled={!canAdd}
          className="bg-blue-500 hover:bg-blue-600 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Robot
        </Button>
      </div>
    </div>
  );
};

export default AddRobotPicker;
