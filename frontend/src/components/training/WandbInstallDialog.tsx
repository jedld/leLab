import React, { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useApi } from "@/contexts/ApiContext";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  XCircle,
} from "lucide-react";

type InstallState = "idle" | "installing" | "done" | "error";

interface LogEntry {
  timestamp: number;
  message: string;
}

interface InstallStatus {
  state: InstallState;
  error: string | null;
  logs: LogEntry[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installHint: string;
}

const POLL_INTERVAL_MS = 1500;

const WandbInstallDialog: React.FC<Props> = ({ open, onOpenChange, installHint }) => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const { toast } = useToast();

  const [state, setState] = useState<InstallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logBoxRef = useRef<HTMLDivElement>(null);

  // Seed local state from the backend whenever the dialog is opened, so a
  // refresh-mid-install picks up where we left off.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchWithHeaders(`${baseUrl}/system/wandb-extra/install-status`)
      .then((r) => r.json())
      .then((status: InstallStatus) => {
        if (cancelled) return;
        setState(status.state);
        setError(status.error);
        if (status.logs.length > 0) {
          setLogs(status.logs);
        }
      })
      .catch(() => {
        // Backend unreachable — stay in idle; the user can still try.
      });
    return () => {
      cancelled = true;
    };
  }, [open, baseUrl, fetchWithHeaders]);

  // Poll while installing.
  useEffect(() => {
    if (state !== "installing") return;
    const id = setInterval(async () => {
      try {
        const r = await fetchWithHeaders(`${baseUrl}/system/wandb-extra/install-status`);
        if (!r.ok) return;
        const status: InstallStatus = await r.json();
        if (status.logs && status.logs.length > 0) {
          setLogs((prev) => [...prev, ...status.logs]);
        }
        if (status.state !== "installing") {
          setState(status.state);
          setError(status.error);
        }
      } catch {
        // Transient errors are fine; we'll retry on next tick.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [state, baseUrl, fetchWithHeaders]);

  // Auto-scroll the log panel as new lines arrive.
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  const handleInstall = async () => {
    setState("installing");
    setError(null);
    setLogs([]);
    try {
      const r = await fetchWithHeaders(`${baseUrl}/system/wandb-extra/install`, {
        method: "POST",
      });
      const body: { started: boolean; message: string } = await r.json();
      if (!body.started && r.ok) {
        return;
      }
      if (!r.ok) {
        setState("error");
        setError(body.message || `Install request failed (${r.status})`);
      }
    } catch (e) {
      setState("error");
      setError(`Install request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRetry = () => {
    setState("idle");
    setError(null);
    setLogs([]);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(installHint);
      toast({ title: "Copied", description: installHint });
    } catch {
      toast({
        title: "Copy failed",
        description: "Select the command and copy manually.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-white">
            {state === "done" ? (
              <CheckCircle2 className="w-6 h-6 text-green-400" />
            ) : state === "error" ? (
              <XCircle className="w-6 h-6 text-red-400" />
            ) : state === "installing" ? (
              <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
            ) : (
              <AlertTriangle className="w-6 h-6 text-amber-400" />
            )}
            {state === "done"
              ? "Install Complete"
              : state === "error"
              ? "Install Failed"
              : state === "installing"
              ? "Installing…"
              : "Weights & Biases Not Installed"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {state === "idle" && (
            <>
              <p className="text-slate-300">
                Enabling W&B logging requires the <code className="px-1 py-0.5 rounded bg-slate-900 text-sky-300">wandb</code> package, which isn't installed in this environment. Install it to log this run to W&B.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono">
                  {installHint}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCopy}
                  className="text-slate-400 hover:text-white"
                  aria-label="Copy install command"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <Button
                onClick={handleInstall}
                className="bg-green-500 hover:bg-green-600 text-white font-semibold"
              >
                Install Now
              </Button>
            </>
          )}

          {state === "installing" && (
            <p className="text-slate-300">
              Installing <code className="px-1 py-0.5 rounded bg-slate-900 text-sky-300">wandb</code>. This usually takes about 10 seconds.
            </p>
          )}

          {state === "done" && (
            <div className="space-y-3 text-slate-300">
              <p>
                Install complete. Restart <code className="px-1 py-0.5 rounded bg-slate-900 text-sky-300">lelab</code> to enable W&B logging:
              </p>
              <ol className="list-decimal list-inside space-y-2 pl-1">
                <li>
                  Press <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-600 text-xs font-mono text-slate-200">Ctrl+C</kbd> in the terminal running <code className="px-1 py-0.5 rounded bg-slate-900 text-sky-300">lelab</code>.
                </li>
                <li>
                  Run <code className="px-1 py-0.5 rounded bg-slate-900 text-sky-300">lelab</code> again.
                </li>
              </ol>
            </div>
          )}

          {state === "error" && (
            <>
              <p className="text-red-300">{error || "Install failed."}</p>
              <Button
                onClick={handleRetry}
                className="bg-slate-700 hover:bg-slate-600 text-white"
              >
                Try again
              </Button>
            </>
          )}

          {state === "error" && logs.length > 0 && (
            <div
              ref={logBoxRef}
              className="bg-slate-900 rounded-lg p-3 h-48 overflow-y-auto font-mono text-xs border border-slate-700 text-slate-300 whitespace-pre-wrap break-words"
            >
              {logs.map((log, idx) => (
                <div key={idx}>{log.message}</div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WandbInstallDialog;
