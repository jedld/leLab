import { useEffect, useState } from "react";
import { useApi } from "@/contexts/ApiContext";

export interface TeleoperationCapabilities {
  robot_family: string;
  robot_family_label: string;
  gripper_force_feedback: boolean;
}

const DEFAULT_CAPABILITIES: TeleoperationCapabilities = {
  robot_family: "so_leader_follower",
  robot_family_label: "SO-100 / SO-101 leader–follower",
  gripper_force_feedback: false,
};

export const useTeleoperationCapabilities = () => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const [capabilities, setCapabilities] =
    useState<TeleoperationCapabilities>(DEFAULT_CAPABILITIES);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetchWithHeaders(`${baseUrl}/teleoperation-capabilities`);
        const data = await res.json();
        if (cancelled) return;
        setCapabilities({
          robot_family: data.robot_family ?? DEFAULT_CAPABILITIES.robot_family,
          robot_family_label:
            data.robot_family_label ?? DEFAULT_CAPABILITIES.robot_family_label,
          gripper_force_feedback: Boolean(data.gripper_force_feedback),
        });
      } catch {
        if (!cancelled) setCapabilities(DEFAULT_CAPABILITIES);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, fetchWithHeaders]);

  return { capabilities, isLoading };
};
