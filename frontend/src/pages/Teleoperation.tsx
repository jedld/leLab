import React, { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import VisualizerPanel from "@/components/control/VisualizerPanel";
import TeleopCameraPanel from "@/components/control/TeleopCameraPanel";
import { useToast } from "@/hooks/use-toast";
import { useApi } from "@/contexts/ApiContext";

const STATUS_POLL_MS = 2000;

const TeleoperationPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { baseUrl, fetchWithHeaders } = useApi();

  // Stop teleoperation exactly once, however the user leaves, so the back
  // button, an in-app link, and the unmount safety net can't double-stop or
  // double-toast.
  const stoppedRef = useRef(false);
  const stopTeleoperation = useCallback(async () => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    try {
      const res = await fetchWithHeaders(`${baseUrl}/stop-teleoperation`, {
        method: "POST",
      });
      const data = await res.json();
      if (data?.success) {
        toast({
          title: "Teleoperation stopped",
          description: "The arm was disconnected cleanly.",
        });
      }
    } catch {
      /* best-effort */
    }
  }, [baseUrl, fetchWithHeaders, toast]);

  // Cover every exit path so a session can't keep running and block the next
  // start with "already active":
  //   - the back button awaits stopTeleoperation() then navigates (below);
  //   - any other in-app navigation unmounts this component → stop via cleanup;
  //   - a browser-level leave (URL change, reload, tab close) never runs React
  //     cleanup, so `pagehide` fires a keepalive stop that survives the unload
  //     and stashes a flag the next page reads to confirm the clean disconnect.
  //     It uses a bare fetch (no JSON Content-Type) so the request stays a CORS
  //     "simple request" and isn't dropped to a preflight mid-unload.
  //   - pagehide with `persisted` (bfcache) is ignored so backgrounding the
  //     tab does not kill an active session.
  useEffect(() => {
    const handlePageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      try {
        sessionStorage.setItem("lelab:teleop-stopped", "1");
      } catch {
        /* sessionStorage may be unavailable; the stop below still runs */
      }
      fetch(`${baseUrl}/stop-teleoperation`, {
        method: "POST",
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      stopTeleoperation();
    };
  }, [baseUrl, stopTeleoperation]);

  // If the backend worker dies (serial glitch, unplug, etc.) while this page
  // is still open, surface it instead of leaving the user moving a dead leader.
  useEffect(() => {
    let cancelled = false;

    const pollStatus = async () => {
      try {
        const res = await fetchWithHeaders(`${baseUrl}/teleoperation-status`);
        const data = await res.json();
        if (cancelled || stoppedRef.current) return;
        if (data?.teleoperation_active) return;

        stoppedRef.current = true;
        const reason =
          typeof data?.stop_reason === "string" && data.stop_reason
            ? data.stop_reason
            : "The teleoperation session ended unexpectedly.";
        toast({
          title: "Teleoperation ended",
          description: reason,
          variant: "destructive",
        });
        navigate("/");
      } catch {
        /* best-effort; keep polling */
      }
    };

    const interval = setInterval(pollStatus, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [baseUrl, fetchWithHeaders, navigate, toast]);

  const handleGoBack = async () => {
    await stopTeleoperation();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-2 sm:p-4">
      <div className="w-full h-[95vh] flex">
        <VisualizerPanel
          onGoBack={handleGoBack}
          className="lg:w-full"
          rightSlot={<TeleopCameraPanel />}
        />
      </div>
    </div>
  );
};

export default TeleoperationPage;
